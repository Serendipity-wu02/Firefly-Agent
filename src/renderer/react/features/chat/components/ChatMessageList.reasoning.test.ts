// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReasoningBlock } from "../../../../../shared/chat-types";

// Think is replaced by a probe that exposes its expanded state and toggles like the real header.
vi.mock("@ant-design/x", async () => {
  const ReactModule = await import("react");
  return {
    Bubble: { List: () => null },
    CodeHighlighter: () => null,
    Think: ({ expanded, onExpand }: { expanded?: boolean; onExpand?: (value: boolean) => void }) =>
      ReactModule.createElement("button", { "data-think": "", "data-expanded": String(Boolean(expanded)), onClick: () => onExpand?.(!expanded) }),
    ThoughtChain: () => null,
  };
});
vi.mock("../../../../../shared/renderer-base", () => ({ resolveAsset: (path: string) => path }));
vi.mock("./StreamdownMessageContent.css", () => ({}));
vi.mock("./MermaidBlock", () => ({ MermaidBlock: () => null }));
vi.mock("./SvgCardBlock", () => ({ SvgCardBlock: () => null }));

import { RunActivityDetail } from "./ChatMessageList";

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(block: ReasoningBlock) {
  act(() => root.render(React.createElement(RunActivityDetail, { live: true, reasoningBlocks: [block], processMessages: [], tools: [] })));
  return container.querySelector<HTMLButtonElement>("[data-think]")!;
}

it("shows a run's reasoning open while it streams and folds it once done", () => {
  expect(render({ id: "r1", content: "思考中", streaming: true, seq: 1 }).dataset.expanded).toBe("true");
  expect(render({ id: "r1", content: "思考完", streaming: false, seq: 1 }).dataset.expanded).toBe("false");
});

it("keeps the user's choice across the end of streaming", () => {
  const live = render({ id: "r1", content: "思考中", streaming: true, seq: 1 });
  act(() => live.click());
  expect(container.querySelector<HTMLElement>("[data-think]")!.dataset.expanded).toBe("false");
  expect(render({ id: "r1", content: "思考完", streaming: false, seq: 1 }).dataset.expanded).toBe("false");
  act(() => container.querySelector<HTMLButtonElement>("[data-think]")!.click());
  expect(render({ id: "r1", content: "思考完", streaming: false, seq: 1 }).dataset.expanded).toBe("true");
});
