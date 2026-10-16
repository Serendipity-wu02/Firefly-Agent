// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../components/ui/SidebarToggle", () => ({
  SidebarToggle: ({ collapsed }: { collapsed: boolean }) => createElement("span", null, `sidebar-toggle:${collapsed}`),
}));
vi.mock("../../../components/ui/ModeMenu", () => ({
  ModeMenu: ({ variant = "sidebar" }: { variant?: string }) => createElement("span", null, `mode-menu:${variant}`),
}));
vi.mock("../../../components/ui/ToolModeButton", () => ({
  ToolModeButton: ({ active }: { active: boolean }) => createElement("span", null, `tool-button:${active}`),
}));
vi.mock("../../../components/ui/SkillModeButton", () => ({
  SkillModeButton: () => createElement("span", null, "skill-button"),
}));
vi.mock("../../../components/ui/ModelModeButton", () => ({
  ModelModeButton: () => createElement("span", null, "model-button"),
}));
vi.mock("../../../components/ui/PluginModeButton", () => ({
  PluginModeButton: ({ active }: { active: boolean }) => createElement("span", null, `plugin-button:${active}`),
}));
vi.mock("../../../components/ui/WindowControls", () => ({
  WindowControls: () => createElement("span", null, "window-controls"),
}));
vi.mock("../../../components/ui/NewTaskButton", () => ({
  NewTaskButton: () => createElement("span", null, "new-task-button"),
}));
vi.mock("./AppUpdateEntry", () => ({ AppUpdateEntry: () => createElement("span", null, "app-update-entry") }));
vi.mock("./ConversationSidebar", () => ({
  ConversationSidebar: ({ listStatus }: { listStatus: string }) => createElement("span", null, `conversation-sidebar:${listStatus}`),
}));

import { ChatPageNavigation } from "./ChatPageNavigation";

describe("ChatPageNavigation", () => {
  it("keeps context modes while a tool panel is open", () => {
    const html = renderToStaticMarkup(createElement(ChatPageNavigation, {
      collapsed: false,
      activePanel: "tool",
      mode: "chat",
      sessions: [],
      sessionListStatus: "loading",
      activeSessionId: undefined,
      onToggleCollapsed: () => undefined,
      onModeChange: () => undefined,
      onNewTask: () => undefined,
      onTogglePanel: () => undefined,
      onSelectSession: () => undefined,
      onOpenProject: () => undefined,
      onRenameSession: () => undefined,
      onDeleteSession: () => undefined,
      onTogglePinSession: () => undefined,
      onMinimize: () => undefined,
      onMaximize: () => undefined,
      onCloseWindow: () => undefined,
      onOpenSettings: () => undefined,
    }));

    expect(html).toContain("mode-menu:sidebar");
    expect(html).not.toContain("mode-menu:compact");
    expect(html).toContain("更多");
    expect(html).toContain("conversation-sidebar:loading");
  });

  it("places the plugin entry in the sidebar and marks it active", () => {
    const html = renderToStaticMarkup(createElement(ChatPageNavigation, {
      collapsed: false,
      activePanel: "plugin",
      mode: "chat",
      sessions: [],
      sessionListStatus: "error",
      activeSessionId: undefined,
      onToggleCollapsed: () => undefined,
      onModeChange: () => undefined,
      onNewTask: () => undefined,
      onTogglePanel: () => undefined,
      onSelectSession: () => undefined,
      onOpenProject: () => undefined,
      onRenameSession: () => undefined,
      onDeleteSession: () => undefined,
      onTogglePinSession: () => undefined,
      onMinimize: () => undefined,
      onMaximize: () => undefined,
      onCloseWindow: () => undefined,
      onOpenSettings: () => undefined,
    }));

    expect(html).toContain("plugin-button:true");
    expect(html).toContain("ff-page-titlebar");
    expect(html).toContain("mode-menu:sidebar");
    expect(html).toContain("conversation-sidebar:error");
  });

  it("moves the mode menu next to the avatar while the sidebar is collapsed", () => {
    const html = renderToStaticMarkup(createElement(ChatPageNavigation, {
      collapsed: true,
      activePanel: null,
      mode: "work",
      sessions: [],
      sessionListStatus: "ready",
      activeSessionId: undefined,
      onToggleCollapsed: () => undefined,
      onModeChange: () => undefined,
      onNewTask: () => undefined,
      onTogglePanel: () => undefined,
      onSelectSession: () => undefined,
      onOpenProject: () => undefined,
      onRenameSession: () => undefined,
      onDeleteSession: () => undefined,
      onTogglePinSession: () => undefined,
      onMinimize: () => undefined,
      onMaximize: () => undefined,
      onCloseWindow: () => undefined,
      onOpenSettings: () => undefined,
    }));

    expect(html).toContain("mode-menu:compact");
    expect(html).not.toContain("mode-menu:sidebar");
  });
});

