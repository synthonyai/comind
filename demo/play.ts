/**
 * The reference demo — Rung 1 (scripted transcript).
 * ---------------------------------------------------------------------------
 * Seeds a world through the in-memory store, then runs the REAL `runAgent`
 * across the scenario's dispatches, rendering the evolving mind-state each turn
 * from the `DecisionTrace`. The **dispatch reset** is the heart: between
 * dispatches the conversation window is dropped (a cold boot), while the store
 * persists — so any recall in dispatch 2 had to come from CoMind, not the
 * window. That is the memory beat the PRD is built around.
 *
 *   npm run demo:play            # real providers if OPENAI_API_KEY is set, else offline
 *   npm run demo:play -- --offline   # force deterministic stubs (no keys/DB/network)
 *
 * Run with NO DATABASE_URL: this uses the in-memory store, never Prisma.
 */

import { createComind, type EmbeddingProvider, type LLMProvider, type AgentActionOutput, type RunAgentContext } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, ScriptedLLM } from "@/demo/stubProviders";
import { robotDetective } from "@/demo/scenarios/robotDetective";
import { renderWorldHeader, renderDispatchBanner, renderTurn } from "@/demo/render";
import { createPanel } from "@/demo/panel";
import { seedWorld } from "@/demo/seedWorld";
import type { Turn } from "@/demo/scenarioTypes";

const log = console.log;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manual step: park until the viewer presses a key, so they can sit on each frame
 * and diff the right panel themselves (the auto-pace timer is easy to blink past).
 * space/enter advance; q or Ctrl-C quit. Falls back to a no-op when stdin isn't a
 * TTY (piped/CI), so capture runs still complete.
 */
function waitForKey(hint: string): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.resolve();
  process.stdout.write(hint);
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf: Buffer) => {
      const key = buf.toString();
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      if (key === "q" || buf[0] === 3) process.exit(0); // q / Ctrl-C
      resolve();
    };
    stdin.on("data", onData);
  });
}

/** Silence runAgent's internal `[AGENT] …` chatter so the transcript stays clean. */
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith("[AGENT]")) return;
    orig(...(a as []));
  };
  return fn().finally(() => { console.log = orig; });
}

/**
 * Build one turn's offline critic output, resolving goal keys + source-record
 * keys to the ids minted during this run. Provenance (`sourceEntryIds`) is
 * authored EXPLICITLY from `sourceKeys` — never the runtime's "all recalled
 * entries" fallback — so a conclusion only ever claims the clue it truly came
 * from, and prefer-artifact dedup stays honest.
 */
function buildOfflineOutput(
  turn: Turn,
  goalKeyToId: Record<string, string>,
  recordKeyToId: Record<string, string>,
): AgentActionOutput {
  return {
    response: turn.offline.response,
    memoryCritic: {
      artifacts: (turn.offline.artifacts ?? []).map((a) => ({
        type: a.type,
        content: a.content,
        title: a.title,
        confidence: a.confidence,
        tags: a.tags,
        sourceEntryIds: (a.sourceKeys ?? []).map((k) => recordKeyToId[k]).filter(Boolean),
        goalLinks: (a.goalKeys ?? []).map((k) => ({
          goalId: goalKeyToId[k],
          strength: 0.8,
          rationale: a.goalRationale,
        })),
      })),
      updatesToRecalledMemories: [],
    },
  };
}

