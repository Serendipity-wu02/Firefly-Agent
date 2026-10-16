// API 预设数据（厂商列表）
// 从 settings.ts 抽离的纯数据常量。
// 注意：引用了 CUSTOM_ENDPOINT_PROVIDERS（运行时值），需用 import（非 type-only）。

import type { ModelPreset } from "../shared/types";
import { CUSTOM_ENDPOINT_PROVIDERS } from "../custom-endpoint-state";

/**
 * 厂商卡片的展示顺序：按名称首字母 A→Z。只影响展示；MODEL_PRESETS 的原顺序仍决定“新建档案”默认选谁。
 */
export function sortPresetsForDisplay(presets: readonly ModelPreset[]): ModelPreset[] {
  return [...presets].sort((a, b) => a.shortName.localeCompare(b.shortName, "en", { sensitivity: "base" }));
}

export const MODEL_PRESETS: ModelPreset[] = [
  // 当前已适配 9 家：MiniMax / DeepSeek / 智谱 GLM / Kimi / Qwen / ChatGPT / Claude / MiMo / OpenRouter（聚合网关）
  // 顺序按使用频率 + 适配优先级；未在此清单内的厂商已硬删，需要时再补回。
  {
    providerName: "MiniMax（稀宇科技）",
    shortName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
    transport: "anthropic",
    mainModels: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"],
    iconUrl: "../icons/providers/minimax.svg",
    websiteUrl: "https://platform.minimaxi.com/",
  },
  {
    // DeepSeek：v1 vendor adapter 不为它做协议层强制，仅作为 OpenAI 兼容厂商列出。
    // 已确认（来自官方定价文档）：支持 Tool Calls / JSON Output；后端原生缓存（命中后输入价跌至 1/50~1/120）。
    // 缓存能力等 v2 vendor adapter 接入时再利用，v1 不动。
    // V4.1 Flash（2026-09-10 发布）：模型名 deepseek-flash，原生多模态视觉；
    // 旧名 v4-flash / v4-flash-vision-exp 是它的别名；v4-pro 官方将于 2026-09-14
    // 起路由到 V4.1 Flash，保留在列表里供存量配置参考。
    providerName: "DeepSeek（深度求索）",
    shortName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    transport: "openai",
    mainModels: ["deepseek-flash", "deepseek-v4-pro"],
    iconUrl: "../icons/providers/deepseek.svg",
    websiteUrl: "https://platform.deepseek.com/",
  },
  {
    providerName: "GLM（智谱）",
    shortName: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    anthropicBaseUrl: "https://open.bigmodel.cn/api/anthropic",
    transport: "openai",
    mainModels: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5-turbo", "glm-4.7"],
    iconUrl: "../icons/providers/glm.svg",
    websiteUrl: "https://open.bigmodel.cn/",
  },
  {
    providerName: "Kimi（月之暗面）",
    shortName: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    transport: "openai",
    mainModels: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking"],
    iconUrl: "../icons/providers/kimi.svg",
    websiteUrl: "https://platform.moonshot.cn/",
  },
  {
    providerName: "Qwen（通义千问）",
    shortName: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    transport: "openai",
    mainModels: ["qwen-max", "qwen-plus", "qwen-turbo"],
    iconUrl: "../icons/providers/qwen.svg",
    websiteUrl: "https://bailian.console.aliyun.com/",
  },
  {
    providerName: "ChatGPT（OpenAI）",
    shortName: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    // 官方主推 Responses（o 系列完整思考摘要仅此协议有），新建档案默认预填 responses。
    transport: "responses",
    // 官方入口只推荐已纳入结构化输出 Profile 的型号；代理与自定义型号走“自定义端点”。
    // gpt-6-astra 为 2026-09-03 新旗舰（API 正在分批开放中）；gpt-5.6 为别名，
    // 路由到旗舰 Sol；terra/luna 为平衡与低成本档。
    mainModels: ["gpt-6-astra", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
    iconUrl: "../icons/providers/openai.svg",
    websiteUrl: "https://platform.openai.com/",
  },
  {
    providerName: "Claude（Anthropic）",
    shortName: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    transport: "anthropic",
    mainModels: ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6"],
    iconUrl: "../icons/providers/claude.svg",
    websiteUrl: "https://console.anthropic.com/",
  },
  {
    providerName: "MiMo（小米）",
    shortName: "MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    anthropicBaseUrl: "https://api.xiaomimimo.com/anthropic",
    transport: "openai",
    mainModels: ["mimo-v2.5-pro"],
    iconUrl: "../icons/providers/xiaomimimo.svg",
    websiteUrl: "https://mimo.mi.com/",
  },
  {
    // OpenRouter：聚合多家模型的 OpenAI 兼容网关。型号数百个，不在此预置型号 id，由“获取模型列表”拉取后选择。
    // 图标取自 OpenRouter 官网的品牌字形（brand/v2/openrouter-glyph-light.svg），仅用于标识该厂商。
    providerName: "OpenRouter",
    shortName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    transport: "openai",
    mainModels: [],
    iconUrl: "../icons/providers/openrouter.svg",
    websiteUrl: "https://openrouter.ai/",
  },
  {
    providerName: CUSTOM_ENDPOINT_PROVIDERS.cloud,
    shortName: "自定义",
    baseUrl: "",
    transport: "openai",
    mainModels: [],
    iconUrl: "../icons/providers/custom-endpoint.svg",
    customEndpointMode: "cloud",
  },
  {
    providerName: CUSTOM_ENDPOINT_PROVIDERS.local,
    shortName: "本地模型",
    baseUrl: "",
    transport: "openai",
    mainModels: [],
    iconUrl: "../icons/providers/custom-endpoint.svg",
    customEndpointMode: "local",
    hiddenInPresetList: true,
  },
];
