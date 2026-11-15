/**
 * InMemoryMemoryStore — a pure-TypeScript `MemoryStore`, the reference demo's
 * proof that the CoMind boundary actually holds.
 *
 * This file is *consumer* code: it lives outside `lib/comind/` and imports ONLY
 * the public contract from the `@/lib/comind` barrel (types are erased at
 * runtime, so this module pulls in zero Prisma / Postgres / Next at runtime).
 * If `runAgent` can run against this, PRD success criteria #1 ("embed by
 * implementing the three interfaces") and #2 ("no Prisma leak") are demonstrated,
 * not just asserted.
 *
 * Similarity: cosine distance (`1 - cos`), so smaller = closer, matching the
 * `<->` ordering the Prisma store returns. Distances are NOT comparable across
 * stores (per the interface contract) — only their ordering within this store is.
 *
 * NOTE (scope): this implements the CURRENT 9-method `MemoryStore` interface.
 * That covers the candidate similarity search, but `runAgent`'s intention
 * weighting, row hydration, profile/context/goal reads, and ALL write-back still
 * call Prisma directly inside the runtime (see demo notes). Closing those is the
 * interface-extension step tracked separately; the verbs land here as they're
 * added to the contract.
 */

import { randomUUID } from "crypto";
import { nextActivation, governingInput } from "@/lib/comind";
import type {
  MemoryStore,
  NewMemoryEntry,
  MemoryEntryPatch,
  MemoryEntryFilters,
  SimilaritySearch,
  SimilarityHit,
  ArtifactSimilarityHit,
  NewArtifact,
  NewGoal,
  GoalPatch,
  GoalFilters,
  NewContext,
  NewAgentProfile,
  NewMemoryLink,
  MemoryLinkFilters,
  MemoryLink,
  MemoryEntry,
  MemoryArtifact,
  Context,
  AgentProfile,
  Goal,
  ContextPatch,
  AgentProfilePatch,
  GoverningItem,
  GoverningItemSeed,
  GoverningKind,
  NewGoverningItem,
  GoverningItemPatch,
  GoverningSuggestion,
  NewGoverningSuggestion,
} from "@/lib/comind";

/** Deep-enough copy so callers never mutate the store's lists. */
const clone = <T extends object>(o: T): T => structuredClone(o);

// --- Operational-signal defaults (mirror the schema's intent; tunable here). ---
const DEFAULTS = {
  importanceScore: 0.5,
  accessScore: 0.5,
  consolidationScore: 0.3, // matches ACTIVATION.CONSOLIDATION_BASE in actions.ts
  activationCount: 0,
  confidence: 0.5,
} as const;

