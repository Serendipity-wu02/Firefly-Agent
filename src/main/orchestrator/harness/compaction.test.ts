import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../vendors/types";
import {
  computeTokenBudget,
  compressForAgentLoop,
  buildCompactionCheckpoint,
  findSafeCutPointForRetainedTokens,
  isCompactionCheckpointMessage,
  isToolPairSafeBoundary,
} from "./compaction";

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("Harness compaction trigger", () => {
  // 约 4 字符 = 1 token：400000 个英文字符 ≈ 100000 token。
  const filler = (tokens: number): ChatMessage[] => [message("user", "x".repeat(tokens * 4))];

  it("compacts once the input reaches 85% of the context window", () => {
    expect(computeTokenBudget("", [], filler(84_000), 100_000, 0, 0).needsCompaction).toBe(false);
    expect(computeTokenBudget("", [], filler(86_000), 100_000, 0, 0).needsCompaction).toBe(true);
  });

  it("never waits past the usable input budget on small windows", () => {
    // 窗口 10k、预留 8k：85% = 8.5k 高于可用输入 ~1.8k，以可用输入为准。
    expect(computeTokenBudget("", [], filler(1_900), 10_000, 8_000, 200).needsCompaction).toBe(true);
    expect(computeTokenBudget("", [], filler(1_000), 10_000, 8_000, 200).needsCompaction).toBe(false);
  });
});

describe("Harness context compaction v2", () => {
  it("writes and recognizes Firefly checkpoints", () => {
    expect(buildCompactionCheckpoint("摘要").content).toContain("<firefly_compaction_checkpoint>");
  });

  it("keeps a tool call and its result in the retained token-budgeted tail", () => {
    const messages: ChatMessage[] = [
      message("user", "旧任务"),
      {
        role: "assistant",
        content: "我先读取文件。",
        toolCalls: [{ id: "call-read", name: "read_file", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "call-read", name: "read_file", content: "文件内容".repeat(30) },
      message("user", "请根据结果继续".repeat(20)),
    ];

    const cutIndex = findSafeCutPointForRetainedTokens(messages, 100);

    expect(cutIndex).toBe(1);
    expect(messages.slice(cutIndex).map((entry) => entry.role)).toEqual([
      "assistant", "tool", "user",
    ]);
  });

  it("cannot split an assistant with two tool calls and only one result", () => {
    const messages: ChatMessage[] = [
      message("user", "查询"),
      {
        role: "assistant",
        content: "并行读取两个文件。",
        toolCalls: [
          { id: "call-a", name: "read_file", arguments: "{}" },
          { id: "call-b", name: "read_file", arguments: "{}" },
        ],
      },
      { role: "tool", toolCallId: "call-a", name: "read_file", content: "文件 A 内容" },
    ];

    // 声明与已有结果之间不得切开（结果在右、声明在左 → 跨界）
    expect(isToolPairSafeBoundary(messages, 2)).toBe(false);
    // 声明之前切开：整组（声明 + 结果）保留在右侧 → 安全
    expect(isToolPairSafeBoundary(messages, 1)).toBe(true);
    // 全部保留 → 安全
    expect(isToolPairSafeBoundary(messages, 0)).toBe(true);
  });

  it("keeps the original transcript when summary generation fails", async () => {
    const messages: ChatMessage[] = [
      message("user", "旧任务".repeat(30)),
      message("assistant", "旧结论".repeat(30)),
      message("user", "最新任务".repeat(30)),
    ];

    const result = await compressForAgentLoop({
      messages,
      retainTokens: 20,
      summarize: async () => { throw new Error("summary unavailable"); },
    });

    expect(result).toBe(messages);
  });

  it("keeps the original transcript when the summary is not smaller", async () => {
    const messages: ChatMessage[] = [
      message("user", "旧任务".repeat(30)),
      message("assistant", "旧结论".repeat(30)),
      message("user", "最新任务".repeat(30)),
    ];

    const result = await compressForAgentLoop({
      messages,
      retainTokens: 20,
      summarize: async () => "摘要".repeat(200),
    });

    expect(result).toBe(messages);
  });
});
