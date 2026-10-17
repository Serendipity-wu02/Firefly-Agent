// Token 用量持久化存储
//
// 存储位置：<userData>/token-usage.json
// 数据结构：按天 ISO 日期聚合，方便查询任意时间段。
//
// 写入策略：record() 立即更新内存缓存，1 秒防抖落盘（避免高频写）。
// 读取策略：首次访问时从磁盘加载到内存，后续直接读缓存。

import { getStorageContext } from "./storage-context";
import { AtomicJsonStore } from "./atomic-json-store";
import type { SessionStats, UsageHistory, UsageHistoryDay } from "../shared/usage-history";
import { currentUsageAttribution, USAGE_FEATURES, type UsageAttribution, type UsageFeature } from "./usage-attribution";


export interface TokenUsageDay {
  input: number;
  output: number;
  /** 厂商明确上报的缓存读取 token。 */
  hit: number;
  /** 同一批已上报缓存明细的输入中，未命中缓存的 token。 */
  miss: number;
  /** 厂商明确上报的缓存创建 token（cache_creation_input_tokens）。 */
  cacheCreation: number;
  /** 返回了缓存明细的请求数；0 表示该日没有可用的缓存数据。 */
  cacheUsageRequests?: number;
  requests: number;
  /** 所有发出的模型请求数（含厂商未返回 usage 的）；用于统计覆盖率。 */
  attemptedRequests?: number;
  /** 从 v2 起按真实模型名聚合；旧数据不具备此维度。 */
  models?: Record<string, TokenUsageModel>;
  /** 按功能（聊天、工作、代码、子代理……）聚合；之前的数据不具备此维度。 */
  features?: Record<string, TokenUsageModel>;
  /** 按会话聚合，用于"聊天用量排行"；每天只保留用量最大的若干个会话。 */
  sessions?: Record<string, TokenUsageSession>;
  /** 当天的使用次数：消息、技能调用、插件调用。 */
  activity?: TokenUsageActivity;
  /** 按会话累计的运行统计；与 sessions 分开存放，不受"用量排行"的数量上限影响。 */
  sessionStats?: Record<string, TokenUsageSessionStats>;
}

export interface TokenUsageSession {
  input: number;
  output: number;
  requests: number;
  feature: string;
}

export interface TokenUsageSessionStats {
  rounds: number;
  steps: number;
  modelMs: number;
  toolMs: number;
  /** 首 token 耗时的总和与样本数，平均值在读取时算。 */
  ttftMs: number;
  ttftCount: number;
  /** 流式输出阶段的耗时与 token 数，用来算输出速度。 */
  genMs: number;
  genTokens: number;
}

export interface TokenUsageActivity {
  messages: number;
  skills: Record<string, number>;
  plugins: Record<string, number>;
}

export interface TokenUsageModel {
  input: number;
  output: number;
  hit: number;
  miss: number;
  /** 厂商明确上报的缓存创建 token（cache_creation_input_tokens）。 */
  cacheCreation: number;
  /** 厂商实际返回缓存统计的请求数；缺失代表历史数据或暂无可用数据。 */
  cacheUsageRequests?: number;
  requests: number;
  /** 所有发出的模型请求数（含厂商未返回 usage 的）；用于统计覆盖率。 */
  attemptedRequests?: number;
}

interface TokenUsageStore {
  schemaVersion: 2;
  days: Record<string, TokenUsageDay>; // key = "2026-06-19"
}


const DEFAULT_STORE: TokenUsageStore = { schemaVersion: 2, days: {} };
const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 5000;

