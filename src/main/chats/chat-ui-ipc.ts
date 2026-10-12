import { BrowserWindow, screen } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { createWindowDragController } from "./window-drag";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { getCapabilityOrOpenAI } from "../orchestrator/vendors";
import { normalizeReasoningPreference } from "../../shared/reasoning";
import {
  listSavedModelProfiles,
  getDefaultModelProfile,
  loadModelSettings,
  saveModelProfile,
  saveModelSettings,
  resolveModelSettingsProfile,
} from "../settings/model-settings";
import { resolveVendorRuntimeSettings } from "../orchestrator/vendors/runtime-settings";
import { resolveTransport } from "../orchestrator/vendors/transport-detector";
import { getSession } from "./chats-store";
import { getActiveLive2dWorkRunCount } from "../orchestrator/live2d-work-signal";
import { describePendingAttachment } from "../rag/file-ingest";
import { captionImageSafe, buildImageCaptionPrompt, validateCaptionImagePath } from "../chat/image-caption";
import { resolveCaptionVisionConfig, resolveImageRoute } from "../orchestrator/image-router";
import type { WindowManager } from "../windows/window-manager";
import { reactChatSession, reactChatWindow } from "../windows/window-state";
import {
  activeChatTargetRegistry,
  parseActiveTargetPayload,
} from "../plugin-host/active-chat-target";

export interface ChatUiIpcDependencies {
  live2dWindowLifecycle: { getDiagnostics(): unknown };
  get windowManager(): WindowManager | null;
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
  /** Refresh private browser ownership synchronously after the trusted target changes. */
  onActiveTargetChanged?: () => void;
}

// 活动会话不再用模块变量记录：activeChatTargetRegistry 同时维护会话、模式、
// 渲染目标标识与失效监听，供语音输入租约冻结提交目标使用。

/** 兼容旧语义：当前活动会话 ID（无目标或欢迎页时为 null）。 */
export function getActiveChatSessionId(): string | null {
  return activeChatTargetRegistry.getActive()?.sessionId ?? null;
}

