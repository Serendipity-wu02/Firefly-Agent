// 超长会话的摘录选择：命中后只返回"最佳窗口 + 邻近上下文"这一段连续消息，而不是整份会话。
// 纯函数：只看每条消息的字符数，不接触消息正文、授权或校验值。评测框架与仓库共用这一份，预算规则只写一次。
// 返回的区间必须由调用方对照权威文档重新切片，不接受任何来自排序阶段的文本。
export interface ExcerptInput {
  /** 每条消息计入预算的字符数（`historyMessageChars`）。 */
  sizes: ReadonlyArray<number>;
  /** 排序窗口的轮数，必须与排序时的 `toWindows` 一致。 */
  windowTurns: number;
  /** 排序得到的最佳窗口下标。 */
  bestUnit: number;
  /** 摘录的字符预算（含最佳窗口本身）。 */
  maxChars: number;
  /** 最佳窗口两侧各最多再扩几个窗口。 */
  contextWindows: number;
}
export interface ExcerptRange {start: number; end: number}

const isCount = (n: number) => Number.isSafeInteger(n) && n >= 0;

/**
 * 以最佳窗口为中心，在预算内向两侧交替各扩一个窗口（先前后，每侧最多 `contextWindows` 个）。
 * 最佳窗口本身放不下、或任何输入不合法时返回 null——宁可不返回，也不截断消息。
 */
export function selectExcerpt(input: ExcerptInput): ExcerptRange | null {
  const {sizes, windowTurns: turns, bestUnit, maxChars, contextWindows} = input;
  const n = sizes.length;
  if (n === 0 || !Number.isSafeInteger(turns) || turns <= 0 || !isCount(bestUnit) || !isCount(contextWindows)
    || !Number.isFinite(maxChars) || maxChars <= 0 || sizes.some((s) => !Number.isFinite(s) || s < 0)) return null;
  if (bestUnit >= Math.ceil(n / turns)) return null;
  const sum = (from: number, to: number) => {
    let total = 0;
    for (let i = from; i < to; i++) total += sizes[i];
    return total;
  };
  let start = bestUnit * turns;
  let end = Math.min(n, start + turns);
  let used = sum(start, end);
  if (used > maxChars) return null;
  let beforeOpen = true;
  let afterOpen = true;
  for (let step = 0; step < contextWindows && (beforeOpen || afterOpen); step++) {
    if (beforeOpen) {
      const from = Math.max(0, start - turns);
      const cost = start === 0 ? 0 : sum(from, start);
      if (start > 0 && used + cost <= maxChars) {
        start = from;
        used += cost;
      } else beforeOpen = false;
    }
    if (afterOpen) {
      const to = Math.min(n, end + turns);
      const cost = end >= n ? 0 : sum(end, to);
      if (end < n && used + cost <= maxChars) {
        end = to;
        used += cost;
      } else afterOpen = false;
    }
  }
  return {start, end};
}
