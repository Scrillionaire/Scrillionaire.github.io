#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  INCOME_BIN_EDGES,
  fitMeanMatchedParetoTail,
  sha256,
  stableJSONStringify,
  sum,
} from "./distributions.mjs";

const DEFAULT_YEAR = "2024";
const API_BATCH_SIZE = 20;
const INCOME_GROUP_STARTS = Object.freeze([6, 29, 53, 76]);
const AGGREGATE_INCOME_VARIABLE = "B19313_001E";
const ZCTA_COUNTY_RELATIONSHIP_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
const BULK_BASE_URL =
  "https://www2.census.gov/programs-surveys/acs/summary_file";

const STATE_ABBREVIATIONS = Object.freeze({
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
});

export const INCOME_VARIABLES = Object.freeze(
  INCOME_GROUP_STARTS.flatMap((start) =>
    Array.from({ length: 20 }, (_, offset) => `B19325_${pad(start + offset)}E`),
  ),
);

export function aggregateIncomeRecord(row, { state } = {}) {
  const counts = Array(20).fill(0);
  for (const start of INCOME_GROUP_STARTS) {
    for (let offset = 0; offset < 20; offset += 1) {
      counts[offset] += censusCount(row[`B19325_${pad(start + offset)}E`]);
    }
  }

  const populationWithIncome = sum(counts);
  if (populationWithIncome <= 0) return null;
  const aggregateIncome = censusEstimate(row[AGGREGATE_INCOME_VARIABLE]);
  const mean = aggregateIncome === null ? null : aggregateIncome / populationWithIncome;
  const distribution = { counts, mean };
  const tail = mean === null ? null : fitMeanMatchedParetoTail({ counts, publishedMean: mean });

  return Object.freeze({
    name: row.NAME,
    state: state ?? null,
    counts,
    mean: mean === null ? null : Math.round(mean),
    populationWithIncome,
    tail: tail
      ? Object.freeze({
          method: "mean_matched_pareto",
          alpha: rounded(tail.alpha, 8),
          topMean: Math.round(tail.topMean),
        })
      : null,
  });
}

export function dominantStatesFromRelationship(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const headers = lines[0].split("|");
  const zctaIndex = headers.indexOf("GEOID_ZCTA5_20");
  const countyIndex = headers.indexOf("GEOID_COUNTY_20");
  const landIndex = headers.indexOf("AREALAND_PART");
  const waterIndex = headers.indexOf("AREAWATER_PART");
  if ([zctaIndex, countyIndex, landIndex, waterIndex].some((index) => index < 0)) {
    throw new Error("The Census ZCTA/county relationship schema is not recognized.");
  }

  const dominant = new Map();
  for (const line of lines.slice(1)) {
    const values = line.split("|");
    const zcta = values[zctaIndex];
    const county = values[countyIndex];
    if (!/^\d{5}$/.test(zcta) || !/^\d{5}$/.test(county)) continue;
    const state = STATE_ABBREVIATIONS[county.slice(0, 2)];
    if (!state) continue;
    const area = Number(values[landIndex] ?? 0) + Number(values[waterIndex] ?? 0);
    const existing = dominant.get(zcta);
    if (!existing || area > existing.area || (area === existing.area && state < existing.state)) {
      dominant.set(zcta, { state, area });
    }
  }
  return new Map([...dominant].map(([zcta, value]) => [zcta, value.state]));
}

