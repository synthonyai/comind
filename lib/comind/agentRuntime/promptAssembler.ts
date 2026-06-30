// lib/agentRuntime/promptAssembler.ts
import { AgentContextData } from '@/lib/comind/agentRuntime/types';

export function assembleAgentPrompt(data: AgentContextData): string {
    const { agentProfile, context, goals, intentionWeighted, recentContext, artifacts, userMessage, conversationContext } = data;

    const systemPrompt = `
You are a Context Guide for this space.

# Agent Identity
- Name: ${agentProfile?.name || 'Guide'}
- Role: ${agentProfile?.description || 'A helpful AI assistant.'}

# Context
- Seed Intent: ${context?.seedIntent || 'Not defined'}
- Why It Matters: ${context?.whyItMatters || 'Not defined'}
- Description: ${context?.description || 'Not defined'}
- Current Direction: ${context?.direction || 'Not defined'}

# Values / Primary Directives
${context?.values?.length ? context.values.map(v => `- ${v}`).join('\n') : '- None defined'}

# Constraints
${context?.constraints?.length ? context.constraints.map(c => `- ${c}`).join('\n') : '- None defined'}

# Active Goals
${goals?.length ? goals.map(g => `- [ID:${g.id}] [${g.status}] ${g.title} (weight: ${g.weight})`).join('\n') : '- No active goals'}

# Behavioral Instructions
${agentProfile?.directives?.length ? agentProfile.directives.map(d => `- ${d}`).join('\n') : '- None defined'}

# Watch Words
${agentProfile?.watchWords?.length ? agentProfile.watchWords.join(', ') : 'None'}

# Output Constraint
You MUST respond only with a single, valid JSON object that strictly adheres to the 'AgentActionOutput' interface.
DO NOT include any conversation, markdown outside the JSON, or explanations.

# Memory Critic Instructions
After generating your 'response', distil any durable meaning from the exchange into
'memoryCritic.artifacts' — an array of 0 or more typed artifacts. Choose the type that
fits each piece of derived meaning:
- DECISION   — a choice that was made (and ideally why).
- INSIGHT    — a realization, pattern, or non-obvious conclusion.
- FACT       — a stable piece of information worth remembering.
- TASK       — something to be done / followed up on.
- QUESTION   — an open question to revisit later.
- CONSTRAINT — a limit, rule, or boundary to respect going forward.
- SUMMARY    — a condensed recap of a larger arc.

For each artifact provide a concise 'content', an optional short 'title', a 'confidence'
(0–1), relevant 'tags', and 'sourceEntryIds' listing which RELEVANT MEMORIES (by their
[ID:…]) it derives from. When an artifact advances one or more ACTIVE GOALS, add
'goalLinks': for each, the goal's 'goalId' (the [ID:…] shown under Active Goals), a
'strength' (0–1, how strongly it serves that goal), and a short 'rationale'. Only link
goals genuinely served — omit goalLinks otherwise. Guidance:
1. Emit MULTIPLE artifacts when the turn produced several distinct pieces of meaning;
   emit an EMPTY array when nothing genuinely new emerged. Do not invent filler.
2. Consider the FULL CONVERSATION ARC, not just the latest message.
3. If you heavily relied on any specific RELEVANT MEMORIES, also include them in
   'updatesToRecalledMemories' with a boosted 'newImportanceScore'.
    `;

    const intentionMemories = intentionWeighted.map(entry =>
        `[ID:${entry.id}] (Intention:${Math.round(entry.intention * 100)}%) CONTENT: "${entry.content.trim().substring(0, 300)}..."`
    ).join('\n---\n');

    const recentChat = recentContext.map(entry =>
        `[ID:${entry.id}] CONTEXT: "${entry.content.trim().substring(0, 300)}..."`
    ).join('\n');

    let conversationThread = '';
    if (conversationContext && conversationContext.chatHistory.length > 0) {
        conversationThread = `
# Conversation Thread
This conversation started with:
"${conversationContext.originalEntry}"

Then evolved through these exchanges:
${conversationContext.chatHistory.map(msg =>
    `${msg.role === 'user' ? 'User' : 'Assistant'}: "${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}"`
).join('\n')}

Latest message: "${userMessage}"
        `;
    }

    const artifactsBlock = artifacts?.length
        ? artifacts.map(a =>
            `[${a.type}] (confidence:${Math.round(a.confidence * 100)}%) "${a.content.trim().substring(0, 300)}${a.content.length > 300 ? '...' : ''}"`
          ).join('\n---\n')
        : null;

    const finalInstruction = `
# Contextual Memory

--- PAST REFLECTIONS (Agent Artifacts) ---
${artifactsBlock ?? "No past reflections yet."}

--- RELEVANT MEMORIES (Intention-Weighted) ---
${intentionMemories.length > 0 ? intentionMemories : "No highly relevant memories found."}

--- RECENT CONTEXT ---
${recentChat.length > 0 ? recentChat : "No recent context found."}

${conversationThread}

# User Interaction
${conversationThread ? 'Current message' : 'User'}: "${userMessage}"

# Task
${conversationThread ?
    `Evaluate the FULL CONVERSATION ARC. Consider how it evolved, what new insights emerged, and whether any genuine turning points occurred. Only emit artifacts for meaning that genuinely emerged; otherwise leave the artifacts array empty.` :
    `Formulate your response based on the above context and profile.`
}

Package your reply into the required JSON format.
    `;

    return systemPrompt + '\n' + finalInstruction;
}