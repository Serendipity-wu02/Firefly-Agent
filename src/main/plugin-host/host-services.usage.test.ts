import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ recordPluginCall: vi.fn() }));
vi.mock("../token-usage-store", () => store);

import { createHostServiceFactory } from "./host-services";

describe("plugin LLM call counting", () => {
  it("counts a direct generateText call for the plugin that made it, and still returns the shared service's answer", async () => {
    store.recordPluginCall.mockClear();
    const generateText = vi.fn(async () => "answer");
    const factory = createHostServiceFactory({
      pluginDataRoot: "unused",
      channelManager: { has: () => false },
      llm: { generateText },
      storage: {} as never,
      chatsReader: {} as never,
      schedulerStore: {} as never,
    });
    const services = factory.createForPlugin({ pluginId: "minecraft", signal: new AbortController().signal, trackResource: () => () => undefined });
    await expect(services.llm!.generateText([{ role: "user", content: "hi" }], { purpose: "greet" })).resolves.toBe("answer");
    expect(store.recordPluginCall).toHaveBeenCalledExactlyOnceWith("minecraft");
    expect(generateText).toHaveBeenCalledWith([{ role: "user", content: "hi" }], { purpose: "greet" });
  });
});
