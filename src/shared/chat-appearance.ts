// 外观排版设置 —— Main / Preload / Renderer 共用类型与归一化。
//
// 数值字段存储无单位数字，CSS 应用时再补单位：
// - chatLineHeight：行高（无单位）
// - chatParaSpacing：段间距（em）
// - uiFontSize / chatFontSize / codeFontSize：字号（px）

export interface ChatAppearanceSettings {
  /** 行高，无单位数字 */
  chatLineHeight: number;
  /** 消息段落之间的间距，单位 em */
  chatParaSpacing: number;
  /** 界面基础字号（px） */
  uiFontSize: number;
  /** 消息正文字号（px） */
  chatFontSize: number;
  /** 代码块字号（px） */
  codeFontSize: number;
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearanceSettings = {
  chatLineHeight: 1.75,
  chatParaSpacing: 0.5,
  uiFontSize: 16,
  chatFontSize: 14,
  codeFontSize: 13,
};

export const CHAT_LINE_HEIGHT_MIN = 1.0;
export const CHAT_LINE_HEIGHT_MAX = 3.0;
export const CHAT_PARA_SPACING_MIN = 0.2;
export const CHAT_PARA_SPACING_MAX = 1.2;
export const UI_FONT_SIZE_MIN = 12;
export const UI_FONT_SIZE_MAX = 20;
export const CHAT_FONT_SIZE_MIN = 12;
export const CHAT_FONT_SIZE_MAX = 22;
export const CODE_FONT_SIZE_MIN = 11;
export const CODE_FONT_SIZE_MAX = 20;

/**
 * 将有限数值 clamp 到 [min, max]；非有限值（NaN / Infinity / 非 number）回退默认值。
 */
export function clampFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clampPixelSize(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampFiniteNumber(value, min, max, fallback));
}

/**
 * 从任意输入归一化为合法 ChatAppearanceSettings。
 * 输入可以是完整对象、部分对象（旧存档只有 chatLineHeight）、null、undefined 或其他任意值；
 * 缺失或非法的字段回退默认值，多余字段被忽略。
 */
export function normalizeChatAppearance(
  input: unknown,
): ChatAppearanceSettings {
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    chatLineHeight: clampFiniteNumber(
      source.chatLineHeight,
      CHAT_LINE_HEIGHT_MIN,
      CHAT_LINE_HEIGHT_MAX,
      DEFAULT_CHAT_APPEARANCE.chatLineHeight,
    ),
    chatParaSpacing: clampFiniteNumber(
      source.chatParaSpacing,
      CHAT_PARA_SPACING_MIN,
      CHAT_PARA_SPACING_MAX,
      DEFAULT_CHAT_APPEARANCE.chatParaSpacing,
    ),
    uiFontSize: clampPixelSize(
      source.uiFontSize,
      UI_FONT_SIZE_MIN,
      UI_FONT_SIZE_MAX,
      DEFAULT_CHAT_APPEARANCE.uiFontSize,
    ),
    chatFontSize: clampPixelSize(
      source.chatFontSize,
      CHAT_FONT_SIZE_MIN,
      CHAT_FONT_SIZE_MAX,
      DEFAULT_CHAT_APPEARANCE.chatFontSize,
    ),
    codeFontSize: clampPixelSize(
      source.codeFontSize,
      CODE_FONT_SIZE_MIN,
      CODE_FONT_SIZE_MAX,
      DEFAULT_CHAT_APPEARANCE.codeFontSize,
    ),
  };
}
