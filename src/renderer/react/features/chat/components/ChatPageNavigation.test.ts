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
    expect(html).toContain("cy-page-titlebar");
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
  it("opens the scheduled-task page of the settings window from the more menu", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenScheduledTasks = vi.fn();
    const onOpenSettings = vi.fn();
    const root = createRoot(container);
    const element = createElement(ChatPageNavigation, {
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
      onOpenSettings,
      onOpenScheduledTasks,
    });
    try {
      await act(async () => { root.render(element); });
      const more = container.querySelector<HTMLButtonElement>('button[aria-label="更多"]');
      expect(more).not.toBeNull();
      await act(async () => { more!.click(); });
      const item = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === "定时任务");
      expect(item).toBeDefined();
      await act(async () => { item!.click(); });
      expect(onOpenScheduledTasks).toHaveBeenCalledTimes(1);
      expect(onOpenSettings).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
