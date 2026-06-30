// lib/agentRuntime/runAgent.ts
import { AgentActionOutput, RunAgentContext, RunAgentResult, DecisionTrace, agentActionSchema } from '@/lib/comind/agentRuntime/types';
import { assembleAgentPrompt } from '@/lib/comind/agentRuntime/promptAssembler';
import { getRecallData } from '@/lib/comind/agentRuntime/dataFetcher';
import { applyContextTokenBudget } from '@/lib/comind/agentRuntime/tokenBudget';
import type { LLMProvider, EmbeddingProvider, MemoryStore } from '@/lib/comind/providers';

const preview = (s: string, n = 160) => s.slice(0, n);

/**
 * Injected runtime dependencies (Bucket E / step 3). When omitted, the
 * batteries-included default adapters are used — the recall search routes its
 * embedder/store through getRecallData, and the LLM call defaults to OpenAI.
 */
export interface RunAgentDeps {
    store?: MemoryStore;
    embeddings?: EmbeddingProvider;
    llm?: LLMProvider;
    /** Token budget for the recall-driven memory blocks (default 4000). */
    tokenBudget?: number;
}

/**
 * The main orchestrator of the Cohesive Mind Agent Runtime (CAMA Loop).
 * @returns The user-facing response plus a decision trace (what was recalled,
 *          what the critic produced, what was reinforced) — Bucket E / step 2.
 */