function usageStore(): AtomicJsonStore<Partial<TokenUsageStore>> {
  return new AtomicJsonStore(getStorageContext().files.tokenUsage, (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Partial<TokenUsageStore>;
    if (!candidate.days || typeof candidate.days !== "object" || Array.isArray(candidate.days)) return false;
    const validCounters = (counters: unknown): boolean => {
      if (!counters || typeof counters !== "object" || Array.isArray(counters)) return false;
      const record = counters as Record<string, unknown>;
      return ["input", "output", "requests"].every((key) => typeof record[key] === "number") &&
        ["input", "output", "requests", "hit", "miss", "cacheCreation", "cacheUsageRequests", "attemptedRequests"].every((key) => record[key] === undefined || (typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0));
    };
    const validRecord = (record: unknown, entry: (value: unknown) => boolean): boolean =>
      record === undefined || (!!record && typeof record === "object" && !Array.isArray(record) && Object.values(record).every(entry));
    const validStats = (value: unknown): boolean => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const stats = value as Record<string, unknown>;
      return ["rounds", "steps", "modelMs", "toolMs", "ttftMs", "ttftCount", "genMs", "genTokens"].every((key) => typeof stats[key] === "number" && Number.isFinite(stats[key]) && (stats[key] as number) >= 0);
    };
    const validSession = (value: unknown): boolean => validCounters(value) && typeof (value as Record<string, unknown>).feature === "string";
    const validCounts = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const validActivity = (value: unknown): boolean => {
      if (value === undefined) return true;
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const activity = value as Record<string, unknown>;
      return validCounts(activity.messages) && validRecord(activity.skills ?? {}, validCounts) && validRecord(activity.plugins ?? {}, validCounts);
    };
    return Object.values(candidate.days).every((day) => validCounters(day) && validRecord(day.models, validCounters)
      && validRecord(day.features, validCounters) && validRecord(day.sessions, validSession) && validActivity(day.activity)
      && validRecord(day.sessionStats, validStats));
  });
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let cache: TokenUsageStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
}

function loadFromDisk(): TokenUsageStore {
  const store = usageStore();
  try {
    const parsed = store.read(DEFAULT_STORE);
    return { schemaVersion: 2, days: parsed.days ?? {} };
  } catch (error) {
    console.warn("[token-usage] read failed:", (error as Error).message);
    return { ...DEFAULT_STORE, days: {} };
  }
}

function ensureLoaded(): TokenUsageStore {
  if (!cache) cache = loadFromDisk();
  return cache;
}

function scheduleFlush(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    flushNow();
  }, DEBOUNCE_MS);
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      flushNow();
    }, MAX_WAIT_MS);
  }
}

function flushNow(): void {
  if (!cache) return;
  const store = usageStore();
  try { store.write(cache); }
  catch (error) { console.warn("[token-usage] write failed:", (error as Error).message); }
}

// ── public API ──

/** 将一次模型调用累加到指定日期；导出供统计逻辑测试与复用。 */
export function applyUsageToDay(
  day: TokenUsageDay,
  input: number,
  output: number,
  requests = 1,
  cachedInput?: number,
  model?: string,
  cacheCreation?: number,
  attribution?: UsageAttribution,
): void {
  day.input += Math.max(0, Math.round(input || 0));
  day.output += Math.max(0, Math.round(output || 0));
  day.requests += Math.max(0, requests);
  if (typeof cachedInput === "number" && Number.isFinite(cachedInput)) {
    const normalizedInput = Math.max(0, Math.round(input || 0));
    const normalizedCachedInput = Math.max(0, Math.min(normalizedInput, Math.round(cachedInput)));
    day.hit += normalizedCachedInput;
    day.miss += normalizedInput - normalizedCachedInput;
    day.cacheUsageRequests = (day.cacheUsageRequests ?? 0) + Math.max(0, requests);
  }
  if (typeof cacheCreation === "number" && Number.isFinite(cacheCreation)) {
    day.cacheCreation = (day.cacheCreation ?? 0) + Math.max(0, Math.round(cacheCreation));
  }
  const modelName = model?.trim() || "未归类";
  const byModel = day.models ?? {};
  const modelDay = byModel[modelName] ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
  modelDay.input += Math.max(0, Math.round(input || 0));
  modelDay.output += Math.max(0, Math.round(output || 0));
  modelDay.requests += Math.max(0, requests);
  if (typeof cachedInput === "number" && Number.isFinite(cachedInput)) {
    const normalizedInput = Math.max(0, Math.round(input || 0));
    const normalizedCachedInput = Math.max(0, Math.min(normalizedInput, Math.round(cachedInput)));
    modelDay.hit += normalizedCachedInput;
    modelDay.miss += normalizedInput - normalizedCachedInput;
    modelDay.cacheUsageRequests = (modelDay.cacheUsageRequests ?? 0) + Math.max(0, requests);
  }
  if (typeof cacheCreation === "number" && Number.isFinite(cacheCreation)) {
    modelDay.cacheCreation = (modelDay.cacheCreation ?? 0) + Math.max(0, Math.round(cacheCreation));
  }
  byModel[modelName] = modelDay;
  day.models = byModel;
  if (attribution) applyAttribution(day, attribution, input, output, requests, cachedInput, cacheCreation);
}

