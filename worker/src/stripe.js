/**
 * Stripe access for the fulfillment worker — plain fetch, NO SDK.
 *
 * This deliberately mirrors the discipline already established in
 * `functions/api/confirm-business.js`:
 *  - STRIPE_SECRET_KEY appears in exactly one place, an Authorization header.
 *    It is never logged, never returned, never placed in a response object.
 *  - Paid status is NEVER trusted from the caller. Every path re-retrieves the
 *    session from Stripe and re-checks payment_status server-side. A webhook body
 *    is not proof of payment on its own (spec §3.1).
 *
 * Difference from the Pages Function: these helpers return plain result objects,
 * not Response objects. This is a Worker with its own routing; the caller decides
 * what HTTP status a failure deserves.
 */

const STRIPE_BASE = "https://api.stripe.com/v1";

// Stripe's own recommended replay window for webhook timestamps.
const SIGNATURE_TOLERANCE_SECONDS = 300;

/* ------------------------------------------------------------------ *
 * Custom-field / metadata key fallbacks
 *
 * checkout.js sends `businessname` / `citystate` (Stripe requires custom_fields
 * keys to be alphanumeric — no underscores), so those are canonical and listed
 * FIRST. The rest are tolerated fallbacks in case a session is ever created by
 * another path. Ported verbatim from confirm-business.js; spec §3.1 explicitly
 * says to mirror this tolerance rather than hard-coding one key.
 * ------------------------------------------------------------------ */
export const NAME_KEYS = ["businessname", "business_name", "company", "company_name", "business"];
export const LOCATION_KEYS = ["citystate", "city_state", "city", "location", "business_location", "city_and_state", "area"];

/* ------------------------------- HTTP ----------------------------------- */

/* GET against the Stripe API. Returns { ok, status, body }.
   `networkError: true` distinguishes "never reached Stripe" from "Stripe said no",
   because the two deserve different webhook responses. */
export async function stripeGet(path, key) {
  let res, body;
  try {
    res = await fetch(`${STRIPE_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` }, // key used ONLY as a Bearer header
    });
  } catch {
    return { ok: false, status: 0, body: null, networkError: true };
  }
  body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/* ------------------------- signature verification ------------------------ */

/* Hex-encode an ArrayBuffer. */
function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/* HMAC-SHA256 over `message` with `secret`, hex-encoded. Web Crypto only —
   no node:crypto, no dependency. */
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

/* Constant-time string compare.
 *
 * Fixed-length XOR accumulation over the EXPECTED digest's length. There is no
 * early return and no `===` on the secret material: every iteration runs
 * regardless of how early a byte diverges, so the time taken carries no
 * information about how many leading characters matched. A length mismatch is
 * folded into the accumulator rather than short-circuiting.
 *
 * The `i < b.length` test branches on the loop index, which is public, not on
 * any compared byte — that is data-independent and therefore safe.
 */
function timingSafeEqual(expected, candidate) {
  const a = String(expected);
  const b = String(candidate);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/* Verify a `Stripe-Signature` header against the RAW request body.
 *
 * Returns a boolean and NEVER throws — any malformed input, missing field, or
 * crypto failure is a false, not an exception. The caller must be able to treat
 * this as a plain gate.
 *
 * The header looks like:  t=1690000000,v1=<hex>,v1=<hex>,v0=<hex>
 * There can be more than one v1 (Stripe emits one per active endpoint secret
 * during a secret rotation), so every v1 is checked.
 *
 * IMPORTANT: `rawBody` must be the exact bytes Stripe sent, as text. Any
 * re-serialization (JSON.parse then JSON.stringify) changes whitespace and key
 * order and will fail verification. The caller reads request.text() first.
 */
export async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  try {
    if (typeof rawBody !== "string") return false;
    if (typeof signatureHeader !== "string" || !signatureHeader) return false;
    if (typeof secret !== "string" || !secret) return false;

    let timestamp = "";
    const v1Signatures = [];
    for (const part of signatureHeader.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const scheme = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (scheme === "t") timestamp = value;
      else if (scheme === "v1") v1Signatures.push(value);
    }
    if (!timestamp || v1Signatures.length === 0) return false;

    // Replay tolerance. A signature is valid arithmetic forever; the timestamp
    // is what stops a captured-and-replayed webhook from being honoured next year.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);

    // Every candidate is compared — `timingSafeEqual(...) || match` evaluates the
    // call before the OR, so a match on the first entry does not skip the rest.
    let match = false;
    for (const candidate of v1Signatures) {
      match = timingSafeEqual(expected, candidate) || match;
    }
    return match;
  } catch {
    return false;
  }
}

