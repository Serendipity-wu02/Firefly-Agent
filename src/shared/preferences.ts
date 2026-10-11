export type SegmentedOutputMode = "all" | "chat" | "off";
export type ProactiveChatMode = "on" | "off";
export type ProactiveDeliveryTarget = "local" | "wechat" | "feishu";

export function normalizeChatSocialContextEnabled(value: unknown): boolean {
  return value === true;
}

export function normalizeSegmentedOutputMode(value: unknown): SegmentedOutputMode {
  return value === "all" || value === "chat" ? value : "off";
}

export function normalizeProactiveChatMode(value: unknown): ProactiveChatMode {
  return value === "on" ? "on" : "off";
}

export function normalizeProactiveDeliveryTarget(value: unknown): ProactiveDeliveryTarget {
  return value === "wechat" || value === "feishu" ? value : "local";
}
