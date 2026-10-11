// 记忆设置页 DOM 引用：导入知识列表与 Obsidian 同步卡片。
// ESM 静态导入保证查询在 settings.ts 顶层代码之前执行。

export const memoryImportedList = document.getElementById("memory-imported-list") as HTMLElement | null;
export const obsidianVaultBindBtn = document.getElementById("obsidian-vault-bind-btn") as HTMLButtonElement | null;
export const obsidianVaultUnbound = document.getElementById("obsidian-vault-unbound") as HTMLElement | null;
export const obsidianVaultBound = document.getElementById("obsidian-vault-bound") as HTMLElement | null;
export const obsidianVaultPath = document.getElementById("obsidian-vault-path") as HTMLElement | null;
export const obsidianVaultSyncBtn = document.getElementById("obsidian-vault-sync-btn") as HTMLButtonElement | null;
export const obsidianVaultUnbindBtn = document.getElementById("obsidian-vault-unbind-btn") as HTMLButtonElement | null;
export const obsidianVaultAutoSync = document.getElementById("obsidian-vault-auto-sync") as HTMLInputElement | null;
export const obsidianVaultExportBtn = document.getElementById("obsidian-vault-export-btn") as HTMLButtonElement | null;
export const obsidianVaultHint = document.getElementById("obsidian-vault-hint") as HTMLParagraphElement | null;
