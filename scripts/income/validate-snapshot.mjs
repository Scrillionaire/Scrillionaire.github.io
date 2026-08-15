#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { sha256, sum } from "./distributions.mjs";

const base = new URL("../../site/data/income/2024/", import.meta.url);
const manifestText = await readFile(new URL("manifest.json", base), "utf8");
const manifest = JSON.parse(manifestText);
const datasetText = await readFile(new URL(manifest.dataset.url, base), "utf8");
const dataset = JSON.parse(datasetText);

assert.equal(manifest.schemaVersion, 1);
assert.equal(dataset.schemaVersion, 1);
assert.equal(manifest.censusVintage, dataset.census.vintage);
assert.equal(manifest.dollarYear, dataset.census.dollarYear);
assert.equal(manifest.dataset.bytes, Buffer.byteLength(datasetText));
assert.equal(manifest.dataset.sha256, sha256(datasetText));
assert.equal(dataset.binEdges.length, 21);
assert.equal(dataset.binEdges.at(-1), null);

validateRecord(dataset.unitedStates, "United States", { expectsState: false });

const states = Object.entries(dataset.states);
const zctas = Object.entries(dataset.zctas);
assert.equal(states.length, manifest.records.states);
assert.equal(zctas.length, manifest.records.zctas);
assert.ok(states.length >= 51, "The snapshot must include states and the District of Columbia.");
assert.ok(zctas.length > 30_000, "The snapshot must include the national ZCTA set.");

for (const [state, record] of states) {
  assert.match(state, /^[A-Z]{2}$/);
  assert.equal(record.s, state);
  validateRecord(record, state);
}

for (const [zcta, record] of zctas) {
  assert.match(zcta, /^\d{5}$/);
  assert.ok(dataset.states[record.s], `${zcta} refers to unknown state ${record.s}.`);
  validateRecord(record, zcta);
}

function validateRecord(record, label, { expectsState = true } = {}) {
  assert.ok(record, `${label} is missing.`);
  assert.equal(record.c.length, 20, `${label} must contain twenty income bins.`);
  assert.ok(record.c.every((count) => Number.isInteger(count) && count >= 0));
  assert.equal(sum(record.c), record.p, `${label} population must equal its bin sum.`);
  assert.ok(record.p > 0, `${label} must have a positive comparison population.`);
  assert.ok(record.m === null || (Number.isInteger(record.m) && record.m >= 0));
  if (expectsState) assert.match(record.s, /^[A-Z]{2}$/);
  if (record.t) {
    assert.ok(record.t.a > 1, `${label} Pareto alpha must be greater than one.`);
    assert.ok(record.t.m > 100_000, `${label} top-bin mean must exceed its lower bound.`);
  }
}