/** 无会话或功能归因的请求归入 "other"。 */
const FALLBACK_FEATURE: UsageFeature = "other";
/** 每天最多保留这么多个会话的明细，超出时丢掉用量最小的。 */
const MAX_SESSIONS_PER_DAY = 60;
/** 每天最多保留这么多个会话的运行统计，超出时丢掉步数最少的；只是防止文件无限增长，远大于排行上限。 */
const MAX_SESSION_STATS_PER_DAY = 500;
/** 技能 / 插件 id 作记录键，挡掉会污染原型的名字。 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function emptyCounters(): TokenUsageModel {
  return { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
}

function applyAttribution(day: TokenUsageDay, attribution: UsageAttribution, input: number, output: number, requests: number, cachedInput?: number, cacheCreation?: number): void {
  const feature = (USAGE_FEATURES as readonly string[]).includes(attribution.feature) ? attribution.feature : FALLBACK_FEATURE;
  const features = day.features ?? {};
  const counters = features[feature] ?? emptyCounters();
  const normalizedInput = Math.max(0, Math.round(input || 0));
  counters.input += normalizedInput;
  counters.output += Math.max(0, Math.round(output || 0));
  counters.requests += Math.max(0, requests);
  if (typeof cachedInput === "number" && Number.isFinite(cachedInput)) {
    const hit = Math.max(0, Math.min(normalizedInput, Math.round(cachedInput)));
    counters.hit += hit;
    counters.miss += normalizedInput - hit;
    counters.cacheUsageRequests = (counters.cacheUsageRequests ?? 0) + Math.max(0, requests);
  }
  if (typeof cacheCreation === "number" && Number.isFinite(cacheCreation)) counters.cacheCreation += Math.max(0, Math.round(cacheCreation));
  features[feature] = counters;
  day.features = features;

  const sessionId = attribution.sessionId?.trim();
  if (!sessionId || UNSAFE_KEYS.has(sessionId)) return;
  const session = touchSession(day, sessionId, feature);
  session.input += normalizedInput;
  session.output += Math.max(0, Math.round(output || 0));
  session.requests += Math.max(0, requests);
  trimSessions(day);
}

/** 取（必要时新建）当天某个会话的明细；改完数字后要调用 trimSessions。 */
function touchSession(day: TokenUsageDay, sessionId: string, feature: string): TokenUsageSession {
  const sessions = day.sessions ?? {};
  const session = sessions[sessionId] ?? { input: 0, output: 0, requests: 0, feature };
  sessions[sessionId] = session;
  day.sessions = sessions;
  return session;
}

function trimSessionStats(day: TokenUsageDay): void {
  const all = day.sessionStats;
  if (!all) return;
  const ids = Object.keys(all);
  if (ids.length <= MAX_SESSION_STATS_PER_DAY) return;
  const smallest = ids.sort((left, right) => all[left]!.steps + all[left]!.rounds - all[right]!.steps - all[right]!.rounds)[0];
  if (smallest) delete all[smallest];
}

/** 超过上限时丢掉用量最小的会话，包括刚碰过的这个。 */
function trimSessions(day: TokenUsageDay): void {
  const sessions = day.sessions;
  if (!sessions) return;
  const ids = Object.keys(sessions);
  if (ids.length <= MAX_SESSIONS_PER_DAY) return;
  const weight = (id: string) => sessions[id]!.input + sessions[id]!.output;
  const smallest = ids.sort((left, right) => weight(left) - weight(right))[0];
  if (smallest) delete sessions[smallest];
}

function emptyStats(): TokenUsageSessionStats {
  return { rounds: 0, steps: 0, modelMs: 0, toolMs: 0, ttftMs: 0, ttftCount: 0, genMs: 0, genTokens: 0 };
}

const wholeMs = (value: number | undefined): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/** 把一次更新记到当前运行所属会话的统计上；不在会话里的调用（记忆、主动聊天）不计。 */
function updateSessionStats(update: (stats: TokenUsageSessionStats) => void): void {
  bestEffort("session stats", () => {
    const attribution = currentUsageAttribution();
    const sessionId = attribution?.sessionId?.trim();
    if (!attribution || !sessionId || UNSAFE_KEYS.has(sessionId)) return;
    const day = dayFor(ensureLoaded());
    const all = day.sessionStats ?? {};
    const stats = all[sessionId] ?? emptyStats();
    all[sessionId] = stats;
    day.sessionStats = all;
    update(stats);
    trimSessionStats(day);
    scheduleFlush();
  });
}

