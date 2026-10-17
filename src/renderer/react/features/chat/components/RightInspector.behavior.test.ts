// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RightInspector, type InspectorTab } from "./RightInspector";
import { moveId, reconcileOrder, tileColumns } from "./reorder-list";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const tabs: InspectorTab[] = [
  { id: "files", label: "Files", closable: false, content: React.createElement("p", null, "Tree") },
  { id: "file:a/notes.md", label: "notes.md", title: "a/notes.md", content: React.createElement("textarea", { defaultValue: "saved draft" }) },
  { id: "diff:notes.md", label: "notes.md", title: "Diff · b/notes.md", content: React.createElement("p", null, "Diff") },
];
const header = (id: string) => host.querySelector<HTMLElement>(`[data-inspector-pane="${id}"] .ff-inspector-pane__head`)!;
const keys = (element: Element, key: string) => act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

it("tiles panels two per column, filling a column before starting the next, and keeps the overview column on the right", async () => {
  const overview: InspectorTab = { id: "overview", kind: "overview", label: "Overview", content: React.createElement("p", null, "Cards") };
  await act(async () => root.render(React.createElement(RightInspector, { tabs: [overview, ...tabs], activeTabId: "files", onTabChange() {}, onCloseTab() {} })));
  const columns = [...host.querySelectorAll(".ff-inspector-grid__column")].map(column =>
    [...column.querySelectorAll("[data-inspector-pane]")].map(pane => (pane as HTMLElement).dataset.inspectorPane));
  expect(columns).toEqual([["files", "file:a/notes.md"], ["diff:notes.md"]]);
  const aside = host.querySelector(".ff-right-inspector")!;
  expect(aside.lastElementChild?.classList.contains("ff-inspector-overview")).toBe(true);
  // The overview is a column of its own, never a tiled panel with a header.
  expect(host.querySelector('.ff-inspector-grid [data-inspector-pane="overview"]')).toBeNull();
  expect(tileColumns([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
});

it("shows full context for identical filenames and keeps every panel mounted when one is enlarged", async () => {
  function TestInspector() {
    const [active, setActive] = useState("file:a/notes.md");
    return React.createElement(RightInspector, { tabs, activeTabId: active, onTabChange: setActive, onCloseTab() {} });
  }
  await act(async () => root.render(React.createElement(TestInspector)));
  const textarea = host.querySelector("textarea")!;
  expect(host.querySelector('[title="a/notes.md"]')).not.toBeNull();
  expect(host.querySelector('[title="Diff · b/notes.md"]')).not.toBeNull();
  const enlarge = host.querySelector<HTMLButtonElement>('[data-inspector-pane="diff:notes.md"] [aria-pressed]')!;
  await act(async () => enlarge.click());
  expect(enlarge.getAttribute("aria-pressed")).toBe("true");
  expect((host.querySelector('[data-inspector-pane="file:a/notes.md"]') as HTMLElement).hidden).toBe(true);
  expect(host.querySelector("textarea")).toBe(textarea);
  await act(async () => enlarge.click());
  expect((host.querySelector('[data-inspector-pane="file:a/notes.md"]') as HTMLElement).hidden).toBe(false);
});

it("focusing a panel makes it the active one", async () => {
  const change = vi.fn();
  await act(async () => root.render(React.createElement(RightInspector, { tabs, activeTabId: "files", onTabChange: change, onCloseTab() {} })));
  expect(host.querySelector('[data-inspector-pane="files"]')?.hasAttribute("data-active")).toBe(true);
  act(() => header("diff:notes.md").focus());
  expect(change).toHaveBeenCalledWith("diff:notes.md");
});

it("Delete on a header closes only that closable panel and never consumes editor deletion", async () => {
  const close = vi.fn();
  await act(async () => root.render(React.createElement(RightInspector, { tabs, activeTabId: "file:a/notes.md", onTabChange() {}, onCloseTab: close })));
  keys(header("files"), "Delete"); expect(close).not.toHaveBeenCalled();
  keys(host.querySelector("textarea")!, "Delete"); expect(close).not.toHaveBeenCalled();
  keys(header("file:a/notes.md"), "Delete"); expect(close).toHaveBeenCalledExactlyOnceWith("file:a/notes.md");
});

it("ignores Delete on nested browser tab headers", async () => {
  const close = vi.fn(), nested = [{ id: "browser", label: "Browser", content: React.createElement("button", { role: "tab", "data-inner-browser-tab": true }, "Tab 1") }, ...tabs];
  await act(async () => root.render(React.createElement(RightInspector, { tabs: nested, activeTabId: "browser", onTabChange() {}, onCloseTab: close })));
  keys(host.querySelector("[data-inner-browser-tab]")!, "Delete");
  expect(close).not.toHaveBeenCalled();
  keys(header("file:a/notes.md"), "Delete");
  expect(close).toHaveBeenCalledExactlyOnceWith("file:a/notes.md");
});

it("closes from the panel's close button and offers no close on a pinned panel", async () => {
  const close = vi.fn();
  await act(async () => root.render(React.createElement(RightInspector, { tabs, activeTabId: "files", onTabChange() {}, onCloseTab: close })));
  expect(host.querySelector('[data-inspector-pane="files"] .ff-right-inspector__close')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-inspector-pane="diff:notes.md"] .ff-right-inspector__close')!.click());
  expect(close).toHaveBeenCalledExactlyOnceWith("diff:notes.md");
});

it("reorders ids and keeps the saved order for ids still present", () => {
  expect(reconcileOrder(["c", "a", "x"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  expect(moveId(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  expect(moveId(["a", "b", "c"], "c", -3)).toEqual(["c", "a", "b"]);
});
