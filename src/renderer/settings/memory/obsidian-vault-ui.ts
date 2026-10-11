// Obsidian 同步卡片：绑定文件夹、立即同步、解绑、自动同步与一次性导出。
// 当前记忆版本（SMH）下这些接口会返回 MEMORY_LEGACY_RETIRED，此时整张卡片置为不可用并说明原因。
import type { ObsidianVaultConfig } from "../shared/types";
import { t } from "../i18n";
import {
  obsidianVaultAutoSync,
  obsidianVaultBindBtn,
  obsidianVaultBound,
  obsidianVaultExportBtn,
  obsidianVaultHint,
  obsidianVaultPath,
  obsidianVaultSyncBtn,
  obsidianVaultUnbindBtn,
  obsidianVaultUnbound,
} from "./dom";

const RETIRED = "MEMORY_LEGACY_RETIRED";

/** 后端在记忆版本切换后可能返回的失败形态（与正常返回值共用一个宽松类型）。 */
interface Reply {
  ok?: boolean;
  code?: string;
  error?: string;
  canceled?: boolean;
  fileCount?: number;
  vaultPath?: string;
  config?: ObsidianVaultConfig;
  autoSync?: boolean;
  lastSyncAt?: number;
}

let initialized = false;
let available = true;

function isRetired(reply: Reply | null | undefined): boolean {
  return reply?.code === RETIRED;
}
function setHint(text: string): void {
  if (obsidianVaultHint) obsidianVaultHint.textContent = text;
}
function replyError(reply: Reply): string {
  if (isRetired(reply)) return t("settings.panel.memory.obsidian.unavailable");
  return t("settings.panel.memory.obsidian.failed", { error: reply.error ?? "" });
}
function setAvailable(value: boolean, message?: string): void {
  const wasAvailable = available;
  available = value;
  for (const node of [obsidianVaultBindBtn, obsidianVaultSyncBtn, obsidianVaultUnbindBtn, obsidianVaultExportBtn, obsidianVaultAutoSync]) {
    if (node) node.disabled = !value;
  }
  if (!value) setHint(message ?? t("settings.panel.memory.obsidian.unavailable"));
  else if (!wasAvailable) setHint("");
}
function showBound(bound: boolean): void {
  obsidianVaultUnbound?.classList.toggle("is-hidden", bound);
  obsidianVaultBound?.classList.toggle("is-hidden", !bound);
}

/** 读取绑定状态并刷新卡片。 */
export async function refreshObsidianVaultUI(): Promise<void> {
  const api = window.memoryPanel;
  if (!api) {
    setAvailable(false, t("settings.panel.memory.obsidian.apiMissing"));
    showBound(false);
    return;
  }
  try {
    const config = (await api.getVaultConfig()) as unknown as Partial<ObsidianVaultConfig> & Reply;
    if (isRetired(config)) {
      setAvailable(false);
      showBound(false);
      return;
    }
    setAvailable(true);
    if (config.vaultPath) {
      showBound(true);
      if (obsidianVaultPath) obsidianVaultPath.textContent = `${t("settings.panel.memory.obsidian.boundPathPrefix")}${config.vaultPath}`;
      if (obsidianVaultAutoSync) obsidianVaultAutoSync.checked = Boolean(config.autoSync);
      if (config.lastSyncAt && config.lastSyncAt > 0) {
        setHint(t("settings.panel.memory.obsidian.lastSync", { time: new Date(config.lastSyncAt).toLocaleString() }));
      }
    } else {
      showBound(false);
    }
  } catch {
    setAvailable(false, t("settings.panel.memory.obsidian.loadFailed"));
  }
}

/** 执行一个带忙碌状态的动作；按钮文字在完成后恢复。 */
async function runBusy(button: HTMLButtonElement, busyLabel: string, action: () => Promise<void>): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  setHint("");
  try {
    await action();
  } catch (err) {
    setHint(t("settings.panel.memory.obsidian.failed", { error: err instanceof Error ? err.message : String(err) }));
  } finally {
    button.textContent = original;
    button.disabled = !available;
  }
}

/** 挂载 Obsidian 卡片的事件（只挂一次）；读取状态由页面的 loadMemoryPanel 负责。 */
export function initObsidianVaultUI(): void {
  if (initialized) return;
  initialized = true;

  obsidianVaultBindBtn?.addEventListener("click", () => {
    const api = window.memoryPanel;
    if (!api || !available || !obsidianVaultBindBtn) return;
    void runBusy(obsidianVaultBindBtn, t("settings.panel.memory.obsidian.binding"), async () => {
      const result = await api.bindVault();
      if (result.ok) setHint(t("settings.panel.memory.obsidian.boundDone", { n: result.fileCount ?? 0 }));
      else if (!result.canceled) setHint(replyError(result));
      await refreshObsidianVaultUI();
    });
  });

  obsidianVaultSyncBtn?.addEventListener("click", () => {
    const api = window.memoryPanel;
    if (!api || !available || !obsidianVaultSyncBtn) return;
    void runBusy(obsidianVaultSyncBtn, t("settings.panel.memory.obsidian.syncing"), async () => {
      const result = await api.syncNow();
      if (result.ok) {
        setHint(t("settings.panel.memory.obsidian.syncDone", { n: result.fileCount ?? 0, time: new Date().toLocaleString() }));
      } else {
        setHint(replyError(result));
      }
    });
  });

  obsidianVaultUnbindBtn?.addEventListener("click", async () => {
    const api = window.memoryPanel;
    if (!api || !available) return;
    const reply = await api.unbindVault();
    if (isRetired(reply)) { setAvailable(false); return; }
    await refreshObsidianVaultUI();
    setHint(t("settings.panel.memory.obsidian.unboundDone"));
  });

  obsidianVaultAutoSync?.addEventListener("change", async () => {
    const api = window.memoryPanel;
    if (!api || !available || !obsidianVaultAutoSync) return;
    const checked = obsidianVaultAutoSync.checked;
    const reply = (await api.setAutoSync(checked)) as unknown as Reply;
    if (isRetired(reply)) {
      obsidianVaultAutoSync.checked = !checked;
      setAvailable(false);
      return;
    }
    setHint(t(checked ? "settings.panel.memory.obsidian.autoSyncOn" : "settings.panel.memory.obsidian.autoSyncOff"));
  });

  obsidianVaultExportBtn?.addEventListener("click", () => {
    const api = window.memoryPanel;
    if (!api || !available || !obsidianVaultExportBtn) return;
    void runBusy(obsidianVaultExportBtn, t("settings.panel.memory.obsidian.exporting"), async () => {
      const result = await api.exportToObsidianVault();
      if (result.ok) setHint(t("settings.panel.memory.obsidian.exported", { n: result.fileCount ?? 0 }));
      else if (!result.canceled) setHint(replyError(result));
    });
  });
}
