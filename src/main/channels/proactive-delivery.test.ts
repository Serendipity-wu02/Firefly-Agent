import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelAdapter } from "./adapters/base";
import {
  createProactiveChannelRecipientRegistry,
  sendProactiveChannelMessage,
} from "./proactive-delivery";
import type { ChannelCapability, IncomingMessage } from "./types";

const capability: ChannelCapability = {
  text: true,
  image: true,
  audio: true,
  file: true,
  video: true,
  markdown: true,
  card: true,
  sticker: true,
  maxTextLength: 4000,
};

function incoming(channel: "wechat" | "feishu", senderId: string, chatId = senderId): IncomingMessage {
  return { channel, senderId, chatId, text: "你好", at: new Date() };
}

function fakeAdapter(phase: "running" | "offline" = "running"): ChannelAdapter {
  return {
    id: "wechat",
    displayName: "test",
    capability,
    onMessage: null,
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn().mockResolvedValue({ ok: true }),
    getStatus: vi.fn(() => ({ enabled: phase === "running", phase })),
  };
}

describe("proactive channel delivery", () => {
  let registry = createProactiveChannelRecipientRegistry();

  beforeEach(() => {
    registry = createProactiveChannelRecipientRegistry();
  });

  it("keeps the latest recipient independently for each channel", () => {
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");
    registry.remember(incoming("feishu", "fs-1"), "session-fs-1");
    registry.remember(incoming("wechat", "wx-2", "wx-chat-2"), "session-wx-2");

    expect(registry.get("wechat")).toMatchObject({ targetId: "wx-chat-2", sessionId: "session-wx-2" });
    expect(registry.get("feishu")).toMatchObject({ targetId: "fs-1", sessionId: "session-fs-1" });
  });

  it("cancels while the selected channel is offline", async () => {
    const adapter = fakeAdapter("offline");
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");

    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。",
      manager: { getAdapter: () => adapter },
      recipientRegistry: registry,
      appendHistory: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result).toEqual({ kind: "cancelled", reason: "channel_offline" });
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("cancels when the channel has no current-process recipient", async () => {
    const adapter = fakeAdapter();
    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。",
      manager: { getAdapter: () => adapter },
      recipientRegistry: registry,
      appendHistory: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result).toEqual({ kind: "cancelled", reason: "recipient_unavailable" });
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("sends the complete reply as one text part", async () => {
    const adapter = fakeAdapter();
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");

    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。第二句？",
      manager: { getAdapter: () => adapter },
      recipientRegistry: registry,
      appendHistory: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result).toEqual({ kind: "committed", deliveredParts: 1, totalParts: 1 });
    expect(adapter.send).toHaveBeenCalledWith({
      channel: "wechat",
      targetId: "wx-1",
      parts: [{ kind: "text", text: "第一句。第二句？" }],
    });
  });

  it("cancels without committing history when the send fails", async () => {
    const adapter = fakeAdapter();
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");
    vi.mocked(adapter.send).mockResolvedValue({ ok: false, error: "failed" });
    const appendHistory = vi.fn();

    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。第二句？",
      manager: { getAdapter: () => adapter },
      recipientRegistry: registry,
      appendHistory,
      appendLog: vi.fn(),
    });

    expect(result).toEqual({ kind: "cancelled", reason: "send_failed" });
    expect(appendHistory).not.toHaveBeenCalled();
  });

  it("通过统一传输服务发送并在送达后提交完整文本", async () => {
    const adapter = fakeAdapter();
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");
    let committedText = "";

    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。第二句？",
      manager: { getAdapter: () => adapter },
      delivery: {
        send: async () => ({ ok: true }),
      },
      recipientRegistry: registry,
      appendHistory: (_sessionId, _role, text) => {
        committedText = text;
      },
      appendLog: vi.fn(),
    });

    expect(result).toEqual({ kind: "committed", deliveredParts: 1, totalParts: 1 });
    expect(committedText).toBe("第一句。第二句？");
  });

  it("does not send when the proactive generation is no longer valid", async () => {
    const adapter = fakeAdapter();
    registry.remember(incoming("wechat", "wx-1"), "session-wx-1");

    const result = await sendProactiveChannelMessage({
      channel: "wechat",
      text: "第一句。第二句？",
      manager: { getAdapter: () => adapter },
      recipientRegistry: registry,
      appendHistory: vi.fn(),
      appendLog: vi.fn(),
      canContinue: () => false,
    });

    expect(result.kind).toBe("cancelled");
    expect(adapter.send).not.toHaveBeenCalled();
  });
});