describe("ChatPageNavigation more menu", () => {
  const menuProps = (overrides: Record<string, unknown>) => ({
    collapsed: false,
    activePanel: null,
    mode: "chat",
    sessions: [],
    sessionListStatus: "ready",
    activeSessionId: undefined,
    onToggleCollapsed: () => undefined,
    onModeChange: () => undefined,
    onNewTask: () => undefined,
    onTogglePanel: () => undefined,
    onSelectSession: () => undefined,
    onOpenProject: () => undefined,
    onRenameSession: () => undefined,
    onDeleteSession: () => undefined,
    onTogglePinSession: () => undefined,
    onExportSession: () => undefined,
    onMinimize: () => undefined,
    onMaximize: () => undefined,
    onCloseWindow: () => undefined,
    onOpenSettings: () => undefined,
    ...overrides,
  });

  async function renderNavigation(props: Record<string, unknown>) {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(ChatPageNavigation, menuProps(props) as never)); });
    return {
      container,
      cleanup: async () => {
        await act(async () => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
      },
    };
  }

  const moreButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[aria-label="更多"]');
  const scheduledItem = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.getAttribute("aria-label") === "定时任务");

  it("toggles the in-app scheduled-task panel from the more menu and never opens the settings window", async () => {
    const onTogglePanel = vi.fn();
    const onOpenSettings = vi.fn();
    const { container, cleanup } = await renderNavigation({ onTogglePanel, onOpenSettings });
    try {
      expect(moreButton(container)).not.toBeNull();
      await act(async () => { moreButton(container)!.click(); });
      expect(scheduledItem()).toBeDefined();
      await act(async () => { scheduledItem()!.click(); });
      expect(onTogglePanel).toHaveBeenCalledTimes(1);
      expect(onTogglePanel).toHaveBeenCalledWith("scheduled");
      expect(onOpenSettings).not.toHaveBeenCalled();
    } finally { await cleanup(); }
  });

  it("marks the more button and the scheduled-task item active while that panel is open", async () => {
    const { container, cleanup } = await renderNavigation({ activePanel: "scheduled" });
    try {
      expect(moreButton(container)?.classList.contains("is-active")).toBe(true);
      await act(async () => { moreButton(container)!.click(); });
      expect(scheduledItem()?.getAttribute("aria-pressed")).toBe("true");
      expect(scheduledItem()?.classList.contains("is-active")).toBe(true);
    } finally { await cleanup(); }
  });
});

describe("ChatPageNavigation temporary chat entry", () => {
  const props = (mode: "chat" | "work", onNewTemporaryChat?: () => void) => ({
    collapsed: false, activePanel: null, mode, sessions: [], sessionListStatus: "ready" as const, activeSessionId: undefined,
    onToggleCollapsed: () => undefined, onModeChange: () => undefined, onNewTask: () => undefined, onTogglePanel: () => undefined,
    onSelectSession: () => undefined, onOpenProject: () => undefined, onRenameSession: () => undefined, onDeleteSession: () => undefined,
    onTogglePinSession: () => undefined, onExportSession: () => undefined, onMinimize: () => undefined, onMaximize: () => undefined,
    onCloseWindow: () => undefined, onOpenSettings: () => undefined, onNewTemporaryChat,
  });
  async function render(mode: "chat" | "work", handler?: () => void) {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(ChatPageNavigation, props(mode, handler))); });
    return { container, cleanup: async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); } };
  }
  const entry = (container: HTMLElement) => container.querySelector<HTMLButtonElement>("button.ff-side-action--temporary");

  it("offers the entry in chat mode and calls the handler", async () => {
    const handler = vi.fn();
    const { container, cleanup } = await render("chat", handler);
    try {
      expect(entry(container)?.textContent).toBe("临时聊天");
      await act(async () => { entry(container)!.click(); });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally { await cleanup(); }
  });

  it("is absent outside chat mode and when no handler is provided", async () => {
    for (const [mode, handler] of [["work", vi.fn()], ["chat", undefined]] as const) {
      const { container, cleanup } = await render(mode, handler);
      try { expect(entry(container)).toBeNull(); } finally { await cleanup(); }
    }
  });
});
