import assert from "node:assert/strict";
import test from "node:test";

import {
  INCOME_VARIABLES,
  aggregateIncomeRecord,
  dominantStatesFromRelationship,
  geographyFromID,
  rowsToObjects,
} from "./generate-census-snapshot.mjs";

test("income variable contract contains four groups of twenty leaf bins", () => {
  assert.equal(INCOME_VARIABLES.length, 80);
  assert.equal(new Set(INCOME_VARIABLES).size, 80);
  assert.equal(INCOME_VARIABLES[0], "B19325_006E");
  assert.equal(INCOME_VARIABLES.at(-1), "B19325_095E");
});

test("aggregates matching leaf bins across sex and work-experience groups", () => {
  const row = { NAME: "Example", B19313_001E: "200000" };
  for (const variable of INCOME_VARIABLES) row[variable] = "0";
  for (const variable of ["B19325_006E", "B19325_029E", "B19325_053E", "B19325_076E"]) {
    row[variable] = "10";
  }

  const record = aggregateIncomeRecord(row, { state: "CA" });
  assert.equal(record.counts[0], 40);
  assert.equal(record.populationWithIncome, 40);
  assert.equal(record.mean, 5_000);
  assert.equal(record.state, "CA");
});

test("chooses the state containing the largest ZCTA area share", () => {
  const relationship = [
    "GEOID_ZCTA5_20|GEOID_COUNTY_20|AREALAND_PART|AREAWATER_PART",
    "12345|06001|100|0",
    "12345|32001|101|0",
    "90210|06037|200|5",
  ].join("\n");
  const mapping = dominantStatesFromRelationship(relationship);
  assert.equal(mapping.get("12345"), "NV");
  assert.equal(mapping.get("90210"), "CA");
});

test("turns Census array responses into keyed objects", () => {
  assert.deepEqual(
    rowsToObjects([
      ["NAME", "B19313_001E", "state"],
      ["California", "100", "06"],
    ]),
    [{ NAME: "California", B19313_001E: "100", state: "06" }],
  );
});

test("selects only U.S., state, and ZCTA bulk summary rows", () => {
  assert.deepEqual(geographyFromID("0100000US"), { kind: "us", key: "US" });
  assert.deepEqual(geographyFromID("0400000US06"), { kind: "state", key: "06" });
  assert.deepEqual(geographyFromID("860Z200US90210"), { kind: "zcta", key: "90210" });
  assert.deepEqual(geographyFromID("8600000US90210"), { kind: "zcta", key: "90210" });
  assert.equal(geographyFromID("0500000US06037"), null);
});
