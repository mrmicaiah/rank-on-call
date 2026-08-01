# Bot Architecture — the Two-Tier Deep Dive Tool

> Build spec for the automated Deep Dive: a **free instant scan** anyone can run against their own website, and the **paid full report** that adds verified Google Business Profile data. Companion to `docs/SITE_BUILD_SPEC.md` (the site) and `docs/PROJECT_MASTER.md` (the strategy).

**Owner of doc:** Untitled Publishers
**Created:** 2026-07-22
**Read first:** `docs/PROJECT_MASTER.md`

---

## ⚠️ AMENDED 2026-08-01 — the funnel was reordered; this document was wrong

**`docs/FUNNEL_REORDER_SPEC.md` is AUTHORITATIVE for the funnel order, the attestation, and the launch gate.** Where it and this document disagree, it wins. This document remains authoritative for the free/paid tier boundary and the free scan's constraints, which the reorder does not touch.

Confirmation and attestation now happen **before** payment, not on `/thank-you/` after it. That invalidated four things here, all now corrected:

| What was wrong | Where |
|---|---|
| **Eight metadata keys were listed as PaymentIntent / confirm POST.** They are now **Checkout Session** metadata written at session creation | the metadata table below |
| **`report_due_at` / `report_due_display` were listed as Stripe metadata.** They are not Stripe data at all any more — they live in **D1**, computed in the Piece 1 webhook | same table |
| **"Places calls only occur after payment"** — no longer true | Cost model |
| **The flow described checkout first**, with Stripe collecting `businessname` / `citystate` via `custom_fields`, which are now dropped | Paid tier — the flow |

> **Why this mattered enough to fix immediately:** this document advertises the table below as *"the contract the report generator reads."* A session building the report generator would come here for the contract and read every confirmation field off the wrong Stripe object — reproducing the exact silent bug `FULFILLMENT_WORKER_SPEC.md` §3.1 warns about, except sourced from documentation rather than memory, which makes it harder to catch.

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

- **Free tier: zero Places calls, zero marginal cost per scan.** Scales with traffic at no API cost. **Unchanged by the funnel reorder** — `functions/api/scan.js` contains exactly one outbound fetch, to the target URL, and references no Places endpoint or Google key at all.
- **⚠️ AMENDED 2026-08-01 — Places calls no longer all sit behind payment.** This line previously read *"Paid tier: Places calls only occur after payment. Every API call has revenue attached."* **That invariant is broken** by pre-payment confirmation, and it is not softened here because the whole value of the original line was its precision. What is true now:

| Call | When | Field mask | SKU | Revenue attached? |
|---|---|---|---|---|
| **Candidate lookup** (`places:searchText`) | **pre-payment**, on unpaid traffic | id, displayName, formattedAddress, websiteUri | **Pro — 5,000/mo** | **No** |
| **Details fetch** on the confirmed `place_id` | **post-payment**, once per order | ratings, review count, phone, category, types | **Enterprise — 1,000/mo** | Yes |

  The split is deliberate and is the mitigation: **the scarce Enterprise budget stays entirely behind the paywall**, and unpaid traffic draws only on the 5×-larger Pro budget. The pre-payment lookup is **rate-limited** (proposed 5 per IP per hour, layered WAF rule + in-function counter + response caching). Full reasoning, including why the field mask had to be split rather than simply reused, is in **`FUNNEL_REORDER_SPEC.md` §7**.
- **The tier trap:** requesting ratings or reviews in a Places call moves it from the **Pro SKU (5,000 free calls/month)** to **Enterprise (1,000/month)**. The paid report needs those fields, so **budget against the 1,000 figure, not 5,000.** This is exactly why the pre-payment mask omits them — the old confirmation lookup requested `rating` and `userRatingCount`, which would have put anonymous traffic on the 1,000-call budget.
- These figures are **as of 2026-07-22** and Google has restructured Maps pricing before — verify against Google's current pricing page before relying on them.

---

## Email capture

- **Optional field, shown AFTER the free results render** — never before.
- **Unchecked opt-in box** for local-search tips.
- Rationale: asking before any value is delivered is the biggest drop-off point in a free tool; asking after a real finding converts far better.
- **CAN-SPAM obligation:** every send includes a real unsubscribe link and a physical mailing address. This is a legal requirement, not a courtesy.

---

## Paid tier — the flow

> **⚠️ AMENDED 2026-08-01 — steps reordered. Confirmation now happens BEFORE payment.** The previous order was checkout → `/thank-you/` confirmation gate. Authoritative: `FUNNEL_REORDER_SPEC.md` §1.

