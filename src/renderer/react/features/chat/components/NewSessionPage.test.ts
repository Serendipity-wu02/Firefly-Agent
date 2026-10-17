// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSessionMeta } from "../../../../../shared/chat-types";
import { CodeRain, randomGlyph, rippleIntensity } from "./CodeRain";
import { ProjectChooserCard, recentProjects } from "./ProjectChooserCard";

vi.mock("../../../i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const session = (id: string, updatedAt: number, workspaceRoot?: string, workspaceDisplayName?: string): ChatSessionMeta =>
  ({ id, title: id, identityId: null, createdAt: 0, updatedAt, messageCount: 1, mode: "code", workspaceRoot, workspaceDisplayName });

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("recent projects", () => {
  it("lists each workspace once, most recently used first, named by its display name or folder", () => {
    expect(recentProjects([
      session("a", 1, "E:/work/storefront", "storefront-web"),
      session("b", 5, "E:/work/payments"),
      session("c", 9, "E:/work/storefront", "storefront-web"),
      session("d", 7),
    ])).toEqual([
      { path: "E:/work/storefront", displayName: "storefront-web", updatedAt: 9 },
      { path: "E:/work/payments", displayName: "payments", updatedAt: 5 },
    ]);
  });
  it("keeps at most the limit", () => {
    expect(recentProjects(Array.from({ length: 9 }, (_, index) => session(`s${index}`, index, `/p${index}`)), 3).map(item => item.path)).toEqual(["/p8", "/p7", "/p6"]);
  });
});

describe("project chooser card", () => {
  it("picks a recent project, marks the current one, and offers to browse", () => {
    const onPick = vi.fn(), onBrowse = vi.fn();
    const projects = [{ path: "/a", displayName: "infra", updatedAt: 2 }, { path: "/b", displayName: "payments-api", updatedAt: 1 }];
    act(() => root.render(React.createElement(ProjectChooserCard, { projects, selectedPath: "/b", onPick, onBrowse })));
    const items = [...host.querySelectorAll<HTMLButtonElement>(".ff-project-chooser__item")];
    expect(items.map(item => item.textContent)).toEqual(["infra", "payments-api"]);
    expect(items.map(item => item.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    act(() => items[0]!.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith(projects[0]);
    act(() => host.querySelector<HTMLButtonElement>(".ff-project-chooser__browse")!.click());
    expect(onBrowse).toHaveBeenCalledOnce();
    expect(host.querySelector(".ff-project-chooser__browse")!.textContent).toContain("chatPage.projectChooser.browse");
  });
  it("asks for a first folder when there are no recent projects", () => {
    act(() => root.render(React.createElement(ProjectChooserCard, { projects: [], onPick: vi.fn(), onBrowse: vi.fn() })));
    expect(host.querySelector(".ff-project-chooser__list")).toBeNull();
    expect(host.textContent).toContain("chatPage.projectChooser.browseFirst");
  });
});

describe("code rain", () => {
  it("draws only letters and digits", () => {
    let n = 0;
    const random = () => (n++ % 62) / 62;
    for (let index = 0; index < 62; index += 1) expect(randomGlyph(random)).toMatch(/^[A-Za-z0-9]$/);
  });
  it("lights a ring that travels out from the pointer and fades, and nothing at rest", () => {
    const ripple = { x: 0, y: 0, born: 0 };
    expect(rippleIntensity(100, 0, [], 500)).toBe(0);
    // After 500 ms the ring is about 160 px out: bright there, dark at the centre and far beyond.
    const onRing = rippleIntensity(160, 0, [ripple], 500);
    expect(onRing).toBeGreaterThan(0.5);
    expect(rippleIntensity(0, 0, [ripple], 500)).toBeLessThan(0.01);
    expect(rippleIntensity(400, 0, [ripple], 500)).toBeLessThan(0.01);
    // Later the same ring is fainter, and once its life is over it is gone.
    expect(rippleIntensity(320, 0, [ripple], 1000)).toBeLessThan(onRing);
    expect(rippleIntensity(600, 0, [ripple], 2000)).toBe(0);
  });
  it("is a decorative canvas that does not take the pointer", () => {
    act(() => root.render(React.createElement(CodeRain)));
    const canvas = host.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.classList.contains("ff-code-rain")).toBe(true);
  });
});