/** 记录一次模型请求的耗时；流式请求另带首 token 耗时和输出阶段的耗时与 token 数。 */
export function recordModelCall(call: { durationMs: number; ttftMs?: number; generationMs?: number; outputTokens?: number }): void {
  updateSessionStats(stats => {
    stats.steps += 1;
    stats.modelMs += wholeMs(call.durationMs);
    if (call.ttftMs !== undefined) { stats.ttftMs += wholeMs(call.ttftMs); stats.ttftCount += 1; }
    const generationMs = wholeMs(call.generationMs);
    const outputTokens = typeof call.outputTokens === "number" && Number.isFinite(call.outputTokens) ? Math.max(0, Math.round(call.outputTokens)) : 0;
    if (generationMs > 0 && outputTokens > 0) { stats.genMs += generationMs; stats.genTokens += outputTokens; }
  });
}

/** 记录一次工具调用的耗时；代为运行子代理的工具传 0，它的时间已记在子代理自己的请求里。 */
export function recordToolCall(durationMs: number): void {
  updateSessionStats(stats => {
    stats.steps += 1;
    stats.toolMs += wholeMs(durationMs);
  });
}

/** 一个会话累计的运行统计；从没记录过时返回 null。 */
export function getSessionStats(sessionId: string): SessionStats | null {
  const id = sessionId.trim();
  if (!id || UNSAFE_KEYS.has(id)) return null;
  let days: Record<string, TokenUsageDay>;
  try { days = ensureLoaded().days; } catch { return null; }
  const total = emptyStats();
  let seen = false;
  for (const day of Object.values(days)) {
    const stats = day.sessionStats?.[id];
    if (!stats) continue;
    seen = true;
    for (const key of Object.keys(total) as Array<keyof TokenUsageSessionStats>) total[key] += stats[key];
  }
  if (!seen) return null;
  return {
    rounds: total.rounds,
    steps: total.steps,
    modelMs: total.modelMs,
    toolMs: total.toolMs,
    avgTtftMs: total.ttftCount > 0 ? Math.round(total.ttftMs / total.ttftCount) : null,
    tokensPerSecond: total.genMs > 0 ? Math.round((total.genTokens / total.genMs) * 1000) : null,
  };
}

function dayFor(store: TokenUsageStore): TokenUsageDay {
  const key = todayKey();
  const day = store.days[key] ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
  store.days[key] = day;
  return day;
}

function activityFor(day: TokenUsageDay): TokenUsageActivity {
  day.activity = day.activity ?? { messages: 0, skills: {}, plugins: {} };
  day.activity.skills = day.activity.skills ?? {};
  day.activity.plugins = day.activity.plugins ?? {};
  return day.activity;
}

/** 统计只是旁路记录：存储不可用时跳过，不能让一次运行因此失败。 */
function bestEffort(label: string, record: () => void): void {
  try {
    record();
  } catch (error) {
    console.warn(`[token-usage] ${label} skipped:`, (error as Error).message);
  }
}

/** 记录一条用户消息触发了一次运行。 */
export function recordMessage(): void {
  bestEffort("message", () => {
    activityFor(dayFor(ensureLoaded())).messages += 1;
    scheduleFlush();
  });
  updateSessionStats(stats => { stats.rounds += 1; });
}

/** 记录一次技能调用（invoke_skill）。 */
export function recordSkillUse(skillId: string): void {
  const id = skillId.trim();
  if (!id || UNSAFE_KEYS.has(id)) return;
  bestEffort("skill call", () => {
    const skills = activityFor(dayFor(ensureLoaded())).skills;
    skills[id] = (Object.prototype.hasOwnProperty.call(skills, id) ? skills[id]! : 0) + 1;
    scheduleFlush();
  });
}

/** 记录一次插件调用（插件代理运行或插件发起的模型请求）。 */
export function recordPluginCall(pluginId: string): void {
  const id = pluginId.trim();
  if (!id || UNSAFE_KEYS.has(id)) return;
  bestEffort("plugin call", () => {
    const plugins = activityFor(dayFor(ensureLoaded())).plugins;
    plugins[id] = (Object.prototype.hasOwnProperty.call(plugins, id) ? plugins[id]! : 0) + 1;
    scheduleFlush();
  });
}

