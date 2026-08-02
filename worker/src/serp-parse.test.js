/**
 * Tests for serp-parse.js — run with: npm test  (node --test src/*.test.js)
 *
 * ⚠️ These run against REAL captured API responses, not synthetic data:
 *
 *   serp-plumber-decatur.json   STRONG performer — target #1 in the local pack
 *                               and #1 organically. Proves extraction works.
 *   serp-gutters-decatur.json   WEAK performer — target on page one but ABSENT
 *                               from the local pack. Proves the headline finding.
 *
 * Both are kept deliberately; they cover opposite outcomes. See
 * test/fixtures/README.md before consolidating anything.
 *
 * Both were captured via the DataForSEO Playground, which unwraps the envelope —
 * so their top level IS a task object, which is exactly what parseSerp() takes.
 * They are fed straight in, with no wrapping. The envelope seam is covered
 * separately in dataforseo.test.js.
 *
 * A hand-written fixture would encode my assumptions about the response shape and
 * then confirm them, which is worse than no test — the whole point is to find out
 * whether the parser survives what DataForSEO actually returns.
 *
 * If a fixture is absent, the tests that need it SKIP with a visible reason rather
 * than passing vacuously.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSerp, registrableDomain, LISTING_PLATFORMS } from "./serp-parse.js";

function loadFixture(name) {
  try {
    return { data: JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8")), skip: null };
  } catch (err) {
    return {
      data: null,
      skip: err.code === "ENOENT" ? `${name} not yet captured` : `${name} unreadable: ${err.message}`,
    };
  }
}

/* STRONG performer — target is #1 in the local pack and #1 organically. */
const plumber = loadFixture("serp-plumber-decatur.json");
const fixture = plumber.data;
const needsFixture = plumber.skip ? { skip: plumber.skip } : {};
const SCANNED_URL = "https://myaplumber.com/";

/* WEAK performer — target is on page one but ABSENT from the local pack. This is
   the shape the product exists to find; see test/fixtures/README.md. */
const gutters = loadFixture("serp-gutters-decatur.json");
const guttersFixture = gutters.data;
const needsGutters = gutters.skip ? { skip: gutters.skip } : {};
const GUTTERS_URL = "https://bettertongutters.com/";

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
/**
 * ⚠️ Values that legitimately reach the output through an ALLOWLISTED field.
 *
 * Google's `highlighted` array is made of fragments OF the title and snippet, so a
 * highlighted fragment can be a verbatim substring of a `title` the parser
 * deliberately emits. When that happens the value arrived via `title` — which is on
 * the allowlist and is not personal data — not via `highlighted`.
 *
 * Without this, the sweep reports a false positive on any such overlap. The gutters
 * fixture has one: BBB's highlighted[0] is "Gutters near Decatur, AL", which is
 * also a substring of its title "BBB Accredited Gutters near Decatur, AL | ...".
 *
 * This narrows the sweep, so it is worth being explicit that it does NOT weaken it:
 * a forbidden value is still a leak unless some allowlisted source field contains
 * it in full. The control test below proves the sweep can still fail.
 */
function allowlistedSourceText(task) {
  const items = task?.result?.[0]?.items ?? [];
  return items.flatMap((i) => [i.title, i.url, i.domain]).filter((v) => typeof v === "string");
}

/**
 * ⚠️ Does `value` occur in the SERIALIZED output?
 *
 * A naive `serialized.includes(value)` misses multi-line values, and the local_pack
 * descriptions — the ones carrying the verbatim review quotes — are all multi-line.
 * `JSON.stringify` renders their newlines as an escaped `\n` and their inner quotes
 * as `\"`, so the raw captured string is NOT a substring of the serialized output
 * even when it leaked in full.
 *
 * Both forms are therefore checked. This was found by the control test below
 * failing on a planted value that should have been caught — which is the entire
 * reason the control exists.
 */
function occursIn(serialized, value) {
  if (serialized.includes(value)) return true;
  const escaped = JSON.stringify(value).slice(1, -1); // inner escaped form, no wrapping quotes
  return serialized.includes(escaped);
}

/* Forbidden values that reached the output and are NOT explained by an allowlisted field. */
function sweepForLeaks(task, serialized) {
  const explained = allowlistedSourceText(task);
  return collectForbiddenValues(task)
    .filter((value) => value.length >= 8)
    .filter((value) => occursIn(serialized, value))
    .filter((value) => !explained.some((source) => source.includes(value)));
}

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

  assert.ok(collectForbiddenValues(fixture).length > 0, "the fixture must contain forbidden fields, or this proves nothing");
  const leaked = sweepForLeaks(fixture, serialized);
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

/* ========================================================================== *
 *  ⚠️ THE WEAK PERFORMER — target absent from the local pack
 *
 *  The strong-performer fixture proves extraction works. This one proves the
 *  product's headline finding survives real data: a business on page one that is
 *  invisible in the three-pack. Everything downstream depends on that shape being
 *  a FINDING rather than a crash or a silence.
 * ========================================================================== */

test("⚠️ NOT IN THE THREE-PACK: targetInLocalPack is null while the target ranks organically", needsGutters, () => {
  const out = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });

  // Strictly null. Not undefined (which reads as "we never looked"), not an empty
  // object (which a truthiness check would treat as "found"), and not a throw.
  // A consumer must be able to distinguish "absent from the pack" from "no data".
  assert.strictEqual(out.targetInLocalPack, null, "must be exactly null");
  assert.ok(!("rankGroup" in (out.targetInLocalPack ?? {})), "no partial object");

  // …while the business is demonstrably present on the page.
  assert.deepEqual(out.targetOrganicRank, { rankGroup: 5, rankAbsolute: 9 });
});

