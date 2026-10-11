import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyChatAppearance } from "./useChatAppearance";

describe("applyChatAppearance", () => {
  const setProperty = vi.fn();
  const dataset: Record<string, string> = {};

  beforeEach(() => {
    setProperty.mockReset();
    for (const key of Object.keys(dataset)) delete dataset[key];
    vi.stubGlobal("document", {
      documentElement: {
        dataset,
        style: { setProperty },
      },
    });
  });

  it("applies the line height and never toggles an assistant bubble dataset", () => {
    applyChatAppearance({ chatLineHeight: 1.6 });

    expect(setProperty).toHaveBeenCalledWith("--cy-chat-line-height", "1.6");
    expect(dataset.assistantBubble).toBeUndefined();
  });

  it("publishes the paragraph spacing and the three font sizes as CSS variables", () => {
    applyChatAppearance({ chatParaSpacing: 0.8, uiFontSize: 15, chatFontSize: 16, codeFontSize: 12 });

    expect(setProperty).toHaveBeenCalledWith("--cy-chat-para-spacing", "0.8em");
    expect(setProperty).toHaveBeenCalledWith("--cy-ui-font-size", "15px");
    expect(setProperty).toHaveBeenCalledWith("--cy-chat-font-size", "16px");
    expect(setProperty).toHaveBeenCalledWith("--cy-code-font-size", "12px");
  });

  it("falls back to the default sizes for a legacy archive", () => {
    applyChatAppearance({ chatLineHeight: 1.75 });

    expect(setProperty).toHaveBeenCalledWith("--cy-ui-font-size", "16px");
    expect(setProperty).toHaveBeenCalledWith("--cy-chat-font-size", "14px");
    expect(setProperty).toHaveBeenCalledWith("--cy-code-font-size", "13px");
  });
});
