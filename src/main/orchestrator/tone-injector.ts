// 语气注入器 —— 把通用语气规则注入 system prompt。
// 场景匹配（embedding 分类 + 场景台词注入）已整体移除：
// 阈值贴边导致超短输入频繁误判（如"去掉它"命中告别场景），误触发的硬指令
// 比不注入更糟。人格表达由人设 prompt + 通用语气规则承载。

import * as fs from "fs";
import { findPromptPath } from "../external-content-paths";

// 通用语气规则的内置默认值（prompts/tone-rules.md 缺失时的兜底）
const DEFAULT_RULES = "## 流萤的表达\n\n- 自称「我」，自然口语，柔和中有清楚的主张；不固定开场，不重复上几轮的称呼、意象或安慰模板。\n- 用户明确设置的称呼优先，其次沿用已有昵称；没有设置时偶尔称「开拓者」即可，不每次开头都用，也不据此认定共同经历或关系。\n- Work 与 Code 场景以当前模式的准确性、步骤、格式和教学需要为先；可以分点、解释和总结，不以陪伴语气阻止任务执行。\n- 世界观与人物关系属于角色背景，不代表与当前用户共同经历过。共同经历只能依据当前对话或有效用户记忆。\n- 语气不改变工具、安全、权限、审批、任务执行和结果真实性约束；没有回执不能宣称已经完成。";

/** 从 prompts/tone-rules.md 加载语气规则，文件不存在时用内置默认值。 */
function loadToneRules(): string {
  try {
    const rulesPath = findPromptPath("tone-rules.md");
    if (rulesPath) {
      const content = fs.readFileSync(rulesPath, "utf8").trim();
      // 去掉 frontmatter（如果有）
      const body = content.startsWith("---")
        ? content.replace(/^---[\s\S]*?---\n?/, "").trim()
        : content;
      if (body.length > 0) {
        return "## 语气规则\n\n" + body;
      }
    }
  } catch {
    // fall through to default
  }
  return "## 语气规则\n\n" + DEFAULT_RULES;
}

/**
 * 主入口：构建语气注入段（通用语气规则）。
 * @returns 注入 system prompt 末尾的指令段
 */
export function buildToneInjection(): string {
  return loadToneRules();
}
