/**
 * Tests for report-precheck.js — run with: node --test
 * Fixtures: one report that passes everything, one deliberately corrupted per code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { precheckReport, MIN_REPORT_CHARS } from "./report-precheck.js";

// A clean, full report that should pass every check. Kept free of phones,
// addresses, placeholders, and banned words on purpose; its "Where you show up"
// section carries a quoted query, a location, and a date.
const PASS = `# Deep Dive — Your Online Presence

Prepared for a real business. Every finding below is checkable.

## Fix these first

Three things are costing you calls right now, in order of how much they hurt:

- Your homepage shows broken counters reading "0+ installs" — every visitor is told you have finished nothing.
- Search engines see two different versions of your business name, so none of them wins.
- You are not on the first page for your own core service in your own city.

## Your Google Business Profile

Your verified Google rating is 4.7 with 240 reviews — a genuinely strong signal. The gap is that your profile lists an older category than the work you actually want, which quietly steers you away from the jobs you care about most.

## Your website

The build itself is fine: secure, quick, and readable on a phone. The problem is the content. Those broken counters sit near the top of the page, and the headline claims about reviews are not backed up anywhere a customer can check.

## Name, address, and phone consistency

Search engines need to see the same business details everywhere they look. Right now your name shows up two different ways across your own pages and listings, and that disagreement makes it harder to rank you. Getting every listing to match is unglamorous and it moves the needle.

## Where you show up

We searched "gutter installation Nashville" from Nashville, TN on July 24, 2026, and you came up sixth. Above you sit a national brand, a directory, and three local shops. Being sixth in your own city means most people who look never see you first.

## Your domain

Your web address is twelve years old, which should help you — but the more obvious spelling of your name is owned by someone else, so people who type the natural version land on a stranger. Your renewal is also due soon; miss it and the whole site goes dark.

## What this means

You do good work and you have the reviews to prove it. What you do not have is agreement — between what your site says, what your listings say, and what search engines can confirm. Fixing that is specific, checkable work, and it is exactly what gets the phone ringing again.`;

const codes = (r) => r.failures.map((f) => f.code);
const hasCode = (r, code) => codes(r).includes(code);
const failureFor = (r, code) => r.failures.find((f) => f.code === code);

/* ------------------------------- the pass case ----------------------------- */

test("PASS: a clean full report passes with zero failures", () => {
  const r = precheckReport(PASS);
  assert.equal(r.passed, true, `expected passed; got failures: ${JSON.stringify(r.failures)}`);
  assert.equal(r.failures.length, 0, `expected no failures; got: ${JSON.stringify(r.failures)}`);
  assert.ok(PASS.length > MIN_REPORT_CHARS);
});

/* --------------------------- one corruption per code ----------------------- */

test("EMPTY_OR_SHORT: blank report", () => {
  const r = precheckReport("");
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "EMPTY_OR_SHORT"));
  assert.equal(failureFor(r, "EMPTY_OR_SHORT").severity, "block");
});

test("EMPTY_OR_SHORT: below the character floor", () => {
  const r = precheckReport("Report generation failed — please retry.");
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "EMPTY_OR_SHORT"));
});

test("TRUNCATED: final line has no terminal punctuation", () => {
  const truncated = PASS.replace(/\.\s*$/, ""); // drop the last period
  const r = precheckReport(truncated);
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "TRUNCATED"));
  assert.equal(failureFor(r, "TRUNCATED").severity, "block");
});

test("TRUNCATED: ends mid-table-row", () => {
  const r = precheckReport(PASS + "\n\n| Metric | Value |\n| Rating | 4.7");
  assert.ok(hasCode(r, "TRUNCATED"));
});

test("PLACEHOLDER_SURVIVED: bracket placeholders survive", () => {
  const corrupted = PASS
    .replace("Prepared for a real business.", "Prepared for [Business Name].")
    .replace("Your verified Google rating is 4.7", "Your verified Google rating is [gbp_verified_rating]");
  const r = precheckReport(corrupted);
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "PLACEHOLDER_SURVIVED"));
  assert.equal(failureFor(r, "PLACEHOLDER_SURVIVED").severity, "block");
});

test("PLACEHOLDER_SURVIVED: does NOT flag a markdown link", () => {
  const withLink = PASS.replace(
    "Fixing that is specific, checkable work",
    "See [our sample report](https://rankoncall.com/sample/). Fixing that is specific, checkable work"
  );
  const r = precheckReport(withLink);
  assert.ok(!hasCode(r, "PLACEHOLDER_SURVIVED"), `unexpected placeholder flag: ${JSON.stringify(r.failures)}`);
});

test("PHONE_LEAKED: a phone number appears", () => {
  const r = precheckReport(PASS + "\n\nReach the owner at (615) 555-0148 to confirm.");
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "PHONE_LEAKED"));
  assert.equal(failureFor(r, "PHONE_LEAKED").severity, "block");
});

test("ADDRESS_LEAKED: a street address appears", () => {
  const r = precheckReport(PASS + "\n\nTheir shop at 418 Harding Rd is easy to miss.");
  assert.equal(r.passed, false);
  assert.ok(hasCode(r, "ADDRESS_LEAKED"));
  assert.equal(failureFor(r, "ADDRESS_LEAKED").severity, "block");
});

test("BANNED_WORD: marketer-speak present (warn, still passes gate)", () => {
  const r = precheckReport(PASS.replace("the phone ringing again.", "the phone ringing again. We will also review your funnel."));
  assert.ok(hasCode(r, "BANNED_WORD"));
  assert.equal(failureFor(r, "BANNED_WORD").severity, "warn");
  assert.equal(r.passed, true, "warn-only report should still pass the block gate");
});

test("MISSING_SECTION: a required heading is absent (warn)", () => {
  const r = precheckReport(PASS.replace("## Your domain", "## Domain notes"));
  assert.ok(hasCode(r, "MISSING_SECTION"));
  assert.equal(failureFor(r, "MISSING_SECTION").severity, "warn");
  assert.match(failureFor(r, "MISSING_SECTION").message, /Your domain/);
  assert.equal(r.passed, true);
});

test("UNSTAMPED_RANKING: ranking section without query/location/date (warn)", () => {
  const stripped = PASS.replace(
    'We searched "gutter installation Nashville" from Nashville, TN on July 24, 2026, and you came up sixth. Above you sit a national brand, a directory, and three local shops. Being sixth in your own city means most people who look never see you first.',
    "You show up further down the results than you should, behind several competitors. Most people who look never see you first."
  );
  const r = precheckReport(stripped);
  assert.ok(hasCode(r, "UNSTAMPED_RANKING"));
  assert.equal(failureFor(r, "UNSTAMPED_RANKING").severity, "warn");
  assert.equal(r.passed, true);
});

test("every failure carries code, severity, message", () => {
  const r = precheckReport("too short");
  for (const f of r.failures) {
    assert.ok(typeof f.code === "string" && f.code);
    assert.ok(f.severity === "block" || f.severity === "warn");
    assert.ok(typeof f.message === "string" && f.message);
    assert.ok(typeof f.excerpt === "string");
  }
});