export function rowsToObjects(payload) {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const [headers, ...rows] = payload;
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

export function geographyFromID(geoID) {
  if (geoID === "0100000US") return Object.freeze({ kind: "us", key: "US" });
  if (/^0400000US\d{2}$/.test(geoID)) {
    return Object.freeze({ kind: "state", key: geoID.slice(-2) });
  }
  if (/^860(?:0000|Z200)US\d{5}$/.test(geoID)) {
    return Object.freeze({ kind: "zcta", key: geoID.slice(-5) });
  }
  return null;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const year = options.year ?? DEFAULT_YEAR;
  const outputDirectory = path.resolve(
    options.output ?? path.join(siteRoot(), "data", "income", year),
  );
  const apiKey = process.env.CENSUS_API_KEY?.trim();
  const source = options.source ?? "bulk";

  const [relationshipText, geographyRows] = await Promise.all([
    fetchText(ZCTA_COUNTY_RELATIONSHIP_URL),
    source === "api"
      ? fetchAPIGeographies(year, apiKey)
      : fetchBulkGeographies(year),
  ]);
  const dominantStates = dominantStatesFromRelationship(relationshipText);
  const { usRows, stateRows, zctaRows } = geographyRows;

  const us = aggregateIncomeRecord(usRows.values().next().value ?? {});
  if (!us) throw new Error("The Census U.S. income distribution is empty.");

  const states = {};
  for (const [fips, row] of [...stateRows].toSorted(([left], [right]) => left.localeCompare(right))) {
    const abbreviation = STATE_ABBREVIATIONS[fips];
    if (!abbreviation) continue;
    const record = aggregateIncomeRecord(row, { state: abbreviation });
    if (record) states[abbreviation] = compactRecord(record);
  }

  const zctas = {};
  for (const [zcta, row] of [...zctaRows].toSorted(([left], [right]) => left.localeCompare(right))) {
    const state = dominantStates.get(zcta);
    if (!state || !states[state]) continue;
    const record = aggregateIncomeRecord(row, { state });
    if (record) zctas[zcta] = compactRecord(record);
  }

  const dataset = Object.freeze({
    schemaVersion: 1,
    census: Object.freeze({
      product: "ACS 5-year detailed tables",
      vintage: Number(year),
      dollarYear: Number(year),
      universe: "Population age 15 and older with personal income",
      incomeTable: "B19325",
      aggregateIncomeTable: "B19313",
      zctaRelationshipVintage: 2020,
    }),
    binEdges: INCOME_BIN_EDGES.map((value) => (Number.isFinite(value) ? value : null)),
    unitedStates: compactRecord(us),
    states,
    zctas,
  });

  const datasetText = stableJSONStringify(dataset);
  const datasetFileName = "distributions.json";
  const generatedAt = new Date(
    process.env.SOURCE_DATE_EPOCH
      ? Number(process.env.SOURCE_DATE_EPOCH) * 1_000
      : Date.now(),
  ).toISOString();
  const manifest = Object.freeze({
    schemaVersion: 1,
    generatedAt,
    censusVintage: Number(year),
    dollarYear: Number(year),
    dataset: Object.freeze({
      url: datasetFileName,
      bytes: Buffer.byteLength(datasetText),
      sha256: sha256(datasetText),
    }),
    records: Object.freeze({ states: Object.keys(states).length, zctas: Object.keys(zctas).length }),
    sources: Object.freeze([
      `https://api.census.gov/data/${year}/acs/acs5/groups/B19325.html`,
      `https://api.census.gov/data/${year}/acs/acs5/groups/B19313.html`,
      `${BULK_BASE_URL}/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b19325.dat`,
      `${BULK_BASE_URL}/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b19313.dat`,
      `${BULK_BASE_URL}/${year}/table-based-SF/documentation/ACS${year}_Table_Based_SF_Documentation.pdf`,
      ZCTA_COUNTY_RELATIONSHIP_URL,
      "https://arxiv.org/abs/1709.09705",
    ]),
  });

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, datasetFileName), datasetText);
  await writeFile(path.join(outputDirectory, "manifest.json"), stableJSONStringify(manifest));

  process.stdout.write(
    `Generated ${Object.keys(zctas).length} ZCTAs and ${Object.keys(states).length} states in ${outputDirectory}\n`,
  );
}

async function fetchGeography(year, geography, geographyKey, apiKey) {
  const variables = ["NAME", AGGREGATE_INCOME_VARIABLE, ...INCOME_VARIABLES];
  const batches = [];
  for (let index = 0; index < variables.length; index += API_BATCH_SIZE) {
    batches.push(variables.slice(index, index + API_BATCH_SIZE));
  }

  const merged = new Map();
  for (const batch of batches) {
    const url = censusURL(year, batch, geography, apiKey);
    const payload = await fetchJSON(url);
    for (const row of rowsToObjects(payload)) {
      const key = row[geographyKey];
      if (!key) throw new Error(`Census response did not include ${geographyKey}.`);
      merged.set(key, { ...(merged.get(key) ?? {}), ...row });
    }
  }
  return merged;
}

async function fetchAPIGeographies(year, apiKey) {
  if (!apiKey) {
    throw new Error("CENSUS_API_KEY is required when --source api is selected.");
  }
  await validateCensusSchema(year, apiKey);
  const [usRows, stateRows, zctaRows] = await Promise.all([
    fetchGeography(year, "us:*", "us", apiKey),
    fetchGeography(year, "state:*", "state", apiKey),
    fetchGeography(year, "zip code tabulation area:*", "zip code tabulation area", apiKey),
  ]);
  return { usRows, stateRows, zctaRows };
}

