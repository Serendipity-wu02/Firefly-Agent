import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { userDataRoot, cleanupUserData } = await vi.hoisted(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-characterization-"));
  return {
    userDataRoot: root,
    cleanupUserData: () => fs.rmSync(root, { recursive: true, force: true }),
  };
});

afterAll(cleanupUserData);

const { trace, runHarness, runStore, reviewTracker } = vi.hoisted(() => ({
  trace: [] as string[],
  runHarness: vi.fn(),
  runStore: {
    create: vi.fn(),
    checkpoint: vi.fn(),
    recordTool: vi.fn(),
    recordTools: vi.fn(),
    recordCompaction: vi.fn(),
    markTerminal: vi.fn(),
  },
  reviewTracker: {
    finalizeReview: vi.fn(),
  },
}));

vi.mock("./harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./harness")>();
  return { ...actual, runFireflyHarness: runHarness };
});

vi.mock("./harness/run-store", () => ({
  getHarnessRunStore: vi.fn(() => runStore),
}));

vi.mock("./review/run-review-tracker", () => ({
  getRunReviewTracker: vi.fn(() => reviewTracker),
}));

vi.mock("./tools/registry/tool-registry", () => ({
  toolRegistry: {
    getEnabledTools: vi.fn(() => []),
    getById: vi.fn(),
  },
}));

vi.mock("../prompts/prompt-loader", () => ({
  loadPromptFile: vi.fn(() => "runtime policy"),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => userDataRoot) },
}));

import { runHarnessWithAdapter } from "./harness-adapter";
import { DEFAULT_HARNESS_CONFIG } from "./harness/types";

