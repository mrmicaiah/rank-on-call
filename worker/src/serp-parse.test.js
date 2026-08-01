/**
 * Tests for serp-parse.js — run with: npm test  (node --test src/*.test.js)
 *
 * ⚠️ These run against the REAL captured API response at
 * `worker/test/fixtures/serp-plumber-decatur.json`, not synthetic data.
 *
 * That fixture was captured via the DataForSEO Playground, which unwraps the
 * envelope — so its top level IS a task object, which is exactly what parseSerp()
 * takes. It is fed straight in, with no wrapping. The envelope seam is covered
 * separately in dataforseo.test.js.
 *
 * A hand-written fixture would encode my assumptions about the response shape and
 * then confirm them, which is worse than no test — the whole point is to find out
 * whether the parser survives what DataForSEO actually returns.
 *
 * If the fixture is absent every test here SKIPS with a visible reason rather than
 * passing vacuously.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSerp, registrableDomain, LISTING_PLATFORMS } from "./serp-parse.js";

const FIXTURE_URL = new URL("../test/fixtures/serp-plumber-decatur.json", import.meta.url);

let fixture = null;
let loadError = null;
try {
  fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
} catch (err) {
  loadError = err.code === "ENOENT" ? "fixture not yet captured — see dispatch A" : `fixture unreadable: ${err.message}`;
}
const needsFixture = loadError ? { skip: loadError } : {};

/* The buyer's own site in this fixture. */
const SCANNED_URL = "https://myaplumber.com/";

/* ========================================================================== *
 *  Domain normalization — no fixture needed
 * ========================================================================== */

test("registrableDomain: strips scheme, www, path, port, trailing dot", () => {
  for (const input of [
    "https://www.myaplumber.com/services?x=1#top",
    "http://myaplumber.com",
    "MyAPlumber.com",
    "www.myaplumber.com.",
    "myaplumber.com:443",
  ]) {
    assert.equal(registrableDomain(input), "myaplumber.com", `failed on ${input}`);
  }
});

test("registrableDomain: a subdomain resolves to its registrable domain", () => {
  assert.equal(registrableDomain("shop.myaplumber.com"), "myaplumber.com");
});

test("registrableDomain: multi-label suffixes keep three labels", () => {
  assert.equal(registrableDomain("https://example.co.uk/x"), "example.co.uk");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
});

test("registrableDomain: unusable input returns empty, never throws", () => {
  for (const bad of [null, undefined, "", "   ", "localhost", "not a url", 42, {}]) {
    assert.equal(registrableDomain(bad), "");
  }
});

/* ========================================================================== *
 *  Extraction contract — against the real response
 * ========================================================================== */

test("local pack is extracted with BOTH rank fields", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });

  assert.ok(out.localPack.length > 0, "fixture should contain a local pack");
  for (const entry of out.localPack) {
    assert.equal(typeof entry.rankGroup, "number", "rankGroup must be preserved");
    assert.equal(typeof entry.rankAbsolute, "number", "rankAbsolute must be preserved");
  }

  // The local pack sits at the top of the page, so its absolute ranks lead.
  const absolutes = out.localPack.map((e) => e.rankAbsolute).sort((a, b) => a - b);
  assert.deepEqual(absolutes, [1, 2, 3], "local pack should occupy rank_absolute 1-3");
});

test("the two rank fields are genuinely different — first organic is group 1, absolute 4", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const first = out.organic.find((e) => e.rankGroup === 1);

  assert.ok(first, "there should be an organic result at rank_group 1");
  assert.equal(first.rankAbsolute, 4, "it should sit at rank_absolute 4, behind the 3-entry local pack");
  assert.notEqual(first.rankGroup, first.rankAbsolute, "conflating these two would be the bug");
});

test("the target is reported SEPARATELY in the local pack and in organic", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });

  assert.ok(out.targetInLocalPack, "myaplumber.com should be found in the local pack");
  assert.equal(out.targetInLocalPack.rankAbsolute, 1);

  assert.ok(out.targetOrganicRank, "myaplumber.com should also be found organically");
  assert.equal(out.targetOrganicRank.rankGroup, 1);

  // The point of the whole two-field design: one business, two true positions.
  assert.notDeepEqual(out.targetInLocalPack, out.targetOrganicRank);
});

test("target matching is by domain, never by title", needsFixture, () => {
  // A business whose title matches but whose domain does not must NOT be claimed.
  const out = parseSerp(fixture, { scannedUrl: "https://a-completely-different-domain.example/" });
  assert.equal(out.targetInLocalPack, null);
  assert.equal(out.targetOrganicRank, null);
});

test("no scannedUrl means no target claim, rather than a wrong one", needsFixture, () => {
  const out = parseSerp(fixture, {});
  assert.equal(out.targetInLocalPack, null);
  assert.equal(out.targetOrganicRank, null);
  assert.ok(out.organic.length > 0, "the rest of the extraction still works");
});

test("listing platforms present in the fixture are found", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const found = out.platformsFound.map((p) => p.platform);

  for (const expected of ["Yelp", "BBB", "Facebook"]) {
    assert.ok(found.includes(expected), `${expected} should be found in this fixture`);
  }
  for (const entry of out.platformsFound) {
    assert.ok(Object.values(LISTING_PLATFORMS).includes(entry.platform));
    assert.equal(typeof entry.rankAbsolute, "number");
  }
  assert.equal(new Set(found).size, found.length, "platforms must not be double-reported");

  // ⚠️ GBP must never be reported here — see the LISTING_PLATFORMS comment.
  // A "no Google Business Profile found" claim would be false on every report.
  assert.ok(!found.some((p) => /google/i.test(p)), "GBP is not a SERP-detectable platform");
});