async function fetchBulkGeographies(year) {
  const base = `${BULK_BASE_URL}/${year}/table-based-SF/data/5YRData`;
  const records = new Map();
  const incomeVariables = INCOME_VARIABLES.map(apiVariableToBulkVariable);

  await streamPipeTable(`${base}/acsdt5y${year}-b19325.dat`, (row) => {
    const geography = geographyFromID(row.GEO_ID);
    if (!geography) return;
    const record = records.get(row.GEO_ID) ?? { NAME: displayName(geography) };
    for (let index = 0; index < INCOME_VARIABLES.length; index += 1) {
      record[INCOME_VARIABLES[index]] = row[incomeVariables[index]];
    }
    records.set(row.GEO_ID, record);
  });

  await streamPipeTable(`${base}/acsdt5y${year}-b19313.dat`, (row) => {
    const geography = geographyFromID(row.GEO_ID);
    if (!geography) return;
    const record = records.get(row.GEO_ID) ?? { NAME: displayName(geography) };
    record[AGGREGATE_INCOME_VARIABLE] = row.B19313_E001;
    records.set(row.GEO_ID, record);
  });

  const usRows = new Map();
  const stateRows = new Map();
  const zctaRows = new Map();
  for (const [geoID, row] of records) {
    const geography = geographyFromID(geoID);
    if (geography?.kind === "us") usRows.set(geography.key, row);
    else if (geography?.kind === "state") stateRows.set(geography.key, row);
    else if (geography?.kind === "zcta") zctaRows.set(geography.key, row);
  }
  return { usRows, stateRows, zctaRows };
}

async function streamPipeTable(url, visit) {
  const response = await fetch(url, { headers: { Accept: "text/plain" } });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}.`);
  }

  const lines = createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
  let headers;
  for await (const line of lines) {
    if (!headers) {
      headers = line.split("|");
      continue;
    }
    if (!line) continue;
    const values = line.split("|");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    visit(row);
  }
  if (!headers?.includes("GEO_ID")) {
    throw new Error(`The Census table ${url} did not contain GEO_ID.`);
  }
}

async function validateCensusSchema(year, apiKey) {
  const suffix = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const [incomeGroup, aggregateGroup] = await Promise.all([
    fetchJSON(`https://api.census.gov/data/${year}/acs/acs5/groups/B19325.json${suffix}`),
    fetchJSON(`https://api.census.gov/data/${year}/acs/acs5/groups/B19313.json${suffix}`),
  ]);
  for (const variable of INCOME_VARIABLES) {
    if (!incomeGroup.variables?.[variable]?.label) {
      throw new Error(`Census variable ${variable} is missing from B19325.`);
    }
  }
  if (!aggregateGroup.variables?.[AGGREGATE_INCOME_VARIABLE]?.label) {
    throw new Error(`Census variable ${AGGREGATE_INCOME_VARIABLE} is missing from B19313.`);
  }
}

function censusURL(year, variables, geography, apiKey) {
  const query = new URLSearchParams({ get: variables.join(","), for: geography });
  if (apiKey) query.set("key", apiKey);
  return `https://api.census.gov/data/${year}/acs/acs5?${query}`;
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}.`);
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const excerpt = body.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`GET ${url} returned non-JSON content: ${excerpt}`);
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}.`);
  return response.text();
}

function compactRecord(record) {
  return Object.freeze({
    n: record.name,
    s: record.state,
    c: record.counts,
    m: record.mean,
    p: record.populationWithIncome,
    t: record.tail
      ? Object.freeze({ a: record.tail.alpha, m: record.tail.topMean })
      : null,
  });
}

function parseArguments(argumentsList) {
  const result = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--year") result.year = argumentsList[++index];
    else if (argument === "--output") result.output = argumentsList[++index];
    else if (argument === "--source") result.source = argumentsList[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (result.source && !["api", "bulk"].includes(result.source)) {
    throw new Error("--source must be either api or bulk.");
  }
  return result;
}

function siteRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "site");
}

function censusCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function censusEstimate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pad(value) {
  return String(value).padStart(3, "0");
}

function rounded(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function apiVariableToBulkVariable(variable) {
  const match = /^(B\d+)_([0-9]{3})([EM])$/.exec(variable);
  if (!match) throw new Error(`Unsupported Census variable name: ${variable}`);
  return `${match[1]}_${match[3]}${match[2]}`;
}

function displayName(geography) {
  if (geography.kind === "us") return "United States";
  if (geography.kind === "state") {
    return STATE_ABBREVIATIONS[geography.key] ?? geography.key;
  }
  return `ZCTA ${geography.key}`;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
