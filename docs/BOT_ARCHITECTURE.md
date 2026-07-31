# Bot Architecture — the Two-Tier Deep Dive Tool

> Build spec for the automated Deep Dive: a **free instant scan** anyone can run against their own website, and the **paid full report** that adds verified Google Business Profile data. Companion to `docs/SITE_BUILD_SPEC.md` (the site) and `docs/PROJECT_MASTER.md` (the strategy).

**Owner of doc:** Untitled Publishers
**Created:** 2026-07-22
**Read first:** `docs/PROJECT_MASTER.md`

---

## Purpose

Two-tier Deep Dive: a **free instant scan** that runs on the visitor's website, and a **paid full report** that adds Google Business Profile data.

The paywall sits on a **real capability boundary** — the free tier genuinely cannot see GBP data, local rankings, reviews, or competitors from a website fetch. The upsell is therefore honest rather than artificial withholding: the free tool does everything it *can* do from the outside, and the paid report is the part that requires going where the free tool cannot. This matches the site's public claim (`src/index.njk`, research section): the research runs automatically; what it looks for is the hand-built method.

---

## Hosting and runtime

- Site deploys as a **Cloudflare Pages** project from `mrmicaiah/rank-on-call`, production branch `main`, build command `npm run build`, output `_site`.
- Serverless endpoints live in a **`functions/` directory** in the same repo (Cloudflare Pages Functions). **One repo, one deploy.**
- The Places API key lives **ONLY in Cloudflare's environment variables** (`GOOGLE_PLACES_API_KEY`, mirroring `.env.example`). It is **never** in the repo, never in client-side JS, never in a build artifact. (Local dev: `.env`, gitignored — see `docs/PRE_LAUNCH_CHECKLIST.md` for the deploy-host env-var owner action.)

> `docs/SITE_BUILD_SPEC.md` was synced to this hosting choice on 2026-07-22 (Tech stack + build step 8) — GitHub Pages was ruled out because it cannot run the serverless functions the bot requires.

---

## Free tier — what it checks

**Input: website URL (required).** Everything else optional.

The endpoint fetches and parses the visitor's own website **server-side** — CORS makes this impossible client-side, which is also why this must be an endpoint and not page JavaScript. Checks:

1. **Title tags and meta descriptions** — missing, duplicated, or truncated
2. **LocalBusiness structured data / schema markup** — present or absent
3. **NAP consistency** — business name, address, phone compared across header, footer, and contact page
4. **Broken or placeholder counters** — e.g. "0+ installs", "0+ reviews"

**Free tier makes ZERO Places API calls.** No allowance burn, no rate-limit exposure, unlimited lookups.

> ⚠️ **Fetch scar, carried from `PROJECT_MASTER.md:211`:** web fetch ≠ what a human browser sees. Cloudflare-protected and JS-rendered sites can serve bots broken or empty content. **A blank fetch is not proof of a blank page** — the free tier must distinguish "your site is missing X" from "we couldn't read your site," and must say the second honestly rather than reporting false findings. A false "your title tag is missing" against a site our fetcher simply couldn't render is the free-tier version of the wrong-business problem.

---

## Free tier — what it must NOT do

**HARD RULE, not a style note: the free tier never renders a verdict.** No "your site looks healthy," no score, no letter grade, no green checkmark summary. A technically clean website can have a disastrous local presence — clean titles and valid schema say nothing about rankings, reviews, or a competitor owning the map pack. A "healthy" verdict from the free tool would be a false all-clear that costs the visitor real calls and costs us the sale.

What it does instead: **reports what it checked and what it found, then names the gap explicitly** — the things it cannot see from outside (how you appear in local search, your Business Profile, your reviews, who outranks you) are the paid report. The boundary line is the sales pitch, stated as fact.

---

## Cost model

- **Free tier: zero Places calls, zero marginal cost per scan.** Scales with traffic at no API cost.
- **Paid tier: Places calls only occur after payment.** Every API call has revenue attached.
- **The tier trap:** requesting ratings or reviews in a Places call moves it from the **Pro SKU (5,000 free calls/month)** to **Enterprise (1,000/month)**. The paid report needs those fields, so **budget against the 1,000 figure, not 5,000.**
- These figures are **as of 2026-07-22** and Google has restructured Maps pricing before — verify against Google's current pricing page before relying on them.

---

## Email capture

- **Optional field, shown AFTER the free results render** — never before.
- **Unchecked opt-in box** for local-search tips.
- Rationale: asking before any value is delivered is the biggest drop-off point in a free tool; asking after a real finding converts far better.
- **CAN-SPAM obligation:** every send includes a real unsubscribe link and a physical mailing address. This is a legal requirement, not a courtesy.

---

## Paid tier — the flow

1. Buyer clicks through from the **free scan results** and POSTs to **`/api/checkout`** (`functions/api/checkout.js`), which creates a dynamic **Stripe Checkout Session** — there is **no Stripe Payment Link**, and none is linked from the site. The session collects **two required `custom_fields`** — keys **`businessname`** and **`citystate`** (Stripe requires alphanumeric keys, no underscores) — and carries the scanned URL in session **metadata** (`scanned_url`). Its `success_url` routes to **`/thank-you/?session_id={CHECKOUT_SESSION_ID}`**.
2. System queries the **Places API** with name + city.
3. **WRONG-BUSINESS CONFIRMATION — mandatory.** Places returns candidates. The buyer is shown **2–4 matching listings** with name, address, and rating, and **must click the one that is theirs** before the report generates. **No auto-delivery on an unconfirmed match, ever.**
4. **If none of the candidates match**, the buyer selects a "none of these look right" option. This routes to manual handling — the report is not generated automatically. This is the escape hatch for the case where Places returns nothing usable; it must never force a guess.
5. Report generates against the **confirmed `place_id`**.

