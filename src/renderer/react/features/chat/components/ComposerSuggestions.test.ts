// @vitest-environment jsdom
import { act, createElement, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySuggestion, detectTrigger, filterItems, useComposerSuggestions, type ComposerSuggestionsState } from "./ComposerSuggestions";

describe("trigger detection", () => {
  it("finds a slash or at token that ends at the caret", () => {
    expect(detectTrigger("/rev")).toEqual({ mode: "slash", query: "rev", start: 0 });
    expect(detectTrigger("看看 @src/ma")).toEqual({ mode: "mention", query: "src/ma", start: 3 });
    expect(detectTrigger("a/b")).toBeNull();
    expect(detectTrigger("mail@example")).toBeNull();
    expect(detectTrigger("/done ")).toBeNull();
  });
  it("replaces the token and adds one space unless the item opens a folder", () => {
    const trigger = detectTrigger("看 @sr")!;
    expect(applySuggestion("看 @sr 后面", 5, trigger, { id: "f", label: "src", insert: "@src/", keepOpen: true }))
      .toEqual({ text: "看 @src/ 后面", caret: 7 });
    expect(applySuggestion("/re", 3, detectTrigger("/re")!, { id: "s", label: "review", insert: "/review" }))
      .toEqual({ text: "/review ", caret: 8 });
  });
  it("filters by label or description", () => {
    const items = [{ id: "a", label: "review", insert: "/review" }, { id: "b", label: "plan", detail: "Review a plan", insert: "/plan" }];
    expect(filterItems(items, "REV").map(item => item.id)).toEqual(["a", "b"]);
    expect(filterItems(items, "pla").map(item => item.id)).toEqual(["b"]);
  });
});

describe("picker keyboard", () => {
  let container: HTMLDivElement; let root: Root; let state: ComposerSuggestionsState; let applied: Array<[string, number]>;
  function Harness({ sessionId }: { sessionId?: string }) {
    state = useComposerSuggestions({ sessionId, onApply: (text, caret) => applied.push([text, caret]) });
    return state.view;
  }
  const key = (name: string) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as KeyboardEvent<Element>;
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    applied = [];
    window.settings = { getSkillCatalog: async () => [
      { id: "s1", name: "review", description: "Review code", enabled: true },
      { id: "s2", name: "off", description: "", enabled: false },
    ] } as unknown as typeof window.settings;
    window.plugins = { list: async () => ({ plugins: [{ id: "p1", name: "weather", description: "Forecast", enabled: true }] }) } as unknown as typeof window.plugins;
    window.workspaceFiles = { list: vi.fn(async (_session: string, dir: string) => ({ ok: true, entries: dir === ""
      ? [{ name: "src", relPath: "src", isDir: true }, { name: "README.md", relPath: "README.md", isDir: false }]
      : [{ name: "main.ts", relPath: "src/main.ts", isDir: false }] })) } as unknown as typeof window.workspaceFiles;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("lists enabled skills and plugins, moves with the arrows and applies with Enter", async () => {
    act(() => root.render(createElement(Harness, {})));
    act(() => state.update("/", 1));
    await flush();
    expect([...container.querySelectorAll('[role="option"]')].map(node => node.textContent)).toEqual(["/reviewReview code技能", "/weatherForecast插件"]);
    act(() => { expect(state.handleKeyDown(key("ArrowDown"), false)).toBe(true); });
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("weather");
    act(() => { state.handleKeyDown(key("Enter"), false); });
    expect(applied).toEqual([["/weather ", 9]]);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("leaves keys alone while an input method is composing", async () => {
    act(() => root.render(createElement(Harness, {})));
    act(() => state.update("/", 1));
    await flush();
    act(() => { expect(state.handleKeyDown(key("Enter"), true)).toBe(false); });
    expect(applied).toEqual([]);
  });

  it("closes on Escape and stays closed for the same token", async () => {
    act(() => root.render(createElement(Harness, {})));
    act(() => state.update("/re", 3));
    await flush();
    act(() => { expect(state.handleKeyDown(key("Escape"), false)).toBe(true); });
    expect(state.open).toBe(false);
    act(() => state.update("/rev", 4));
    expect(state.open).toBe(false);
    act(() => state.update("x /", 3));
    expect(state.open).toBe(true);
  });

  it("browses workspace folders one level at a time with @", async () => {
    act(() => root.render(createElement(Harness, { sessionId: "s1" })));
    act(() => state.update("@", 1));
    await flush();
    act(() => { state.handleKeyDown(key("Enter"), false); });
    expect(applied.at(-1)).toEqual(["@src/", 5]);
    await flush();
    expect(window.workspaceFiles!.list).toHaveBeenLastCalledWith("s1", "src");
    expect(container.querySelector('[role="option"]')?.textContent).toContain("main.ts");
  });

  it("asks for a project before referencing files", async () => {
    act(() => root.render(createElement(Harness, {})));
    act(() => state.update("@", 1));
    await flush();
    expect(container.textContent).toContain("先选择项目目录");
  });
});
