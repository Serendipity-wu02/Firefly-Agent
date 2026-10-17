// 输入框下方的状态条，两枚胶囊，悬停各展开一张明细卡：
// - 会话统计：当前对话累计的轮数、步数、输出速度；卡里有模型用时、工具调用用时、首 token 平均耗时、输出速度。
//   数据来自主进程按会话累计的运行统计（tokenUsage.sessionStats），对话没有记录时不显示这枚胶囊。
// - Token 用量：近 N 天的 token 总量与缓存命中率（tokenUsage.get）；卡里有缓存命中、未缓存输入、缓存读取、输出与请求数。
//   store 没有按会话拆分的缓存明细，所以这一枚是全局累计窗口，文案写明"近 N 天"。
// - 刷新时机：挂载、切换对话时拉一次；run 结束（busy 由 true 落到 false）时再拉一次，不轮询。
// - 两项都没有数据（或读取失败、尚未返回）时整条不渲染，不留空白占位。
// - 窄窗口：会话统计胶囊由容器查询隐藏，不换行。
import { useEffect, useState, type ReactNode } from "react";
import { Popover } from "antd";
import type { SessionStats } from "../../../../../shared/usage-history";
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
  /** 命中缓存的输入 token（缓存读取）与未命中的输入 token；只含返回了缓存明细的请求。 */
  hit: number;
  miss: number;
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
  return { requests, attemptedRequests, input, output, hit, miss, total: input + output, cacheHitRate };
}

type TokenUsageApi = {
  get?: (days: number) => Promise<{ days?: TokenUsageBarDay[] } | undefined>;
  sessionStats?: (sessionId: string) => Promise<SessionStats | null | undefined>;
};

function tokenUsageApi(): TokenUsageApi | undefined {
  return (window as typeof window & { tokenUsage?: TokenUsageApi }).tokenUsage;
}

/** 毫秒 → 秒数文本（一位小数，用于首 token 耗时）。 */
export function formatSeconds(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

/** 毫秒 → 分秒；总分钟数不折成小时，长对话里 162 分钟就写 162 分。 */
export function splitDuration(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

function SessionIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14l3.5-4M4.5 18a9 9 0 1 1 15 0" /><circle cx="12" cy="14" r="1.2" /></svg>;
}

function TokenIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
}

function UsageCard({ icon, title, value, rows, note }: { icon: ReactNode; title: string; value?: string; rows: Array<[string, string]>; note?: string }) {
  return (
    <div className="ff-usage-card">
      <div className="ff-usage-card__header">
        <span className="ff-usage-card__title">{icon}{title}</span>
        {value && <strong>{value}</strong>}
      </div>
      <dl className="ff-usage-card__rows">
        {rows.map(([label, text]) => (
          <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
        ))}
      </dl>
      {note && <div className="ff-usage-card__note">{note}</div>}
    </div>
  );
}

interface TokenUsageBarProps {
  /** 模型运行中：run 结束（true → false）时重新拉取统计。 */
  busy?: boolean;
  /** 当前对话；用它取"会话统计"，没有时只显示 Token 用量。 */
  sessionId?: string;
}

export function TokenUsageBar({ busy, sessionId }: TokenUsageBarProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [session, setSession] = useState<SessionStats | null>(null);

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

  useEffect(() => {
    // 换对话时先清掉上一个对话的数字，免得新对话短暂显示别人的统计。
    setSession(null);
  }, [sessionId]);

  useEffect(() => {
    if (busy || !sessionId) return;
    const load = tokenUsageApi()?.sessionStats;
    if (!load) return;
    let active = true;
    load(sessionId)
      .then((stats) => {
        if (active) setSession(stats && (stats.rounds > 0 || stats.steps > 0) ? stats : null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [busy, sessionId]);

  if (!summary && !session) return null;

  const duration = (ms: number) => {
    const { minutes, seconds } = splitDuration(ms);
    return minutes > 0 ? t("tokenUsageBar.durationMinutes", { minutes, seconds }) : t("tokenUsageBar.durationSeconds", { seconds });
  };
  const speed = (value: number | null) => (value === null ? "—" : t("tokenUsageBar.speed", { value }));
  const exact = (value: number) => value.toLocaleString("en-US");

  const days = TOKEN_USAGE_BAR_DAYS;
  const cacheText = summary?.cacheHitRate === undefined
    ? undefined
    : `${Math.round(summary.cacheHitRate * 100)}%`;

  return (
    <div className="ff-token-usage-bar" role="status" aria-label={t("tokenUsageBar.ariaLabel", { days })}>
      <div className="ff-token-usage-bar__inner">
        {session && (
          <Popover
            trigger={["hover", "focus"]}
            placement="top"
            mouseEnterDelay={0.15}
            rootClassName="ff-usage-popover"
            content={(
              <UsageCard
                icon={<SessionIcon />}
                title={t("tokenUsageBar.sessionTitle")}
                rows={[
                  [t("tokenUsageBar.modelTime"), duration(session.modelMs)],
                  [t("tokenUsageBar.toolTime"), duration(session.toolMs)],
                  [t("tokenUsageBar.ttft"), session.avgTtftMs === null ? "—" : t("tokenUsageBar.seconds", { value: formatSeconds(session.avgTtftMs) })],
                  [t("tokenUsageBar.tps"), speed(session.tokensPerSecond)],
                ]}
              />
            )}
          >
            <button type="button" className="ff-token-usage-bar__item ff-token-usage-bar__item--secondary">
              <SessionIcon />
              {t("tokenUsageBar.roundsSteps", { rounds: session.rounds, steps: session.steps })}
              {session.tokensPerSecond !== null && <> · {speed(session.tokensPerSecond)}</>}
            </button>
          </Popover>
        )}
        {summary && (
          <Popover
            trigger={["hover", "focus"]}
            placement="top"
            mouseEnterDelay={0.15}
            rootClassName="ff-usage-popover"
            content={(
              <UsageCard
                icon={<TokenIcon />}
                title={t("tokenUsageBar.tokenTitle")}
                value={t("tokenUsageBar.tokens", { value: exact(summary.total) })}
                rows={[
                  ...(cacheText !== undefined ? [[t("tokenUsageBar.cacheHitRow"), cacheText] as [string, string]] : []),
                  [t("tokenUsageBar.uncachedInput"), t("tokenUsageBar.tokens", { value: exact(summary.miss) })],
                  [t("tokenUsageBar.cacheRead"), t("tokenUsageBar.tokens", { value: exact(summary.hit) })],
                  [t("tokenUsageBar.outputRow"), t("tokenUsageBar.tokens", { value: exact(summary.output) })],
                  [t("tokenUsageBar.requestsRow"), t("tokenUsageBar.requests", { count: exact(summary.requests) })],
                ]}
                note={t("tokenUsageBar.rangeNote", { days })}
              />
            )}
          >
            <button type="button" className="ff-token-usage-bar__item">
              <TokenIcon />
              {t("tokenUsageBar.total", { days, value: formatTokenAmount(summary.total) })}
              {cacheText !== undefined && <> · {t("tokenUsageBar.cacheHit", { rate: cacheText })}</>}
            </button>
          </Popover>
        )}
      </div>
    </div>
  );
}
