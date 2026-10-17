// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionOverviewPanel } from "./SessionOverviewPanel";

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(SessionOverviewPanel, { outputs: [] })));
  // jsdom has no layout: give each card a 100px row, stacked in DOM order.
  for (const card of host.querySelectorAll<HTMLElement>("[data-overview-card]")) {
    card.getBoundingClientRect = () => {
      const index = [...host.querySelectorAll("[data-overview-card]")].indexOf(card);
      return { top: index * 100, height: 100, bottom: index * 100 + 100, left: 0, right: 200, width: 200, x: 0, y: index * 100, toJSON() {} } as DOMRect;
    };
  }
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const order = () => [...host.querySelectorAll<HTMLElement>("[data-overview-card]")].map(card => card.dataset.overviewCard);
const grip = (id: string) => host.querySelector<HTMLButtonElement>(`[data-overview-card="${id}"] [data-overview-grip]`)!;
const pointer = (target: Element, type: string, clientY: number) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientY })); });

it("starts with tasks, context, changes and gives every card a six-dot grip", () => {
  expect(order()).toEqual(["tasks", "context", "changes"]);
  expect(host.querySelectorAll("[data-overview-grip]")).toHaveLength(3);
});

it("ignores a press that moves less than the 4px dead zone", () => {
  pointer(grip("tasks"), "pointerdown", 50);
  pointer(grip("tasks"), "pointermove", 53);
  expect(host.querySelector("[data-dragging]")).toBeNull();
  pointer(grip("tasks"), "pointerup", 53);
  expect(order()).toEqual(["tasks", "context", "changes"]);
});

it("drags a card below another, shows where it lands, and remembers the order", () => {
  pointer(grip("tasks"), "pointerdown", 50);
  pointer(grip("tasks"), "pointermove", 260);
  expect(host.querySelector('[data-overview-card="tasks"]')?.hasAttribute("data-dragging")).toBe(true);
  expect(host.querySelector(".ff-overview-drop-end")).not.toBeNull();
  pointer(grip("tasks"), "pointerup", 260);
  expect(order()).toEqual(["context", "changes", "tasks"]);
  expect(JSON.parse(localStorage.getItem("ff.sessionOverview.order")!)).toEqual(["context", "changes", "tasks"]);
  expect(host.querySelector("[data-dragging]")).toBeNull();
});

it("moves a card with the arrow keys on its grip", () => {
  act(() => { grip("changes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
  expect(order()).toEqual(["tasks", "changes", "context"]);
  act(() => { grip("tasks").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(order()).toEqual(["changes", "tasks", "context"]);
});

it("folds a card with the grid animation and keeps its body out of reach while closed", () => {
  const card = host.querySelector<HTMLElement>('[data-overview-card="context"]')!;
  const head = card.querySelector<HTMLButtonElement>(".ff-overview-card__head")!;
  expect(card.dataset.open).toBe("true");
  act(() => head.click());
  expect(card.dataset.open).toBe("false");
  const fold = card.querySelector<HTMLElement>(".ff-overview-card__fold")!;
  expect(fold.getAttribute("aria-hidden")).toBe("true");
  expect(fold.hasAttribute("inert")).toBe(true);
});
