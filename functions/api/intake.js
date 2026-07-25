/**
 * High-value intent fields — Cloudflare Pages Function at /api/intake.
 * Spec: docs/PROJECT_MASTER.md ("Intake form — two tiers" → HIGH-VALUE INTENT fields).
 *
 * These are OPTIONAL and collected AFTER confirmation, on the /thank-you/ success
 * panel. They sharpen the report; they never gate or delay the confirmation. This
 * endpoint is therefore separate from the confirmation POST (a distinct route can't
 * share one file's onRequestPost) and simply appends to the SAME PaymentIntent
 * metadata the confirmation already wrote to.
 *
 * SECURITY / discipline (mirrors confirm-business.js):
 *  - Paid status is re-verified server-side every call; a client paid flag is never
 *    trusted. Reuses loadPaidSession/stripePost/json from confirm-business.js.
 *  - Stripe metadata limits: 50 keys, 40-char keys, 500-char VALUES. The free-text
 *    fields can exceed 500 — they are TRUNCATED server-side, never rejected. A buyer
 *    writing an essay must never cause a failed write.
 *  - Empty fields are skipped entirely — no empty strings written.
 */

import { json, loadPaidSession, stripePost } from "./confirm-business.js";

// Client body keys === metadata keys (per the task). 40-char cap on keys is satisfied.
const INTENT_KEYS = [
  "intent_service",
  "intent_target_area",
  "intent_paid_leads",
  "intent_pain",
  "intent_competitors",
];

const MAX_VALUE = 500; // Stripe metadata per-value cap

export async function onRequestPost({ request, env }) {
  const key = env && env.STRIPE_SECRET_KEY;
  if (!key) {
    return json({ status: "error", code: "config", message: "That isn't available right now. Please try again shortly." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  // Re-retrieve + re-gate the session server-side. Only a paid session gets intent
  // written — and loadPaidSession expands payment_intent, giving us the id below.
  const loaded = await loadPaidSession(payload.session_id, key);
  if (loaded.error) return loaded.error;
  const session = loaded.session;

  const pi = session.payment_intent;
  const paymentIntentId = pi && typeof pi === "object" ? pi.id : (typeof pi === "string" ? pi : "");
  if (!paymentIntentId) {
    return json({ status: "error", code: "no_payment_intent", message: "We couldn't attach that to your order. Please try again shortly." }, 502);
  }

  // Build the update from non-empty fields only, each truncated to the Stripe cap.
  const form = new URLSearchParams();
  let wrote = 0;
  for (const k of INTENT_KEYS) {
    const raw = typeof payload[k] === "string" ? payload[k].trim() : "";
    if (!raw) continue; // skip empties entirely — never write empty strings
    form.set(`metadata[${k}]`, raw.slice(0, MAX_VALUE)); // truncate, never throw
    wrote++;
  }

  // Nothing to save (buyer submitted a blank form) — success, no Stripe call needed.
  if (wrote === 0) return json({ status: "ok", saved: 0 });

  const upd = await stripePost(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, key, form);
  if (!upd.ok || !upd.body || upd.body.error) {
    console.error("Intent metadata update failed", {
      httpStatus: upd.status,
      errorType: upd.body && upd.body.error && upd.body.error.type,
    });
    return json({ status: "error", code: "record_failed", message: "We couldn't save that just now. Please try again in a moment." }, 502);
  }

  return json({ status: "ok", saved: wrote });
}
