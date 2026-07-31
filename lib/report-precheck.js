/**
 * report-precheck.js — deterministic pre-delivery checks for a generated Deep Dive.
 *
 * Runs BEFORE any AI reviewer sees the report. NO model calls, NO network, pure
 * functions, fully deterministic. Its job is cheap, mechanical triage: catch the
 * failures a human should never have to (a leaked phone number, a surviving
 * placeholder, a truncated generation) and surface softer smells as warnings.
 *
 * Entry point: precheckReport(report) → { passed, failures }
 *   - failures: [{ code, severity, message, excerpt }]
 *   - severity: "block" (must not ship) or "warn" (ship-able, but flag it)
 *   - passed: true when there are NO "block" failures. Warnings do not fail the
 *     gate — they travel with the report to the human/AI reviewer. (So a report
 *     can be `passed: true` and still carry warn-level failures.)
 *
 * Philosophy on false positives: for leak checks (phone/address) we accept some.
 * Flagging a clean line for a human glance is cheap; leaking a customer's address
 * in a paid deliverable is not.
 */

/* -------------------------------- tunables --------------------------------- */

// Character floor below which a report is treated as blank/stub. A real Deep Dive
// runs to several thousand characters across its required sections; this only
// catches gross generation failures. Tune here.
export const MIN_REPORT_CHARS = 800;

export const REQUIRED_SECTIONS = [
  "Fix these first",
  "Your Google Business Profile",
  "Your website",
  "Name, address, and phone consistency",
  "Where you show up",
  "Your domain",
  "What this means",
];

// Case-insensitive, word-boundary matched. Marketer-speak the house voice bans.
export const BANNED_WORDS = [
  "traffic",
  "impressions",
  "funnel",
  "conversion rate",
  "SEO strategy",
  "optimize your presence",
  "leverage",
  "synergy",
];

const SEVERITY = {
  EMPTY_OR_SHORT: "block",
  TRUNCATED: "block",
  PLACEHOLDER_SURVIVED: "block",
  PHONE_LEAKED: "block",
  ADDRESS_LEAKED: "block",
  BANNED_WORD: "warn",
  MISSING_SECTION: "warn",
  UNSTAMPED_RANKING: "warn",
};

const MAX_FAILURES_PER_CODE = 25; // keep output bounded on a pathological report

/* -------------------------------- patterns --------------------------------- */

// A square-bracket placeholder — [Business Name], [date], [gbp_snake_case], etc.
// Excludes markdown links ([text](url)) by rejecting a "]" immediately followed by "(".
const PLACEHOLDER_RE = /\[[^\]\n]{1,80}\](?!\()/g;

// US phone numbers: (615) 555-0148, 615-555-0148, 615.555.0148, +1 615 555 0148,
// and bare 10-digit runs. Digit boundaries stop it eating longer number strings.
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

// Street address: a number, then up to 4 words, then a street-type token.
const STREET_TYPES =
  "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Ste|Suite|Unit";
const ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s+){0,4}(?:${STREET_TYPES})\\b\\.?`,
  "gi"
);

// Ranking-stamp components, searched WITHIN the "Where you show up" section.
const QUOTED_RE = /["“][^"“”\n]{2,}["”]/;
const STATE_ABBR =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
// "Nashville, TN" (City, ST) or a bare uppercase state code.
const LOCATION_RE = new RegExp(`\\b[A-Z][a-zA-Z]+,\\s*(?:${STATE_ABBR})\\b|\\b(?:${STATE_ABBR})\\b`);
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(
  `\\b(?:${MONTHS})\\b\\s+\\d{1,2},?\\s+\\d{4}` + // July 24, 2026
    `|\\b(?:${MONTHS})\\b\\s+\\d{4}` + // July 2026
    `|\\b\\d{4}-\\d{2}-\\d{2}\\b` + // 2026-07-24
    `|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b`, // 7/24/2026
  "i"
);

/* -------------------------------- helpers ---------------------------------- */

function lineContaining(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim().slice(0, 160);
}

// The text of a markdown heading line ("## Your website" → "Your website"), else null.
function headingText(line) {
  const m = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
  return m ? m[1] : null;
}

// Everything from the heading matching `needle` up to the next heading (or EOF).
function extractSection(report, needle) {
  const lines = report.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = headingText(lines[i]);
    if (h && h.toLowerCase().includes(needle.toLowerCase())) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (headingText(lines[j]) !== null) {
      end = j;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// Trailing markdown wrappers to peel before checking terminal punctuation.
function stripTrailingMarkup(s) {
  return s.replace(/[\s*_`"'”’)\]>]+$/, "");
}

/* --------------------------------- checks ---------------------------------- */

