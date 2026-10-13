// 检索评测的纯指标函数。输入是"按名次排好的会话 id 列表"，不依赖任何模型或生产代码，
// 因此可以脱离 Electron 单独测试。

/** 保留每个 id 第一次出现的位置。窗口级检索会让同一会话出现多次，指标按会话计。 */
export function dedupe(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 前 k 名里是否至少有一个标准答案。 */
export function hitAtK(ranked, gold, k) {
  const goldSet = new Set(gold);
  return ranked.slice(0, k).some((id) => goldSet.has(id)) ? 1 : 0;
}

/** 前 k 名覆盖了多少比例的标准答案。多证据问题用它。 */
export function recallAtK(ranked, gold, k) {
  if (gold.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return gold.filter((id) => top.has(id)).length / gold.length;
}

/** 第一个标准答案名次的倒数，没命中为 0。 */
export function reciprocalRank(ranked, gold) {
  const goldSet = new Set(gold);
  const index = ranked.findIndex((id) => goldSet.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

/** 二值相关性的 nDCG@k。 */
export function ndcgAtK(ranked, gold, k) {
  const goldSet = new Set(gold);
  let dcg = 0;
  ranked.slice(0, k).forEach((id, i) => {
    if (goldSet.has(id)) dcg += 1 / Math.log2(i + 2);
  });
  let ideal = 0;
  for (let i = 0; i < Math.min(gold.length, k); i++) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? 0 : dcg / ideal;
}

/**
 * 更正场景的时间准确率：新事实必须排在被取代的旧事实前面。
 * 新事实没出现算失败；旧事实没出现而新事实出现算成功。
 */
export function supersededOrder(ranked, newer, older) {
  const n = ranked.indexOf(newer);
  if (n < 0) return 0;
  const o = ranked.indexOf(older);
  return o < 0 || n < o ? 1 : 0;
}

export function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** 最近邻分位数（不插值），p 取 0..1。 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * 弃答可分性：随机取一个"有答案查询的最高分"和一个"无答案查询的最高分"，
 * 前者更大的概率（相等记 0.5）。1 表示完全可分，0.5 等于猜。
 */
export function auc(positive, negative) {
  if (positive.length === 0 || negative.length === 0) return null;
  let wins = 0;
  for (const p of positive) {
    for (const n of negative) wins += p > n ? 1 : p === n ? 0.5 : 0;
  }
  return wins / (positive.length * negative.length);
}

/** 带种子的伪随机数，保证评测可复现。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 均值的百分位自助法置信区间。查询只有几十条，差异小于区间宽度时不能算改善。
 */
export function bootstrapCi(values, { iterations = 1000, seed = 7, alpha = 0.05 } = {}) {
  if (values.length === 0) return { mean: 0, low: 0, high: 0 };
  const random = mulberry32(seed);
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    mean: mean(values),
    low: means[Math.floor((alpha / 2) * iterations)],
    high: means[Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations))],
  };
}
