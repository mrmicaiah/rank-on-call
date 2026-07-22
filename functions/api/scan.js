/**
 * Free-tier instant scan — Cloudflare Pages Function, served at /api/scan.
 * Spec: docs/BOT_ARCHITECTURE.md ("Free tier — what it checks" / "what it must NOT do").
 *
 * HARD RULES (from the spec):
 *  - ZERO Places API calls. Nothing in this file touches any key. No env vars.
 *  - No verdicts. The response contains what was checked and what was found —
 *    never a score, grade, pass/fail, or "looks healthy" field.
 *  - The fetch scar: a failed/empty/bot-blocked/JS-shell fetch is NEVER a finding.
 *    "We could not read your site" is a distinct status, stated plainly.
 *  - SSRF guard: this endpoint fetches user-supplied URLs. Private/internal
 *    targets are rejected before any fetch happens.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // ~2MB cap — never parse unbounded input
const NEAR_EMPTY_BYTES = 500; // smaller than any real page
const JS_SHELL_TEXT_THRESHOLD = 200; // visible chars below this + framework signals = unreadable
const JS_SHELL_SCRIPT_RATIO = 0.45; // >45% of bytes inside <script> = script-dominated

const USER_AGENT = "RankOnCallScanBot/1.0 (+https://rankoncall.com)";

// The capability boundary, stated as fact — the paid report is the other side of it.
const CANNOT_SEE = [
  "how you appear in local search results",
  "your Google Business Profile rating and review count",
  "who outranks you for your own service in your own city",
  "how your listings agree (or disagree) across the web",
];

/* ---------------------------------- input ---------------------------------- */

const PRIVATE_V4 = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local
  /^0\./,
];

export function normalizeAndValidateUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Enter your website address." };
  let input = raw.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) input = "https://" + input;

  let url;
  try {
    url = new URL(input);
  } catch {
    return { error: "That doesn't look like a web address we can reach." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Only http(s) websites can be scanned." };
  }
  // Default ports only — anything else is a probe, not a website.
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { error: "Only standard web ports can be scanned." };
  }

  const host = url.hostname.toLowerCase();
  const isIpV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpV6 = host.includes(":") || (host.startsWith("[") && host.endsWith("]"));
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isIpV6 || // no IPv6 literals at all
    (isIpV4 && PRIVATE_V4.some((re) => re.test(host))) ||
    isIpV4 // no IP literals at all — real business sites have hostnames
  ) {
    return { error: "That address can't be scanned — enter your public website address." };
  }

  url.hash = "";
  return { url: url.toString() };
}

/* ---------------------------------- fetch ---------------------------------- */

async function boundedFetch(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });

    // Read at most MAX_BODY_BYTES, then stop.
    const reader = res.body?.getReader();
    let received = 0;
    let truncated = false;
    const chunks = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          chunks.push(value.slice(0, value.byteLength - (received - MAX_BODY_BYTES)));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { ok: true, httpStatus: res.status, body, bytes: buf.byteLength, truncated, finalUrl: res.url };
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------- html utils ------------------------------- */

function stripToVisibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptByteRatio(html) {
  let scriptBytes = 0;
  for (const m of html.matchAll(/<script[\s\S]*?<\/script>/gi)) scriptBytes += m[0].length;
  return html.length ? scriptBytes / html.length : 0;
}