test("the local pack still extracts all three competitors when the target is absent from it", needsGutters, () => {
  const out = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });

  assert.equal(out.localPack.length, 3);
  assert.deepEqual(out.localPack.map((e) => e.rankAbsolute), [1, 2, 3]);
  assert.deepEqual(out.localPack.map((e) => e.domain), [
    "www.usaroofing.us",
    "qualitychoice-roofing.com",
    "www.offdutyguttersunlimitedllc.com",
  ]);

  // The target must not appear among them under any normalization.
  const target = registrableDomain(GUTTERS_URL);
  for (const entry of out.localPack) {
    assert.notEqual(registrableDomain(entry.domain), target);
  }
});

test("platformsFound picks up the real directories and nothing else", needsGutters, () => {
  const out = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });
  const byName = Object.fromEntries(out.platformsFound.map((p) => [p.platform, p.rankAbsolute]));

  assert.equal(byName.Yelp, 5);
  assert.equal(byName.Facebook, 7);
  assert.equal(byName.BBB, 13);

  // ⚠️ A retailer, a national installer, a content site and a franchise all appear
  // in this SERP. None is a listing platform, and reporting one as a "listing"
  // would be a finding about nothing.
  const domains = out.platformsFound.map((p) => p.domain);
  for (const notAPlatform of ["lowes.com", "truteam.com", "ecowatch.com", "mrgutter.com"]) {
    assert.ok(!domains.includes(notAPlatform), `${notAPlatform} is not a listing platform`);
  }
});

test("⚠️ derived privacy sweep against the weak-performer fixture", needsGutters, () => {
  const out = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });
  const serialized = JSON.stringify(out);

  // Derived from the file, never hardcoded — so this keeps working if the fixture
  // is ever recaptured, and cannot be weakened by not knowing what is in it.
  assert.ok(collectForbiddenValues(guttersFixture).length > 0, "the fixture must contain forbidden fields, or this proves nothing");
  const leaked = sweepForLeaks(guttersFixture, serialized);
  assert.deepEqual(leaked, [], `parser leaked forbidden content: ${JSON.stringify(leaked.slice(0, 3))}`);
});

test("⚠️ the organic `links` sitelink array never reaches the output", needsGutters, () => {
  // The plumber fixture had no `links` field anywhere, so the allowlist has never
  // been tested against it. It is not personal data — it is a field the allowlist
  // has simply never seen, which is exactly the case an allowlist exists for.
  const raw = JSON.stringify(guttersFixture);
  assert.ok(raw.includes('"links"'), "the fixture must actually contain a links array");

  const out = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });
  assert.ok(!JSON.stringify(out).includes('"links"'), "links must not survive the allowlist");

  for (const entry of out.organic) {
    assert.deepEqual(Object.keys(entry).sort(), ["domain", "rankAbsolute", "rankGroup", "title", "url"]);
  }
});

test("both fixtures parse with the same code path and disagree only where they should", needsFixture, () => {
  if (gutters.skip) return; // needs both; the individual suites cover each alone.

  const strong = parseSerp(fixture, { scannedUrl: SCANNED_URL });
  const weak = parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL });

  // Same shape, opposite outcome — which is the entire reason both are kept.
  assert.deepEqual(Object.keys(strong).sort(), Object.keys(weak).sort());
  assert.ok(strong.targetInLocalPack, "strong performer is in the pack");
  assert.equal(weak.targetInLocalPack, null, "weak performer is not");
  assert.ok(strong.targetOrganicRank && weak.targetOrganicRank, "both rank organically");
});

test("⚠️ CONTROL: the narrowed privacy sweep can still detect a real leak", needsGutters, () => {
  // A sweep that has been narrowed must prove it did not become unfalsifiable.
  // Plant the ACTUAL forbidden values the parser withholds — not paraphrases of
  // them — and the sweep has to catch every one.
  const clean = JSON.stringify(parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL }));
  assert.deepEqual(sweepForLeaks(guttersFixture, clean), [], "the real output is clean");

  const explained = allowlistedSourceText(guttersFixture);
  const shouldNeverAppear = collectForbiddenValues(guttersFixture)
    .filter((value) => value.length >= 8)
    .filter((value) => !explained.some((source) => source.includes(value)));

  assert.ok(shouldNeverAppear.length >= 10, `expected many unexplained forbidden values, got ${shouldNeverAppear.length}`);

  for (const value of shouldNeverAppear) {
    // Plant the value the way a real leak would appear — JSON-escaped inside the output.
    const planted = `${clean}${JSON.stringify(value).slice(1, -1)}`;
    const leaks = sweepForLeaks(guttersFixture, planted);
    assert.ok(leaks.includes(value), `the sweep must catch a planted ${JSON.stringify(value.slice(0, 40))}…`);
  }
});

test("⚠️ the sweep matches WHOLE captured values — a partial extraction would slip past", needsGutters, () => {
  // Recording a known limitation rather than pretending it away. The sweep asks
  // "did this exact captured value survive?", so a parser that emitted only the
  // review quote pulled OUT of a local_pack description would not be caught by it.
  // The allowlist is what prevents that; this sweep is the second line, not the first.
  const clean = JSON.stringify(parseSerp(guttersFixture, { scannedUrl: GUTTERS_URL }));
  const quoteFragment = "The crew was quick and the finished product looks great";

  assert.ok(!clean.includes(quoteFragment), "the parser does not emit it — which is what actually protects us");
  assert.deepEqual(
    sweepForLeaks(guttersFixture, `${clean}"${quoteFragment}"`),
    [],
    "…but the sweep alone would not have caught a fragment, hence the allowlist"
  );
});
