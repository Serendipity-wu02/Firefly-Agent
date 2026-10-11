// 厂商能力表 —— vendor adapter 的唯一事实来源。
// 每条字段以厂商官方文档核实为准；没核实的留保守默认值。
// displayName 必须与 renderer settings.ts 的 MODEL_PRESETS.providerName 完全一致。
import { ProviderCapability } from "./types";

export const PROVIDER_CAPABILITIES = [
  {
    id: "minimax",
    displayName: "MiniMax（稀宇科技）",
    // 官方对 M 系列优先推荐 Anthropic SDK；OpenAI 兼容入口仍可由用户显式选择。
    transport: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
    // OpenAI 兼容入口使用 Bearer；Anthropic 入口由下方 override 使用 x-api-key。
    authStyle: "bearer",
    anthropicAuthStyle: "x-api-key",
    defaultModel: "MiniMax-M3",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "cache_control",
    testStrategy: "text",
    // 视觉仍走 OpenAI 兼容入口。
    visionBaseUrl: "https://api.minimaxi.com/v1",
    // 三协议全支持（协议矩阵 2026-08-21）
    supportedTransports: ["anthropic", "openai", "responses"],
  },
  {
    id: "deepseek",
    displayName: "DeepSeek（深度求索）",
    transport: "openai",
    baseUrl: "https://api.deepseek.com",
    authStyle: "bearer",
    anthropicAuthStyle: "x-api-key",
    defaultModel: "deepseek-flash",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // 三格式原生全支持（官方文档）
    supportedTransports: ["openai", "anthropic", "responses"],
  },
  {
    id: "glm",
    displayName: "GLM（智谱）",
    transport: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authStyle: "bearer",
    defaultModel: "glm-5.2",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // OpenAI 兼容 + Anthropic 兼容（协议矩阵 2026-08-21，用户确认）
    supportedTransports: ["openai", "anthropic"],
  },
  {
    id: "kimi",
    displayName: "Kimi（月之暗面）",
    // OpenAI 兼容 + prompt_cache_key + function.name 正则限制；baseUrl 必须是 .cn
    transport: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    authStyle: "bearer",
    defaultModel: "kimi-k2.7-code",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "prompt_cache_key",
    testStrategy: "text",
    // 官方仅兼容 Chat Completions（协议矩阵 2026-08-21）
    supportedTransports: ["openai"],
  },
  {
    id: "qwen",
    displayName: "Qwen（通义千问）",
    transport: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authStyle: "bearer",
    defaultModel: "qwen-max",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // 官方 OpenAI 兼容；Responses 由阿里云百炼中转（协议矩阵 2026-08-21）
    supportedTransports: ["openai", "responses"],
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT（OpenAI）",
    // 官方主推 Responses（o 系列完整思考摘要仅此协议有）——默认切换（施工文档关键决策）。
    // 旧档案已固化 explicitTransport，不受默认值影响；仅新建档案/无显式值时生效。
    transport: "responses",
    baseUrl: "https://api.openai.com/v1",
    authStyle: "bearer",
    defaultModel: "",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // 双协议：Chat Completions + Responses（Responses 为官方主推）
    supportedTransports: ["openai", "responses"],
    // 端点级标记：仅 OpenAI 官方端点支持 encrypted reasoning 回放
    responsesEncryptedReasoning: true,
  },
  {
    id: "claude",
    displayName: "Claude（Anthropic）",
    transport: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authStyle: "x-api-key",
    defaultModel: "claude-sonnet-4-6",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "cache_control",
    testStrategy: "text",
    // 自家协议 only
    supportedTransports: ["anthropic"],
  },
  {
    id: "mimo",
    displayName: "MiMo（小米）",
    // 默认使用 OpenAI 入口；Anthropic 入口由用户在设置中明确选择。
    transport: "openai",
    baseUrl: "https://api.xiaomimimo.com/v1",
    // 官方文档：/v1 与 /anthropic 都支持 Authorization: Bearer
    authStyle: "bearer",
    defaultModel: "mimo-v2.5-pro",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // 结构上独立：用户切主入口到 /anthropic 时视觉仍由 visionBaseUrl 决定
    visionBaseUrl: "https://api.xiaomimimo.com/v1",
    // 三格式原生全支持（协议矩阵 2026-08-21）
    supportedTransports: ["openai", "anthropic", "responses"],
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    // OpenAI Chat Completions 兼容；显式 transport 为 openai，不走 Responses。
    transport: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    authStyle: "bearer",
    // 聚合网关没有默认型号：型号由“获取模型列表”拉取后选择，不预置。
    defaultModel: "",
    supportsTools: true,
    // 推理统一下发为请求体 reasoning.effort（规则见 shared/reasoning.ts 的 openrouter 条目）；是否真正思考取决于所选型号。
    supportsThinking: true,
    // 思考文本：流式在 delta.reasoning_details（sdk-stream 同时读取 delta.reasoning），非流式在 message.reasoning。
    thinkingField: "reasoning_details",
    // 缓存由底层型号各自决定；本地不下发 cache_control / prompt_cache_key。
    cacheStrategy: "auto",
    testStrategy: "text",
    // 只登记 Chat Completions；Responses 与 Anthropic 入口不在此条目内。
    supportedTransports: ["openai"],
  },
] satisfies readonly ProviderCapability[];

const byDisplayName = new Map(PROVIDER_CAPABILITIES.map(c => [c.displayName, c]));

export function getCapability(provider: string): ProviderCapability | undefined {
  return byDisplayName.get(provider);
}

/** 兜底：未知厂商按 OpenAI 兼容处理（保守可用），避免直接崩。 */
export function getCapabilityOrOpenAI(provider: string): ProviderCapability {
  return byDisplayName.get(provider) ?? {
    id: "unknown",
    displayName: provider,
    transport: "openai",
    baseUrl: "",
    authStyle: "bearer",
    defaultModel: "",
    supportsTools: true,
    supportsThinking: false,
    thinkingField: null,
    cacheStrategy: "none",
    testStrategy: "text",
  };
}
