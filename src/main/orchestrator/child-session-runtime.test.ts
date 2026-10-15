import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentSessionRegistry } from "../tasks/agent-session-registry";
import { TaskSessionStore } from "../tasks/task-session-store";
import { requireBackgroundMemoryIngress, type BackgroundMemoryHost } from "../memory-context/background-memory-ingress";
import { runChildSession } from "./child-session-runtime";
import { ConversationTranscriptStore } from "./conversation-transcript-store";
import { createTranscriptSink } from "./transcript-sink";
import { HarnessRunStore, type PersistedToolCall } from "./harness/run-store";
import { prepareHarnessRecovery } from "./harness/run-recovery";
import type { ToolDefinition } from "./tools/registry/tool-registry";
import type { ChatMessage, ChatResponse, ToolCall } from "./vendors/types";

// Usage storage belongs to the installed desktop profile; this fixture owns only temporary stores.
vi.mock("../token-usage-store", () => ({ recordUsage: () => undefined, recordRequest: () => undefined }));

const roots: string[] = [];
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("unexpected network request"); }); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options: { failPlannedWrite?: boolean; cancelAfterPlannedWrite?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-child-planned-"));
  roots.push(root);
  const tasks = new TaskSessionStore(root), runs = new HarnessRunStore(root), transcripts = new ConversationTranscriptStore(root);
  const controller = new AbortController();
  const prompt = "Read three synthetic inputs";
  const session = new AgentSessionRegistry(tasks).acquire({ agentId: "fixture-agent", modelProfile: "coding", savedModelProfileId: "fixture-model",
    parentConversationId: "fixture-parent", parentRunId: "fixture-parent-run", mode: "code", resolvedWorkspaceRoot: root, description: "fixture", prompt });
  const calls: ToolCall[] = [0, 1, 2].map(index => ({ id: `read-${index}`, name: "synthetic_read", arguments: JSON.stringify({ index }) }));
  const plannedWrites: PersistedToolCall[][] = [];
  const committedWrites: Array<{ messages: ChatMessage[]; toolCalls: PersistedToolCall[] }> = [];
  const executionSnapshots: NonNullable<ReturnType<HarnessRunStore["get"]>>[] = [];
  const runPath = path.join(root, "firefly-runs", "sessions", `${session.childRunId}.json`);
  const rename = fs.renameSync.bind(fs);
  let plannedWriteFailed = false, leaseReleased = false, memoryClosed = false;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    let snapshot: { messages: ChatMessage[]; toolCalls: PersistedToolCall[] } | undefined;
    if (String(to) === runPath) {
      snapshot = JSON.parse(fs.readFileSync(from, "utf8")) as { messages: ChatMessage[]; toolCalls: PersistedToolCall[] };
      if (snapshot.toolCalls.length > 0 && snapshot.toolCalls.every(call => call.status === "planned")
        && !snapshot.messages.some(message => message.role === "tool")) {
        plannedWrites.push(snapshot.toolCalls);
        if (options.failPlannedWrite && !plannedWriteFailed) {
          plannedWriteFailed = true;
          throw new Error("synthetic planned snapshot failure");
        }
        rename(from, to);
        if (options.cancelAfterPlannedWrite) controller.abort();
        return;
      }
    }
    rename(from, to);
    if (snapshot?.toolCalls.some(call => call.status === "committed")) committedWrites.push(snapshot);
  });
  const tool: ToolDefinition = { id: "synthetic_read", name: "Synthetic read", description: "Local fixture", enabled: true,
    inputSchema: { type: "object", properties: { index: { type: "number" } } }, effectKind: "read", execute: async () => {
      executionSnapshots.push(runs.get(session.childRunId)!);
      return "synthetic read complete";
    } };
  const host: BackgroundMemoryHost = { async prepareBackgroundRun(input) {
    const ingress = requireBackgroundMemoryIngress(input.ingress);
    await transcripts.append(ingress.sessionId, { id: input.userTurnId, turnId: input.userTurnId, revision: 1,
      kind: "user", payload: { text: input.instructionText } });
    const sink = createTranscriptSink({ store: transcripts, conversationId: ingress.sessionId, runId: input.runId, assistantTurnId: input.assistantTurnId });
    let round = 0;
    return { sessionId: ingress.sessionId, signal: ingress.signal, transcriptSink: sink, close: async () => undefined,
      openMemoryRun: async () => ({ bindSink: candidate => candidate, close: async () => { memoryClosed = true; }, call: async request => {
        const toolCalls = round++ === 0 ? calls : [];
        const text = toolCalls.length ? "" : "Synthetic work complete";
        if (text) request.onDelta?.({ type: "text_delta", delta: text });
        return { text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", raw: {},
          assistantMessage: { role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) } } satisfies ChatResponse;
      } }),
    };
  } };
  const execute = () => runChildSession({ session, store: tasks, runStore: runs, prompt, description: "fixture", systemPrompt: "Synthetic worker",
    tools: [tool], config: { totalTimeoutMs: 0, maxRounds: 3 }, lease: { nickname: "fixture", assetFileName: "fixture.png", release: () => { leaseReleased = true; } },
    parent: { parentConversationId: "fixture-parent", parentRunId: "fixture-parent-run", mode: "code", systemPrompt: "fixture",
      vendorConfig: { provider: "fixture", model: "fixture-model", baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-only", explicitTransport: "openai" },
      tools: [tool], resolvedWorkspaceRoot: root, signal: controller.signal, backgroundMemory: host, includeInteractiveTools: false } });
  return { root, session, tasks, runs, transcripts, calls, plannedWrites, committedWrites, executionSnapshots, execute,
    released: () => leaseReleased, closed: () => memoryClosed };
}