export async function runAgent(
    userId: string,
    contextId: string,
    userMessage: string,
    context?: RunAgentContext,
    deps?: RunAgentDeps
): Promise<RunAgentResult> {

    console.log('[AGENT] 🚀 Starting memory consolidation for contextId', contextId)
    console.log('[AGENT] 📝 User message:', userMessage.slice(0, 100))

    try {
        // The three providers are required and shared across this whole call, so
        // recall (read) and the critic (write-back) hit the same instances —
        // essential for a non-Prisma store, where reads and writes must touch the
        // same in-memory state. The library ships no default backend; the host
        // injects them (e.g. via createComind).
        const store: MemoryStore | undefined = deps?.store;
        const embeddings: EmbeddingProvider | undefined = deps?.embeddings;
        const llm: LLMProvider | undefined = deps?.llm;
        if (!store || !embeddings || !llm) {
            throw new Error('CoMind: runAgent requires injected store, embeddings, and llm (no default backend).');
        }

        // --- 1. Context (Content -> Attention) ---
        console.log('[AGENT] 🔍 Fetching recall data...')
        const rawContextData = await getRecallData(userId, contextId, userMessage, context, {
            store,
            embeddings,
        });
        // Token budget + eviction (step 4) — trim the recall-driven blocks BEFORE
        // assembly, so prompt/activation/trace all reflect only what actually fit.
        const contextData = applyContextTokenBudget(rawContextData, { maxTokens: deps?.tokenBudget });
        console.log('[AGENT] ✅ Retrieved context data:', {
            hasProfile: !!contextData.agentProfile,
            hasContext: !!contextData.context,
            goalCount: contextData.goals.length,
            intentionCount: contextData.intentionWeighted.length,
            recentCount: contextData.recentContext.length,
            artifactCount: contextData.artifacts.length,
        })

        // --- 2. Reasoning Loop (Memory -> Action) ---
        console.log('[AGENT] 🤖 Assembling prompt...')
        const prompt = assembleAgentPrompt({
            agentProfile: contextData.agentProfile,
            context: contextData.context,
            goals: contextData.goals,
            intentionWeighted: contextData.intentionWeighted,
            recentContext: contextData.recentContext,
            artifacts: contextData.artifacts,
            userMessage: userMessage,
            conversationContext: context,
        });
        console.log('[AGENT] 📤 Calling LLM...')

        // Structured output via the injected LLMProvider (default: OpenAI gpt-4o).
        // The provider fills CoMind's own schema; the model lives in the adapter.
        // `agentActionSchema`'s `.default([])` makes its input type (artifacts
        // optional) differ from its output (artifacts required); generateStructured
        // infers the input shape, so assert the validated output type here.
        const actionOutput = await llm.generateStructured({
            prompt,
            schema: agentActionSchema,
            temperature: 0.1,
        }) as AgentActionOutput;
        console.log('[AGENT] ✅ LLM response received')

        // --- 3. Memory Critic Execution ---
        const critic = actionOutput.memoryCritic;
        console.log('[AGENT] 🧠 Memory critic:', {
            artifacts: critic.artifacts.length,
            updates: critic.updatesToRecalledMemories?.length || 0
        })

        // A. Create derived artifacts (0..n typed, embedded on creation)
        const recalledEntryIds = contextData.intentionWeighted.map(e => e.id);
        const producedArtifacts: DecisionTrace['produced']['artifacts'] = [];
        if (critic.artifacts.length) {
            console.log('[AGENT] 💾 Creating', critic.artifacts.length, 'artifact(s)...')
            const created = await Promise.all(critic.artifacts.map(async a => {
                // Critic may attribute sources per artifact; fall back to all
                // recalled entries when it omits them (preserves prior behavior).
                const sourceEntryIds = a.sourceEntryIds?.length ? a.sourceEntryIds : recalledEntryIds;
                // Embed via the INJECTED provider (same 'memory' instruction +
                // normalize as entries), then persist through the store — no direct
                // HuggingFace/Prisma. The store validates goal-link ids.
                const embedding = await embeddings.embed(a.content);
                const artifact = await store.createArtifact({
                    contextId,
                    type: a.type,
                    content: a.content,
                    title: a.title,
                    confidence: a.confidence ?? 0.7,
                    tags: a.tags ?? [],
                    embedding,
                    sourceEntryIds,
                    goalLinks: a.goalLinks,
                });
                return { artifact, requested: a, sourceEntryIds };
            }));
            for (const { artifact, requested, sourceEntryIds } of created) {
                producedArtifacts.push({
                    id: artifact.id,
                    type: artifact.type,
                    title: requested.title,
                    preview: preview(artifact.content),
                    sourceEntryIds,
                    goalLinks: requested.goalLinks ?? [],
                });
            }
        }

        // B. Update recalled memories (Feedback Loop) — critic's IMPORTANCE judgement.
        //    Routed through the store; the app-layer chatInteractions/lastAccessed
        //    bookkeeping is the host's concern, not the cognitive layer's.
        if (critic.updatesToRecalledMemories?.length) {
            console.log('[AGENT] ⬆️ Updating', critic.updatesToRecalledMemories.length, 'recalled memories...')
            await Promise.all(critic.updatesToRecalledMemories.map(update =>
                store.updateMemoryEntry(update.id, { importanceScore: update.newImportanceScore })
            ));
        }

        // C. Activation feedback (the living loop) — EVERY recalled memory OR
        //    artifact that surfaced was "used", independent of the critic.
        //    Strengthens its operational signals so use shapes future recall.
        //    Artifacts ride the same reinforcement rule as entries (P3).
        const recalledArtifactIds = contextData.artifacts.map(a => a.id);
        if (recalledEntryIds.length || recalledArtifactIds.length) {
            console.log('[AGENT] 🔆 Activating', recalledEntryIds.length, 'memories +', recalledArtifactIds.length, 'artifacts...')
            await Promise.all([
                store.activateEntries(recalledEntryIds),
                store.activateArtifacts(recalledArtifactIds),
            ]);
        }

        console.log('[AGENT] ✅ Memory consolidation complete')

        // --- 4. Return response + decision trace (inspectability #6, provenance #10) ---
        const trace: DecisionTrace = {
            lens: {
                seedIntent: contextData.context?.seedIntent ?? null,
                values: contextData.context?.values ?? [],
                directives: contextData.agentProfile?.directives ?? [],
                watchWords: contextData.agentProfile?.watchWords ?? [],
                activeGoals: contextData.goals
                    .filter(g => g.status === 'ACTIVE')
                    .map(g => ({ title: g.title, weight: g.weight })),
            },
            recalled: {
                entries: contextData.intentionWeighted.map(e => ({
                    id: e.id,
                    preview: preview(e.content),
                    intention: e.intention,
                    confidence: e.confidence,
                    attribution: e.attribution,
                })),
                artifacts: contextData.artifacts.map(a => ({
                    id: a.id,
                    type: a.type,
                    preview: preview(a.content),
                    intention: a.intention,
                    confidence: a.confidence,
                })),
            },
            produced: {
                artifacts: producedArtifacts,
                memoryUpdates: critic.updatesToRecalledMemories ?? [],
            },
            activated: { entryIds: recalledEntryIds, artifactIds: recalledArtifactIds },
        };

        return { response: actionOutput.response, trace };

    } catch (error) {
        console.error('[AGENT] ❌ ERROR in runAgent:', error)
        throw error
    }
}