1. Buyer clicks through from the **free scan results** to the **confirmation step on our own page**, carrying the scanned URL.
2. System queries the **Places API** with name + city, using the **Pro-SKU field mask** (see Cost model). Rate-limited, because this now runs on unpaid traffic.
3. **WRONG-BUSINESS CONFIRMATION — mandatory, and now pre-payment.** Places returns candidates. The buyer is shown **2–4 matching listings** with name and address, and **must click the one that is theirs**. **No auto-delivery on an unconfirmed match, ever.** Candidates whose GBP website domain matches the scanned URL sort first and are marked — this **ranks**, it never auto-selects (`FUNNEL_REORDER_SPEC.md` §4).
4. **If none of the candidates match**, the buyer takes the manual path: types business name + address themselves. `confirmation_method = "manual"`, no `confirmed_place_id`. It must never force a guess. Post-payment this routes to hold pending the no-GBP resolution question (`FUNNEL_REORDER_SPEC.md` §5).
5. **AFFILIATION ATTESTATION + owner name**, in the same block as the payment button. Required on the paid path. **This is a claim, nothing verifies it** — `FUNNEL_REORDER_SPEC.md` §2. The verbatim wording and its version are recorded in D1.
6. Buyer POSTs to **`/api/checkout`** (`functions/api/checkout.js`), which writes the attestation record and creates a dynamic **Stripe Checkout Session** — there is **no Stripe Payment Link**, and none is linked from the site. **The two `custom_fields` (`businessname`, `citystate`) are DROPPED** — that information is now collected and disambiguated before checkout, so asking Stripe to collect it again could only introduce a mismatch. All confirmation data goes into **session metadata** at creation. `success_url` routes to **`/thank-you/?session_id={CHECKOUT_SESSION_ID}`**.
7. Payment. `checkout.session.completed` fires; the Piece 1 webhook computes the delivery deadline and enqueues the job.
8. Report generates against the **confirmed `place_id`**. The optional `intent_*` fields are still collected **after** payment on `/thank-you/`.

### What the flow writes to Stripe metadata

**⚠️ AMENDED 2026-08-01 — the storage column below changed for eight keys.** Because confirmation now happens **before** the Checkout Session is created, every confirmation field is known at session-creation time and is written into **Checkout Session metadata** there. Nothing writes them to the PaymentIntent any more. Only the five optional `intent_*` keys still land on the PaymentIntent, because `intake.js` is still post-payment.

**This is the contract the report generator reads** — written down here so it doesn't live only in source, with the storage location made explicit per key because a consumer that reads one object will not see the other's keys:

| Key | Stored on | Written by | Meaning |
|---|---|---|---|
| `scanned_url` | **Checkout Session** | checkout POST | The URL from the free scan, carried through payment (absent if the buyer arrived without one, or supplied an invalid URL) |
| `confirmed_place_id` | **Checkout Session** | checkout POST | Google Places `place_id` the buyer clicked (empty on manual) |
| `confirmed_name` | **Checkout Session** | checkout POST | Business name as confirmed |
| `confirmed_address` | **Checkout Session** | checkout POST | Address of the confirmed listing (or manually entered). **Never printed** — output privacy lock |
| `confirmed_phone` | **Checkout Session** | checkout POST | Manual phone, when supplied on the manual path (absent otherwise). **Never printed** |
| `confirmation_method` | **Checkout Session** | checkout POST | `"places"` or `"manual"` |
| `ownership_attested` | **Checkout Session** | checkout POST | `"true"` — buyer attested affiliation. ⚠️ The KEY still says "ownership"; the displayed wording asserts **affiliation** (`FUNNEL_REORDER_SPEC.md` §1.2 — the key is deliberately not renamed) |
| `attested_at` | **Checkout Session** | checkout POST | ISO 8601 timestamp of the attestation |
| `attestation_id` | **Checkout Session** | checkout POST | Foreign key into the D1 `attestations` table, which holds the verbatim wording and its version |
| `intent_service` | PaymentIntent | intake POST | Optional: #1 service the buyer wants more of |
| `intent_target_area` | PaymentIntent | intake POST | Optional: city/area they most want to win |
| `intent_paid_leads` | PaymentIntent | intake POST | Optional: `yes` / `no` / `not sure` |
| `intent_pain` | PaymentIntent | intake POST | Optional: what's already bugging them about their site |
| `intent_competitors` | PaymentIntent | intake POST | Optional: 1–2 competitors they lose work to |

