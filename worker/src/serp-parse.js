/**
 * SERP response parser — the extraction contract from FULFILLMENT_WORKER_SPEC §7.4.
 *
 * ============================================================================
 * ⚠️ THE ALLOWLIST RULE — read this before changing anything in this file
 * ============================================================================
 *
 * This parser returns an object built FIELD BY FIELD from an explicit allowlist.
 *
 * It MUST NEVER spread, clone, `Object.assign`, `JSON.parse(JSON.stringify(...))`,
 * or otherwise pass through a raw API item. Not "and then delete the bad fields" —
 * never constructed from the raw item in the first place.
 *
 * This is AUTOMATION_PIPELINE_SPEC §6's "stripped BY CONSTRUCTION during
 * generation, not removed post-hoc" applied at the only boundary where it can
 * actually be enforced. Everything downstream — the Anthropic prompt, the drafted
 * report, Checkpoint 4 — is easier to get right if the personal data was never in
 * the object to begin with.
 *
 * What is in the raw response and must never reach the output:
 *
 *   local_pack[].description  VERBATIM CUSTOMER REVIEW QUOTES. Banned outright by
 *                             the §4 CUT list — they are Google's content inside a
 *                             document ROC sells.
 *   local_pack[].phone        Business phone. §6 output lock: never printed.
 *   organic[].description     Contains FULL STREET ADDRESSES and PHONE NUMBERS
 *                             scraped into the snippet.
 *   organic[].highlighted     Same, in fragments.
 *
 * A spread would carry every one of them, silently, and the report would read
 * perfectly well right up until someone noticed their address in it.
 * ============================================================================
 *
 * ⚠️ TWO RANK FIELDS, both preserved, never conflated:
 *
 *   rank_group     position within the item's OWN type — organic #1 is the first
 *                  organic result
 *   rank_absolute  position across the WHOLE page — the local pack occupies the
 *                  top slots, so the first organic result is typically #4
 *
 * A business can be rank_group 1 and rank_absolute 4 simultaneously, and both are
 * true. Report copy must never say "ranked #1" without saying #1 of what — which
 * is why these are named `rankGroup` and `rankAbsolute` in the output rather than
 * being flattened into anything called "rank".
 */

/**
 * The NINE listing platforms detectable from a SERP (FULFILLMENT_WORKER_SPEC §7.4).
 * Keyed by registrable domain, because that is what the SERP item reports.
 *
 * ⚠️ `google.com` / "Google Business Profile" was DELIBERATELY REMOVED. Do not
 * helpfully add it back.
 *
 * It cannot work, and failing here is unusually expensive:
 *   - In a `local_pack` item, `domain` is THE BUSINESS'S OWN WEBSITE, not google.com.
 *   - GBP never appears as an organic result.
 * So a `google.com` entry matches nothing, ever — and under the absence rule
 * (§7.4: "a platform may only be reported as absent if it was specifically
 * checked") a permanent non-match would become **"no Google Business Profile
 * found"** on every single report, including for businesses whose profile is
 * live, verified, and carrying hundreds of reviews. That is a false claim about
 * the most important finding in the document.
 *
 * **The GBP signal is `targetInLocalPack`**, which this parser already produces:
 * appearing in the local pack IS having a profile Google is willing to show.
 */
export const LISTING_PLATFORMS = {
  "yelp.com": "Yelp",
  "angi.com": "Angi",
  "homeadvisor.com": "HomeAdvisor",
  "bbb.org": "BBB",
  "facebook.com": "Facebook",
  "nextdoor.com": "Nextdoor",
  "houzz.com": "Houzz",
  "thumbtack.com": "Thumbtack",
  "porch.com": "Porch",
};

/* Multi-label public suffixes relevant to this market. NOT the full Public Suffix
   List — that is a large, frequently-updated file for a US-only product
   (FUNNEL_REORDER_SPEC §4.2). The failure mode is deliberately asymmetric: a
   suffix we get wrong produces a MISSED match, never a false one. */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au",
  "co.nz", "com.mx", "com.br", "co.za", "com.ca",
]);

/**
 * Normalize a hostname or URL to its registrable domain (eTLD+1), lowercased.
 * Returns "" for anything unusable — never throws.
 */
export function registrableDomain(input) {
  if (typeof input !== "string" || !input.trim()) return "";
  let host = input.trim().toLowerCase();

  // Accept a bare hostname or a full URL.
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  } else {
    host = host.split("/")[0].split("?")[0].split("#")[0];
  }

  host = host.replace(/:\d+$/, "");   // strip port
  host = host.replace(/\.$/, "");      // strip FQDN root dot
  host = host.replace(/^www\./, "");   // strip a single leading www.
  if (!host || !host.includes(".")) return "";

  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  // example.co.uk → keep three labels; shop.example.com → keep two.
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/** True when `itemDomain` is the same registrable domain as `targetDomain`. */
function sameDomain(itemDomain, targetDomain) {
  if (!targetDomain) return false;
  const a = registrableDomain(itemDomain);
  return a !== "" && a === targetDomain;
}