export function registerChatUiIpc(deps: ChatUiIpcDependencies): void {
  const ipc = deps.ipc ?? createIpcScope();

  // 桌宠只会收到“工作中”的跳变事件；窗口晚于 true 事件加载或重载时，用这个快照补上当前状态。
  ipc.handle(IPC.LIVE2D_GET_WORKING, () => getActiveLive2dWorkRunCount() > 0);

  ipc.on(IPC.CHAT_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipc.on(IPC.CHAT_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipc.on(IPC.CHAT_TOGGLE_MAXIMIZE, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;
    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize();
    } else {
      senderWindow.maximize();
    }
  });

  ipc.handle(IPC.CHAT_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // 无边框透明窗口最大化后拖标题栏不会被系统还原：渲染端发起拖动，这里还原并跟随光标。
  const windowDrag = createWindowDragController({
    getCursor: () => screen.getCursorScreenPoint(),
    getWorkArea: (point) => screen.getDisplayNearestPoint(point).workArea,
  });
  ipc.on(IPC.CHAT_WINDOW_DRAG_START, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow) windowDrag.start(senderWindow);
  });
  ipc.on(IPC.CHAT_WINDOW_DRAG_END, () => windowDrag.stop());

  ipc.handle(IPC.CHAT_GET_REASONING_STATE, (_event, payload?: { sessionId?: unknown; modelProfileId?: unknown }) => {
    const baseSettings = loadModelSettings();
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : undefined;
    const session = sessionId ? getSession(sessionId) : undefined;
    // 档案解析优先级：会话绑定 > 渲染端待定档案（欢迎页暂存）> 默认档案。
    // 不能回退顶层镜像：顶层可能是空壳（provider 指向别家、三件套全空），
    // 与 channel bot 不回复是同一病根：不解析默认档案时拿到的是顶层空壳镜像配置。
    const profiles = listSavedModelProfiles(baseSettings);
    const requestedId = session?.modelProfileId
      ?? (typeof payload?.modelProfileId === "string" && payload.modelProfileId ? payload.modelProfileId : undefined);
    const profile = profiles.find((item) => item.id === requestedId) ?? getDefaultModelProfile(baseSettings);
    const settings = profile ? resolveModelSettingsProfile(baseSettings, profile.id) : baseSettings;
    const cap = getCapabilityOrOpenAI(settings.provider);
    return {
      providerKey: settings.provider,
      providerId: cap.id,
      model: settings.model,
      preference: settings.reasoning,
      // 档案里声明的档位；没声明时渲染端按型号规则表回退。
      reasoningLevels: settings.reasoningLevels,
      thinkingOverride: resolveVendorRuntimeSettings(settings).thinkingOverride,
      // PRO 档（reasoning.mode="pro"）仅 Responses 协议存在，UI 据此决定是否显示
      transport: resolveTransport({
        baseUrl: settings.baseUrl,
        explicitTransport: settings.explicitTransport,
        provider: settings.provider,
      }),
      modelProfileId: profile?.id ?? null,
    };
  });

  ipc.handle(IPC.CHAT_SET_REASONING, (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const p = payload as { sessionId?: unknown; modelProfileId?: unknown; providerKey?: unknown; preference?: unknown };
    if (typeof p.providerKey !== "string" || typeof p.preference !== "object" || !p.preference) return;
    const normalized = normalizeReasoningPreference(p.preference);
    if (!normalized) return;

    const current = loadModelSettings();
    const session = typeof p.sessionId === "string" ? getSession(p.sessionId) : undefined;
    if (session?.modelProfileId) {
      const profile = listSavedModelProfiles(current).find((item) => item.id === session.modelProfileId);
      if (!profile || profile.provider !== p.providerKey) return;
      saveModelProfile({ ...profile, reasoning: normalized });
      return;
    }

    // 无会话（欢迎页）：与 GET 对称——优先写渲染端待定档案，其次默认档案，
    // 都没有才写顶层镜像。否则 GET 读的是档案、SET 写的是顶层，切了等于没切。
    const profiles = listSavedModelProfiles(current);
    const requestedId = typeof p.modelProfileId === "string" && p.modelProfileId ? p.modelProfileId : undefined;
    const profile = profiles.find((item) => item.id === requestedId) ?? getDefaultModelProfile(current);
    if (profile) {
      if (profile.provider !== p.providerKey) return;
      saveModelProfile({ ...profile, reasoning: normalized });
      return;
    }

    if (current.provider !== p.providerKey) return;
    saveModelSettings({ reasoning: normalized });
  });

  ipc.handle(IPC.CHAT_INGEST_FILES, async (_event, entries: unknown) => {
    const list = Array.isArray(entries)
      ? entries.filter((entry): entry is { path: string; mime?: string } =>
          typeof entry === "object" && entry !== null
          && typeof (entry as { path?: unknown }).path === "string")
      : [];
    if (list.length === 0) return [];
    try {
      return list.map((entry) => describePendingAttachment(entry.path, entry.mime));
    } catch (err: any) {
      console.error("[Firefly] ingestFiles ERROR:", err?.message || err);
      return [];
    }
  });

  ipc.handle(IPC.CHAT_CAPTION_IMAGE, async (_event, payload: unknown) => {
    const filePath = payload && typeof payload === "object"
      ? (payload as { filePath?: unknown }).filePath
      : undefined;
    const hasAnnotations = payload && typeof payload === "object"
      ? (payload as { hasAnnotations?: unknown }).hasAnnotations === true
      : false;
    const settings = resolveModelSettingsProfile(loadModelSettings());
    const vision = resolveCaptionVisionConfig(settings);
    if (!vision.ok) {
      return { ok: false, error: vision.error };
    }

    return captionImageSafe(filePath, buildImageCaptionPrompt(hasAnnotations), vision.config);
  });

  ipc.handle(IPC.CHAT_GET_IMAGE_PREVIEW, (_event, payload: unknown) => {
    const filePath = payload && typeof payload === "object"
      ? (payload as { filePath?: unknown }).filePath
      : undefined;
    const validated = validateCaptionImagePath(filePath);
    if (!validated.ok) return { ok: false, error: validated.error };
    return {
      ok: true,
      dataUrl: `data:${validated.mime};base64,${validated.buffer.toString("base64")}`,
    };
  });

  ipc.handle(IPC.CHAT_GET_IMAGE_SEND_STRATEGY, (_event, payload: unknown) => {
    // 按会话解析：会话绑定的档案按其厂商 + 型号推断图片能力；
    // 无 sessionId / 会话未绑档案 → 使用默认档案（现行为）。
    const sessionId = payload && typeof payload === "object"
      ? (payload as { sessionId?: unknown }).sessionId
      : undefined;
    let settings = loadModelSettings();
    if (typeof sessionId === "string" && sessionId) {
      const session = getSession(sessionId);
      if (session?.modelProfileId) {
        settings = resolveModelSettingsProfile(settings, session.modelProfileId);
      }
    }
    // 图片路由统一收口在 image-router；返回形状保持 { mode: "direct" | "caption" } 不变。
    // reject（当前型号不支持图片）映射为 caption：UI 侧转述请求会拿到路由的
    // 人话错误并如实展示，而不是假装能直发。
    const imageRoute = resolveImageRoute("attachment", settings);
    return { mode: imageRoute.mode === "direct" ? "direct" as const : "caption" as const };
  });

  // 状态栏专用入口：打开/复用 reactChatWindow
  // 注意：必须用 deps.windowManager 实时读取 getter，不能在注册时解构。
  // registerChatUiIpc 在模块加载阶段调用，那时 windowManager 仍为 null，
  // 解构会捕获 null 并导致后续 ?. 永远短路，按钮点了打不开窗口。
  ipc.handle(IPC.CHATS_OPEN_IN_REACT_WINDOW, (_event, sessionId: string) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) return false;
    void deps.windowManager?.openReactChatWindow(sessionId);
    return true;
  });

  // reactChatWindow → main：声明 ChatPage 已挂好 IPC 监听
  ipc.on(IPC.CHATS_REACT_READY, (event) => {
    const win = reactChatWindow;
    if (!win || win.isDestroyed()) return;
    if (event.sender !== win.webContents) return;
    const pending = reactChatSession.markReady();
    if (pending) {
      win.webContents.send(IPC.CHATS_REACT_SWITCH_SESSION, pending);
    }
  });

  // 聊天窗口启动/切换会话时上报当前活跃目标（会话 + 模式 + 渲染目标标识）；
  // 只有聊天窗口的 webContents 可以登记，其他窗口的上报被忽略；main 广播给所有窗口
  ipc.handle(IPC.CHATS_SET_ACTIVE_SESSION, (event, payload: unknown) => {
    const chatWindow = reactChatWindow;
    if (!chatWindow || chatWindow.isDestroyed() || event.sender !== chatWindow.webContents) {
      return false;
    }
    if (payload == null) {
      activeChatTargetRegistry.clearActive(event.sender);
    } else {
      const parsed = parseActiveTargetPayload(payload);
      if (parsed) {
        activeChatTargetRegistry.setActive({ sender: event.sender, ...parsed });
      }
    }
    deps.onActiveTargetChanged?.();
    return true;
  });

}
