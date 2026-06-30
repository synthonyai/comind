/**
 * The reference demo — Rung 3 (interactive REPL).
 * ---------------------------------------------------------------------------
 * Rung 1/2 replay a *scripted* case; Rung 3 hands you the prompt and lets you
 * drive one live. Same engine, same `DecisionTrace`, same in-memory store — the
 * only thing that changes is that the turns come from YOU, not a script. That is
 * the whole point of this rung: the smart recalls can't be staged, because you
 * pick the questions. If the mind surfaces the right memory, it earned it.
 *
 * You are driving a robot detective. You feed it clues, ask it questions, and —
 * crucially — you trigger the dispatch reset yourself with `/reset`: the chat
 * window is dropped (a cold boot) while the store persists, so anything it
 * recalls afterward came from CoMind, not the conversation. You can also move a
 * goal through its lifecycle (`/goal culprit done`) and watch the SAME memory
 * pile re-rank beneath the unchanged identity core — the #4/#13 focus-shift,
 * now on demand.
 *
 *   npm run demo:repl                 # real providers if OPENAI_API_KEY is set
 *   npm run demo:repl -- --offline    # recall-only (no keys): real recall +
 *                                     # persistence + re-rank, but no derivation
 *   npm run demo:repl -- --tui        # drive the persistent Rung 2 split-pane
 *
 * Run with NO DATABASE_URL: this uses the in-memory store, never Prisma.
 *
 * Honest note on `--offline`: derivation (raw clue → typed artifact) needs a
 * real LLM to read your arbitrary input. The offline stub can't, so offline is a
 * deliberately recall-only REPL — everything it shows (recall, persistence
 * across `/reset`, the goal-driven re-rank) is real; it just won't mint new
 * conclusions. Run without `--offline` for the full loop.
 */

import readline from "readline";
import {
  createComind,
  type EmbeddingProvider,
  type LLMProvider,
  type RunAgentContext,
  type GoalPatch,
} from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, ScriptedLLM } from "@/demo/stubProviders";
import { robotDetective } from "@/demo/scenarios/robotDetective";
import { renderWorldHeader, renderDispatchBanner, renderTurn } from "@/demo/render";
import { createPanel } from "@/demo/panel";
import { seedWorld } from "@/demo/seedWorld";

const log = console.log;

/** Silence runAgent's internal `[AGENT] …` chatter so the REPL stays clean. */
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith("[AGENT]")) return;
    orig(...(a as []));
  };
  return fn().finally(() => { console.log = orig; });
}

const HELP = `
commands ─────────────────────────────────────────────────────────────────────
  <text>                ask the detective (recall only — no clue recorded)
  /ask <text>           same as bare text
  /clue <text>          record an observation (a 'told' memory), then deduce
  /reset [reason]       cold boot: drop the chat window; the store persists
  /goal <key> <change>  drive a goal — change ∈ done | pause | active | w<0..1>
                        keys: ${Object.keys(robotDetective.world.goals.reduce((m, g) => ((m[g.key] = 1), m), {} as Record<string, number>)).join(", ")}
  /goals                list the goals and their status
  /help                 this list
  /quit                 leave
────────────────────────────────────────────────────────────────────────────────`;