**No longer Stripe metadata at all:**

| Key | Now lives in | Computed by | Meaning |
|---|---|---|---|
| `report_due_at` | **D1 `jobs` row** | Piece 1 webhook | Delivery deadline: **the Stripe event timestamp + 24 hours**, ISO 8601 with offset |
| `report_due_display` | **D1 `jobs` row** | Piece 1 webhook | Human deadline string, e.g. *"Thursday, August 6 at 2:14 PM Central"* |

> ⚠️ **The deadline is computed from the STRIPE EVENT TIMESTAMP, not from when the webhook runs.** The webhook returns 500 on transient failures to invite a Stripe retry, and Stripe's retry schedule spreads over hours — computing from "now" would silently grant a later deadline than the buyer's receipt implies. `FULFILLMENT_WORKER_SPEC.md` §3.2.
>
> The old rule (3 business days, weekends and US holidays skipped, 5:00 PM landing) is retired. `America/Chicago` is now **display-only**.

> ⚠️ **The both-objects read is REDUCED, not eliminated.** A consumer reading only the Checkout Session now has everything needed to aim the report — that is the point of the change. But the five `intent_*` keys still live on the **PaymentIntent**, so anything wanting steering inputs must still retrieve both, via `expand[]=payment_intent`. **The two `custom_fields` (`businessname`, `citystate`) no longer exist** and must not be read for.
>
> Note also the timing: `checkout.session.completed` fires before the buyer fills the intake form, so **`intent_*` do not exist yet at webhook time.** They must be read by the pipeline at research time, not from the queue message. `FULFILLMENT_WORKER_SPEC.md` §3.1.

The five `intent_*` keys are optional and collected **after** payment (`functions/api/intake.js`); they are absent if the buyer skipped them.

**⚠️ There IS a database now.** This previously read *"There is no database. Stripe metadata IS the store for v1."* That is no longer true: the fulfillment worker owns a **D1 database** (`worker/schema.sql`) holding the `jobs` table and the `attestations` table. Stripe metadata remains the **carrier** from checkout into the pipeline, but it is no longer the system of record for anything the Worker owns — hence the deadline moving out of it.

Everything still written to Stripe lives within Stripe's metadata limits: **max 50 keys per object, 40 characters per key, 500 characters per value.** All values are strings, and the endpoints truncate each to the 500-char cap so a long free-text answer can never cause a failed write. The limits are **per object**, so the two stores have separate budgets: at most 5 keys on the PaymentIntent and 9 on the Session, both far under 50, leaving headroom for later additions.

---

## Why the confirmation step exists

*(Authored from `PROJECT_MASTER.md:128` and the decision log at :240 — this section's rationale predates this doc and is the project's most explicitly recorded risk.)*

Three different businesses can share a name, and the correct one is not always the first result. Without the confirmation step, a fully automated pipeline will — eventually and inevitably — email a polished, confident, completely wrong report about someone else's company, with a Stripe receipt attached. That is a refund, a bad review, and a credibility loss in one message, delivered to a paying customer at the exact moment they were most willing to trust us.

The master doc's own words: **"Verification is not optional overhead; it is the thing that makes automation survivable"** — and it names shipping automation without solving wrong-business verification as the single highest-consequence mistake available to this project (`PROJECT_MASTER.md:187`).

The confirmation step is how full automation honors that decision: the human judgment that used to happen in the manual insight pass ("is this report about the right company?") is **moved to the one person who can answer it instantly and with certainty — the buyer.** It costs one click at the moment of highest engagement and converts the wrong-business risk from a silent failure mode into an explicit, buyer-verified gate. The decision log's constraint — *"wrong-business verification must precede any auto-delivery"* — remains satisfied under full automation.

> **⚠️ AMENDED 2026-08-01:** this paragraph previously placed that click *after* payment ("they just paid"). It is now **before** payment. **The rationale is unchanged and arguably stronger** — the constraint was always that verification must precede auto-delivery, and it now precedes the *purchase* as well. The practical gain is that a buyer whose listing cannot be found discovers it before paying rather than after, which turns a refund conversation into a free one.

---

## Open items

- [x] **Docs-sync complete (2026-07-22):** `SITE_BUILD_SPEC.md` hosting updated to Cloudflare Pages with the ruled-out reason recorded; `PROJECT_MASTER.md` launch-model sections and decision log updated to the automated model + buyer-confirmation gate, original constraints preserved.
- [x] Manager review complete (2026-07-22). The authored "Why the confirmation step exists" section was reviewed and retained as written.
