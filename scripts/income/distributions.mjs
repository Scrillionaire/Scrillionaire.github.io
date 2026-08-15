import { createHash } from "node:crypto";

export const INCOME_BIN_EDGES = Object.freeze([
  0,
  2_500,
  5_000,
  7_500,
  10_000,
  12_500,
  15_000,
  17_500,
  20_000,
  22_500,
  25_000,
  30_000,
  35_000,
  40_000,
  45_000,
  50_000,
  55_000,
  65_000,
  75_000,
  100_000,
  Number.POSITIVE_INFINITY,
]);

export const TOP_BIN_LOWER_BOUND = 100_000;

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function clamp(value, lower, upper) {
  return Math.min(Math.max(value, lower), upper);
}

export function linearBinCDF({ income, counts, edges = INCOME_BIN_EDGES }) {
  validateBins(counts, edges);
  const total = sum(counts);
  if (total <= 0) return null;
  if (income < edges[0]) return 0;

  let countBelow = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const lower = edges[index];
    const upper = edges[index + 1];
    const count = counts[index];

    if (income >= upper) {
      countBelow += count;
      continue;
    }

    if (!Number.isFinite(upper)) {
      return {
        cdfBelowBin: countBelow / total,
        binShare: count / total,
        binIndex: index,
        lower,
        upper,
      };
    }

    const fraction = clamp((income - lower) / (upper - lower), 0, 1);
    return (countBelow + count * fraction) / total;
  }

  return 1;
}

export function fitMeanMatchedParetoTail({
  counts,
  publishedMean,
  edges = INCOME_BIN_EDGES,
  minimumTopBinCount = 30,
  alphaRange = [1.05, 12],
}) {
  validateBins(counts, edges);
  const total = sum(counts);
  const topCount = counts.at(-1);
  if (!(publishedMean > 0) || total <= 0 || topCount < minimumTopBinCount) {
    return null;
  }

  let finiteIncome = 0;
  for (let index = 0; index < counts.length - 1; index += 1) {
    const midpoint = (edges[index] + edges[index + 1]) / 2;
    finiteIncome += counts[index] * midpoint;
  }

  const topMean = (total * publishedMean - finiteIncome) / topCount;
  const lower = edges.at(-2);
  if (!(topMean > lower)) return null;

  const alpha = topMean / (topMean - lower);
  if (!Number.isFinite(alpha) || alpha < alphaRange[0] || alpha > alphaRange[1]) {
    return null;
  }

  return Object.freeze({ alpha, lower, topMean, topCount, total });
}

export function paretoConditionalCDF(income, fit) {
  if (income <= fit.lower) return 0;
  return clamp(1 - (fit.lower / income) ** fit.alpha, 0, 1);
}

export function conditionalCDF({ income, points, lowerBound }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const candidates = points.filter((point) => point.income >= lowerBound);
  if (candidates.length < 2) return null;

  const base = interpolateCDF(lowerBound, candidates);
  const value = interpolateCDF(income, candidates);
  if (base === null || value === null || base >= 1) return null;
  return clamp((value - base) / (1 - base), 0, 1);
}

export function percentileForDistribution({ income, distribution, stateTailPoints }) {
  const finiteResult = linearBinCDF({ income, counts: distribution.counts });
  if (finiteResult === null) return null;
  if (typeof finiteResult === "number") {
    return Object.freeze({
      percentile: clamp(finiteResult * 100, 0, 100),
      method: "direct_bin_interpolation",
      approximate: true,
    });
  }

  const localFit = fitMeanMatchedParetoTail({
    counts: distribution.counts,
    publishedMean: distribution.mean,
  });
  if (localFit) {
    const withinTail = paretoConditionalCDF(income, localFit);
    return Object.freeze({
      percentile: clamp(
        (finiteResult.cdfBelowBin + finiteResult.binShare * withinTail) * 100,
        0,
        100,
      ),
      method: "modeled_mean_matched_pareto_tail",
      approximate: true,
      parameters: Object.freeze({ alpha: localFit.alpha, topMean: localFit.topMean }),
    });
  }

  const stateTail = conditionalCDF({
    income,
    points: stateTailPoints,
    lowerBound: TOP_BIN_LOWER_BOUND,
  });
  if (stateTail === null) {
    return Object.freeze({
      percentile: finiteResult.cdfBelowBin * 100,
      method: "lower_bound_only",
      approximate: true,
    });
  }

  return Object.freeze({
    percentile: clamp(
      (finiteResult.cdfBelowBin + finiteResult.binShare * stateTail) * 100,
      0,
      100,
    ),
    method: "modeled_state_tail_fallback",
    approximate: true,
  });
}

export function weightedCDFPoints(records, requestedIncomes) {
  const sorted = records
    .filter((record) => Number.isFinite(record.income) && record.weight > 0)
    .toSorted((left, right) => left.income - right.income);
  const totalWeight = sum(sorted.map((record) => record.weight));
  if (totalWeight <= 0) return [];

  let recordIndex = 0;
  let cumulativeWeight = 0;
  return [...new Set(requestedIncomes)]
    .toSorted((left, right) => left - right)
    .map((income) => {
      while (recordIndex < sorted.length && sorted[recordIndex].income <= income) {
        cumulativeWeight += sorted[recordIndex].weight;
        recordIndex += 1;
      }
      return Object.freeze({ income, cdf: cumulativeWeight / totalWeight });
    });
}

export function interpolateCDF(income, points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const sorted = points.toSorted((left, right) => left.income - right.income);
  if (income <= sorted[0].income) return sorted[0].cdf;
  if (income >= sorted.at(-1).income) return sorted.at(-1).cdf;

  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    if (income > right.income) continue;
    const left = sorted[index - 1];
    const fraction = (income - left.income) / (right.income - left.income);
    return left.cdf + (right.cdf - left.cdf) * fraction;
  }
  return null;
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function stableJSONStringify(value) {
  return `${JSON.stringify(sortJSON(value))}\n`;
}

function sortJSON(value) {
  if (Array.isArray(value)) return value.map(sortJSON);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJSON(child)]),
  );
}

function validateBins(counts, edges) {
  if (!Array.isArray(counts) || counts.length + 1 !== edges.length) {
    throw new TypeError("Income-bin counts and edges do not align.");
  }
  if (counts.some((count) => !Number.isFinite(count) || count < 0)) {
    throw new TypeError("Income-bin counts must be finite nonnegative numbers.");
  }
}