### What the flow writes to Stripe metadata

Most post-checkout state is recorded by the confirmation gate (`functions/api/confirm-business.js`) on the **PaymentIntent** metadata — Checkout Sessions are immutable after creation, so the PaymentIntent is where post-checkout state lives (zero new infra for v1; it also surfaces in the Stripe dashboard next to the payment). But **the metadata is split across two Stripe objects**: `scanned_url` is written at checkout time, before a PaymentIntent exists to write to, so it lands on the **Checkout Session**. **This is the contract the report generator reads** — written down here so it doesn't live only in source, with the storage location made explicit per key because a consumer that reads one object will not see the other's keys:

| Key | Stored on | Written by | Meaning |
|---|---|---|---|
| `scanned_url` | **Checkout Session** | checkout POST | The URL from the free scan, carried through payment (absent if the buyer arrived without one, or supplied an invalid URL) |
| `confirmed_place_id` | PaymentIntent | confirm POST | Google Places `place_id` the buyer clicked (empty on manual) |
| `confirmed_name` | PaymentIntent | confirm POST | Business name as confirmed |
| `confirmed_address` | PaymentIntent | confirm POST | Address of the confirmed listing (or manually entered) |
| `confirmed_phone` | PaymentIntent | confirm POST | Manual phone, when supplied on the "none of these" path (absent otherwise) |
| `confirmation_method` | PaymentIntent | confirm POST | `"places"` or `"manual"` |
| `ownership_attested` | PaymentIntent | confirm POST | `"true"` — buyer attested owner/authorized rep |
| `attested_at` | PaymentIntent | confirm POST | ISO 8601 timestamp of the attestation |
| `report_due_at` | PaymentIntent | confirm POST | Delivery deadline, ISO 8601 with offset (America/Chicago) |
| `report_due_display` | PaymentIntent | confirm POST | Human deadline string, e.g. "Wednesday, July 29 at 5:00 PM Central" |
| `intent_service` | PaymentIntent | intake POST | Optional: #1 service the buyer wants more of |
| `intent_target_area` | PaymentIntent | intake POST | Optional: city/area they most want to win |
| `intent_paid_leads` | PaymentIntent | intake POST | Optional: `yes` / `no` / `not sure` |
| `intent_pain` | PaymentIntent | intake POST | Optional: what's already bugging them about their site |
| `intent_competitors` | PaymentIntent | intake POST | Optional: 1–2 competitors they lose work to |

> ⚠️ **A consumer reading only the PaymentIntent will not see `scanned_url`.** It lives on the Checkout Session (`functions/api/checkout.js:81`) and must be retrieved from the Session separately — via the `session_id` the `success_url` carries, or by expanding the Session from the PaymentIntent. The same is true of the two required `custom_fields` (`businessname`, `citystate`): they are Session data, not metadata, and `confirm-business.js` reads them off the Session. Anything that needs the scanned URL — including the report generator — must retrieve the Session, not just the PaymentIntent.

The five `intent_*` keys are optional and collected **after** confirmation (`functions/api/intake.js`); they are absent if the buyer skipped them.

**There is no database. Stripe metadata IS the store** for v1 — which means the report generator reads this contract straight off Stripe, and everything here lives within Stripe's metadata limits: **max 50 keys per object, 40 characters per key, 500 characters per value.** All values are strings, and the endpoints truncate each to the 500-char cap so a long free-text answer can never cause a failed write. The limits are **per object**, so the two stores have separate budgets: at most 14 keys on the PaymentIntent and 1 on the Session, both far under 50, leaving headroom for later additions.

---

## Why the confirmation step exists

*(Authored from `PROJECT_MASTER.md:128` and the decision log at :240 — this section's rationale predates this doc and is the project's most explicitly recorded risk.)*

Three different businesses can share a name, and the correct one is not always the first result. Without the confirmation step, a fully automated pipeline will — eventually and inevitably — email a polished, confident, completely wrong report about someone else's company, with a Stripe receipt attached. That is a refund, a bad review, and a credibility loss in one message, delivered to a paying customer at the exact moment they were most willing to trust us.

The master doc's own words: **"Verification is not optional overhead; it is the thing that makes automation survivable"** — and it names shipping automation without solving wrong-business verification as the single highest-consequence mistake available to this project (`PROJECT_MASTER.md:187`).

The confirmation step is how full automation honors that decision: the human judgment that used to happen in the manual insight pass ("is this report about the right company?") is **moved to the one person who can answer it instantly and with certainty — the buyer.** It costs one click at the moment of highest engagement (they just paid) and converts the wrong-business risk from a silent failure mode into an explicit, buyer-verified gate. The decision log's constraint — *"wrong-business verification must precede any auto-delivery"* — remains satisfied under full automation.

---

## Open items

- [x] **Docs-sync complete (2026-07-22):** `SITE_BUILD_SPEC.md` hosting updated to Cloudflare Pages with the ruled-out reason recorded; `PROJECT_MASTER.md` launch-model sections and decision log updated to the automated model + buyer-confirmation gate, original constraints preserved.
- [x] Manager review complete (2026-07-22). The authored "Why the confirmation step exists" section was reviewed and retained as written.
