// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidingTabs, type SlidingTabItem } from "./SlidingTabs";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const items = (extra: Partial<SlidingTabItem> = {}): SlidingTabItem[] => [
  { id: "a", label: "Alpha", ...extra },
  { id: "b", label: "Beta", ...extra },
  { id: "c", label: "Gamma", ...extra },
];
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const key = (element: Element, value: string) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });

function Harness({ onClose, list = items({ closable: true }) }: { onClose?: (id: string) => void; list?: SlidingTabItem[] }) {
  const [active, setActive] = useState<string | null>("a");
  return createElement(SlidingTabs, { tabs: list, activeId: active, onChange: setActive, onClose, ariaLabel: "demo" });
}

describe("SlidingTabs", () => {
  it("exposes a tablist with exactly one selected tab and a roving tab stop", async () => {
    await act(async () => root.render(createElement(Harness)));
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("demo");
    expect(tabs().map(tab => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs().map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("selects on click and moves the selection marker", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => tabs()[2].click());
    expect(tabs().map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(host.querySelectorAll('.ff-sliding-tabs__item[data-active="true"]')).toHaveLength(1);
  });

  it("moves with the arrow keys, wraps around, and honours Home/End", async () => {
    await act(async () => root.render(createElement(Harness)));
    key(tabs()[0], "ArrowRight"); expect(tabs()[1].getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(tabs()[1]);
    key(tabs()[1], "End"); expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    key(tabs()[2], "ArrowRight"); expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    key(tabs()[0], "ArrowLeft"); expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    key(tabs()[2], "Home"); expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("skips disabled tabs when moving", async () => {
    const list = items(); list[1] = { ...list[1], disabled: true };
    await act(async () => root.render(createElement(Harness, { list })));
    key(tabs()[0], "ArrowRight"); expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
  });

  it("closes through the close button, Delete and middle click, but only for closable tabs", async () => {
    const close = vi.fn();
    const list = items(); list[0] = { ...list[0], closable: true, closeLabel: "close alpha" }; list[1] = { ...list[1], closable: false }; list[2] = { ...list[2], closable: true };
    await act(async () => root.render(createElement(Harness, { onClose: close, list })));
    expect(host.querySelectorAll(".ff-sliding-tabs__close")).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="close alpha"]')!.click());
    expect(close).toHaveBeenLastCalledWith("a");
    key(tabs()[1], "Delete"); expect(close).toHaveBeenCalledTimes(1);
    key(tabs()[2], "Delete"); expect(close).toHaveBeenLastCalledWith("c");
    await act(async () => { host.querySelectorAll(".ff-sliding-tabs__item")[2].dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true })); });
    expect(close).toHaveBeenCalledTimes(3);
    await act(async () => { host.querySelectorAll(".ff-sliding-tabs__item")[1].dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true })); });
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("never renders close controls without a close handler", async () => {
    await act(async () => root.render(createElement(Harness, { onClose() {}, list: items({ closable: true }) })));
    expect(host.querySelectorAll(".ff-sliding-tabs__close")).toHaveLength(3);
    await act(async () => root.render(createElement(SlidingTabs, { tabs: items({ closable: true }), activeId: "a", onChange() {} })));
    expect(host.querySelectorAll(".ff-sliding-tabs__close")).toHaveLength(0);
  });

  it("places the thumb under the measured active tab and follows the selection", async () => {
    const geometry: Record<string, [number, number]> = { Alpha: [2, 60], Beta: [62, 80], Gamma: [142, 70] };
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return geometry[this.textContent ?? ""]?.[0] ?? 0; });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return geometry[this.textContent ?? ""]?.[1] ?? 0; });
    await act(async () => root.render(createElement(Harness, { list: items() })));
    const thumb = () => host.querySelector<HTMLElement>(".ff-sliding-tabs__thumb")!;
    expect(thumb().style.transform).toBe("translateX(2px)"); expect(thumb().style.width).toBe("60px");
    await act(async () => tabs()[1].click());
    expect(thumb().style.transform).toBe("translateX(62px)"); expect(thumb().style.width).toBe("80px");
    vi.restoreAllMocks();
  });

  it("keeps an enabled tab in the tab order when the selected tab is disabled", async () => {
    const list = items(); list[0] = { ...list[0], disabled: true };
    await act(async () => root.render(createElement(SlidingTabs, { tabs: list, activeId: "a", onChange() {} })));
    expect(tabs().map(tab => tab.tabIndex)).toEqual([-1, 0, -1]);
    // With nothing enabled there is no tab stop to give.
    const all = items().map(tab => ({ ...tab, disabled: true }));
    await act(async () => root.render(createElement(SlidingTabs, { tabs: all, activeId: "a", onChange() {} })));
    expect(tabs().every(tab => tab.tabIndex === -1)).toBe(true);
  });

  it("shows no thumb when nothing is selected, and marks a closing tab for its collapse", async () => {
    const list = items(); list[1] = { ...list[1], closing: true, className: "extra" };
    await act(async () => root.render(createElement(SlidingTabs, { tabs: list, activeId: null, onChange() {} })));
    expect(host.querySelector(".ff-sliding-tabs__thumb")).toBeNull();
    expect(tabs()[0].tabIndex).toBe(0);
    const closing = host.querySelectorAll(".ff-sliding-tabs__item")[1];
    expect(closing.classList.contains("is-closing")).toBe(true); expect(closing.classList.contains("extra")).toBe(true);
  });

  it("forwards data attributes to the tab and close buttons", async () => {
    const list = items({ closable: true }); list[0] = { ...list[0], tabData: { "data-pick": "a" }, closeData: { "data-shut": "a" } };
    await act(async () => root.render(createElement(Harness, { onClose() {}, list })));
    expect(host.querySelector('[role="tab"][data-pick="a"]')).not.toBeNull();
    expect(host.querySelector('.ff-sliding-tabs__close[data-shut="a"]')).not.toBeNull();
  });
});
