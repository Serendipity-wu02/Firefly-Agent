import { IPC } from "../../shared/ipc-channels";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { clearUsage, getSessionStats, getUsageHistory, getUsageReport } from "../token-usage-store";
import { listSessions } from "../chats/chats-store";
import {
  sidebarWindow,
  settingsWindow,
} from "./window-state";
import type { WindowManager } from "./window-manager";

export interface WindowSystemIpcDependencies {
  get windowManager(): WindowManager | null;
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
  /**
   * 退出应用。由组合根注入（`() => app.quit()`），使本模块不直接依赖 electron app，
   * 同时保留 before-quit 受控退出链路。
   */
  quit(): void;
}

/**
 * 注册窗口控制与系统入口相关的 IPC handler。
 *
 * 注意：TOKEN_USAGE_GET 本质属于用量统计领域，当前仅因改动最小而临时
 * 挂靠在此；后续拆分统计模块时应二次归位。
 */
export function registerWindowSystemIpc(deps: WindowSystemIpcDependencies): void {
  const ipc = deps.ipc ?? createIpcScope();
  ipc.handle(IPC.WINDOW_SET_INTERACTIVE, (_event, interactive: boolean) => {
    deps.windowManager?.setPetWindowInteractive(interactive);
  });

  ipc.on(IPC.WINDOW_MOVE_TO, (_event, x: number, y: number) => {
    deps.windowManager?.movePetWindowTo(x, y);
  });

  ipc.on(IPC.WINDOW_SET_DRAGGING, (_event, isDragging: boolean) => {
    deps.windowManager?.setPetWindowDragging(isDragging);
  });

  // 桌宠窗口自身的最小化/隐藏入口。两者曾随 index.ts 拆分（711a40d9）被误删，
  // preload 侧 window.firefly.minimize()/hide() 一直保留，此处按原语义补回。
  ipc.on(IPC.WINDOW_MINIMIZE, () => {
    deps.windowManager?.minimizePetWindow();
  });

  ipc.handle(IPC.WINDOW_GET_CURSOR_POSITION, () => deps.windowManager?.getCursorScreenPosition() ?? { x: 0, y: 0 });

  ipc.on(IPC.SIDEBAR_MINIMIZE, () => {
    sidebarWindow?.minimize();
  });

  ipc.on(IPC.SIDEBAR_CLOSE, () => {
    sidebarWindow?.close();
  });

  // 状态栏窗口置顶 toggle：返回切换后的新状态（true=已置顶）
  ipc.handle(IPC.SIDEBAR_TOGGLE_ALWAYS_ON_TOP, () => {
    if (!sidebarWindow) return false;
    const next = !sidebarWindow.isAlwaysOnTop();
    sidebarWindow.setAlwaysOnTop(next, next ? "screen-saver" : "normal");
    return next;
  });

  ipc.on(IPC.SIDEBAR_OPEN_SETTINGS, (_event, section?: string) => {
    deps.windowManager?.createSettingsWindow(section);
  });

  ipc.on(IPC.SETTINGS_MINIMIZE, () => {
    settingsWindow?.minimize();
  });

  ipc.on(IPC.SETTINGS_CLOSE, () => {
    settingsWindow?.close();
  });

  ipc.handle(IPC.MUSIC_OPEN_PLAYER, () => {
    deps.windowManager?.createSettingsWindow("music");
    return true;
  });
  ipc.handle(IPC.MUSIC_OPEN_SETTINGS, (_event, section?: string) => {
    deps.windowManager?.createSettingsWindow(section);
    return true;
  });

  // Token 用量查询 IPC（临时挂靠，后续归到统计模块）
  ipc.handle(IPC.TOKEN_USAGE_GET, (_event, days: number) => {
    return getUsageReport(Math.max(1, Math.min(90, Number(days) || 7)));
  });
  ipc.handle(IPC.TOKEN_USAGE_CLEAR, () => {
    clearUsage();
  });
  // 用量历史：会话排行里的 id 在这里换成会话标题；已删除或临时的会话没有标题，界面按"已删除"展示。
  ipc.handle(IPC.TOKEN_USAGE_HISTORY, (_event, days: number) => {
    const history = getUsageHistory(Math.max(1, Math.min(90, Number(days) || 7)));
    let titles = new Map<string, string>();
    try { titles = new Map(listSessions().map(session => [session.id, session.title])); } catch { /* the ranking still works by id */ }
    return { ...history, sessions: history.sessions.map(session => ({ ...session, title: titles.get(session.id) ?? null })) };
  });
  // 会话统计：输入框下方"会话统计"卡片用；没有记录时为 null。
  ipc.handle(IPC.TOKEN_USAGE_SESSION_STATS, (_event, sessionId: unknown) => (typeof sessionId === "string" ? getSessionStats(sessionId) : null));

}