/** 记录一次 API 调用的 token 用量（异步累加到当天）。 */
/** feature names the owner of a background call that runs outside any conversation (memory, proactive chat); otherwise the run's declared attribution applies. */
export function recordUsage(input: number, output: number, requests = 1, cachedInput?: number, model?: string, cacheCreation?: number, feature?: UsageFeature): void {
  const store = ensureLoaded();
  const key = todayKey();
  const day = store.days[key] ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
  applyUsageToDay(day, input, output, requests, cachedInput, model, cacheCreation, feature ? { feature } : currentUsageAttribution() ?? { feature: FALLBACK_FEATURE });
  store.days[key] = day;
  scheduleFlush();
}

/** 记录一次模型请求的发生（不依赖厂商是否返回 usage）。用于统计请求覆盖率。 */
export function recordRequest(model?: string, feature?: UsageFeature): void {
  const store = ensureLoaded();
  const key = todayKey();
  const day = store.days[key] ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
  day.attemptedRequests = (day.attemptedRequests ?? 0) + 1;
  const modelName = model?.trim() || "未归类";
  const byModel = day.models ?? {};
  const modelDay = byModel[modelName] ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
  modelDay.attemptedRequests = (modelDay.attemptedRequests ?? 0) + 1;
  byModel[modelName] = modelDay;
  day.models = byModel;
  const owner = feature ?? currentUsageAttribution()?.feature ?? FALLBACK_FEATURE;
  const features = day.features ?? {};
  const counters = features[owner] ?? emptyCounters();
  counters.attemptedRequests = (counters.attemptedRequests ?? 0) + 1;
  features[owner] = counters;
  day.features = features;
  store.days[key] = day;
  scheduleFlush();
}

/** 清空所有本地 Token 用量记录；传入 days 时仅清空该对象，供纯逻辑测试使用。 */
export function clearUsage(days?: Record<string, TokenUsageDay>): void {
  if (days) {
    for (const key of Object.keys(days)) delete days[key];
    return;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
  cache = { ...DEFAULT_STORE, days: {} };
  flushNow();
}

/** 查询最近 N 天的用量数据，按日期升序返回（无数据的天填 0）。 */
export function getUsage(days: number): Array<{ date: string; weekday: string; input: number; output: number; hit: number; miss: number; cacheCreation: number; requests: number; attemptedRequests: number; cacheUsageRequests: number }> {
  const store = ensureLoaded();
  const result: Array<{ date: string; weekday: string; input: number; output: number; hit: number; miss: number; cacheCreation: number; requests: number; attemptedRequests: number; cacheUsageRequests: number }> = [];
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = store.days[key];
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    result.push({
      date: `${mm}-${dd}`,
      weekday: weekdays[d.getDay()],
      input: day?.input ?? 0,
      output: day?.output ?? 0,
      hit: day?.hit ?? 0,
      miss: day?.miss ?? 0,
      cacheCreation: day?.cacheCreation ?? 0,
      requests: day?.requests ?? 0,
      attemptedRequests: day?.attemptedRequests ?? 0,
      cacheUsageRequests: day?.cacheUsageRequests ?? 0,
    });
  }
  return result;
}

export interface TokenUsageReport {
  days: ReturnType<typeof getUsage>;
  models: Array<TokenUsageModel & { model: string }>;
}

/** 查询某个时间范围的日统计和真实模型占比；历史 v1 记录归入"未归类"。 */
export function getUsageReport(days: number): TokenUsageReport {
  const daily = getUsage(days);
  const store = ensureLoaded();
  const models = new Map<string, TokenUsageModel>();
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const day = store.days[key];
    if (!day) continue;
    const entries = day.models && Object.keys(day.models).length > 0
      ? Object.entries(day.models)
      : [["未归类", day] as const];
    for (const [model, value] of entries) {
      const target = models.get(model) ?? { input: 0, output: 0, hit: 0, miss: 0, cacheCreation: 0, requests: 0 };
      target.input += value.input ?? 0;
      target.output += value.output ?? 0;
      target.hit += value.hit ?? 0;
      target.miss += value.miss ?? 0;
      target.cacheCreation += value.cacheCreation ?? 0;
      target.requests += value.requests ?? 0;
      target.attemptedRequests = (target.attemptedRequests ?? 0) + (value.attemptedRequests ?? 0);
      models.set(model, target);
    }
  }
  return {
    days: daily,
    models: [...models.entries()]
      .map(([model, value]) => ({ model, ...value }))
      // attemptedRequests > 0 也保留：端点不回 usage 的模型可见（显示 0 token），而不是从列表消失
      .filter((item) => item.input > 0 || item.output > 0 || item.requests > 0 || (item.attemptedRequests ?? 0) > 0)
      .sort((left, right) => (right.input + right.output) - (left.input + left.output)),
  };
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MAX_RANKED_SESSIONS = 10;

