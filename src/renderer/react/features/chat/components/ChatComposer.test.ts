import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let senderProps: Record<string, unknown> | undefined;

vi.mock("@ant-design/x", () => ({
  Sender: (props: Record<string, unknown>) => {
    senderProps = props;
    return null;
  },
}));

vi.mock("antd", () => ({
  Popover: ({ children }: { children?: unknown }) => children ?? null,
  Segmented: () => null,
}));

vi.mock("./ModelEffortControl", () => ({ ModelEffortControl: () => null }));
vi.mock("./DesktopAsrButton", () => ({ DesktopAsrButton: () => null }));
vi.mock("./PermissionControl", () => ({ PermissionControl: () => null }));
vi.mock("../../../../../shared/renderer-base", () => ({ resolveAsset: (path: string) => path }));

import { ChatComposer, composerAddMenuEntries, parseComposerMessage, splitStickerMarkers } from "./ChatComposer";

/** Renders the Sender footer toolbar the composer passes, with stand-in send controls. */
function renderToolbar(): string {
  const footer = senderProps?.footer as (action: React.ReactNode, info: { components: Record<string, () => null> }) => React.ReactElement;
  return renderToStaticMarkup(footer(createElement("button", { "data-send": "" }), { components: { LoadingButton: () => null, SendButton: () => null } }));
}

describe("ChatComposer cancellation", () => {
  beforeEach(() => {
    senderProps = undefined;
  });

  it("forwards cancellation to the Sender stop button", () => {
    const onCancel = vi.fn();
    vi.stubGlobal("React", React);

    renderToStaticMarkup(createElement(ChatComposer, {
      value: "",
      mode: "chat",
      docked: true,
      attachments: [],
      modelBusy: true,
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      onCancel,
      onChooseWorkspace: vi.fn(),
      onChooseFiles: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onScreenshot: vi.fn(),
      onChooseSticker: vi.fn(),
    }));

    expect(senderProps?.onCancel).toBe(onCancel);
  });

  it("does not disable an active Work run when its workspace label is not loaded", () => {
    vi.stubGlobal("React", React);

    renderToStaticMarkup(createElement(ChatComposer, {
      value: "",
      mode: "work",
      docked: true,
      attachments: [],
      modelBusy: true,
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      onChooseWorkspace: vi.fn(),
      onChooseFiles: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onScreenshot: vi.fn(),
      onChooseSticker: vi.fn(),
    }));

    expect(senderProps?.disabled).toBe(false);
  });

});

describe("sticker markers in the text box", () => {
  const known = new Set(["firefly-happy", "hug"]);
  it("hides recognised markers from the typed text and restores them after it", () => {
    const { visible, markers } = splitStickerMarkers("你好 [sticker:firefly-happy]", known);
    expect(visible).toBe("你好 ");
    expect(markers).toEqual(["[sticker:firefly-happy]"]);
    expect(`${visible}${markers.join("")}`).toBe("你好 [sticker:firefly-happy]");
  });
  it("keeps a sticker-only draft sendable and every duplicate", () => {
    const { visible, markers } = splitStickerMarkers("[sticker:hug][sticker:hug]", known);
    expect(visible).toBe(""); expect(markers).toEqual(["[sticker:hug]", "[sticker:hug]"]);
  });
  it("round-trips typing, including a trailing space, without moving or losing a marker", () => {
    const original = "a[sticker:hug]";
    const { markers } = splitStickerMarkers(original, known);
    for (const typed of ["a ", "a b", "", "a\n"]) {
      const next = `${typed}${markers.join("")}`;
      expect(splitStickerMarkers(next, known).visible).toBe(typed);
      expect(splitStickerMarkers(next, known).markers).toEqual(markers);
    }
  });
  it("leaves unrecognised markers visible so they can never become hidden text", () => {
    const { visible, markers } = splitStickerMarkers("x [sticker:retired] y", known);
    expect(visible).toBe("x [sticker:retired] y"); expect(markers).toEqual([]);
  });
  it("leaves text without markers untouched", () => {
    expect(splitStickerMarkers("plain [text]", known)).toEqual({ visible: "plain [text]", markers: [] });
  });
});

describe("ChatComposer Code sticker policy", () => {
  const baseProps = {
    value: "",
    docked: true,
    workspaceName: "project",
    attachments: [],
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onChooseWorkspace: vi.fn(),
    onChooseFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onScreenshot: vi.fn(),
    onChooseSticker: vi.fn(),
  };

  it("offers stickers in the add menu for Work but not for Code", () => {
    expect(composerAddMenuEntries(false)).toEqual(["upload", "screenshot"]);
    expect(composerAddMenuEntries(true)).toEqual(["upload", "screenshot", "sticker"]);
    // The composer decides per mode; the one "+" entry is always present.
    renderToStaticMarkup(createElement(ChatComposer, { ...baseProps, mode: "code" }));
    expect(renderToolbar()).toContain('aria-label="添加"');
  });

  it("strips sticker markers without turning them into a Code message sticker", () => {
    expect(parseComposerMessage("code", "检查一下 [sticker:playful]")).toEqual({
      rawContent: "检查一下",
      visibleContent: "检查一下",
      userSticker: undefined,
    });
    expect(parseComposerMessage("work", "检查一下 [sticker:playful]")).toEqual({
      rawContent: "检查一下 [sticker:playful]",
      visibleContent: "检查一下",
      userSticker: "playful",
    });
  });

  it("keeps the plan mode toggle in the Code composer footer", () => {
    renderToStaticMarkup(createElement(ChatComposer, {
      ...baseProps,
      mode: "code",
      conversationId: "session-1",
    }));
    const html = renderToolbar();

    expect(html).toContain("计划模式 · off");
    expect(html).toContain("ff-plan-control");
  });
  it("puts every control in one toolbar under the text: add and mode on the left, send on the right", () => {
    renderToStaticMarkup(createElement(ChatComposer, { ...baseProps, mode: "code", conversationId: "session-1" }));
    expect(senderProps?.suffix).toBe(false);
    expect(senderProps?.prefix).toBeUndefined();
    const html = renderToolbar();
    const start = html.slice(html.indexOf("ff-composer__toolbar-start"), html.indexOf("ff-composer__toolbar-end"));
    const end = html.slice(html.indexOf("ff-composer__toolbar-end"));
    expect(start).toContain('aria-label="添加"');
    expect(start).toContain("ff-plan-control");
    expect(end).toContain("data-send");
    expect(start).not.toContain("data-send");
  });
});
