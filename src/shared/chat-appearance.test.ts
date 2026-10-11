import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_APPEARANCE, normalizeChatAppearance } from "./chat-appearance";

describe("normalizeChatAppearance", () => {
  it("keeps in-range values and drops fields it does not know about", () => {
    expect(normalizeChatAppearance({
      chatLineHeight: 1.6,
      chatParaSpacing: 0.8,
      uiFontSize: 15,
      chatFontSize: 16,
      codeFontSize: 12,
      assistantBubbleEnabled: true,
    })).toEqual({
      chatLineHeight: 1.6,
      chatParaSpacing: 0.8,
      uiFontSize: 15,
      chatFontSize: 16,
      codeFontSize: 12,
    });
  });

  it("uses the current real defaults for invalid input", () => {
    expect(normalizeChatAppearance(null)).toEqual(DEFAULT_CHAT_APPEARANCE);
    expect(normalizeChatAppearance({ chatLineHeight: "wide", uiFontSize: Number.NaN })).toEqual(DEFAULT_CHAT_APPEARANCE);
    expect(DEFAULT_CHAT_APPEARANCE).toEqual({
      chatLineHeight: 1.75,
      chatParaSpacing: 0.5,
      uiFontSize: 16,
      chatFontSize: 14,
      codeFontSize: 13,
    });
  });

  it("clamps the font sizes to their supported ranges", () => {
    expect(normalizeChatAppearance({ uiFontSize: 4 }).uiFontSize).toBe(12);
    expect(normalizeChatAppearance({ uiFontSize: 99 }).uiFontSize).toBe(20);
    expect(normalizeChatAppearance({ chatFontSize: 1 }).chatFontSize).toBe(12);
    expect(normalizeChatAppearance({ chatFontSize: 99 }).chatFontSize).toBe(22);
    expect(normalizeChatAppearance({ codeFontSize: 1 }).codeFontSize).toBe(11);
    expect(normalizeChatAppearance({ codeFontSize: 99 }).codeFontSize).toBe(20);
  });

  it("rounds font sizes to whole pixels and clamps spacing to its slider range", () => {
    expect(normalizeChatAppearance({ chatFontSize: 14.6 }).chatFontSize).toBe(15);
    expect(normalizeChatAppearance({ chatParaSpacing: 0 }).chatParaSpacing).toBe(0.2);
    expect(normalizeChatAppearance({ chatParaSpacing: 3 }).chatParaSpacing).toBe(1.2);
    expect(normalizeChatAppearance({ chatLineHeight: 9 }).chatLineHeight).toBe(3);
  });

  it("reads a legacy archive that only stored the line height and fills in the rest", () => {
    expect(normalizeChatAppearance({ chatLineHeight: 1.6, windowCornerRadius: 24 })).toEqual({
      ...DEFAULT_CHAT_APPEARANCE,
      chatLineHeight: 1.6,
    });
  });
});