/** Numbers only when they are numbers — a missing rank is null, never 0. */
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Strings only when non-empty after trimming. */
function str(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse a live/advanced SERP TASK.
 *
 * ⚠️ INPUT IS A TASK OBJECT, NOT THE ENVELOPE. That is what `serpLiveAdvanced()`
 * returns — it validates and discards the envelope itself. A task looks like:
 *
 *   { id, status_code, status_message, time, cost, result_count, path, data,
 *     result: [ { keyword, location_code, language_code, check_url, datetime,
 *                 item_types, se_results_count, items_count, items: [] } ] }
 *
 * Keeping the envelope out of here is why a Playground capture — which arrives
 * pre-unwrapped — is the parser's natural input and needs no massaging to test
 * against.
 *
 * @param {object} task            the task object from serpLiveAdvanced()
 * @param {object} [opts]
 * @param {string} [opts.scannedUrl]  the buyer's own site, for target matching
 * @returns {object} the allowlisted extraction
 */
export function parseSerp(task, { scannedUrl } = {}) {
  const result = Array.isArray(task?.result) ? task.result[0] : null;

  if (!result) {
    // No result is not an error here — Checkpoint 1 decides what an empty read
    // means. This returns an honestly empty extraction and says so.
    return emptyExtraction();
  }

  const items = Array.isArray(result.items) ? result.items : [];
  const targetDomain = registrableDomain(scannedUrl || "");

  /* ---------------------------- local pack ---------------------------- */
  // ALLOWLIST: rank_group, rank_absolute, title, domain, rating.value,
  // rating.votes_count, rating.rating_max, rating.rating_type, cid.
  // NOT description (verbatim review quotes). NOT phone.
  //
  // ratingMax / ratingType are carried because "rated 4.9" is meaningless without
  // the scale it was measured on. Google is consistent at /5 today, but a report
  // that hardcodes the denominator would silently misstate the number the day that
  // changes — and a rating is the most-read figure in the whole document. Both are
  // a number and a label; neither is personal data.
  const localPack = items
    .filter((item) => item && item.type === "local_pack")
    .map((item) => ({
      rankGroup: num(item.rank_group),
      rankAbsolute: num(item.rank_absolute),
      title: str(item.title),
      domain: str(item.domain),
      ratingValue: num(item.rating?.value),
      ratingVotes: num(item.rating?.votes_count),
      ratingMax: num(item.rating?.rating_max),
      ratingType: str(item.rating?.rating_type),
      cid: str(item.cid),
    }));

  /* ------------------------------ organic ----------------------------- */
  // ALLOWLIST: rank_group, rank_absolute, domain, title, url.
  // NOT description, NOT highlighted — both carry addresses and phone numbers.
  const organic = items
    .filter((item) => item && item.type === "organic")
    .map((item) => ({
      rankGroup: num(item.rank_group),
      rankAbsolute: num(item.rank_absolute),
      domain: str(item.domain),
      title: str(item.title),
      url: str(item.url),
    }));

  /* --------------------------- target matching ------------------------- */
  // Domain match ONLY. Never title — three businesses can share a name, which is
  // the entire reason the confirmation gate exists (§1.4). Matching a title here
  // would reintroduce the guess that gate removed.
  const localPackHit = localPack.find((entry) => sameDomain(entry.domain, targetDomain)) || null;
  const organicHit = organic.find((entry) => sameDomain(entry.domain, targetDomain)) || null;

  const targetInLocalPack = localPackHit
    ? { rankGroup: localPackHit.rankGroup, rankAbsolute: localPackHit.rankAbsolute }
    : null;
  const targetOrganicRank = organicHit
    ? { rankGroup: organicHit.rankGroup, rankAbsolute: organicHit.rankAbsolute }
    : null;

  /* --------------------------- platforms found ------------------------- */
  // Scanned across BOTH item types: a directory can surface in the local pack as
  // well as organically, and missing it in one place would understate coverage.
  // First occurrence wins, so the recorded rank is the best position achieved.
  const platformsFound = [];
  const seen = new Set();
  for (const entry of [...localPack, ...organic]) {
    const domain = registrableDomain(entry.domain || "");
    const name = LISTING_PLATFORMS[domain];
    if (!name || seen.has(domain)) continue;
    seen.add(domain);
    platformsFound.push({
      platform: name,
      domain,
      rankGroup: entry.rankGroup,
      rankAbsolute: entry.rankAbsolute,
    });
  }

  /* ----------------------------- claim stamp --------------------------- */
  // §4 requires every ranking claim to carry exact query + location + date.
  // These are the API'S OWN values, never reconstructed — a stamp we assembled
  // from our request would record what we MEANT to ask, not what was answered,
  // and would hide exactly the class of bug anti-pattern 1 describes (a location
  // silently discarded between intent and request).
  const claimStamp = {
    keyword: str(result.keyword),
    locationCode: num(result.location_code),
    languageCode: str(result.language_code),
    checkUrl: str(result.check_url),
    datetime: str(result.datetime),
  };

  return {
    localPack,
    targetInLocalPack,
    organic,
    targetOrganicRank,
    platformsFound,
    claimStamp,
    itemTypes: Array.isArray(result.item_types) ? result.item_types.slice() : [],
  };
}

function emptyExtraction() {
  return {
    localPack: [],
    targetInLocalPack: null,
    organic: [],
    targetOrganicRank: null,
    platformsFound: [],
    claimStamp: { keyword: null, locationCode: null, languageCode: null, checkUrl: null, datetime: null },
    itemTypes: [],
  };
}

export default parseSerp;
