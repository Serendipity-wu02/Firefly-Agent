// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SidebarLayoutApi, SidebarSnapshot } from "../../../../../shared/sidebar-layout";
import { SidebarLayoutControls } from "./SidebarLayoutControls";
import { useSidebarLayout } from "../pages/use-sidebar-layout";
vi.mock("../../../i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, snapshot: SidebarSnapshot, api: SidebarLayoutApi;
const sessions = [] as const;
const groups = [{ groupId: "work:section:s", sectionId: "s", label: "Section", sessions: [] }, { groupId: "work:default", label: "Recent", sessions: [] }];
function Harness() {
  const layout = useSidebarLayout(api, sessions);
  return layout.snapshot && createElement(SidebarLayoutControls, { mode: "work", snapshot: layout.snapshot, groups, projectIds: [], title: "Section title", pending: layout.pending, mutate: layout.mutate });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const state = { viewMode: "merged" as const, sortMode: "recent" as const, hiddenProjectIds: [], sections: [{ id: "s", name: "Section" }], collapsedGroupIds: [], membership: {}, manualOrders: {}, groupOrder: ["work:project:pb", "work:section:s", "work:project:pa", "work:default"] };
  snapshot = { layout: { schemaVersion: 1, revision: 3, projects: [], modes: { work: state, chat: state, code: state } }, sessionProjectIds: {}, notices: [] };
  api = { get: vi.fn(async () => ({ ok: true, snapshot })), mutate: vi.fn(async () => ({ ok: false, code: "storage_error" })), onChanged: () => () => {} };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("reorders visible groups without dropping the invisible project order", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="sidebar.moveDown"]')!.click());
  expect(api.mutate).toHaveBeenCalledWith({ expectedRevision: 3, patch: { mode: "work", kind: "set-group-order", groupIds: ["work:project:pb", "work:default", "work:project:pa", "work:section:s"] } });
});
it.each(["conflict", "storage_error"])("preserves a section name draft after %s", async code => {
  vi.mocked(api.mutate).mockResolvedValue({ ok: false, code: code as "conflict" | "storage_error" });
  await act(async () => root.render(createElement(Harness)));
  const form = host.querySelector<HTMLFormElement>("form")!, input = form.querySelector<HTMLInputElement>("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Keep this draft"); input.dispatchEvent(new Event("input",{bubbles:true})); });
  await act(async () => form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(api.mutate).toHaveBeenCalled(); expect(input.value).toBe("Keep this draft");
});
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const menuOpen = () => document.querySelector(".ff-sidebar-menu:not(.ant-dropdown-hidden)") !== null;
async function openMenu() {
  if (menuOpen()) return;
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="sidebar.manageLayout"]')!.click());
  await flush();
}
const menuTitles = () => Array.from(document.querySelectorAll(".ff-sidebar-menu .ant-dropdown-menu-item, .ff-sidebar-menu .ant-dropdown-menu-submenu-title"), node => node.textContent ?? "");
const findItem = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent?.includes(text));
async function clickMenu(text: string) {
  await vi.waitFor(() => { if (!findItem(text)) throw new Error(`menu item not found: ${text}; have ${menuTitles().join(" | ")}`); });
  await act(async () => findItem(text)!.click());
  await flush();
}
it("opens an arrangement menu from the heading button and keeps section management folded away", async () => {
  await act(async () => root.render(createElement(Harness)));
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="sidebar.manageLayout"]')!;
  const panel = host.querySelector<HTMLElement>(".ff-sidebar-layout__panel")!;
  expect(toggle.getAttribute("aria-haspopup")).toBe("menu");
  expect(panel.hidden).toBe(true);
  await openMenu();
  expect(menuTitles().join("|")).toMatch(/sidebar\.groupBy.*sidebar\.sortBy.*sidebar\.show.*sidebar\.newSection.*sidebar\.manageSections.*sidebar\.resetDefaults/);
  await clickMenu("sidebar.newSection");
  expect(panel.hidden).toBe(false);
  expect(host.querySelector(".ff-conversation-sidebar__title")?.textContent).toBe("Section title");
});
it("sorts and groups through submenus, patching only what changed", async () => {
  await act(async () => root.render(createElement(Harness)));
  await openMenu();
  await clickMenu("sidebar.sortBy");
  await clickMenu("sidebar.manualSort");
  expect(api.mutate).toHaveBeenCalledWith({ expectedRevision: 3, patch: { mode: "work", kind: "set-sort", sortMode: "manual" } });
  vi.mocked(api.mutate).mockClear();
  await openMenu();
  await clickMenu("sidebar.groupBy");
  await clickMenu("sidebar.viewMergedShort");
  expect(api.mutate).not.toHaveBeenCalled(); // already merged in this fixture
  await openMenu();
  await clickMenu("sidebar.groupBy");
  await clickMenu("sidebar.viewProjectsShort");
  expect(api.mutate).toHaveBeenCalledWith({ expectedRevision: 3, patch: { mode: "work", kind: "set-view", viewMode: "project" } });
});
it("greys out reset while everything is at its default", async () => {
  snapshot.layout.modes.work = { ...snapshot.layout.modes.work, viewMode: "project" };
  await act(async () => root.render(createElement(Harness)));
  await openMenu();
  expect(findItem("sidebar.resetDefaults")!.getAttribute("aria-disabled")).toBe("true");
  expect(findItem("sidebar.viewAll")!.getAttribute("aria-disabled")).toBe("true");
});
it("resets a changed view and sort one patch at a time, stopping when one is rejected", async () => {
  snapshot.layout.modes.work = { ...snapshot.layout.modes.work, viewMode: "merged", sortMode: "manual" };
  vi.mocked(api.mutate).mockResolvedValue({ ok: false, code: "conflict" });
  await act(async () => root.render(createElement(Harness)));
  await openMenu();
  expect(findItem("sidebar.resetDefaults")!.getAttribute("aria-disabled")).not.toBe("true");
  await clickMenu("sidebar.resetDefaults");
  expect(api.mutate).toHaveBeenCalledTimes(1);
  expect(api.mutate).toHaveBeenCalledWith({ expectedRevision: 3, patch: { mode: "work", kind: "set-view", viewMode: "project" } });
});
it("leaves out project-only entries in Chat mode", async () => {
  function ChatHarness() {
    const layout = useSidebarLayout(api, sessions);
    return layout.snapshot && createElement(SidebarLayoutControls, { mode: "chat", snapshot: layout.snapshot, groups: [], projectIds: [], title: "T", pending: layout.pending, mutate: layout.mutate });
  }
  await act(async () => root.render(createElement(ChatHarness)));
  await openMenu();
  expect(menuTitles().join("|")).not.toContain("sidebar.groupBy");
  expect(menuTitles().join("|")).not.toContain("sidebar.show");
  expect(menuTitles().join("|")).toContain("sidebar.sortBy");
});
