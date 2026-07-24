/**
 * Stripe Checkout Session creator — Cloudflare Pages Function, served at /api/checkout.
 * Spec: docs/BOT_ARCHITECTURE.md ("Paid tier — the flow", step 1).
 *
 * This replaces the static Stripe Payment Link so we can carry the scanned URL
 * through payment (Option B) into session metadata, where the later
 * wrong-business confirmation flow can read it.
 *
 * SECURITY (hard rules, mirroring scan.js discipline):
 *  - STRIPE_SECRET_KEY is read ONLY from context.env. Never hardcoded, never
 *    sent to the client, never logged. It appears exactly once below, as a
 *    Bearer header — it is never placed in any object we return or console.log.
 *  - No stripe npm package — the REST API is called directly with fetch,
 *    consistent with scan.js avoiding heavy deps.
 *  - Client input (the scanned url) is normalized/validated with scan.js's own
 *    guard before it goes anywhere near the session.
 */

import { normalizeAndValidateUrl } from "./scan.js";

const STRIPE_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";
const DEFAULT_SITE_BASE = "https://rankoncall.com";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/* --------------------------- health check (GET) ---------------------------- */
/* Booleans ONLY — never the values. Lets us confirm the env wiring post-deploy
   without exposing any secret or even the price ID string. */
export function onRequestGet({ env }) {
  return json({
    hasStripeKey: Boolean(env && env.STRIPE_SECRET_KEY),
    hasPriceId: Boolean(env && env.STRIPE_PRICE_ID),
    hasSiteBase: Boolean(env && env.SITE_BASE_URL),
  });
}

/* ----------------------------- checkout (POST) ----------------------------- */
export async function onRequestPost({ request, env }) {
  const key = env && env.STRIPE_SECRET_KEY;
  const priceId = env && env.STRIPE_PRICE_ID;

  // Config errors are ours, not the buyer's — 500, and never name the missing
  // secret specifically in a way that leaks which env vars exist.
  if (!key || !priceId) {
    return json(
      { status: "error", message: "Checkout isn't available right now. Please try again shortly." },
      500
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  // The scanned URL is OPTIONAL — checkout must still work without it.
  // When present, validate with the same guard scan.js uses; a bad value is
  // simply dropped from metadata rather than blocking the purchase.
  let scannedUrl = "";
  if (payload && typeof payload.url === "string" && payload.url.trim()) {
    const v = normalizeAndValidateUrl(payload.url);
    if (v.url) scannedUrl = v.url;
  }

  const base = (env && env.SITE_BASE_URL) || DEFAULT_SITE_BASE;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", `${base}/thank-you/?session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${base}/deep-dive/`);
  // Option B: carry the scanned site through payment for the confirmation flow.
  if (scannedUrl) form.set("metadata[scanned_url]", scannedUrl);

  // Buyer-confirmation gate inputs (docs/BOT_ARCHITECTURE.md "Paid tier — the flow"):
  // the /thank-you/ gate queries Google Places with these to show the buyer their
  // own listing to confirm. Both REQUIRED (optional=false) — a report can't be
  // aimed without them. Stripe rule: custom_fields[].key must be ALPHANUMERIC (no
  // underscores), so keys are `businessname` / `citystate`; label.custom caps at
  // 50 chars. confirm-business.js reads these exact keys.
  form.set("custom_fields[0][key]", "businessname");
  form.set("custom_fields[0][label][type]", "custom");
  form.set("custom_fields[0][label][custom]", "Business name");
  form.set("custom_fields[0][type]", "text");
  form.set("custom_fields[0][optional]", "false");
  form.set("custom_fields[1][key]", "citystate");
  form.set("custom_fields[1][label][type]", "custom");
  form.set("custom_fields[1][label][custom]", "City and state");
  form.set("custom_fields[1][type]", "text");
  form.set("custom_fields[1][optional]", "false");

  let stripeRes, stripeBody;
  try {
    stripeRes = await fetch(STRIPE_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`, // the ONLY use of the key — not logged, not returned
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    stripeBody = await stripeRes.json();
  } catch {
    return json({ status: "error", message: "Couldn't reach the payment processor. Please try again." }, 502);
  }

  if (!stripeRes.ok || !stripeBody || !stripeBody.url) {
    // Do NOT echo stripeBody — a raw Stripe error can carry request/account
    // detail we don't want client-side. Log only the type + code, never the key.
    console.error("Stripe session creation failed", {
      httpStatus: stripeRes.status,
      errorType: stripeBody && stripeBody.error && stripeBody.error.type,
      errorCode: stripeBody && stripeBody.error && stripeBody.error.code,
    });
    return json({ status: "error", message: "We couldn't start checkout. Please try again." }, 502);
  }

  return json({ url: stripeBody.url });
}
