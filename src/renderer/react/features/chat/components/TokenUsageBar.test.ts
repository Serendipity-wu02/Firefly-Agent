// @vitest-environment jsdom
// TokenUsageBar 单测：格式化与汇总的纯函数口径 + 挂载/run 结束刷新、无数据隐藏的组件行为。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOKEN_USAGE_BAR_DAYS,
  TokenUsageBar,
  formatTokenAmount,
  summarizeTokenUsage,
  type TokenUsageBarDay,
} from "./TokenUsageBar";

function day(overrides: Partial<TokenUsageBarDay> = {}): TokenUsageBarDay {
  return { input: 0, output: 0, hit: 0, miss: 0, requests: 0, attemptedRequests: 0, cacheUsageRequests: 0, ...overrides };
}

describe("formatTokenAmount", () => {
  it("keeps small values as integers and abbreviates k / M / B", () => {
    expect(formatTokenAmount(0)).toBe("0");
    expect(formatTokenAmount(Number.NaN)).toBe("0");
    expect(formatTokenAmount(999)).toBe("999");
    expect(formatTokenAmount(1234)).toBe("1.2k");
    expect(formatTokenAmount(12_345)).toBe("12.3k");
    expect(formatTokenAmount(123_456)).toBe("123k");
    expect(formatTokenAmount(1_234_567)).toBe("1.2M");
    expect(formatTokenAmount(350_000_000)).toBe("350M");
    expect(formatTokenAmount(2_500_000_000)).toBe("2.5B");
  });
});

describe("summarizeTokenUsage", () => {
  it("returns null when nothing was recorded, so the bar stays hidden", () => {
    expect(summarizeTokenUsage([])).toBeNull();
    expect(summarizeTokenUsage([day(), day()])).toBeNull();
  });

  it("treats attempted-but-unreported requests as data, with zero tokens", () => {
    const summary = summarizeTokenUsage([day({ attemptedRequests: 2 })]);
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(0);
    expect(summary!.attemptedRequests).toBe(2);
    expect(summary!.cacheHitRate).toBeUndefined();
  });

  it("sums days into requests, input, output and total", () => {
    const summary = summarizeTokenUsage([
      day({ input: 1000, output: 200, requests: 2, attemptedRequests: 2 }),
      day({ input: 500, output: 300, requests: 1, attemptedRequests: 1 }),
    ]);
    expect(summary).toEqual({
      requests: 3,
      attemptedRequests: 3,
      input: 1500,
      output: 500,
      total: 2000,
      cacheHitRate: undefined,
    });
  });

  it("computes the cache hit rate as hit / (hit + miss) like the settings token panel", () => {
    const summary = summarizeTokenUsage([
      day({ input: 1000, output: 10, hit: 990, miss: 10, requests: 1, cacheUsageRequests: 1 }),
    ]);
    expect(summary!.cacheHitRate).toBeCloseTo(0.99);
  });

  it("omits the cache rate when the vendor never reported cache details", () => {
    const summary = summarizeTokenUsage([day({ input: 1000, output: 10, requests: 1 })]);
    expect(summary!.cacheHitRate).toBeUndefined();
  });
});

describe("TokenUsageBar rendering and refresh", () => {
  let root: Root;
  let host: HTMLDivElement;
  let getUsage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    getUsage = vi.fn(async () => ({
      days: [day({ input: 349_000_000, output: 1_000_000, hit: 346_000_000, miss: 3_000_000, requests: 133, attemptedRequests: 133, cacheUsageRequests: 133 })],
    }));
    (window as unknown as { tokenUsage?: unknown }).tokenUsage = { get: getUsage };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { tokenUsage?: unknown }).tokenUsage;
  });

  async function render(busy: boolean) {
    await act(async () => {
      root.render(React.createElement(TokenUsageBar, { busy }));
    });
  }

  it("fetches the usage window on mount and shows the summary", async () => {
    await render(false);
    expect(getUsage).toHaveBeenCalledWith(TOKEN_USAGE_BAR_DAYS);
    expect(host.textContent).toContain("133 次请求");
    expect(host.textContent).toContain("近 90 天 350M tok");
    expect(host.textContent).toContain("缓存命中 99%");
  });

  it("does not fetch while a run is in progress", async () => {
    await render(true);
    expect(getUsage).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe("");
  });

  it("refreshes once the run ends (busy true -> false) and not on every render", async () => {
    await render(true);
    await render(false);
    expect(getUsage).toHaveBeenCalledTimes(1);
    await render(false);
    expect(getUsage).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there is no recorded usage", async () => {
    getUsage.mockResolvedValueOnce({ days: [] });
    await render(false);
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing and does not throw when the read fails", async () => {
    getUsage.mockRejectedValueOnce(new Error("ipc down"));
    await render(false);
    expect(host.innerHTML).toBe("");
  });
});
