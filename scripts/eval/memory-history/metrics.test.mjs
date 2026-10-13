import assert from "node:assert/strict";
import test from "node:test";
import {
  auc,
  bootstrapCi,
  dedupe,
  hitAtK,
  mean,
  mulberry32,
  ndcgAtK,
  percentile,
  recallAtK,
  reciprocalRank,
  supersededOrder,
} from "./metrics.mjs";

test("dedupe keeps the first occurrence only", () => {
  assert.deepEqual(dedupe(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});

test("hit, recall and reciprocal rank follow the ranked order", () => {
  const ranked = ["x", "g1", "y", "g2"];
  assert.equal(hitAtK(ranked, ["g1"], 1), 0);
  assert.equal(hitAtK(ranked, ["g1"], 2), 1);
  assert.equal(recallAtK(ranked, ["g1", "g2"], 2), 0.5);
  assert.equal(recallAtK(ranked, ["g1", "g2"], 4), 1);
  assert.equal(recallAtK(ranked, [], 4), 0);
  assert.equal(reciprocalRank(ranked, ["g2", "g1"]), 0.5);
  assert.equal(reciprocalRank(ranked, ["missing"]), 0);
});

test("nDCG is 1 for a perfect ranking and lower when the answer is pushed down", () => {
  assert.equal(ndcgAtK(["g", "a", "b"], ["g"], 3), 1);
  const lower = ndcgAtK(["a", "b", "g"], ["g"], 3);
  assert.ok(lower > 0 && lower < 1);
  assert.equal(ndcgAtK(["a", "b"], ["g"], 2), 0);
});

test("a correction must outrank the fact it supersedes", () => {
  assert.equal(supersededOrder(["new", "old"], "new", "old"), 1);
  assert.equal(supersededOrder(["old", "new"], "new", "old"), 0);
  assert.equal(supersededOrder(["new"], "new", "old"), 1);
  assert.equal(supersededOrder(["old"], "new", "old"), 0);
  assert.equal(supersededOrder([], "new", "old"), 0);
});

test("percentile and mean on small samples", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
});

test("auc is 1 for separable scores, 0.5 for ties and null without both groups", () => {
  assert.equal(auc([0.9, 0.8], [0.1, 0.2]), 1);
  assert.equal(auc([0.5], [0.5]), 0.5);
  assert.equal(auc([0.1], [0.9]), 0);
  assert.equal(auc([], [1]), null);
});

test("the seeded generator and bootstrap are reproducible", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const first = bootstrapCi([1, 0, 1, 1, 0, 1, 1, 1], { seed: 3 });
  const second = bootstrapCi([1, 0, 1, 1, 0, 1, 1, 1], { seed: 3 });
  assert.deepEqual(first, second);
  assert.ok(first.low <= first.mean && first.mean <= first.high);
  assert.deepEqual(bootstrapCi([]), { mean: 0, low: 0, high: 0 });
});
