import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import { isDev } from "../env";
import { getModelConnectionSnapshot, onModelConnectionChanged, testModelConnection } from "./model-settings";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { DEFAULT_UI_FONT, isSupportedFontFileName } from "../../shared/ui-font";
import type { GeneralSettings } from "./general-settings";
import type { TimeoutSettings } from "../../shared/timeout-types";
import type { WindowManager } from "../windows/window-manager";
import {
  reactChatWindow,
  sidebarWindow,
  settingsWindow,
} from "../windows/window-state";
import type { EmbeddingIndexService } from "../services/embedding/embedding-index-service";
import { initReranker, getRerankerInstallStatus } from "../rag/reranker";
import { switchEmbeddingModel } from "../rag";
import { testVendorConnection } from "../orchestrator/vendors/test-connection";
import { fetchVendorModels, type FetchModelsInput } from "./fetch-vendor-models";
import type { VendorConfig } from "../orchestrator/vendors";
import { normalizeModelSettings, getPublicModelConfig, listSavedModelProfiles, saveModelProfile, setDefaultModelProfile, saveModelSettings } from "./model-settings";
import { getAgentRoutingView, updateAgentRouting } from "./agent-model-routing";
import type { ModelSettings } from "./model-settings";
import { assertModelSettingsReadable } from "./model-settings";
import { resolveInputModalities } from "../orchestrator/vendors/multimodal";
import { normalizeDeclaredInputModalities } from "../../shared/input-modalities";
import { assertGeneralSettingsReadable } from "./settings-facade";
import { getTimeoutSettings, saveTimeoutSettings } from "../timeout-manager";
import type { syncVolcanoSearchMcp } from "./general-settings-lifecycle";
import type { syncPlaywrightMcp } from "../sync-mcp-builtin";

export interface SettingsIpcDependencies {
  get windowManager(): WindowManager | null;
  getGeneralSettings: () => GeneralSettings;
  saveGeneralSettings: (settings: Partial<GeneralSettings>) => GeneralSettings;
  getModelSettings: () => ModelSettings;
  saveModelSettings: (settings: Partial<ModelSettings>) => ModelSettings;
  proactiveLifecycle: { getProactiveChatService: () => { invalidate: () => void } | null };
  reconcileUserMemoryIndex: () => Promise<void>;
  embeddingIndexService: EmbeddingIndexService;
  syncVolcanoSearchMcp: typeof syncVolcanoSearchMcp;
  syncPlaywrightMcp: typeof syncPlaywrightMcp;
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
}

function getUiFontsDir(): string {
  return path.join(app.getPath("userData"), "ui-fonts");
}

function getCustomFontDisplayName(filePath: string): string {
  return (
    path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim().slice(0, 80) || "自定义字体"
  );
}

/** 档案列表对外视图：图片能力由显式声明 / 内置目录判定（不存进档案），这里补上结果与依据供 UI 展示。 */
function listProfileViews(settings: ModelSettings) {
  return listSavedModelProfiles(settings).map((profile) => {
    const judged = resolveInputModalities({
      provider: profile.provider,
      model: profile.model,
      declared: profile.inputModalities,
      declaredSource: profile.inputModalitiesSource,
    });
    return { ...profile, multimodal: judged.image, multimodalSource: judged.source };
  });
}