/** Cosine distance in [0, 2]; smaller = closer. Returns null if unrankable. */
function cosineDistance(a: number[] | null, b: number[]): number | null {
  if (!a || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return null;
  return 1 - dot / denom;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly artifacts = new Map<string, MemoryArtifact>();
  /** Provenance: artifactId -> the entry ids it was distilled from. */
  private readonly artifactSources = new Map<string, string[]>();
  private readonly contexts = new Map<string, Context>();
  private readonly agentProfiles = new Map<string, AgentProfile>();
  private readonly goals = new Map<string, Goal>();
  private readonly links: MemoryLink[] = [];
  /** Goal-health links: artifactId -> goal links the critic wrote (not read back in v0.1). */
  private readonly artifactGoalLinks = new Map<
    string,
    { goalId: string; strength?: number; rationale?: string }[]
  >();

  // --- Memory entries -------------------------------------------------------

  async createMemoryEntry(input: NewMemoryEntry): Promise<MemoryEntry> {
    const now = new Date();
    const entry: MemoryEntry = {
      id: randomUUID(),
      contextId: input.contextId,
      type: input.type,
      subtype: input.subtype ?? null,
      title: input.title ?? null,
      content: input.content,
      tags: input.tags ?? [],
      timestamp: input.timestamp ?? now,
      capturedAt: now,
      embedding: input.embedding ?? null,
      importanceScore: input.importanceScore ?? DEFAULTS.importanceScore,
      accessScore: DEFAULTS.accessScore,
      consolidationScore: DEFAULTS.consolidationScore,
      activationCount: DEFAULTS.activationCount,
      lastActivatedAt: null,
      confidence: input.confidence ?? DEFAULTS.confidence,
      attributionType: input.attributionType ?? "AGENT_INFERRED",
      derivedFromId: input.derivedFromId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      sourceUri: input.sourceUri ?? null,
    };
    this.entries.set(entry.id, entry);
    return { ...entry };
  }

  async updateMemoryEntry(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry> {
    const existing = this.entries.get(id);
    if (!existing) throw new Error(`MemoryEntry ${id} not found`);
    const updated: MemoryEntry = {
      ...existing,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.embedding !== undefined ? { embedding: patch.embedding } : {}),
      ...(patch.importanceScore !== undefined ? { importanceScore: patch.importanceScore } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
    };
    this.entries.set(id, updated);
    return { ...updated };
  }

  async getMemoryEntry(id: string): Promise<MemoryEntry | null> {
    const e = this.entries.get(id);
    return e ? { ...e } : null;
  }

  async listMemoryEntries(filters: MemoryEntryFilters): Promise<MemoryEntry[]> {
    let rows = [...this.entries.values()].filter((e) => e.contextId === filters.contextId);
    if (filters.tagsAny?.length) {
      const want = new Set(filters.tagsAny);
      rows = rows.filter((e) => e.tags.some((t) => want.has(t)));
    }
    rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    if (filters.limit != null) rows = rows.slice(0, filters.limit);
    return rows.map((e) => ({ ...e }));
  }

  async searchSimilar(query: SimilaritySearch): Promise<SimilarityHit[]> {
    const limit = query.limit ?? 50;
    const want = query.tagsAny?.length ? new Set(query.tagsAny) : null;

    const hits: SimilarityHit[] = [];
    for (const entry of this.entries.values()) {
      if (query.contextId && entry.contextId !== query.contextId) continue;
      if (want && !entry.tags.some((t) => want.has(t))) continue;
      const distance = cosineDistance(entry.embedding, query.vector);
      if (distance === null) continue; // never-embedded: can't rank
      hits.push({ entry: { ...entry }, distance });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, limit);
  }

  async searchSimilarArtifacts(query: SimilaritySearch): Promise<ArtifactSimilarityHit[]> {
    const limit = query.limit ?? 50;
    const want = query.tagsAny?.length ? new Set(query.tagsAny) : null;

    const hits: ArtifactSimilarityHit[] = [];
    for (const artifact of this.artifacts.values()) {
      if (query.contextId && artifact.contextId !== query.contextId) continue;
      if (want && !artifact.tags.some((t) => want.has(t))) continue;
      const distance = cosineDistance(artifact.embedding, query.vector);
      if (distance === null) continue;
      hits.push({
        artifact: { ...artifact },
        sourceEntryIds: [...(this.artifactSources.get(artifact.id) ?? [])],
        distance,
      });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, limit);
  }

  async getArtifact(id: string): Promise<MemoryArtifact | null> {
    const a = this.artifacts.get(id);
    return a ? { ...a } : null;
  }

  async getLatestSummary(contextId: string): Promise<MemoryArtifact | null> {
    let latest: MemoryArtifact | null = null;
    for (const a of this.artifacts.values()) {
      if (a.contextId !== contextId || a.type !== "SUMMARY") continue;
      if (!latest || a.createdAt.getTime() > latest.createdAt.getTime()) latest = a;
    }
    return latest ? { ...latest } : null;
  }

  async setArtifactConsolidation(id: string, consolidationScore: number): Promise<MemoryArtifact | null> {
    const a = this.artifacts.get(id);
    if (!a) return null;
    const clamped = Math.max(0, Math.min(1, consolidationScore));
    const updated: MemoryArtifact = { ...a, consolidationScore: clamped, updatedAt: new Date() };
    this.artifacts.set(id, updated);
    return { ...updated };
  }

  async listPromotedArtifacts(contextId: string, minConsolidation: number, limit = 8): Promise<MemoryArtifact[]> {
    return [...this.artifacts.values()]
      .filter(
        (a) =>
          a.contextId === contextId &&
          a.type !== "SUMMARY" &&
          a.consolidationScore >= minConsolidation,
      )
      .sort((x, y) => y.consolidationScore - x.consolidationScore || y.createdAt.getTime() - x.createdAt.getTime())
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  async createArtifact(input: NewArtifact): Promise<MemoryArtifact> {
    const now = new Date();
    const artifact: MemoryArtifact = {
      id: randomUUID(),
      contextId: input.contextId,
      type: input.type,
      title: input.title ?? null,
      content: input.content,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 0.7,
      embedding: input.embedding ?? null,
      accessScore: DEFAULTS.accessScore,
      consolidationScore: DEFAULTS.consolidationScore,
      activationCount: DEFAULTS.activationCount,
      lastActivatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.artifacts.set(artifact.id, artifact);
    this.artifactSources.set(artifact.id, [...input.sourceEntryIds]);

    // Validate goal links against THIS context's goals (drop unknown/cross-context).
    if (input.goalLinks?.length) {
      const valid = input.goalLinks.filter((g) => {
        const goal = this.goals.get(g.goalId);
        return goal != null && goal.contextId === input.contextId;
      });
      if (valid.length) this.artifactGoalLinks.set(artifact.id, valid);
    }
    return { ...artifact };
  }

  async clearContextMemory(contextId: string): Promise<{ entries: number; artifacts: number }> {
    // Episodic tier: every entry in the context.
    let entries = 0;
    for (const [id, e] of this.entries) {
      if (e.contextId !== contextId) continue;
      this.entries.delete(id);
      entries++;
    }
    // Derived tier: every artifact in the context EXCEPT SUMMARY (the carryover
    // thread survives — same exclusion rule as listPromotedArtifacts).
    let artifacts = 0;
    for (const [id, a] of this.artifacts) {
      if (a.contextId !== contextId || a.type === "SUMMARY") continue;
      this.artifacts.delete(id);
      this.artifactSources.delete(id);
      this.artifactGoalLinks.delete(id);
      artifacts++;
    }
    // Governing memory (Context / AgentProfile / Goal) is untouched by design.
    return { entries, artifacts };
  }

  // --- The living loop (activation feedback) -------------------------------

  async activateEntries(ids: string[]): Promise<number> {
    const now = new Date();
    let n = 0;
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e) continue;
      this.entries.set(id, { ...e, ...nextActivation(e, now) });
      n++;
    }
    return n;
  }

  async activateArtifacts(ids: string[]): Promise<number> {
    const now = new Date();
    let n = 0;
    for (const id of ids) {
      const a = this.artifacts.get(id);
      if (!a) continue;
      this.artifacts.set(id, { ...a, ...nextActivation(a, now), updatedAt: now });
      n++;
    }
    return n;
  }

  // --- Context, goals & agent profile --------------------------------------

  async createContext(input: NewContext): Promise<Context> {
    const ctx: Context = {
      id: randomUUID(),
      name: input.name,
      seedIntent: input.seedIntent ?? null,
      whyItMatters: input.whyItMatters ?? null,
      direction: input.direction ?? null,
      summary: null,
      description: input.description ?? null,
      themes: input.themes ?? [],
      constraints: input.constraints ?? [],
      assumptions: input.assumptions ?? [],
      watchWords: this.items("watchWord", input.watchWords),
      parentId: input.parentId ?? null,
      isRoot: input.isRoot ?? false,
      createdAt: new Date(),
    };
    if (ctx.isRoot && (await this.getRootContextId())) throw new Error("A root context already exists");
    this.contexts.set(ctx.id, ctx);
    return clone(ctx);
  }

  async getContext(id: string): Promise<Context | null> {
    const c = this.contexts.get(id);
    return c ? clone(c) : null;
  }

  async updateContext(id: string, patch: ContextPatch): Promise<Context> {
    const c = this.contexts.get(id);
    if (!c) throw new Error(`Context ${id} not found`);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    Object.assign(c, defined);
    return clone(c);
  }

  async getRootContextId(): Promise<string | null> {
    for (const c of this.contexts.values()) {
      if (c.isRoot) return c.id;
    }
    return null;
  }

  // --- Governing items (stored with their owner) ----------------------------

  private items(kind: GoverningKind, seeds: GoverningItemSeed[] = []): GoverningItem[] {
    return seeds.map((seed, i) => {
      const s = governingInput(seed);
      return { id: randomUUID(), kind, text: s.text, priority: s.priority ?? 0.5, outranks: s.outranks ?? false, order: s.order ?? i };
    });
  }

  /** The list an item lives in: watch words on the context, directives on its agent profile. */
  private ownerList(contextId: string, kind: GoverningKind): GoverningItem[] {
    if (kind === "directive") {
      const profile = [...this.agentProfiles.values()].find((p) => p.homeContextId === contextId);
      if (!profile) throw new Error(`No agent profile for context ${contextId}`);
      return profile.directives;
    }
    const ctx = this.contexts.get(contextId);
    if (!ctx) throw new Error(`Context ${contextId} not found`);
    return ctx.watchWords;
  }

  private findItem(id: string): { list: GoverningItem[]; index: number } {
    const lists = [
      ...[...this.contexts.values()].map((c) => c.watchWords),
      ...[...this.agentProfiles.values()].map((p) => p.directives),
    ];
    for (const list of lists) {
      const index = list.findIndex((i) => i.id === id);
      if (index >= 0) return { list, index };
    }
    throw new Error(`Governing item ${id} not found`);
  }

  async createGoverningItem(input: NewGoverningItem): Promise<GoverningItem> {
    const list = this.ownerList(input.contextId, input.kind);
    const [item] = this.items(input.kind, [input]);
    item.order = input.order ?? list.length;
    list.push(item);
    return { ...item };
  }

  async updateGoverningItem(id: string, patch: GoverningItemPatch): Promise<GoverningItem> {
    const { list, index } = this.findItem(id);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    list[index] = { ...list[index], ...defined };
    return { ...list[index] };
  }

  async deleteGoverningItem(id: string): Promise<void> {
    const { list, index } = this.findItem(id);
    list.splice(index, 1);
  }

  // --- Suggestions (the mind proposes; the person approves) -----------------

  private readonly suggestions = new Map<string, GoverningSuggestion>();

  async createSuggestion(input: NewGoverningSuggestion): Promise<GoverningSuggestion> {
    if (!this.contexts.has(input.contextId)) throw new Error(`Context ${input.contextId} not found`);
    const s: GoverningSuggestion = {
      id: randomUUID(),
      contextId: input.contextId,
      kind: input.kind,
      text: input.text,
      priority: input.priority ?? 0.5,
      rationale: input.rationale ?? null,
      ...(input.kind === "goal" ? { standing: input.standing ?? false, supports: [...(input.supports ?? [])] } : {}),
      status: "pending",
      createdAt: new Date(),
    };
    this.suggestions.set(s.id, s);
    return clone(s);
  }

  async getSuggestion(id: string): Promise<GoverningSuggestion | null> {
    const s = this.suggestions.get(id);
    return s ? { ...s } : null;
  }

  async listSuggestions(contextId: string, status?: GoverningSuggestion["status"]): Promise<GoverningSuggestion[]> {
    return [...this.suggestions.values()]
      .filter((s) => s.contextId === contextId && (!status || s.status === status))
      .map((s) => ({ ...s }));
  }

  async setSuggestionStatus(id: string, status: GoverningSuggestion["status"]): Promise<GoverningSuggestion> {
    const s = this.suggestions.get(id);
    if (!s) throw new Error(`Suggestion ${id} not found`);
    s.status = status;
    return { ...s };
  }

  async createGoal(input: NewGoal): Promise<Goal> {
    const goal: Goal = {
      id: randomUUID(),
      contextId: input.contextId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "ACTIVE",
      weight: input.weight ?? 0.5,
      order: input.order ?? null,
      outranks: input.outranks ?? false,
      standing: input.standing ?? false,
      supports: [...(input.supports ?? [])],
      signs: { positive: [...(input.signs?.positive ?? [])], negative: [...(input.signs?.negative ?? [])] },
      parentId: input.parentId ?? null,
    };
    this.goals.set(goal.id, goal);
    return clone(goal);
  }

  async updateGoal(id: string, patch: GoalPatch): Promise<Goal> {
    const existing = this.goals.get(id);
    if (!existing) throw new Error(`Goal ${id} not found`);
    const updated: Goal = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.order !== undefined ? { order: patch.order } : {}),
      ...(patch.outranks !== undefined ? { outranks: patch.outranks } : {}),
      ...(patch.standing !== undefined ? { standing: patch.standing } : {}),
      ...(patch.supports !== undefined ? { supports: [...patch.supports] } : {}),
      signs: {
        positive: [...(patch.signs?.positive ?? existing.signs.positive)],
        negative: [...(patch.signs?.negative ?? existing.signs.negative)],
      },
    };
    this.goals.set(id, updated);
    return clone(updated);
  }

  async listGoals(filters: GoalFilters): Promise<Goal[]> {
    let rows = [...this.goals.values()].filter((g) => g.contextId === filters.contextId);
    if (filters.status) rows = rows.filter((g) => g.status === filters.status);
    rows.sort((a, b) => b.weight - a.weight);
    return rows.map((g) => clone(g));
  }

  async createAgentProfile(input: NewAgentProfile): Promise<AgentProfile> {
    const profile: AgentProfile = {
      id: randomUUID(),
      name: input.name ?? null,
      homeContextId: input.homeContextId ?? null,
      description: input.description ?? null,
      directives: this.items("directive", input.directives),
    };
    this.agentProfiles.set(profile.id, profile);
    return clone(profile);
  }

  async getAgentProfileForContext(contextId: string): Promise<AgentProfile | null> {
    for (const p of this.agentProfiles.values()) {
      if (p.homeContextId === contextId) return clone(p);
    }
    return null;
  }

  async updateAgentProfile(id: string, patch: AgentProfilePatch): Promise<AgentProfile> {
    const p = this.agentProfiles.get(id);
    if (!p) throw new Error(`Agent profile ${id} not found`);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    Object.assign(p, defined);
    return clone(p);
  }

  async createLink(input: NewMemoryLink): Promise<MemoryLink> {
    const existing = this.links.find((l) => l.fromId === input.fromId && l.toId === input.toId && l.type === input.type);
    if (existing) return { ...existing };
    const link: MemoryLink = {
      id: randomUUID(),
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      weight: input.weight ?? 1,
      attributionType: input.attributionType ?? "USER_EXPLICIT",
      rationale: input.rationale ?? null,
      createdAt: new Date(),
    };
    this.links.push(link);
    return { ...link };
  }

  async listLinks(filters: MemoryLinkFilters): Promise<MemoryLink[]> {
    const dir = filters.direction ?? "both";
    return this.links
      .filter((l) =>
        (dir !== "to" && l.fromId === filters.entryId) || (dir !== "from" && l.toId === filters.entryId))
      .filter((l) => !filters.type || l.type === filters.type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((l) => ({ ...l }));
  }
}
