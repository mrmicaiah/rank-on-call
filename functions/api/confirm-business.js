/**
 * Post-payment business confirmation — Cloudflare Pages Function at /api/confirm-business.
 * Spec: docs/BOT_ARCHITECTURE.md ("Paid tier — the flow", steps 2–5, the
 * WRONG-BUSINESS CONFIRMATION gate). This is the buyer-confirmation gate: the
 * buyer must click their own Google listing before any report generates.
 *
 * GET  (?session_id=…) — verify the paid session, look up Google Places
 *      candidates for the buyer to choose from.
 * POST ({session_id, place_id|manual_details, attested}) — record the buyer's
 *      confirmed choice onto the PaymentIntent metadata.
 *
 * SECURITY (hard rules, mirroring scan.js / checkout.js discipline):
 *  - STRIPE_SECRET_KEY and GOOGLE_PLACES_API_KEY are read ONLY from context.env.
 *    Neither is ever returned to the client, logged, or placed in any response
 *    object. GOOGLE_PLACES_API_KEY is server-side ONLY — it must never reach the
 *    browser (BOT_ARCHITECTURE.md "Hosting and runtime").
 *  - Paid status is NEVER trusted from the client. Every request re-retrieves
 *    the session from Stripe and re-checks payment_status server-side.
 *  - No SDKs — Stripe and Places are called directly with fetch, consistent
 *    with scan.js / checkout.js avoiding heavy deps.
 *
 * PLACES API NOTE: the key (`rank-on-call-places-server`) is restricted to
 * "Places API (New)" per docs/SITE_BUILD_SPEC.md — so this uses the NEW
 * endpoint `places:searchText`, NOT the legacy `maps/api/place/textsearch`.
 * The legacy endpoint would 403 against a New-restricted key.
 *
 * DEPENDS ON A CHECKOUT CHANGE (flagged to the manager): checkout.js currently
 * collects NO Stripe custom_fields — only metadata[scanned_url]. Until it
 * collects the business name + city/state (as custom_fields or metadata), the
 * GET has nothing to query Places with and the page falls straight through to
 * the manual form. This file is written to degrade cleanly in that state AND to
 * work the moment the fields are supplied — it reads several likely key names.
 */

const STRIPE_BASE = "https://api.stripe.com/v1";
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_CANDIDATES = 4;

/* ------------------------- delivery deadline config ------------------------ */
// The deadline is computed ONCE at confirmation and stored on the PaymentIntent.
// It is the single source of truth for the page, the email, and any monitoring.
// Delivery timezone — America/Chicago, confirmed permanent. Every deadline renders in
// THIS zone: one stated deadline, one zone, named explicitly in the buyer-facing text.
// The buyer's local time is never used.
const DELIVERY_TIMEZONE = "America/Chicago";
const DELIVERY_ZONE_LABEL = "Central"; // human label appended to the display string
const DELIVERY_SLA_BUSINESS_DAYS = 3; // internal SLA
const DELIVERY_HOUR = 17; // 5:00 PM, end of the 3rd business day

// US federal holidays 2026–2027, listed on their OBSERVED weekday. A holiday that
// lands on a weekend is observed on the adjacent Friday/Monday — that observed day
// is when the business is closed, so that's the date to skip. Extend as years roll.
const US_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (Jul 4 is Sat → observed Fri Jul 3)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-11-27", // Day after Thanksgiving
  "2026-12-25", // Christmas Day
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // MLK Day
  "2027-02-15", // Presidents' Day
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (Jun 19 is Sat → observed Fri Jun 18)
  "2027-07-05", // Independence Day (Jul 4 is Sun → observed Mon Jul 5)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-11-26", // Day after Thanksgiving
  "2027-12-24", // Christmas Day (Dec 25 is Sat → observed Fri Dec 24)
]);

// Exported for reuse by sibling endpoints (e.g. intake.js) — mirrors the
// scan.js → checkout.js helper-sharing pattern. Only reserved onRequest* names
// are treated as routes by Pages; these plain exports are ignored by the router.
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ------------------------------ Stripe helpers ----------------------------- */