it("durably saves every child call in one planned snapshot before entering a real tool body", async () => {
  const f = fixture();
  expect((await f.execute()).status).toBe("completed");
  expect(f.plannedWrites.map(batch => batch.map(call => call.toolCallId))).toEqual([f.calls.map(call => call.id)]);
  expect(f.executionSnapshots).toHaveLength(3);
  expect(f.executionSnapshots[0].toolCalls.map(call => call.status)).toEqual(["started", "planned", "planned"]);
  expect(f.executionSnapshots[0].messages.find(message => message.role === "assistant")?.toolCalls).toEqual(f.calls);
  expect(f.committedWrites.length).toBeGreaterThan(0);
  for (const snapshot of f.committedWrites) {
    for (const call of snapshot.toolCalls.filter(call => call.status === "committed")) {
      expect(snapshot.messages.some(message => message.role === "tool" && message.toolCallId === call.toolCallId)).toBe(true);
    }
  }
  const saved = new HarnessRunStore(f.root).get(f.session.childRunId)!;
  expect(saved.status).toBe("completed");
  expect(saved.toolCalls.map(call => call.status)).toEqual(["committed", "committed", "committed"]);
  expect(saved.messages.filter(message => message.role === "tool")).toHaveLength(3);
  expect(new TaskSessionStore(f.root).get(f.session.id)?.messages).toEqual(saved.messages);
  expect(f.released()).toBe(true);
  expect(f.closed()).toBe(true);
});

it("executes no child tool when the complete planned snapshot cannot be atomically saved", async () => {
  const f = fixture({ failPlannedWrite: true });
  const result = await f.execute();
  expect(result.status).toBe("failed");
  expect(result.error?.message).toContain("synthetic planned snapshot failure");
  expect(f.plannedWrites.map(batch => batch.map(call => call.toolCallId))).toEqual([f.calls.map(call => call.id)]);
  expect(f.executionSnapshots).toHaveLength(0);
  expect(new HarnessRunStore(f.root).get(f.session.childRunId)?.toolCalls).toEqual([]);
  const entries = (await f.transcripts.read(f.session.id)).entries;
  const results = entries.filter(entry => entry.kind === "tool_result");
  expect(results).toHaveLength(3);
  expect(results.every(entry => entry.kind === "tool_result" && entry.payload.outcome === "not_executed")).toBe(true);
  expect(f.released()).toBe(true);
  expect(f.closed()).toBe(true);
});

it("closes all durably planned child calls without execution when cancelled at the batch boundary", async () => {
  const f = fixture({ cancelAfterPlannedWrite: true });
  expect((await f.execute()).status).toBe("cancelled");
  expect(f.plannedWrites.map(batch => batch.map(call => call.toolCallId))).toEqual([f.calls.map(call => call.id)]);
  expect(f.executionSnapshots).toHaveLength(0);
  const saved = new HarnessRunStore(f.root).get(f.session.childRunId)!;
  expect(saved.status).toBe("cancelled");
  expect(saved.toolCalls.map(call => call.status)).toEqual(["not_executed", "not_executed", "not_executed"]);
  const recovered = prepareHarnessRecovery({ ...saved, status: "interrupted" }, { workspaceRoot: f.root });
  expect(recovered.state.uncertainEffects).toEqual([]);
  for (const call of f.calls) expect(recovered.messages.filter(message => message.toolCallId === call.id)).toHaveLength(1);
  const results = (await f.transcripts.read(f.session.id)).entries.filter(entry => entry.kind === "tool_result");
  expect(results).toHaveLength(3);
  expect(results.every(entry => entry.kind === "tool_result" && entry.payload.outcome === "not_executed")).toBe(true);
  expect(f.released()).toBe(true);
  expect(f.closed()).toBe(true);
});
