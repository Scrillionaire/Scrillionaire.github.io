import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { routeForPath } from "../site/assets/routes.js";

const appID = "4AM5US9G8B.ai.scrillionaire.Scrillionaire";
const requiredPaths = ["/u/*", "/groups/new", "/groups/*", "/invite/*", "/plaid/*"];
const aasaPath = new URL("../site/.well-known/apple-app-site-association", import.meta.url);
const aasa = JSON.parse(await readFile(aasaPath, "utf8"));
const details = aasa.applinks?.details;

assert.equal(Array.isArray(details), true, "AASA applinks.details must be an array");
assert.deepEqual(
  details[0].components.map((component) => component["/"]),
  requiredPaths,
  "AASA must retain every supported universal-link route",
);
assert.equal(details.length, 1, "AASA must contain one production app entry");
assert.deepEqual(details[0].appIDs, [appID]);
assert.deepEqual(details[0].components.map((component) => component["/"]), requiredPaths);
assert.ok((await stat(aasaPath)).size < 128 * 1024, "AASA must remain under 128 KiB");

assert.equal((await readFile(new URL("../site/CNAME", import.meta.url), "utf8")).trim(), "scrillionaire.ai");
assert.equal(routeForPath("/").kind, "home");
assert.equal(routeForPath("/u/Valid_Handle-1").kind, "profile");
assert.equal(routeForPath("/u/_invalid").kind, "not-found");
assert.equal(routeForPath("/u/too-long-handle-12345678901234567890").kind, "not-found");
assert.equal(routeForPath("/groups/new").kind, "group-new");
assert.equal(routeForPath("/groups/group_123").kind, "group");
assert.equal(routeForPath("/invite/token~123").kind, "invite");
assert.equal(routeForPath("/invite/not%2Fa%2Ftoken").kind, "not-found");
assert.equal(routeForPath("/unknown").kind, "not-found");
