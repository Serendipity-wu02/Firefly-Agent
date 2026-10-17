// @vitest-environment jsdom
// TokenUsageBar 单测：格式化与汇总的纯函数口径 + 挂载/run 结束刷新、无数据隐藏的组件行为。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOKEN_USAGE_BAR_DAYS,
  TokenUsageBar,
  formatSeconds,
  formatTokenAmount,
  splitDuration,
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
      hit: 0,
      miss: 0,
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

  it("keeps cache read and uncached input so the detail card can list them", () => {
    const summary = summarizeTokenUsage([day({ input: 1000, output: 10, hit: 990, miss: 10, requests: 1, cacheUsageRequests: 1 })]);
    expect(summary).toEqual(expect.objectContaining({ hit: 990, miss: 10, output: 10, total: 1010 }));
  });

  it("omits the cache rate when the vendor never reported cache details", () => {
    const summary = summarizeTokenUsage([day({ input: 1000, output: 10, requests: 1 })]);
    expect(summary!.cacheHitRate).toBeUndefined();
  });
});

describe("duration helpers", () => {
  it("splits milliseconds into whole minutes and seconds without rolling into hours", () => {
    expect(splitDuration(162 * 60_000 + 16_000)).toEqual({ minutes: 162, seconds: 16 });
    expect(splitDuration(45_400)).toEqual({ minutes: 0, seconds: 45 });
    expect(splitDuration(-5)).toEqual({ minutes: 0, seconds: 0 });
  });

  it("writes the first-token delay with one decimal", () => {
    expect(formatSeconds(3900)).toBe("3.9");
    expect(formatSeconds(2000)).toBe("2");
  });
});

describe("TokenUsageBar rendering and refresh", () => {
  let root: Root;
  let host: HTMLDivElement;
  let getUsage: ReturnType<typeof vi.fn>;
  let getSessionStats: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // antd Popover positions itself with a ResizeObserver, which jsdom does not implement.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    getUsage = vi.fn(async () => ({
      days: [day({ input: 349_000_000, output: 1_000_000, hit: 346_000_000, miss: 3_000_000, requests: 133, attemptedRequests: 133, cacheUsageRequests: 133 })],
    }));
    getSessionStats = vi.fn(async () => ({ rounds: 153, steps: 1005, modelMs: 162 * 60_000 + 16_000, toolMs: 99 * 60_000 + 31_000, avgTtftMs: 3900, tokensPerSecond: 245 }));
    (window as unknown as { tokenUsage?: unknown }).tokenUsage = { get: getUsage, sessionStats: getSessionStats };
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    host.remove();
    delete (window as unknown as { tokenUsage?: unknown }).tokenUsage;
  });

  async function render(busy: boolean, sessionId?: string) {
    await act(async () => {
      root.render(React.createElement(TokenUsageBar, { busy, sessionId }));
    });
  }

  /** The detail card opens on hover or keyboard focus; focus is the deterministic one in jsdom. */
  async function openCard(chip: Element | null | undefined) {
    await act(async () => { (chip as HTMLElement).focus(); });
  }
  const chips = () => [...host.querySelectorAll(".ff-token-usage-bar__item")];
  const card = () => document.body.querySelector(".ff-usage-card");

  it("fetches the usage window on mount and shows the summary", async () => {
    await render(false);
    expect(getUsage).toHaveBeenCalledWith(TOKEN_USAGE_BAR_DAYS);
    expect(host.textContent).toContain("近 90 天 350M tok");
    expect(host.textContent).toContain("缓存命中 99%");
  });

  it("shows the conversation chip with rounds, steps and speed, and fetches by conversation id", async () => {
    await render(false, "session-a");
    expect(getSessionStats).toHaveBeenCalledWith("session-a");
    expect(chips()).toHaveLength(2);
    expect(chips()[0]!.textContent).toBe("153 轮 1005 步 · 245 tok/s");
  });

  it("lists the conversation stats in its detail card", async () => {
    await render(false, "session-a");
    await openCard(chips()[0]);
    const text = card()!.textContent!;
    expect(text).toContain("会话统计");
    expect(text).toContain("模型用时162分16秒");
    expect(text).toContain("工具调用用时99分31秒");
    expect(text).toContain("首 token 平均 (TTFT)3.9秒");
    expect(text).toContain("输出速度 (TPS)245 tok/s");
  });

  it("lists the token breakdown with exact numbers in its detail card", async () => {
    await render(false, "session-a");
    await openCard(chips()[1]);
    const text = card()!.textContent!;
    expect(text).toContain("Token 用量350,000,000 tok");
    expect(text).toContain("缓存命中99%");
    expect(text).toContain("未缓存输入3,000,000 tok");
    expect(text).toContain("缓存读取346,000,000 tok");
    expect(text).toContain("输出1,000,000 tok");
    expect(text).toContain("请求数133 次请求");
    expect(text).toContain("近 90 天累计");
  });

  it("shows em dashes where a conversation has no first-token or speed data", async () => {
    getSessionStats.mockResolvedValueOnce({ rounds: 1, steps: 2, modelMs: 800, toolMs: 0, avgTtftMs: null, tokensPerSecond: null });
    await render(false, "session-a");
    expect(chips()[0]!.textContent).toBe("1 轮 2 步");
    await openCard(chips()[0]);
    expect(card()!.textContent).toContain("首 token 平均 (TTFT)—");
    expect(card()!.textContent).toContain("输出速度 (TPS)—");
  });

  it("hides the conversation chip when the conversation has nothing recorded or no id yet", async () => {
    getSessionStats.mockResolvedValueOnce(null);
    await render(false, "session-a");
    expect(chips()).toHaveLength(1);
    expect(host.textContent).not.toContain("轮");
    await render(false, undefined);
    expect(chips()).toHaveLength(1);
  });

  it("drops the previous conversation's numbers when switching and refetches for the new one", async () => {
    await render(false, "session-a");
    expect(chips()).toHaveLength(2);
    getSessionStats.mockResolvedValueOnce(null);
    await render(false, "session-b");
    expect(getSessionStats).toHaveBeenLastCalledWith("session-b");
    expect(chips()).toHaveLength(1);
  });

  it("still shows the token chip when the conversation read fails", async () => {
    getSessionStats.mockRejectedValueOnce(new Error("ipc down"));
    await render(false, "session-a");
    expect(chips()).toHaveLength(1);
  });

  it("does not fetch while a run is in progress", async () => {
    await render(true, "session-a");
    expect(getUsage).not.toHaveBeenCalled();
    expect(getSessionStats).not.toHaveBeenCalled();
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