async function stripeGet(path, key) {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` }, // key used ONLY as a Bearer header
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export async function stripePost(path, key, form) {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/* Retrieve the session with its PaymentIntent expanded, and gate on paid status.
   Returns { error: Response } on any failure, or { session } on success. */
export async function loadPaidSession(sessionId, key) {
  if (!sessionId || typeof sessionId !== "string") {
    return { error: json({ status: "error", code: "missing_session", message: "We couldn't find your order — no session was provided." }, 400) };
  }
  // expand payment_intent so we can write confirmation metadata onto it later.
  const { ok, status, body } = await stripeGet(
    `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
    key
  );
  if (!ok || !body || body.error) {
    // 404 from Stripe → bad/unknown session id. Anything else → treat as invalid too.
    const code = status === 404 ? "invalid_session" : "invalid_session";
    return { error: json({ status: "error", code, message: "We couldn't find that order. If you just paid, give it a moment and refresh." }, 404) };
  }
  if (body.payment_status !== "paid") {
    return { error: json({ status: "error", code: "unpaid", message: "This order isn't showing as paid yet. If you just completed checkout, refresh in a moment." }, 402) };
  }
  return { session: body };
}

/* --------------------------- session field readers ------------------------- */

// Stripe custom_fields keys are chosen by whoever creates the session. checkout.js
// now sends `businessname` / `citystate` (keys must be alphanumeric — no underscores),
// listed FIRST as the canonical keys; the remaining names are tolerated fallbacks in
// case a session is created by another path (e.g. metadata instead of custom_fields).
const NAME_KEYS = ["businessname", "business_name", "company", "company_name", "business"];
const LOCATION_KEYS = ["citystate", "city_state", "city", "location", "business_location", "city_and_state", "area"];

function readCustomField(session, candidateKeys) {
  const fields = Array.isArray(session.custom_fields) ? session.custom_fields : [];
  for (const f of fields) {
    if (!f || !candidateKeys.includes(f.key)) continue;
    // custom fields carry their value under text/numeric/dropdown per the field type.
    const v = (f.text && f.text.value) || (f.numeric && f.numeric.value) || (f.dropdown && f.dropdown.value);
    if (v) return String(v).trim();
  }
  return "";
}

function readMetadata(session, candidateKeys) {
  const md = (session && session.metadata) || {};
  for (const k of candidateKeys) {
    if (md[k]) return String(md[k]).trim();
  }
  return "";
}

// Business name / location, from custom_fields first, then metadata as a fallback.
function readBusiness(session) {
  const name = readCustomField(session, NAME_KEYS) || readMetadata(session, NAME_KEYS);
  const location = readCustomField(session, LOCATION_KEYS) || readMetadata(session, LOCATION_KEYS);
  return { name, location };
}

/* ------------------------------ Places lookup ------------------------------ */

/* Google Places API (New) text search. Returns { placesStatus, candidates }.
   placesStatus: "ok" | "zero_results" | "no_query" | "unavailable".
   Never throws — a Places failure degrades to the manual form, it must not
   crash the confirmation flow or leak the key. */
async function findCandidates(business, placesKey) {
  const query = [business.name, business.location].filter(Boolean).join(" ").trim();
  if (!query) return { placesStatus: "no_query", candidates: [] };
  if (!placesKey) return { placesStatus: "unavailable", candidates: [] };

  let res, data;
  try {
    res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": placesKey, // server-side ONLY — never returned or logged
        // Field mask keeps the response tight. rating/userRatingCount put this on
        // the Enterprise SKU (BOT_ARCHITECTURE.md "tier trap"); phone/category/website
        // ride the same tier, so they're included at no extra SKU jump — they feed the
        // post-confirmation GBP preview on /thank-you/ (still ONE Places call, no extra).
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.types,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: MAX_CANDIDATES }),
    });
    data = await res.json().catch(() => null);
  } catch {
    return { placesStatus: "unavailable", candidates: [] };
  }

  if (!res.ok || !data || data.error) {
    console.error("Places search failed", { httpStatus: res && res.status, errStatus: data && data.error && data.error.status });
    return { placesStatus: "unavailable", candidates: [] };
  }

  const places = Array.isArray(data.places) ? data.places : [];
  if (!places.length) return { placesStatus: "zero_results", candidates: [] };

  const candidates = places.slice(0, MAX_CANDIDATES).map((p) => {
    const c = {
      place_id: p.id || "",
      name: (p.displayName && p.displayName.text) || "",
      formatted_address: p.formattedAddress || "",
    };
    if (typeof p.rating === "number") c.rating = p.rating;
    if (typeof p.userRatingCount === "number") c.user_ratings_total = p.userRatingCount;
    if (p.nationalPhoneNumber) c.formatted_phone_number = p.nationalPhoneNumber;
    // GBP-preview extras — reused client-side after confirmation, no second API call.
    if (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) c.category = p.primaryTypeDisplayName.text;
    if (Array.isArray(p.types) && p.types.length) c.types = p.types;
    if (p.websiteUri) c.website = p.websiteUri;
    return c;
  }).filter((c) => c.place_id); // a candidate with no place_id can't be confirmed against

  if (!candidates.length) return { placesStatus: "zero_results", candidates: [] };
  return { placesStatus: "ok", candidates };
}