export function precheckReport(report) {
  const failures = [];
  const add = (code, message, excerpt = "") => {
    failures.push({ code, severity: SEVERITY[code], message, excerpt });
  };
  // Bounded, deduped push for the match-scanning checks.
  const seenByCode = {};
  const addMatch = (code, message, excerpt) => {
    const seen = (seenByCode[code] = seenByCode[code] || new Set());
    if (seen.has(excerpt)) return;
    if (seen.size >= MAX_FAILURES_PER_CODE) return;
    seen.add(excerpt);
    add(code, message, excerpt);
  };

  const text = typeof report === "string" ? report : "";
  const trimmed = text.trim();

  // EMPTY_OR_SHORT — bail early; the other checks are meaningless on a stub.
  if (trimmed.length === 0) {
    add("EMPTY_OR_SHORT", "Report is blank.", "");
    return finalize(failures);
  }
  if (trimmed.length < MIN_REPORT_CHARS) {
    add(
      "EMPTY_OR_SHORT",
      `Report is ${trimmed.length} characters, below the ${MIN_REPORT_CHARS}-character floor.`,
      trimmed.slice(0, 160)
    );
    // keep going — a short report may also be truncated / missing sections, all useful.
  }

  // TRUNCATED — final non-empty line ends mid-sentence or mid-table-row.
  const lines = text.split("\n");
  let lastNonEmpty = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      lastNonEmpty = lines[i].trim();
      break;
    }
  }
  if (lastNonEmpty) {
    const isTableRow = lastNonEmpty.startsWith("|");
    if (isTableRow) {
      if (!lastNonEmpty.endsWith("|")) {
        add("TRUNCATED", "Report ends mid-table-row.", lastNonEmpty.slice(0, 160));
      }
    } else {
      const stripped = stripTrailingMarkup(lastNonEmpty);
      if (!/[.!?]$/.test(stripped)) {
        add(
          "TRUNCATED",
          "Report's final line has no terminal punctuation — it appears cut off mid-sentence.",
          lastNonEmpty.slice(0, 160)
        );
      }
    }
  }

  // PLACEHOLDER_SURVIVED
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    addMatch("PLACEHOLDER_SURVIVED", `Unresolved placeholder ${m[0]} survived into the report.`, lineContaining(text, m.index));
  }

  // PHONE_LEAKED
  for (const m of text.matchAll(PHONE_RE)) {
    addMatch("PHONE_LEAKED", `Phone number "${m[0].trim()}" must never appear in the client report.`, lineContaining(text, m.index));
  }

  // ADDRESS_LEAKED
  for (const m of text.matchAll(ADDRESS_RE)) {
    addMatch("ADDRESS_LEAKED", `Possible street address "${m[0].trim()}" — verify before delivery.`, lineContaining(text, m.index));
  }

  // BANNED_WORD (warn)
  for (const word of BANNED_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      addMatch("BANNED_WORD", `Banned marketer phrase "${m[0]}" (avoid "${word}").`, lineContaining(text, m.index));
    }
  }

  // MISSING_SECTION (warn)
  const headings = lines.map(headingText).filter(Boolean).map((h) => h.toLowerCase());
  for (const required of REQUIRED_SECTIONS) {
    const present = headings.some((h) => h.includes(required.toLowerCase()));
    if (!present) add("MISSING_SECTION", `Required section "${required}" is missing.`, "");
  }

  // UNSTAMPED_RANKING (warn) — the ranking section must carry all three of a quoted
  // query, a location, and a date; a ranking claim is unsupportable without them.
  // NOTE ON INTERPRETATION: the task said "lacks all three of a quoted query, a
  // location, and a date." Read literally that fires only when ALL are absent, but
  // the stated rationale ("unsupportable without their measurement context") means a
  // claim missing ANY one is already unsupportable — so this fires when ANY is
  // missing and names which. It's a warn; flip to require-all-absent if intended.
  const rankSection = extractSection(text, "Where you show up");
  if (rankSection) {
    const missing = [];
    if (!QUOTED_RE.test(rankSection)) missing.push("a quoted query");
    if (!LOCATION_RE.test(rankSection)) missing.push("a location");
    if (!DATE_RE.test(rankSection)) missing.push("a date");
    if (missing.length) {
      add(
        "UNSTAMPED_RANKING",
        `"Where you show up" is missing ${missing.join(", ")} — ranking claims need their measurement context.`,
        headingText(rankSection.split("\n")[0]) || "Where you show up"
      );
    }
  }

  return finalize(failures);
}

function finalize(failures) {
  const passed = !failures.some((f) => f.severity === "block");
  return { passed, failures };
}

export default precheckReport;