export function registerSettingsIpc(deps: SettingsIpcDependencies): () => void {
  const ipc = deps.ipc ?? createIpcScope();
  const {
    getGeneralSettings,
    saveGeneralSettings,
    getModelSettings,
    saveModelSettings,
    proactiveLifecycle,
    reconcileUserMemoryIndex,
    embeddingIndexService,
    syncVolcanoSearchMcp,
    syncPlaywrightMcp,
  } = deps;
  // 注意：windowManager 不解构，统一用 deps.windowManager 实时读取 getter。
  // registerSettingsIpc 在模块加载阶段调用，那时 windowManager 仍为 null，
  // 解构会捕获 null 并导致后续 ?. 永远短路（设置里的打开侧边栏/日程等会失效）。

  function broadcastToAuxWindows(channel: string, payload: unknown): void {
    for (const win of [reactChatWindow, sidebarWindow, settingsWindow]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  function broadcastModelConfigChanged(settings = getModelSettings()): void {
    broadcastToAuxWindows(IPC.MODEL_CONFIG_CHANGED, getPublicModelConfig(settings));
  }

  ipc.handle(IPC.SETTINGS_GET_CONFIG, () => {
    assertModelSettingsReadable();
    return getModelSettings();
  });
  ipc.handle(IPC.SETTINGS_MODEL_PROFILES_LIST, () => {
    assertModelSettingsReadable();
    const settings = getModelSettings();
    return { profiles: listProfileViews(settings), defaultModelProfileId: settings.defaultModelProfileId };
  });
  ipc.handle(IPC.SETTINGS_AGENT_ROUTING_GET, () => {
    assertModelSettingsReadable();
    return getAgentRoutingView(getModelSettings());
  });
  ipc.handle(IPC.SETTINGS_AGENT_ROUTING_UPDATE, (_event, input: unknown) => {
    assertModelSettingsReadable();
    const saved = saveModelSettings(updateAgentRouting(getModelSettings(), input));
    return getAgentRoutingView(saved);
  });
  ipc.handle(IPC.SETTINGS_MODEL_PROFILE_SAVE, (_event, profile) => {
    const saved = saveModelProfile(profile as Parameters<typeof saveModelProfile>[0]);
    if (saved.added && saved.settings.defaultModelProfileId === saved.settings.modelProfiles?.at(-1)?.id) {
      broadcastModelConfigChanged(saved.settings);
    }
    return { added: saved.added, profiles: listProfileViews(saved.settings), defaultModelProfileId: saved.settings.defaultModelProfileId };
  });
  ipc.handle(IPC.SETTINGS_MODEL_PROFILE_DELETE, (_event, id: unknown) => {
    if (typeof id !== "string") return null;
    const settings = getModelSettings();
    const profiles = listSavedModelProfiles(settings).filter((profile) => profile.id !== id);
    const defaultModelProfileId = settings.defaultModelProfileId === id ? profiles[0]?.id : settings.defaultModelProfileId;
    const saved = saveModelSettings({ modelProfiles: profiles, defaultModelProfileId });
    broadcastModelConfigChanged(saved);
    return { profiles: listProfileViews(saved), defaultModelProfileId: saved.defaultModelProfileId };
  });
  ipc.handle(IPC.SETTINGS_MODEL_PROFILE_SET_DEFAULT, (_event, id: unknown) => {
    if (typeof id !== "string") return null;
    const saved = setDefaultModelProfile(id);
    broadcastModelConfigChanged(saved);
    return { profiles: listProfileViews(saved), defaultModelProfileId: saved.defaultModelProfileId };
  });

  ipc.handle(IPC.SETTINGS_GET_GENERAL, () => {
    assertGeneralSettingsReadable();
    return getGeneralSettings();
  });

  ipc.handle(IPC.SETTINGS_GET_TIMEOUT_SETTINGS, () => getTimeoutSettings());

  ipc.handle(IPC.SETTINGS_SAVE_TIMEOUT_SETTINGS, (_event, settings: Partial<TimeoutSettings>) =>
    saveTimeoutSettings(settings),
  );

  ipc.handle(IPC.UI_COLORS_GET, () => getGeneralSettings().uiColors);

  ipc.handle(IPC.UI_THEME_GET, () => getGeneralSettings().uiTheme);

  ipc.handle(IPC.UI_FONT_GET, () => getGeneralSettings().uiFont);

  ipc.handle(IPC.SETTINGS_PICK_UI_FONT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "字体文件", extensions: ["ttf", "otf"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipc.handle(IPC.SETTINGS_IMPORT_UI_FONT, (_event, sourcePath: unknown) => {
    if (typeof sourcePath !== "string" || !sourcePath) throw new Error("未选择字体文件");
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension !== ".ttf" && extension !== ".otf") throw new Error("仅支持 .ttf 或 .otf 字体文件");
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 50 * 1024 * 1024) throw new Error("字体文件无效或超过 50 MB");

    const fileName = `custom-${randomUUID()}${extension}`;
    if (!isSupportedFontFileName(fileName)) throw new Error("字体文件名无效");
    const fontsDir = getUiFontsDir();
    fs.mkdirSync(fontsDir, { recursive: true });
    const targetPath = path.join(fontsDir, fileName);
    fs.copyFileSync(sourcePath, targetPath);

    const before = getGeneralSettings().uiFont;
    const saved = saveGeneralSettings({
      uiFont: { kind: "custom", fileName, displayName: getCustomFontDisplayName(sourcePath) },
    });
    if (before.kind === "custom" && before.fileName !== fileName) {
      const oldPath = path.join(fontsDir, before.fileName);
      if (isSupportedFontFileName(before.fileName)) fs.rmSync(oldPath, { force: true });
    }
    return saved.uiFont;
  });

  ipc.handle(IPC.SETTINGS_RESET_UI_FONT, () => {
    const before = getGeneralSettings().uiFont;
    const saved = saveGeneralSettings({ uiFont: DEFAULT_UI_FONT });
    if (before.kind === "custom" && isSupportedFontFileName(before.fileName)) {
      fs.rmSync(path.join(getUiFontsDir(), before.fileName), { force: true });
    }
    return saved.uiFont;
  });

  ipc.handle(IPC.SETTINGS_SAVE_GENERAL, async (_event, settings: Partial<GeneralSettings>) => {
    const saved = saveGeneralSettings(settings);
    if ("searchMinimaxKey" in settings || "searchEngine" in settings) await syncVolcanoSearchMcp(saved);
    if ("playwrightMcpEnabled" in settings) await syncPlaywrightMcp(saved);
    if ("proactiveChatMode" in settings || "proactiveDeliveryTarget" in settings) {
      proactiveLifecycle.getProactiveChatService()?.invalidate();
    }
    return saved;
  });

  ipc.on(IPC.SETTINGS_OPEN_SIDEBAR, () => {
    // Retired standalone status window: legacy messages are harmless.
  });

  ipc.on(IPC.SETTINGS_CLOSE_SIDEBAR, async () => {
    sidebarWindow?.close();
  });

  ipc.on(IPC.SETTINGS_SET_PET_ALWAYS_ON_TOP, (_event, value: boolean) => {
    const saved = saveGeneralSettings({ ...getGeneralSettings(), petAlwaysOnTop: Boolean(value) });
    deps.windowManager?.setPetWindowAlwaysOnTop(saved.petAlwaysOnTop);
  });

  ipc.on(IPC.SETTINGS_SET_PET_VISIBLE, (_event, value: boolean) => {
    saveGeneralSettings({ ...getGeneralSettings(), petVisible: Boolean(value) });
  });

  ipc.on(IPC.SETTINGS_SET_PET_ZOOM, (_event, value: number) => {
    const saved = saveGeneralSettings({ ...getGeneralSettings(), petZoom: Number(value) });
    deps.windowManager?.applyPetWindowZoom(saved.petZoom);
  });

  ipc.handle(IPC.MODEL_CONFIG_GET, () => {
    assertModelSettingsReadable();
    return getPublicModelConfig();
  });

  ipc.handle(IPC.SETTINGS_SAVE_CONFIG, (_event, settings: Partial<ModelSettings>) => {
    const saved = saveModelSettings(settings);
    broadcastModelConfigChanged(saved);
    return saved;
  });

  const unsubscribeConnections = onModelConnectionChanged((snapshot) => {
    broadcastToAuxWindows(IPC.MODEL_CONNECTION_CHANGED, snapshot);
    broadcastModelConfigChanged();
  });
  ipc.handle(IPC.MODEL_CONNECTION_GET, () => {
    assertModelSettingsReadable();
    return getModelConnectionSnapshot();
  });
  // 带着档案里的 API Key 去访问外部地址的调用，只允许设置窗口的主 frame 发起。
  const assertSettingsSender = (event: IpcMainInvokeEvent): void => {
    const win = settingsWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("MODEL_CONNECTION_FORBIDDEN");
    }
    const expected = isDev ? "http://localhost:5173/settings/" : pathToFileURL(path.join(app.getAppPath(), "dist", "renderer", "settings", "index.html")).href;
    let actual: string;
    try { const url = new URL(event.senderFrame.url); url.hash = ""; actual = url.href; } catch { throw new Error("MODEL_CONNECTION_FORBIDDEN"); }
    if (actual !== expected) throw new Error("MODEL_CONNECTION_FORBIDDEN");
  };
  ipc.handle(IPC.SETTINGS_TEST_CONNECTION, async (event: IpcMainInvokeEvent, cfg: VendorConfig) => {
    assertSettingsSender(event);
    return testModelConnection(cfg, testVendorConnection);
  });
  // 设置页"获取模型列表"：向用户接入的厂商拉取它实际提供的型号，只返回 id/展示名，不回传 Key。
  ipc.handle(IPC.SETTINGS_FETCH_MODELS, async (event: IpcMainInvokeEvent, input: FetchModelsInput) => {
    assertSettingsSender(event);
    if (!input || typeof input !== "object") return { ok: false, error: "MISSING_BASE_URL" };
    return fetchVendorModels({
      provider: typeof input.provider === "string" ? input.provider : "",
      baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "",
      apiKey: typeof input.apiKey === "string" ? input.apiKey : "",
      explicitTransport: input.explicitTransport === "openai" || input.explicitTransport === "anthropic" || input.explicitTransport === "responses" ? input.explicitTransport : undefined,
    });
  });
  // 输入类型的“当前生效结果”：编辑器按草稿实时显示，与档案列表共用同一判定入口 resolveInputModalities。
  ipc.handle(IPC.SETTINGS_RESOLVE_INPUT_MODALITIES, (event: IpcMainInvokeEvent, input: unknown) => {
    assertSettingsSender(event);
    const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const declared = normalizeDeclaredInputModalities(raw.inputModalities, raw.inputModalitiesSource);
    return resolveInputModalities({
      provider: typeof raw.provider === "string" ? raw.provider : "",
      model: typeof raw.model === "string" ? raw.model : "",
      declared: declared.inputModalities,
      declaredSource: declared.inputModalitiesSource,
    });
  });

  ipc.handle(IPC.EMBEDDING_SET_MODEL, async (_event, modelKey: string) => {
    console.log("[Firefly] embedding model switch requested:", modelKey);
    try {
      const result = await switchEmbeddingModel(modelKey);
      if (result.ok) {
        await reconcileUserMemoryIndex();
        saveModelSettings({ embeddingModel: "bgem3" });
        broadcastModelConfigChanged();
        embeddingIndexService.invalidateStickerEmbeddingIndex();
        embeddingIndexService.refreshStickerEmbeddingIndex("embedding-model-switch");
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Firefly] embedding model switch failed:", message);
      return { ok: false, clearedEntries: 0, error: message };
    }
  });

  ipc.handle(IPC.RERANKER_SET_MODE, async (_event, mode: "standard" | "none") => {
    const current = getModelSettings();
    saveModelSettings({ ...current, rerankerMode: mode });
    await initReranker(mode);
    console.log("[Firefly] reranker mode switched to", mode);
    return true;
  });

  ipc.handle(IPC.RERANKER_GET_STATUS, () => getRerankerInstallStatus());

  ipc.handle(IPC.MODEL_GET_INSTALL_STATUS, () => {
    const { getModelInstallStatus } = require("../rag/model-status");
    return getModelInstallStatus();
  });

  ipc.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, error: "Invalid URL" };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  return unsubscribeConnections;
}
