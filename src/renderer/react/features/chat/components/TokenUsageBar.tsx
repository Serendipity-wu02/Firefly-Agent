// 输入框下方的 token 用量条：读取主进程 token-usage-store 已记录的日统计（tokenUsage.get），
// 汇总近 N 天的请求数、输入+输出 token 与缓存命中率。
// - 只展示 store 里真实记录的指标；store 没有会话维度，故这里是全局累计窗口，文案写明"近 N 天"。
// - 刷新时机：挂载时拉一次；run 结束（busy 由 true 落到 false）时再拉一次，不轮询。
// - 无任何记录（或读取失败、尚未返回）时整条不渲染，不留空白占位。
// - 窄窗口：次要项（请求数）由容器查询隐藏，不换行。
import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import "./TokenUsageBar.css";

/** 统计窗口：与主进程 TOKEN_USAGE_GET 的上限一致（getUsageReport 最多 90 天）。 */
export const TOKEN_USAGE_BAR_DAYS = 90;

/** 主进程 getUsageReport().days 单日条目中本组件用到的字段。 */
export interface TokenUsageBarDay {
  input: number;
  output: number;
  hit: number;
  miss: number;
  requests: number;
  attemptedRequests?: number;
  cacheUsageRequests?: number;
}

export interface TokenUsageSummary {
  requests: number;
  attemptedRequests: number;
  input: number;
  output: number;
  /** 输入 + 输出。 */
  total: number;
  /** 缓存命中率 0..1；厂商未返回缓存统计时为 undefined（不展示该项）。 */
  cacheHitRate?: number;
}

/** 数字缩写：<1000 原值；k / M / B 保留一位小数，>=100 取整（350M、123k）。 */
export function formatTokenAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const scaled = (divisor: number): string => {
    const n = value / divisor;
    return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  };
  if (value >= 1e9) return `${scaled(1e9)}B`;
  if (value >= 1e6) return `${scaled(1e6)}M`;
  if (value >= 1e3) return `${scaled(1e3)}k`;
  return String(Math.round(value));
}

/** 汇总日统计；全部为 0（无任何请求、无 token）时返回 null，调用方据此整条隐藏。 */
export function summarizeTokenUsage(days: readonly TokenUsageBarDay[]): TokenUsageSummary | null {
  let requests = 0;
  let attemptedRequests = 0;
  let input = 0;
  let output = 0;
  let hit = 0;
  let miss = 0;
  let cacheUsageRequests = 0;
  for (const day of days) {
    requests += day.requests || 0;
    attemptedRequests += day.attemptedRequests || 0;
    input += day.input || 0;
    output += day.output || 0;
    hit += day.hit || 0;
    miss += day.miss || 0;
    cacheUsageRequests += day.cacheUsageRequests || 0;
  }
  if (requests <= 0 && attemptedRequests <= 0 && input <= 0 && output <= 0) return null;
  // 与设置页 Token 面板口径一致：命中率 = 命中 /（命中 + 未命中），仅统计返回了缓存明细的请求。
  const cacheable = hit + miss;
  const cacheHitRate = cacheUsageRequests > 0 && cacheable > 0 ? hit / cacheable : undefined;
  return { requests, attemptedRequests, input, output, total: input + output, cacheHitRate };
}

type TokenUsageApi = {
  get?: (days: number) => Promise<{ days?: TokenUsageBarDay[] } | undefined>;
};

function tokenUsageApi(): TokenUsageApi | undefined {
  return (window as typeof window & { tokenUsage?: TokenUsageApi }).tokenUsage;
}

function RequestIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>;
}

function TokenIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
}

interface TokenUsageBarProps {
  /** 模型运行中：run 结束（true → false）时重新拉取统计。 */
  busy?: boolean;
}

export function TokenUsageBar({ busy }: TokenUsageBarProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);

  useEffect(() => {
    // 运行中不拉取：用量在 run 结束后才稳定，避免每轮都发 IPC。
    if (busy) return;
    const load = tokenUsageApi()?.get;
    if (!load) return;
    let active = true;
    // 读取失败保持上一次结果，不影响输入框本身。
    load(TOKEN_USAGE_BAR_DAYS)
      .then((report) => {
        if (active) setSummary(summarizeTokenUsage(report?.days ?? []));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [busy]);

  if (!summary) return null;

  const days = TOKEN_USAGE_BAR_DAYS;
  const cacheText = summary.cacheHitRate === undefined
    ? undefined
    : `${Math.round(summary.cacheHitRate * 100)}%`;
  const input = formatTokenAmount(summary.input);
  const output = formatTokenAmount(summary.output);
  const tooltip = t("tokenUsageBar.tooltip", { days, input, output });

  return (
    <div className="ff-token-usage-bar" role="status" aria-label={t("tokenUsageBar.ariaLabel", { days })}>
      <div className="ff-token-usage-bar__inner" title={tooltip}>
        <span className="ff-token-usage-bar__item ff-token-usage-bar__item--secondary">
          <RequestIcon />
          {t("tokenUsageBar.requests", { count: formatTokenAmount(summary.requests) })}
        </span>
        <span className="ff-token-usage-bar__item">
          <TokenIcon />
          {t("tokenUsageBar.total", { days, value: formatTokenAmount(summary.total) })}
        </span>
        {cacheText !== undefined && (
          <span className="ff-token-usage-bar__item">
            {t("tokenUsageBar.cacheHit", { rate: cacheText })}
          </span>
        )}
      </div>
    </div>
  );
}
