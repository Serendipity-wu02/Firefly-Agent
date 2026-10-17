import { dialog } from "electron";
import { cachedZhMap, parseTranslation, translateMissing, translationMessages } from "../skills/skill-description-zh";
import { createLlmClient } from "../services/llm/llm-client";
import { loadModelSettings, resolveModelSettingsProfile } from "../settings/model-settings";
import type { IpcMainInvokeEvent } from "electron";
import { isTrustedExternalMainFrame } from "../skills/external-ipc";
import { isExternalSkillId } from "../skills/skill-scanner";
import * as fs from "fs";
import * as path from "path";
import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { getStickerManagerConfig, setStickerEnabled } from "../orchestrator/sticker-settings";
import { addUserSticker } from "../sticker-storage";
import { loadImportedDocumentPanelData, loadMemoryPanelData } from "./panel";
import { deleteImportedDoc } from "../rag";
import { loadUserProfile, saveUserProfile, getAvatarPath } from "../settings-store";
import { registerMcpManagementIpc } from "../orchestrator/mcp-management-ipc";
import { toolRegistry } from "../orchestrator/tools/registry/tool-registry";
import type { ConversationMode } from "../../shared/chat-types";
import { loadGeneralSettings, saveGeneralSettings } from "../settings/settings-facade";
import { setSkillEnabled, skillRegistry, rescanSkills } from "../skills";
import type { SkillMode } from "../skills/types";
import type { WindowManager } from "../windows/window-manager";
import {
  reactChatWindow,
  sidebarWindow,
  settingsWindow,
  stickerManagerWindow,
} from "../windows/window-state";
import type { EmbeddingIndexService } from "../services/embedding/embedding-index-service";

export interface MemoryUserToolIpcDependencies {
  get windowManager(): WindowManager | null;
  embeddingIndexService: EmbeddingIndexService;
  /** Main 装配决定，Renderer payload 不能启用旧个人记忆。 */
  personalMemoryMode?: "legacy" | "smh";
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
}

