import { buildToolCatalog } from "./tools/registry/tool-catalog";
import type { ToolDefinition } from "./tools/registry/tool-registry";
import type { ConversationMode } from "../../shared/chat-types";
import { buildModePrompt } from "./mode-prompt-profile";

/**
 * @deprecated 新运行链路必须使用 buildModePrompt(mode)。
 * 仅供尚未迁移的调用方兼容，绝不再根据 Work 默认拼接 Code 或 soul。
 */
export function buildSystemPrompt(promptName: string): string {
  const mode: ConversationMode = promptName.startsWith("chat") || promptName.startsWith("talk")
    ? "chat"
    : "work";
  return buildModePrompt(mode);
}

/**
 * 工具规则与目录 system prompt（进入 harness stablePrefix）。
 * 仅含运行时生成的工具目录——
 * 不放任何人格 / 环境 / 记忆，避免人设污染工具决策。
 */
export function buildToolSystemPrompt(
  _mode: ConversationMode,
  enabledTools: ReadonlyArray<ToolDefinition>,
): string {
  const catalog = buildToolCatalog(enabledTools as ToolDefinition[]);
  return [
    "## 当前可用工具",
    catalog,
  ].filter(Boolean).join("\n\n");
}

/**
 * 人设基础 system prompt（进入 stablePrefix）。
 * 仅包含按模式选取的人设基础；环境/记忆/关系/附件等动态内容走
 * soulRuntimeContext，随请求尾部注入。
 * 注意：工具结果（`role: "tool"` 消息）在单循环 transcript 中已携带，本函数不重复注入。
 */
export function buildSoulSystemBasePrompt(promptName: string): string {
  return buildSystemPrompt(promptName);
}