async function main() {
  const forceOffline = process.argv.includes("--offline");
  const offline = forceOffline || !process.env.OPENAI_API_KEY;
  const tui = process.argv.includes("--tui");

  const store = new InMemoryMemoryStore();

  // Embeddings: stub offline, real HuggingFace for the showcase path.
  const embeddings: EmbeddingProvider = offline
    ? new StubEmbeddings()
    : new (await import("@/lib/comind/adapters/huggingFaceEmbeddingProvider")).HuggingFaceEmbeddingProvider();

  // Seed the SAME world the scripted demo proves — so this is the case live.
  const w = robotDetective.world;
  const { ctxId, goalKeyToId } = await seedWorld(store, embeddings, w);

  // Offline = recall-only: the scripted LLM returns empty output (no derivation),
  // so the loop still recalls/persists/re-ranks but mints no new conclusions.
  // Real path uses OpenAI for live derivation.
  const llm: LLMProvider = offline
    ? new ScriptedLLM()
    : new (await import("@/lib/comind/adapters/openAILLMProvider")).OpenAILLMProvider();
  const comind = createComind({ userId: "demo", store, embeddings, llm });

  const panel = tui
    ? createPanel({ title: `${robotDetective.title} · LIVE`, directives: w.profile.directives, values: w.context.values ?? [] })
    : null;

  if (!panel) {
    log(`\n[demo] Rung 3 — interactive REPL · mode: ${offline ? "OFFLINE (recall-only, no derivation)" : "REAL (live providers)"}`);
    log(renderWorldHeader({
      title: `${robotDetective.title} · you are driving`,
      directives: w.profile.directives,
      values: w.context.values ?? [],
      goals: w.goals.map((g) => ({ title: g.title, weight: g.weight })),
    }));
    log(HELP);
  }

  // --- Live session state. The window resets only when YOU call /reset. ---
  let chatHistory: RunAgentContext["chatHistory"] = [];
  let firstMessage = ""; // the dispatch's originalEntry — set on first turn after a reset
  let dispatchN = 1;
  let clueN = 0;

  if (panel) panel.setDispatch(`Dispatch ${dispatchN} — live`, "Drive the case: feed clues, ask questions, /reset to cold-boot.");

  /** Run one agent turn and render it on whichever surface is active. */
  async function turn(message: string, feed: string) {
    if (!firstMessage) firstMessage = message;
    const context: RunAgentContext = { originalEntry: firstMessage, chatHistory };
    const { response, trace } = await quiet(() => comind.runAgent(ctxId, message, context));

    // Offline mints no response; show an honest recall-only note instead of "".
    const shown = response || (offline
      ? `(offline: recalled ${trace.recalled.entries.length + trace.recalled.artifacts.length} memories — derivation needs a live LLM)`
      : "");

    if (panel) panel.renderTurn({ feed, response: shown, trace });
    else log(renderTurn({ feed, response: shown, trace }));

    chatHistory = [...chatHistory, { role: "user", content: message }, { role: "assistant", content: shown }];
  }

  /** A clue = a recorded observation (a 'told' entry), then a deduction turn. */
  async function clue(text: string) {
    clueN += 1;
    await store.createMemoryEntry({
      contextId: ctxId,
      type: "NOTE",
      content: text,
      tags: ["clue", `c${clueN}`],
      attributionType: "USER_EXPLICIT", // you TOLD the detective this
      embedding: await embeddings.embed(text),
    });
    await turn(text, `clue: ${text}`);
  }

  function reset(reason: string) {
    chatHistory = [];
    firstMessage = "";
    dispatchN += 1;
    const label = `Dispatch ${dispatchN} — cold boot`;
    const why = reason || "You powered the detective down and back up. The window is gone; the case persists in CoMind.";
    if (panel) panel.setDispatch(label, why);
    else log(renderDispatchBanner(label, why));
  }

  /** Map a CLI change token to a GoalPatch. Returns null if unrecognized. */
  function parseGoalChange(change: string): GoalPatch | null {
    const c = change.toLowerCase();
    if (c === "done" || c === "complete" || c === "completed") return { status: "COMPLETED" };
    if (c === "pause" || c === "paused") return { status: "PAUSED" };
    if (c === "active") return { status: "ACTIVE" };
    const m = c.match(/^w?(0?\.\d+|[01])$/); // w.3 / 0.3 / .3 / 1
    if (m) return { weight: Number(m[1]) };
    return null;
  }

  async function goal(args: string) {
    const [key, change] = args.split(/\s+/, 2);
    const goalId = goalKeyToId[key];
    if (!goalId) return log(`  [repl] unknown goal key '${key}'. keys: ${Object.keys(goalKeyToId).join(", ")}`);
    const patch = change ? parseGoalChange(change) : null;
    if (!patch) return log(`  [repl] usage: /goal ${key} done|pause|active|w<0..1>`);
    await store.updateGoal(goalId, patch);
    log(`  [repl] goal '${key}' → ${JSON.stringify(patch)}  (recall re-ranks on the next turn)`);
  }

  async function listGoals() {
    const goals = await store.listGoals({ contextId: ctxId });
    log("  goals ────────────────────────────────");
    for (const g of goals) {
      const key = Object.keys(goalKeyToId).find((k) => goalKeyToId[k] === g.id) ?? "?";
      log(`    ▸ [${key}] ${g.title}  ·  ${g.status}  ·  w${g.weight.toFixed(2)}`);
    }
  }

  // --- The read loop. ----------------------------------------------------------
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\ndetective› " });
  rl.prompt();

  for await (const lineRaw of rl) {
    const line = lineRaw.trim();
    if (!line) { rl.prompt(); continue; }

    try {
      if (line === "/quit" || line === "/exit" || line === "/q") break;
      else if (line === "/help" || line === "/?") log(HELP);
      else if (line === "/goals") await listGoals();
      else if (line.startsWith("/clue ")) await clue(line.slice(6).trim());
      else if (line.startsWith("/ask ")) await turn(line.slice(5).trim(), `ask: ${line.slice(5).trim()}`);
      else if (line.startsWith("/reset")) reset(line.slice(6).trim());
      else if (line.startsWith("/goal ")) await goal(line.slice(6).trim());
      else if (line.startsWith("/")) log(`  [repl] unknown command '${line.split(" ")[0]}'. /help for the list.`);
      else await turn(line, `ask: ${line}`); // bare text = a question
    } catch (e) {
      log(`  [repl] error: ${(e as Error).message}`);
    }
    rl.prompt();
  }

  rl.close();
  log("\n[demo] ✅ session ended — the case lives in CoMind, not in the window you just closed.\n");
}

main().catch((e) => { console.error("[demo] error:", e); process.exitCode = 1; });