function broadcastToAuxWindows(channel: string, payload: unknown): void {
  for (const win of [reactChatWindow, sidebarWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function registerMemoryUserToolIpc(deps: MemoryUserToolIpcDependencies): void {
  const { embeddingIndexService } = deps;
  const personalMemoryRetired = deps.personalMemoryMode === "smh";
  const ipc = deps.ipc ?? createIpcScope();
  // 注意：windowManager 不解构，统一用 deps.windowManager 实时读取 getter。
  // registerMemoryUserToolIpc 在模块加载阶段调用，那时 windowManager 仍为 null，
  // 解构会捕获 null 并导致后续 ?. 永远短路（表情包管理窗口打不开）。

  // Sticker manager window controls
  ipc.handle(IPC.SETTINGS_OPEN_STICKER_MANAGER, async () => {
    console.log("[stickers] open sticker manager requested");
    return deps.windowManager?.createStickerManagerWindow();
  });

  ipc.on(IPC.STICKERS_MINIMIZE, () => {
    stickerManagerWindow?.minimize();
  });

  ipc.on(IPC.STICKERS_CLOSE, () => {
    stickerManagerWindow?.close();
  });

  ipc.handle(IPC.STICKERS_GET_CONFIG, () => getStickerManagerConfig());

  ipc.handle(IPC.STICKERS_SET_ENABLED, (_event, payload: unknown) => {
    const record = payload as { id?: unknown; enabled?: unknown };
    const id = typeof record?.id === "string" ? record.id : null;
    if (!id) return getStickerManagerConfig();
    setStickerEnabled(id, Boolean(record.enabled));
    return getStickerManagerConfig();
  });

  ipc.handle(IPC.STICKERS_PICK_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipc.handle(IPC.STICKERS_ADD, async (_event, payload: unknown) => {
    const { sourcePath, id, description, phrases } = payload as {
      sourcePath: string;
      id: string;
      description: string;
      phrases: string[];
    };
    try {
      await addUserSticker(sourcePath, id, description, phrases);
      embeddingIndexService.invalidateStickerEmbeddingIndex();
      embeddingIndexService.refreshStickerEmbeddingIndex("user-sticker-add");
    } catch (err) {
      console.error("[stickers] add failed:", err);
      throw err;
    }
    return getStickerManagerConfig();
  });

  ipc.handle(IPC.STICKERS_GET_ENABLED, () => {
    return getStickerManagerConfig().filter((s) => s.enabled);
  });

  // User avatar / profile
  ipc.handle(IPC.USER_GET_AVATAR, () => {
    const avatarPath = getAvatarPath();
    if (!fs.existsSync(avatarPath)) return null;
    const buf = fs.readFileSync(avatarPath);
    const ext = path.extname(avatarPath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : "image/png";
    return "data:" + mime + ";base64," + buf.toString("base64");
  });

  // Memory panel
  ipc.handle(IPC.MEMORY_PANEL_GET_DATA, () => personalMemoryRetired ? loadImportedDocumentPanelData() : loadMemoryPanelData());

  ipc.handle(IPC.MEMORY_PANEL_DELETE_IMPORTED_DOC, (_event, payload: { importId: string; fileName?: string }) => {
    const deleted = deleteImportedDoc(payload.importId, payload.fileName);
    return { ok: true, deleted };
  });

  ipc.handle(IPC.USER_GET_PROFILE, () => loadUserProfile());

  ipc.handle(IPC.USER_SAVE_PROFILE, (_event, profile: Partial<{ avatarPath?: string } & Record<string, unknown>>) => {
    const saved = saveUserProfile(profile);
    broadcastToAuxWindows(IPC.USER_PROFILE_CHANGED, saved);
    return saved;
  });

  ipc.handle(IPC.USER_UPLOAD_AVATAR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const srcPath = result.filePaths[0];
    const avatarPath = getAvatarPath();
    fs.mkdirSync(path.dirname(avatarPath), { recursive: true });
    fs.copyFileSync(srcPath, avatarPath);
    const profile = saveUserProfile({ avatarPath });
    broadcastToAuxWindows(IPC.USER_AVATAR_CHANGED, null);
    return { avatarPath, profile };
  });

  registerMcpManagementIpc({ ipc, getSettingsWindow: () => settingsWindow });

  // 工具目录元数据（工具页展示用；只暴露可序列化字段，不含 execute/zod schema）
  ipc.handle(IPC.TOOL_GET_CATALOG, () => {
    return toolRegistry.getAllTools().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      modes: t.modes ?? null,
      chatBuiltin: t.chatBuiltin === true,
      deprecated: t.deprecated ?? null,
    }));
  });

  // 三模适配层：工具-模式覆盖层读写。
  // 覆盖层持久化在 general-settings.toolModeOverrides，覆盖优先于工具声明的 modes 字段。
  ipc.handle(IPC.TOOL_GET_MODE_OVERRIDES, () => {
    return loadGeneralSettings().toolModeOverrides;
  });

  ipc.handle(IPC.TOOL_SET_MODE_OVERRIDE, (_event, payload: unknown) => {
    const p = payload as { toolId?: string; mode?: string; enabled?: boolean };
    if (!p.toolId || !p.mode) return { ok: false, error: "missing toolId or mode" };
    const validModes = ["chat", "work", "code"];
    if (!validModes.includes(p.mode)) return { ok: false, error: "invalid mode" };
    const mode = p.mode as ConversationMode;
    const before = loadGeneralSettings().toolModeOverrides;
    const next = { ...before };
    next[p.toolId] = { ...(next[p.toolId] ?? {}), [mode]: p.enabled !== false };
    saveGeneralSettings({ toolModeOverrides: next });
    console.log(`[Tool] override ${p.toolId}@${mode}=${p.enabled !== false}`);
    return { ok: true };
  });

  ipc.handle(IPC.SKILL_SET_ENABLED, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "Invalid Skill enable request." };
    const p = payload as { id?: unknown; enabled?: unknown };
    if (typeof p.id !== "string" || !p.id || typeof p.enabled !== "boolean" || !skillRegistry.getById(p.id)) return { ok: false, error: "Invalid Skill enable request." };
    if (isExternalSkillId(p.id) && (Reflect.ownKeys(payload).some(key => key !== "id" && key !== "enabled")
      || !isTrustedExternalMainFrame(event, reactChatWindow && !reactChatWindow.isDestroyed() ? reactChatWindow.webContents : null))) {
      return { ok: false, error: "External Skill enable request is not permitted." };
    }
    try {
      setSkillEnabled(p.id, p.enabled);
      return { ok: true };
    } catch {
      return { ok: false, error: "Skill state could not be saved or verified. Refresh before trying again." };
    }
  });

  // Skill 目录元数据（skill 页展示用；只暴露可序列化字段）
  // hiddenFromUi = true 的技能（如角色语气校准）不显示在设置面板。
  ipc.handle(IPC.SKILL_GET_CATALOG, () => {
    const visible = skillRegistry.getAll().filter((s) => !s.hiddenFromUi);
    const zh = cachedZhMap(visible);
    return visible
      .map((s) => ({
        descriptionZh: zh[s.id],
        id: s.id,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        source: s.source,
        modes: s.modes ?? null,
        version: s.version,
        references: s.references,
        external: s.external,
      }));
  });

  // 技能页打开时：把还没有中文的描述交给默认模型翻一次，存在本机（不改技能文件），返回所有已知的中文描述。
  ipc.handle(IPC.SKILL_TRANSLATE_DESCRIPTIONS, async () => {
    const visible = skillRegistry.getAll().filter((s) => !s.hiddenFromUi).map((s) => ({ id: s.id, description: s.description }));
    try {
      const settings = resolveModelSettingsProfile(loadModelSettings());
      const client = createLlmClient();
      const translated = await translateMissing(visible, async (batch) => {
        const reply = await client.chatNonStream(settings, translationMessages(batch), 0, 90_000, "skill-description-zh");
        return parseTranslation(reply.text, batch);
      });
      return { ok: true, translated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), translated: cachedZhMap(visible) };
    }
  });

  // 重新扫描 user skills 目录，安装/删除 skill 后无需重启即可刷新 UI。
  ipc.handle(IPC.SKILL_RESCAN, () => {
    const count = rescanSkills();
    return { ok: true, count };
  });

  // 三模适配层：skill-模式覆盖层读写。
  // 覆盖层持久化在 general-settings.skillModeOverrides，覆盖优先于 skill 声明的 modes 字段。
  ipc.handle(IPC.SKILL_GET_MODE_OVERRIDES, () => {
    return loadGeneralSettings().skillModeOverrides;
  });

  ipc.handle(IPC.SKILL_SET_MODE_OVERRIDE, (_event, payload: unknown) => {
    const p = payload as { skillId?: string; mode?: string; enabled?: boolean };
    if (!p.skillId || !p.mode) return { ok: false, error: "missing skillId or mode" };
    const validModes = ["work", "code"];
    if (!validModes.includes(p.mode)) return { ok: false, error: "invalid mode" };
    const mode = p.mode as SkillMode;
    const before = loadGeneralSettings().skillModeOverrides;
    const next = { ...before };
    next[p.skillId] = { ...(next[p.skillId] ?? {}), [mode]: p.enabled !== false };
    saveGeneralSettings({ skillModeOverrides: next });
    console.log(`[Skill] override ${p.skillId}@${mode}=${p.enabled !== false}`);
    return { ok: true };
  });
}