/* ---------------------------- session loading ---------------------------- */

/* Retrieve the Checkout Session with its PaymentIntent expanded, and gate on
 * paid status. Ported from `loadPaidSession()` in confirm-business.js (~line 113),
 * with the Response objects replaced by a plain result.
 *
 * Returns:
 *   { ok: true,  session }
 *   { ok: false, code, message, status, retryable }
 *
 * `retryable` is the signal the webhook needs: a 5xx or a network failure means
 * "Stripe is unwell, try again"; a 404 or an unpaid session means "this will
 * never succeed, stop retrying."
 */
export async function loadPaidSession(sessionId, key) {
  if (!sessionId || typeof sessionId !== "string") {
    return { ok: false, code: "missing_session", message: "No session id was provided.", status: 0, retryable: false };
  }

  // expand payment_intent — the confirmation metadata written by
  // confirm-business.js lives on the PaymentIntent, not the Session (spec §3.1).
  const { ok, status, body, networkError } = await stripeGet(
    `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
    key
  );

  if (networkError) {
    return { ok: false, code: "stripe_unreachable", message: "Could not reach Stripe.", status: 0, retryable: true };
  }
  if (!ok || !body || body.error) {
    // 5xx → Stripe's problem, worth another attempt. 4xx → the session id is
    // bad or gone, and hammering it will never help.
    const retryable = status >= 500;
    return {
      ok: false,
      code: retryable ? "stripe_error" : "invalid_session",
      message: retryable ? "Stripe returned a server error." : "Stripe did not return that session.",
      status,
      retryable,
    };
  }
  if (body.payment_status !== "paid") {
    // Never trust the webhook body's word for it — this is the server-side re-check.
    return { ok: false, code: "unpaid", message: "Session is not paid.", status, retryable: false };
  }

  return { ok: true, session: body };
}

/* --------------------------- field readers ------------------------------- */

/* Read a Checkout Session custom_field by any of `candidateKeys`.
   Ported from confirm-business.js. Custom fields carry their value under
   text/numeric/dropdown depending on the field type. */
export function readCustomField(session, candidateKeys) {
  const fields = session && Array.isArray(session.custom_fields) ? session.custom_fields : [];
  for (const f of fields) {
    if (!f || !candidateKeys.includes(f.key)) continue;
    const v = (f.text && f.text.value) || (f.numeric && f.numeric.value) || (f.dropdown && f.dropdown.value);
    if (v) return String(v).trim();
  }
  return "";
}

/* Read a `metadata` bag by any of `candidateKeys`. Works on either Stripe object
   — the Session or the PaymentIntent — since both expose plain `metadata`. */
export function readMetadata(obj, candidateKeys) {
  const md = (obj && obj.metadata) || {};
  for (const k of candidateKeys) {
    if (md[k]) return String(md[k]).trim();
  }
  return "";
}

/* Business name + location, custom_fields first then metadata as a fallback —
   the same precedence confirm-business.js uses. */
export function readBusiness(session) {
  const name = readCustomField(session, NAME_KEYS) || readMetadata(session, NAME_KEYS);
  const location = readCustomField(session, LOCATION_KEYS) || readMetadata(session, LOCATION_KEYS);
  return { name, location };
}

/* Normalize `session.payment_intent`, which is a full object when the expand
 * worked and a bare id string when it did not.
 *
 * Returns { id, object } where `object` is null if only an id came back. The
 * caller MUST treat a null object as a failure: every gate field lives in that
 * object's metadata, and confirm-business.js only ever writes those fields — no
 * existing code reads them back, so there is no second source to fall back on.
 */
export function extractPaymentIntent(session) {
  const pi = session && session.payment_intent;
  if (pi && typeof pi === "object" && pi.id) return { id: String(pi.id), object: pi };
  if (typeof pi === "string" && pi) return { id: pi, object: null };
  return { id: "", object: null };
}