describe("harness-adapter characterization", () => {
  beforeEach(() => {
    trace.length = 0;
    runHarness.mockReset();
    runStore.create.mockReset();
    runStore.checkpoint.mockReset();
    runStore.recordTool.mockReset();
    runStore.recordTools.mockReset();
    runStore.recordCompaction.mockReset();
    runStore.markTerminal.mockReset();
    reviewTracker.finalizeReview.mockReset();

    runStore.create.mockImplementation(() => trace.push("runStore.create"));
    runStore.markTerminal.mockImplementation(() => {
      trace.push("runStore.markTerminal");
      return { createdAt: 1 };
    });
    reviewTracker.finalizeReview.mockImplementation(() => trace.push("review.finalizeReview"));
    runHarness.mockImplementation(async () => {
      trace.push("runHarness");
      return {
        finalAnswer: "完成",
        finalState: { todoItems: [], uncertainEffects: [] },
        terminated: true,
        rounds: 1,
      };
    });
  });

  it("preserves create, run, terminal, review, and return order", async () => {
    const result = await runHarnessWithAdapter({
      runId: "run-characterization",
      settings: {
        provider: "test",
        baseUrl: "",
        model: "test-model",
        apiKey: "",
        contextWindowTokens: 256_000,
      },
      messages: [{ role: "user", content: "执行" }],
      toolSystemContent: "",
      soulSystemBaseContent: "persona",
      executionMode: "work",
      conversationMode: "work",
    } as never, new AbortController().signal, () => undefined);

    trace.push("return");
    expect(result.reply).toBe("完成");
    expect(trace).toEqual([
      "runStore.create",
      "runHarness",
      "runStore.markTerminal",
      "review.finalizeReview",
      "return",
    ]);
  });

  it("passes the Main run and guarded sink through Harness and its terminal checkpoint", async () => {
    const checkpoint = vi.fn(async () => undefined), guardedCheckpoint = vi.fn(async () => undefined);
    const sink = { checkpoint }, guardedSink = { checkpoint: guardedCheckpoint };
    const memoryRun = { call: vi.fn(), bindSink: vi.fn(() => guardedSink), close: vi.fn(async () => undefined) };
    await runHarnessWithAdapter({
      runId: "run-memory-adapter",
      settings: { provider: "test", baseUrl: "", model: "fixture", apiKey: "", contextWindowTokens: 256000 },
      messages: [{ role: "user", content: "执行" }], toolSystemContent: "", soulSystemBaseContent: "persona",
      executionMode: "work", conversationMode: "work", memoryRun, transcriptSink: sink,
    } as never, new AbortController().signal, () => undefined);
    expect(memoryRun.bindSink).toHaveBeenCalledWith(sink);
    expect(runHarness).toHaveBeenCalledWith(expect.objectContaining({ memoryRun, transcriptSink: guardedSink }));
    expect(guardedCheckpoint).toHaveBeenCalledOnce(); expect(checkpoint).not.toHaveBeenCalled();
  });

  it("preserves the compaction cache epoch when committing a run checkpoint", async () => {
    runHarness.mockImplementation(async (input) => {
      input.onCheckpoint({ messages: [], state: { todoItems: [], uncertainEffects: [] },
        toolOutputs: [], rounds: 1, cache: { cacheEpoch: 2, epochReason: "compaction" }, at: 1 });
      return { finalAnswer: "完成", finalState: { todoItems: [], uncertainEffects: [] }, terminated: false, rounds: 1 };
    });
    await runHarnessWithAdapter({
      runId: "run-cache-epoch", settings: { provider: "test", baseUrl: "", model: "fixture", apiKey: "", contextWindowTokens: 256000 },
      messages: [{ role: "user", content: "执行" }], toolSystemContent: "", soulSystemBaseContent: "persona",
      executionMode: "work", conversationMode: "work",
    } as never, new AbortController().signal, () => undefined);
    expect(runStore.checkpoint).toHaveBeenCalledWith("run-cache-epoch", expect.objectContaining({
      cache: { cacheEpoch: 2, epochReason: "compaction" },
    }));
  });

  it("writes the planned batch through the adapter into the recoverable run snapshot", async () => {
    const { HarnessRunStore } = await vi.importActual<typeof import("./harness/run-store")>("./harness/run-store");
    const durableStore = new HarnessRunStore(userDataRoot);
    runStore.create.mockImplementation(input => durableStore.create(input));
    runStore.recordTools.mockImplementation((runId, calls) => durableStore.recordTools(runId, calls));
    runStore.markTerminal.mockImplementation((runId, status) => durableStore.markTerminal(runId, status));
    runHarness.mockImplementation(async input => {
      input.onToolsPlanned([
        { toolCallId: "a", toolName: "read_file", toolSideEffect: "read_only", status: "planned" },
        { toolCallId: "b", toolName: "write_file", toolSideEffect: "idempotent_mutation", status: "planned" },
      ]);
      expect(durableStore.get(input.runId)?.toolCalls).toEqual([
        expect.objectContaining({ toolCallId: "a", sideEffect: "read_only", status: "planned" }),
        expect.objectContaining({ toolCallId: "b", sideEffect: "idempotent_mutation", status: "planned" }),
      ]);
      return { finalAnswer: "完成", finalState: { todoItems: [], uncertainEffects: [] }, terminated: false, rounds: 0 };
    });
    await runHarnessWithAdapter({
      runId: "run-planned-batch", settings: { provider: "test", baseUrl: "", model: "fixture", apiKey: "", contextWindowTokens: 256000 },
      messages: [{ role: "user", content: "执行" }], toolSystemContent: "", soulSystemBaseContent: "persona",
      executionMode: "work", conversationMode: "work",
    } as never, new AbortController().signal, () => undefined);
    expect(durableStore.get("run-planned-batch")?.status).toBe("completed");
  });

  it.each([undefined, 2])("keeps the default tool concurrency unless explicitly configured (%s)", async (configured) => {
    let effectiveConcurrency: number | undefined;
    runHarness.mockImplementation(async (input) => {
      effectiveConcurrency = { ...DEFAULT_HARNESS_CONFIG, ...input.config }.maxParallelToolCalls;
      return { finalAnswer: "完成", finalState: { todoItems: [], uncertainEffects: [] }, terminated: false, rounds: 0 };
    });
    await runHarnessWithAdapter({
      runId: "run-default-concurrency", settings: { provider: "test", baseUrl: "", model: "fixture", apiKey: "", contextWindowTokens: 256000 },
      messages: [{ role: "user", content: "执行" }], toolSystemContent: "", soulSystemBaseContent: "persona",
      executionMode: "work", conversationMode: "work", maxParallelToolCalls: configured,
    } as never, new AbortController().signal, () => undefined);
    expect(effectiveConcurrency).toBe(configured ?? 4);
  });
});