/** 最近 N 天的"用量历史"：按模型、按功能的每日堆叠数据、会话排行，以及消息 / 技能 / 插件的使用次数。 */
export function getUsageHistory(days: number): UsageHistory {
  const store = ensureLoaded();
  const span = Math.max(1, Math.min(90, Math.round(days) || 7));
  const today = new Date();
  const models = new Map<string, { tokens: number; requests: number }>();
  const features = new Map<string, { tokens: number; requests: number }>();
  const sessions = new Map<string, { feature: string; tokens: number; requests: number }>();
  const skills = new Map<string, number>();
  const plugins = new Map<string, number>();
  const result: UsageHistoryDay[] = [];
  const add = <K>(target: Map<K, { tokens: number; requests: number }>, key: K, tokens: number, requests: number) => {
    const current = target.get(key) ?? { tokens: 0, requests: 0 };
    current.tokens += tokens;
    current.requests += requests;
    target.set(key, current);
  };
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const day = store.days[key];
    const entry: UsageHistoryDay = {
      date: `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      weekday: WEEKDAYS[date.getDay()]!,
      tokens: (day?.input ?? 0) + (day?.output ?? 0),
      requests: day?.requests ?? 0,
      byModel: {},
      byFeature: {},
      messages: day?.activity?.messages ?? 0,
      skillCalls: 0,
      pluginCalls: 0,
    };
    if (day) {
      // Older days have no per-model split: the whole day belongs to "未归类".
      const modelEntries = day.models && Object.keys(day.models).length > 0 ? Object.entries(day.models) : [["未归类", day] as const];
      for (const [name, value] of modelEntries) {
        const tokens = (value.input ?? 0) + (value.output ?? 0);
        if (tokens > 0) entry.byModel[name] = tokens;
        add(models, name, tokens, value.requests ?? 0);
      }
      for (const [name, value] of Object.entries(day.features ?? {})) {
        const tokens = (value.input ?? 0) + (value.output ?? 0);
        if (tokens > 0) entry.byFeature[name] = tokens;
        add(features, name, tokens, value.requests ?? 0);
      }
      for (const [id, value] of Object.entries(day.sessions ?? {})) {
        const current = sessions.get(id) ?? { feature: value.feature, tokens: 0, requests: 0 };
        current.tokens += (value.input ?? 0) + (value.output ?? 0);
        current.requests += value.requests ?? 0;
        sessions.set(id, current);
      }
      for (const [id, count] of Object.entries(day.activity?.skills ?? {})) {
        skills.set(id, (skills.get(id) ?? 0) + count);
        entry.skillCalls += count;
      }
      for (const [id, count] of Object.entries(day.activity?.plugins ?? {})) {
        plugins.set(id, (plugins.get(id) ?? 0) + count);
        entry.pluginCalls += count;
      }
    }
    result.push(entry);
  }
  const ranked = <K extends string>(map: Map<K, { tokens: number; requests: number }>) => [...map.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .filter(item => item.tokens > 0 || item.requests > 0)
    .sort((left, right) => right.tokens - left.tokens);
  const counted = (map: Map<string, number>) => [...map.entries()].map(([id, count]) => ({ id, count })).sort((left, right) => right.count - left.count);
  return {
    days: result,
    models: ranked(models),
    features: ranked(features),
    sessions: [...sessions.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens)
      .slice(0, MAX_RANKED_SESSIONS),
    skills: counted(skills),
    plugins: counted(plugins),
  };
}

/** 立即落盘（应用退出时调用）。 */
export function flush(): void {
  clearTimers();
  flushNow();
}