const FRAMEWORK_MARKERS =
  /__NEXT_DATA__|__NUXT__|ng-version=|data-reactroot|id=["']root["']|id=["']app["']|wp-content\/plugins\/elementor/i;

const BOT_BLOCK_MARKERS =
  /just a moment|checking your browser|cf-challenge|captcha|access denied|attention required/i;

/* --------------------------------- checks ---------------------------------- */

function checkTitleMeta(html) {
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) =>
    m[1].replace(/\s+/g, " ").trim()
  );
  const metas = [...html.matchAll(/<meta\s[^>]*name=["']description["'][^>]*>/gi)].map((m) => {
    const c = m[0].match(/content=["']([\s\S]*?)["']/i);
    return c ? c[1].replace(/\s+/g, " ").trim() : "";
  });

  const findings = [];
  if (titles.length === 0) findings.push("No <title> tag found.");
  if (titles.length === 1 && titles[0] === "") findings.push("The <title> tag is empty.");
  if (titles.length > 1) findings.push(`${titles.length} <title> tags found — search results may show the wrong one.`);
  if (titles[0] && titles[0].length > 60)
    findings.push(`Title is ${titles[0].length} characters — search results truncate around 60.`);
  if (metas.length === 0) findings.push("No meta description — search engines will improvise your snippet.");
  if (metas.length === 1 && metas[0] === "") findings.push("Meta description is present but empty.");
  if (metas.length > 1) findings.push(`${metas.length} meta descriptions found.`);

  return {
    checked: true,
    title: { count: titles.length, text: titles[0] ? titles[0].slice(0, 120) : null },
    metaDescription: { count: metas.length, text: metas[0] ? metas[0].slice(0, 200) : null },
    findings,
  };
}

const LOCALBUSINESS_TYPES = new Set([
  "LocalBusiness", "HomeAndConstructionBusiness", "GeneralContractor", "RoofingContractor",
  "Plumber", "Electrician", "HVACBusiness", "HousePainter", "Locksmith", "MovingCompany",
  "PestControl", "ProfessionalService", "LandscapeService",
]);

function collectTypes(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  const t = node["@type"];
  if (typeof t === "string") out.add(t);
  if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  for (const v of Object.values(node)) collectTypes(v, out);
}

function checkSchema(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set();
  let parseFailures = 0;
  for (const b of blocks) {
    try {
      collectTypes(JSON.parse(b[1]), types);
    } catch {
      parseFailures++;
    }
  }
  const lbTypes = [...types].filter((t) => LOCALBUSINESS_TYPES.has(t) || /LocalBusiness/i.test(t));
  const findings = [];
  if (blocks.length === 0) findings.push("No structured data (JSON-LD) found on this page.");
  else if (lbTypes.length === 0)
    findings.push(`Structured data exists (${[...types].slice(0, 5).join(", ") || "unparseable"}) but no LocalBusiness type — search engines aren't being told this is a local business.`);
  if (parseFailures) findings.push(`${parseFailures} structured-data block(s) contain invalid JSON.`);

  return {
    checked: true,
    jsonLdBlocks: blocks.length,
    localBusinessFound: lbTypes.length > 0,
    types: [...types].slice(0, 10),
    findings,
  };
}

function normalizePhone(s) {
  const digits = s.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function checkNap(html, visibleText) {
  // Phones: tel: links + visible text, normalized to bare digits, deduped.
  // A tel: link and the same number written in text are ONE number.
  const phoneSet = new Map(); // normalized -> first display form seen
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const n = normalizePhone(m[1]);
    if (n.length === 10 && !phoneSet.has(n)) phoneSet.set(n, m[1].trim());
  }
  for (const m of visibleText.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g)) {
    const n = normalizePhone(m[0]);
    if (n.length === 10 && !phoneSet.has(n)) phoneSet.set(n, m[0].trim());
  }

  // Street-address-shaped strings, deduped after aggressive normalization.
  const addrRe =
    /\b\d{1,6}\s+(?:[A-Z][A-Za-z.]*\s+){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Hwy|Highway|Pkwy|Parkway|Way|Cir|Circle|Pl|Place)\b\.?/g;
  const addrSet = new Map();
  for (const m of visibleText.matchAll(addrRe)) {
    const key = m[0].toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
    if (!addrSet.has(key)) addrSet.set(key, m[0].trim());
  }

  const findings = [];
  if (phoneSet.size > 1)
    findings.push(`${phoneSet.size} different phone numbers appear on this page.`);
  if (addrSet.size > 1)
    findings.push(`${addrSet.size} different street addresses appear on this page.`);

  return {
    checked: true,
    phonesFound: [...phoneSet.values()].slice(0, 5),
    distinctPhones: phoneSet.size,
    addressesFound: [...addrSet.values()].slice(0, 5),
    distinctAddresses: addrSet.size,
    findings,
    caveat:
      "Single-page scan: name/address/phone compared within this page only, not across your header, footer, and contact page separately, and not against your listings elsewhere.",
  };
}

function checkCounters(visibleText) {
  const matches = [];
  for (const m of visibleText.matchAll(/\b0\s*\+\s*(?:[A-Za-z][A-Za-z-]*\s?){0,3}/g)) {
    const s = m[0].trim();
    if (s.length > 1) matches.push(s.slice(0, 40));
  }
  for (const m of visibleText.matchAll(/\b0\s+(projects?|reviews?|jobs?|installs?|repairs?|years?|customers?|clients?)\b/gi)) {
    matches.push(m[0].trim());
  }
  const unique = [...new Set(matches)].slice(0, 10);
  const findings = unique.length
    ? [`Placeholder or broken counters found: ${unique.map((s) => `"${s}"`).join(", ")} — your page may be advertising zeros.`]
    : [];
  return { checked: true, matches: unique, findings };
}

/* ---------------------------------- scan ----------------------------------- */

export async function runScan(rawUrl) {
  const v = normalizeAndValidateUrl(rawUrl);
  if (v.error) return { status: "error", httpCode: 400, message: v.error };

  const f = await boundedFetch(v.url);

  // --- The fetch scar: none of these paths may produce a finding. ---
  if (!f.ok) {
    return {
      status: "unreadable",
      url: v.url,
      unreadableReason: f.reason,
      message:
        f.reason === "timeout"
          ? "Your site took too long to respond, so we couldn't read it. That's a fact about our fetch, not a finding about your site."
          : "We couldn't reach your site from here. That's a fact about our fetch, not a finding about your site.",
    };
  }
  if (f.httpStatus < 200 || f.httpStatus >= 300) {
    const blocked = BOT_BLOCK_MARKERS.test(f.body);
    return {
      status: "unreadable",
      url: v.url,
      unreadableReason: blocked ? "bot_blocked" : "http_status",
      fetched: { httpStatus: f.httpStatus, bytes: f.bytes, truncated: f.truncated },
      message: blocked
        ? "Your site (or its firewall) blocks automated visitors, so we couldn't read it. Nothing below counts against you."
        : `Your site answered with HTTP ${f.httpStatus}, so we couldn't read the page. Nothing below counts against you.`,
    };
  }
  if (f.bytes < NEAR_EMPTY_BYTES) {
    return {
      status: "unreadable",
      url: v.url,
      unreadableReason: "near_empty",
      fetched: { httpStatus: f.httpStatus, bytes: f.bytes, truncated: false },
      message: "Your site returned an almost-empty page to us. A blank fetch is not proof of a blank page — we can't scan what we can't see.",
    };
  }

  const visibleText = stripToVisibleText(f.body);
  const ratio = scriptByteRatio(f.body);
  if (
    visibleText.length < JS_SHELL_TEXT_THRESHOLD &&
    (ratio > JS_SHELL_SCRIPT_RATIO || FRAMEWORK_MARKERS.test(f.body))
  ) {
    return {
      status: "unreadable",
      url: v.url,
      unreadableReason: "js_shell",
      fetched: { httpStatus: f.httpStatus, bytes: f.bytes, truncated: f.truncated },
      message:
        "Your site builds its page with JavaScript in the browser, so our reader only sees an empty shell. We can't scan it from here — this is a limit of our fetch, not a finding about your site.",
    };
  }
  if (BOT_BLOCK_MARKERS.test(f.body) && visibleText.length < 1000) {
    return {
      status: "unreadable",
      url: v.url,
      unreadableReason: "bot_blocked",
      fetched: { httpStatus: f.httpStatus, bytes: f.bytes, truncated: f.truncated },
      message: "Your site (or its firewall) served us a bot-check page instead of your site. Nothing below counts against you.",
    };
  }

  // --- Fetch is trustworthy; run the four checks. ---
  return {
    status: "scanned",
    url: v.url,
    finalUrl: f.finalUrl,
    fetched: { httpStatus: f.httpStatus, bytes: f.bytes, truncated: f.truncated },
    checks: {
      titleMeta: checkTitleMeta(f.body),
      schema: checkSchema(f.body),
      nap: checkNap(f.body, visibleText),
      counters: checkCounters(visibleText),
    },
    cannotSee: CANNOT_SEE,
  };
}

/* ------------------------------ HTTP handler ------------------------------- */

export async function onRequestPost({ request }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ status: "error", message: "Send JSON: { \"url\": \"yourwebsite.com\" }" }, 400);
  }
  const result = await runScan(payload?.url);
  const code = result.httpCode ?? 200;
  delete result.httpCode;
  return json(result, code);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