test("⚠️ google.com is NOT a listing platform — GBP comes from targetInLocalPack", () => {
  assert.ok(!("google.com" in LISTING_PLATFORMS), "google.com must stay out of LISTING_PLATFORMS");
  assert.equal(Object.keys(LISTING_PLATFORMS).length, 9, "nine SERP-detectable platforms");
});

test("claimStamp comes from the API's own values", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const result = fixture.result[0];

  assert.equal(out.claimStamp.keyword, result.keyword);
  assert.equal(out.claimStamp.locationCode, result.location_code);
  assert.equal(out.claimStamp.checkUrl, result.check_url);
  assert.equal(out.claimStamp.datetime, result.datetime);

  // Every field the §4 stamp needs must actually be populated, or a ranking claim
  // cannot be made at all.
  assert.ok(out.claimStamp.keyword, "query");
  assert.ok(out.claimStamp.locationCode, "location");
  assert.ok(out.claimStamp.datetime, "date measured");
});

test("a rating carries its scale, not just its value", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const rated = out.localPack.filter((e) => e.ratingValue !== null);

  assert.ok(rated.length > 0, "the local pack should carry ratings");
  for (const entry of rated) {
    // "rated 4.9" is meaningless without knowing 4.9 out of what.
    assert.equal(typeof entry.ratingMax, "number", "ratingMax must accompany ratingValue");
    assert.ok(entry.ratingValue <= entry.ratingMax, "a rating cannot exceed its own scale");
  }
});

test("itemTypes is carried through as a page manifest", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  assert.ok(Array.isArray(out.itemTypes));
  assert.ok(out.itemTypes.includes("local_pack"));
  assert.ok(out.itemTypes.includes("organic"));
});

/* ========================================================================== *
 *  ⚠️ PRIVACY — the tests that matter most
 * ========================================================================== */

/* Pull every value the API returned under a forbidden key, at any depth. Deriving
   the forbidden strings FROM the fixture rather than hardcoding them means this
   test keeps working if the fixture is ever recaptured, and it cannot be
   weakened by my not knowing what is in there. */
function collectForbiddenValues(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectForbiddenValues(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if ((key === "description" || key === "phone") && typeof value === "string" && value.trim()) {
        out.push(value.trim());
      }
      if (key === "highlighted" && Array.isArray(value)) {
        for (const fragment of value) if (typeof fragment === "string" && fragment.trim()) out.push(fragment.trim());
      }
      collectForbiddenValues(value, out);
    }
  }
  return out;
}

test("⚠️ NO review quote, phone, or address from any forbidden field appears in the output", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const serialized = JSON.stringify(out);

  const forbidden = collectForbiddenValues(fixture);
  assert.ok(forbidden.length > 0, "the fixture must actually contain forbidden fields, or this test proves nothing");

  const leaked = forbidden.filter((value) => value.length >= 8 && serialized.includes(value));
  assert.deepEqual(leaked, [], `parser leaked forbidden content: ${JSON.stringify(leaked.slice(0, 3))}`);
});

test("⚠️ the known fixture phone number and street address are absent", needsFixture, () => {
  const serialized = JSON.stringify(parseSerp(fixture, { scannedUrl: SCANNED_URL }));

  // Belt-and-braces against the two strings named in the dispatch, in several
  // shapes, in case the fixture formats them differently from the report.
  for (const needle of [
    "(256) 301-5529", "256-301-5529", "2563015529",
    "2250 Old Moulton Rd", "Old Moulton", "35601",
  ]) {
    assert.ok(!serialized.includes(needle), `output must not contain "${needle}"`);
  }
});

test("⚠️ output keys are the allowlist and nothing else", needsFixture, () => {
  const out = parseSerp(fixture, { scannedUrl: SCANNED_URL });

  assert.deepEqual(Object.keys(out).sort(), [
    "claimStamp", "itemTypes", "localPack", "organic",
    "platformsFound", "targetInLocalPack", "targetOrganicRank",
  ]);

  for (const entry of out.localPack) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "cid", "domain", "rankAbsolute", "rankGroup",
      "ratingMax", "ratingType", "ratingValue", "ratingVotes", "title",
    ]);
  }
  for (const entry of out.organic) {
    assert.deepEqual(Object.keys(entry).sort(), ["domain", "rankAbsolute", "rankGroup", "title", "url"]);
  }
});

test("⚠️ a raw item is never passed through, even if the API adds new fields", needsFixture, () => {
  // Simulate DataForSEO adding a field we have never seen. An allowlist ignores
  // it; a spread would ship it. This is the regression that would otherwise only
  // surface when the API changed under us.
  const mutated = JSON.parse(JSON.stringify(fixture));
  const items = mutated.result[0].items;
  for (const item of items) {
    item.some_future_pii_field = "REGRESSION_CANARY_owner@example.com 555-0100";
  }

  const serialized = JSON.stringify(parseSerp(mutated, { scannedUrl: SCANNED_URL }));
  assert.ok(!serialized.includes("REGRESSION_CANARY"), "an unknown field must never be carried through");
});

/* ========================================================================== *
 *  Degenerate input — no fixture needed
 * ========================================================================== */

test("an empty or malformed body yields an honestly empty extraction, never a throw", () => {
  for (const task of [null, undefined, {}, { result: [] }, { result: null }, { result: [null] }]) {
    const out = parseSerp(task, { scannedUrl: SCANNED_URL });
    assert.deepEqual(out.localPack, []);
    assert.deepEqual(out.organic, []);
    assert.equal(out.targetInLocalPack, null);
    assert.equal(out.targetOrganicRank, null);
    assert.deepEqual(out.itemTypes, []);
  }
});
