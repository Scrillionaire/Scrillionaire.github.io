import assert from "node:assert/strict";
import test from "node:test";

import {
  fitMeanMatchedParetoTail,
  interpolateCDF,
  linearBinCDF,
  paretoConditionalCDF,
  percentileForDistribution,
  sha256,
  stableJSONStringify,
  weightedCDFPoints,
} from "./distributions.mjs";

function countsWith(...entries) {
  const counts = Array(20).fill(0);
  for (const [index, count] of entries) counts[index] = count;
  return counts;
}

test("linearly interpolates inside a finite income bin", () => {
  const counts = countsWith([0, 20], [1, 80]);
  assert.equal(linearBinCDF({ income: 3_750, counts }), 0.6);
});

test("returns upper-bin context instead of pretending the open tail is uniform", () => {
  const counts = countsWith([18, 60], [19, 40]);
  assert.deepEqual(linearBinCDF({ income: 120_000, counts }), {
    cdfBelowBin: 0.6,
    binShare: 0.4,
    binIndex: 19,
    lower: 100_000,
    upper: Number.POSITIVE_INFINITY,
  });
});

test("fits a Pareto tail whose implied mean matches the published mean", () => {
  const counts = countsWith([18, 70], [19, 30]);
  const publishedMean = (70 * 87_500 + 30 * 150_000) / 100;
  const fit = fitMeanMatchedParetoTail({ counts, publishedMean });

  assert.ok(fit);
  assert.equal(Math.round(fit.topMean), 150_000);
  assert.equal(Math.round(fit.alpha * 100) / 100, 3);
  assert.equal(paretoConditionalCDF(100_000, fit), 0);
  assert.ok(paretoConditionalCDF(200_000, fit) > 0.8);
});

test("rejects unsupported local tail fits", () => {
  const sparse = countsWith([18, 95], [19, 5]);
  assert.equal(fitMeanMatchedParetoTail({ counts: sparse, publishedMean: 95_000 }), null);
});

test("falls back to a state tail when a local tail is not supportable", () => {
  const result = percentileForDistribution({
    income: 150_000,
    distribution: { counts: countsWith([18, 95], [19, 5]), mean: 95_000 },
    stateTailPoints: [
      { income: 100_000, cdf: 0.8 },
      { income: 150_000, cdf: 0.9 },
      { income: 250_000, cdf: 1 },
    ],
  });

  assert.equal(result.method, "modeled_state_tail_fallback");
  assert.equal(result.percentile, 97.5);
});

test("builds monotonic weighted CDF points", () => {
  const points = weightedCDFPoints(
    [
      { income: 10, weight: 1 },
      { income: 20, weight: 2 },
      { income: 30, weight: 1 },
    ],
    [30, 10, 20],
  );
  assert.deepEqual(points, [
    { income: 10, cdf: 0.25 },
    { income: 20, cdf: 0.75 },
    { income: 30, cdf: 1 },
  ]);
  assert.equal(interpolateCDF(15, points), 0.5);
});

test("stable JSON and digest are independent of object insertion order", () => {
  const first = stableJSONStringify({ z: 1, a: { d: 2, b: 3 } });
  const second = stableJSONStringify({ a: { b: 3, d: 2 }, z: 1 });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
});