/* ----------------------------- delivery deadline --------------------------- */

function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

// Calendar-date math runs in UTC purely for day-of-week + increment; that's
// timezone-independent once the starting calendar date is pinned in the target zone.
function isBusinessDay(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
  if (dow === 0 || dow === 6) return false;
  if (US_HOLIDAYS.has(dateKey(y, m, d))) return false;
  return true;
}

function addCalendarDay(part) {
  const dt = new Date(Date.UTC(part.y, part.m - 1, part.d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// The calendar date (in `timeZone`) of a given instant.
function zonedCalendarDate(instant, timeZone) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { y: +p.year, m: +p.month, d: +p.day };
}

// Offset in minutes (local − UTC) of `timeZone` at `instant`. e.g. CDT → -300.
function zoneOffsetMinutes(instant, timeZone) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

// The UTC instant for a wall-clock time in `timeZone` (DST-safe via one refine pass).
function zonedWallTimeToInstant(y, m, d, hh, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, 0, 0);
  const off = zoneOffsetMinutes(new Date(guess), timeZone);
  let instant = new Date(guess - off * 60000);
  const off2 = zoneOffsetMinutes(instant, timeZone);
  if (off2 !== off) instant = new Date(guess - off2 * 60000);
  return instant;
}

function offsetIso(mins) {
  const sign = mins <= 0 ? "-" : "+"; // -300 (behind UTC) → "-05:00"
  const a = Math.abs(mins);
  return `${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/* From a confirmation instant: start the day AFTER confirmation, count
   DELIVERY_SLA_BUSINESS_DAYS business days (skipping weekends + US_HOLIDAYS), land on
   DELIVERY_HOUR:00 in DELIVERY_TIMEZONE. Returns { iso, display }. */
function computeDeliveryDeadline(nowInstant) {
  let cur = zonedCalendarDate(nowInstant, DELIVERY_TIMEZONE);
  let counted = 0;
  while (counted < DELIVERY_SLA_BUSINESS_DAYS) {
    cur = addCalendarDay(cur);
    if (isBusinessDay(cur.y, cur.m, cur.d)) counted++;
  }
  const instant = zonedWallTimeToInstant(cur.y, cur.m, cur.d, DELIVERY_HOUR, DELIVERY_TIMEZONE);
  const iso = `${dateKey(cur.y, cur.m, cur.d)}T${pad2(DELIVERY_HOUR)}:00:00${offsetIso(zoneOffsetMinutes(instant, DELIVERY_TIMEZONE))}`;
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: DELIVERY_TIMEZONE, weekday: "long", month: "long", day: "numeric",
  }).format(instant);
  const display = `${datePart} at 5:00 PM ${DELIVERY_ZONE_LABEL}`;
  return { iso, display };
}

/* ---------------------------------- GET ------------------------------------ */

export async function onRequestGet({ request, env }) {
  const key = env && env.STRIPE_SECRET_KEY;
  if (!key) {
    return json({ status: "error", code: "config", message: "Confirmation isn't available right now. Please try again shortly." }, 500);
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  const loaded = await loadPaidSession(sessionId, key);
  if (loaded.error) return loaded.error;
  const session = loaded.session;

  const business = readBusiness(session);
  const scannedUrl = readMetadata(session, ["scanned_url"]);
  const { placesStatus, candidates } = await findCandidates(business, env && env.GOOGLE_PLACES_API_KEY);

  return json({
    status: "ok",
    paid: true,
    business: { name: business.name, location: business.location }, // echo exactly what was submitted
    scannedUrl,
    placesStatus,
    candidates,
  });
}

/* ---------------------------------- POST ----------------------------------- */

export async function onRequestPost({ request, env }) {
  const key = env && env.STRIPE_SECRET_KEY;
  if (!key) {
    return json({ status: "error", code: "config", message: "Confirmation isn't available right now. Please try again shortly." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  // Attestation is mandatory and must be an explicit boolean true — never inferred.
  if (payload.attested !== true) {
    return json({ status: "error", code: "not_attested", message: "Please confirm you're the owner or an authorized representative before submitting." }, 400);
  }

  const placeId = typeof payload.place_id === "string" ? payload.place_id.trim() : "";
  const manual = payload.manual_details && typeof payload.manual_details === "object" ? payload.manual_details : null;
  const manualAddress = manual && typeof manual.address === "string" ? manual.address.trim() : "";
  const manualPhone = manual && typeof manual.phone === "string" ? manual.phone.trim() : "";

  const method = placeId ? "places" : "manual";
  if (method === "manual" && !manualAddress) {
    return json({ status: "error", code: "missing_manual", message: "Please enter your business street address." }, 400);
  }

  // Re-retrieve and re-gate the session server-side. NEVER trust a client-supplied paid flag.
  const loaded = await loadPaidSession(payload.session_id, key);
  if (loaded.error) return loaded.error;
  const session = loaded.session;

  // The PaymentIntent id — Checkout Sessions are immutable after creation, so the
  // confirmation is recorded on the PaymentIntent metadata instead (v1: zero new
  // infra; it shows in the Stripe dashboard next to the payment). Supabase later.
  const pi = session.payment_intent;
  const paymentIntentId = pi && typeof pi === "object" ? pi.id : (typeof pi === "string" ? pi : "");
  if (!paymentIntentId) {
    return json({ status: "error", code: "no_payment_intent", message: "We couldn't attach the confirmation to your payment. Please try again shortly." }, 502);
  }

  const business = readBusiness(session);
  const confirmedName = (typeof payload.name === "string" && payload.name.trim()) || business.name || "";
  const confirmedAddress = method === "places"
    ? ((typeof payload.address === "string" && payload.address.trim()) || "")
    : manualAddress;

  const now = new Date();
  const attestedAt = now.toISOString();
  // Deadline computed ONCE here and stored — the single source of truth for the
  // page, the (future) email, and any monitoring. Never recomputed downstream.
  const deadline = computeDeliveryDeadline(now);

  // Stripe metadata values are strings; keep each well under the 500-char cap.
  const form = new URLSearchParams();
  form.set("metadata[confirmed_place_id]", placeId);
  form.set("metadata[confirmed_name]", confirmedName.slice(0, 480));
  form.set("metadata[confirmed_address]", confirmedAddress.slice(0, 480));
  if (manualPhone) form.set("metadata[confirmed_phone]", manualPhone.slice(0, 120));
  form.set("metadata[ownership_attested]", "true");
  form.set("metadata[attested_at]", attestedAt);
  form.set("metadata[confirmation_method]", method);
  form.set("metadata[report_due_at]", deadline.iso);
  form.set("metadata[report_due_display]", deadline.display.slice(0, 480));

  const upd = await stripePost(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, key, form);
  if (!upd.ok || !upd.body || upd.body.error) {
    console.error("PaymentIntent metadata update failed", {
      httpStatus: upd.status,
      errorType: upd.body && upd.body.error && upd.body.error.type,
    });
    return json({ status: "error", code: "record_failed", message: "We couldn't save your confirmation just now. Please try again in a moment." }, 502);
  }

  return json({
    status: "ok",
    confirmation_method: method,
    report_due_at: deadline.iso,
    report_due_display: deadline.display,
  });
}