async function main() {
  const scenario = robotDetective;
  const forceOffline = process.argv.includes("--offline");
  const offline = forceOffline || !process.env.OPENAI_API_KEY;

  // Rung 2: --tui swaps the scrolling transcript for the persistent split-pane,
  // same engine + same trace. --pace <ms> sets the per-turn dwell so a viewer can
  // watch the panel re-rank in place (0 = instant, for capture/CI).
  const tui = process.argv.includes("--tui");
  // --step parks on each frame until a keypress, instead of auto-advancing on the
  // pace timer — so a viewer can sit on a turn and diff the right panel. It wins
  // over --pace when both are set.
  const step = process.argv.includes("--step");
  const paceArg = process.argv.indexOf("--pace");
  const pace = paceArg >= 0 ? Number(process.argv[paceArg + 1]) || 0 : tui ? 1400 : 0;

  const store = new InMemoryMemoryStore();

  // --- Embeddings: stub offline, real HuggingFace for the showcase path. ---
  const embeddings: EmbeddingProvider = offline
    ? new StubEmbeddings()
    : new (await import("@/lib/comind/adapters/huggingFaceEmbeddingProvider")).HuggingFaceEmbeddingProvider();

  // --- Seed the world (the host's setup), all through the store. ---
  const w = scenario.world;
  const { ctxId, goalKeyToId } = await seedWorld(store, embeddings, w);
  const ctx = { id: ctxId };

  // --- LLM: scripted offline (output set per turn), OpenAI for the real path. ---
  const llm: LLMProvider = offline
    ? new ScriptedLLM()
    : new (await import("@/lib/comind/adapters/openAILLMProvider")).OpenAILLMProvider();
  const scripted = offline ? (llm as ScriptedLLM) : undefined;
  const comind = createComind({ userId: "demo", store, embeddings, llm });

  // Record keys → entry ids, populated as observations are stored during the run.
  const recordKeyToId: Record<string, string> = {};

  const panel = tui
    ? createPanel({ title: scenario.title, directives: w.profile.directives, values: w.context.values ?? [] })
    : null;

  if (!tui) {
    log(`\n[demo] mode: ${offline ? "OFFLINE (deterministic stubs)" : "REAL (live providers)"}`);
    log(renderWorldHeader({
      title: scenario.title,
      directives: w.profile.directives,
      values: w.context.values ?? [],
      goals: w.goals.map((g) => ({ title: g.title, weight: g.weight })),
    }));
  }

  // --- Run the dispatches. The window resets at each dispatch boundary. ---
  for (const dispatch of scenario.dispatches) {
    if (panel) panel.setDispatch(dispatch.label, dispatch.reason);
    else log(renderDispatchBanner(dispatch.label, dispatch.reason));

    // Goal-lifecycle changes for this dispatch (e.g. completing the culprit goal)
    // are applied to the STORE — a real host call, not a demo shortcut — so the
    // intention lens genuinely loses those terms on the next recall. The identity
    // core (seedIntent/values/directives) has no setter and cannot be touched.
    for (const gu of dispatch.goalUpdates ?? []) {
      const goalId = goalKeyToId[gu.key];
      if (goalId) await store.updateGoal(goalId, gu.patch);
    }

    // The per-session window. Dropped here = the reset; the store persists.
    let chatHistory: RunAgentContext["chatHistory"] = [];
    const firstMessage = dispatch.turns[0]?.message ?? "";

    for (const turn of dispatch.turns) {
      // Record the raw observation FIRST (the host's job in both modes), so it's
      // in the store before recall runs and can be cited as provenance.
      if (turn.record) {
        const entry = await store.createMemoryEntry({
          contextId: ctx.id,
          type: "NOTE",
          content: turn.record.content,
          tags: turn.record.tags,
          attributionType: turn.record.attribution,
          embedding: await embeddings.embed(turn.record.content),
        });
        recordKeyToId[turn.record.key] = entry.id;
      }

      // Offline: hand the scripted critic this turn's output (ids now resolvable).
      scripted?.setNext(buildOfflineOutput(turn, goalKeyToId, recordKeyToId));

      const context: RunAgentContext = { originalEntry: firstMessage, chatHistory };
      const { response, trace } = await quiet(() => comind.runAgent(ctx.id, turn.message, context));
      if (panel) {
        panel.renderTurn({ feed: turn.feed, response, trace });
        if (step) await waitForKey("\n  ⏎ space/enter → next turn · q → quit");
        else if (pace > 0) await sleep(pace);
      } else {
        log(renderTurn({ feed: turn.feed, response, trace }));
        if (step) await waitForKey("\n  ⏎ space/enter → next turn · q → quit");
      }
      chatHistory = [...chatHistory, { role: "user", content: turn.message }, { role: "assistant", content: response }];
    }
  }

  if (!tui) log("\n[demo] ✅ done — the case persisted across the reset in CoMind, not the window.\n");
}

main().catch((e) => { console.error("[demo] error:", e); process.exitCode = 1; });
