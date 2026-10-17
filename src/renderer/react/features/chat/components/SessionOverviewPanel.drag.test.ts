// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionOverviewPanel, type SessionOverviewPanelProps } from "./SessionOverviewPanel";
import type { WorkspaceRunOutput } from "../workspace/workspace-artifacts";

const DEFAULT = ["environment", "connectors", "tasks", "context", "changes", "outputs"];
let host: HTMLDivElement; let root: Root;
function render(props: Partial<SessionOverviewPanelProps> = {}) {
  act(() => root.render(createElement(SessionOverviewPanel, { outputs: [], ...props })));
  // jsdom has no layout: give each card a 100px row, stacked in DOM order.
  for (const card of host.querySelectorAll<HTMLElement>("[data-overview-card]")) {
    card.getBoundingClientRect = () => {
      const index = [...host.querySelectorAll("[data-overview-card]")].indexOf(card);
      return { top: index * 100, height: 100, bottom: index * 100 + 100, left: 0, right: 200, width: 200, x: 0, y: index * 100, toJSON() {} } as DOMRect;
    };
  }
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const order = () => [...host.querySelectorAll<HTMLElement>("[data-overview-card]")].map(card => card.dataset.overviewCard);
const card = (id: string) => host.querySelector<HTMLElement>(`[data-overview-card="${id}"]`)!;
const grip = (id: string) => card(id).querySelector<HTMLButtonElement>("[data-overview-grip]")!;
const head = (id: string) => card(id).querySelector<HTMLButtonElement>(".ff-overview-card__head")!;
const pointer = (target: Element, type: string, clientY: number) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientY })); });
const output = (id: string, files: number, description = ""): WorkspaceRunOutput => ({
  id, sessionId: "s", runId: id, messageId: id, tools: [],
  files: Array.from({ length: files }, (_, index) => ({ toolId: `t${index}`, change: { file: `f${index}.ts`, kind: "modified", insertions: 1, deletions: 0 } })) as WorkspaceRunOutput["files"],
  tasks: description ? [{ invocationId: id, taskId: id, description, nickname: "n", status: "completed" }] as unknown as WorkspaceRunOutput["tasks"] : [],
});

it("lists environment, connectors, tasks, context, changes and outputs, each with a six-dot grip", () => {
  render();
  expect(order()).toEqual(DEFAULT);
  expect(host.querySelectorAll("[data-overview-grip]")).toHaveLength(6);
});

it("makes environment and connectors one-row entries that open the project and the connector settings", () => {
  const openEnvironment = vi.fn(), openConnectors = vi.fn();
  render({ environment: { mode: "code", workspaceName: "Firefly_Agent" }, onOpenEnvironment: openEnvironment, onOpenConnectors: openConnectors });
  expect(card("environment").hasAttribute("data-entry")).toBe(true);
  expect(card("environment").querySelector(".ff-overview-card__fold")).toBeNull();
  expect(head("environment").hasAttribute("aria-expanded")).toBe(false);
  expect(card("environment").querySelector(".ff-overview-card__summary")?.textContent).toBe("Firefly_Agent");
  act(() => head("environment").click());
  act(() => head("connectors").click());
  expect(openEnvironment).toHaveBeenCalledTimes(1);
  expect(openConnectors).toHaveBeenCalledTimes(1);
});

it("says where a chat without a project runs, and disables an entry with nothing to open", () => {
  render({ environment: { mode: "chat" } });
  expect(card("environment").querySelector(".ff-overview-card__summary")?.textContent).toBe("本机 · 聊天");
  expect(head("environment").disabled).toBe(true);
  render({ environment: { mode: "chat", temporary: true } });
  expect(card("environment").querySelector(".ff-overview-card__summary")?.textContent).toBe("临时对话");
});

it("lists outputs newest first with their counts and opens the chosen one", () => {
  const open = vi.fn();
  const first = output("r1", 2), second = output("r2", 0, "Summarise the logs");
  render({ outputs: [first, second], onOpenOutput: open });
  expect(card("outputs").querySelector(".ff-overview-card__summary")?.textContent).toBe("2");
  const rows = [...card("outputs").querySelectorAll<HTMLButtonElement>(".ff-overview-list__row")];
  expect(rows.map(row => row.querySelector(".ff-overview-list__name")?.textContent)).toEqual(["Summarise the logs", "第 1 次运行结果"]);
  act(() => rows[1]!.click());
  expect(open).toHaveBeenCalledExactlyOnceWith(first);
});

it("puts the new entry cards on top of an order saved before they existed", () => {
  localStorage.setItem("ff.sessionOverview.order", JSON.stringify(["changes", "tasks", "context"]));
  render();
  expect(order()).toEqual(["environment", "connectors", "changes", "tasks", "context", "outputs"]);
});

it("ignores a press that moves less than the 4px dead zone", () => {
  render();
  pointer(grip("tasks"), "pointerdown", 250);
  pointer(grip("tasks"), "pointermove", 253);
  expect(host.querySelector("[data-dragging]")).toBeNull();
  pointer(grip("tasks"), "pointerup", 253);
  expect(order()).toEqual(DEFAULT);
});

it("drags a card to the end, shows where it lands, and remembers the order", () => {
  render();
  pointer(grip("tasks"), "pointerdown", 250);
  pointer(grip("tasks"), "pointermove", 590);
  expect(card("tasks").hasAttribute("data-dragging")).toBe(true);
  expect(host.querySelector(".ff-overview-drop-end")).not.toBeNull();
  pointer(grip("tasks"), "pointerup", 590);
  const moved = ["environment", "connectors", "context", "changes", "outputs", "tasks"];
  expect(order()).toEqual(moved);
  expect(JSON.parse(localStorage.getItem("ff.sessionOverview.order")!)).toEqual(moved);
  expect(host.querySelector("[data-dragging]")).toBeNull();
});

it("moves a card with the arrow keys on its grip", () => {
  render();
  act(() => { grip("changes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
  expect(order()).toEqual(["environment", "connectors", "tasks", "changes", "context", "outputs"]);
  act(() => { grip("tasks").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(order()).toEqual(["environment", "connectors", "changes", "tasks", "context", "outputs"]);
});

it("folds a card with the grid animation and keeps its body out of reach while closed", () => {
  render();
  expect(card("context").dataset.open).toBe("true");
  act(() => head("context").click());
  expect(card("context").dataset.open).toBe("false");
  const fold = card("context").querySelector<HTMLElement>(".ff-overview-card__fold")!;
  expect(fold.getAttribute("aria-hidden")).toBe("true");
  expect(fold.hasAttribute("inert")).toBe(true);
});

it("lifts the dragged card so it follows the pointer, and Escape puts it back", () => {
  render();
  pointer(grip("tasks"), "pointerdown", 250);
  pointer(grip("tasks"), "pointermove", 330);
  expect(card("tasks").style.getPropertyValue("--ff-drag-y")).toBe("80px");
  act(() => { grip("tasks").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(host.querySelector("[data-dragging]")).toBeNull();
  pointer(grip("tasks"), "pointerup", 330);
  expect(order()).toEqual(DEFAULT);
});
