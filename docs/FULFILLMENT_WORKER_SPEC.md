# Rank On Call — Fulfillment Worker Spec

**Status:** APPROVED — Irene reviewed 2026-07-31. Build may proceed per §7.6 sequencing. **Piece 1 (webhook + job store + queue enqueue) is now built** — `worker/`, commit `d950011` — but not deployed. Everything downstream is still unbuilt.
**Governed by:** `docs/AUTOMATION_PIPELINE_SPEC.md` — its §3/§4 (checkpoint template + research set), §5 (deterministic safety layer), §6 (privacy locks), and §7 (deliverable shape) are **inputs to this spec, not things it redefines.** Where this document and that one disagree, that one wins and this one is wrong.
**Scope:** the worker that implements that architecture. Everything from the Stripe webhook to the delivered email.

---

## ⚠️ AMENDED 2026-08-01 — reconciled with `docs/FUNNEL_REORDER_SPEC.md`

Irene made a set of decisions recorded in `docs/FUNNEL_REORDER_SPEC.md` (as amended in `5d01ecc`) that this document contradicted. **These are reconciliations to decisions already made, not new proposals — the APPROVED status is unchanged.** What moved:

| § | Change | Why |
|---|---|---|
| **§3.2** | **Delivery is 24 hours from payment**, not 3 business days. No weekend skipping, no holiday table, no 5:00 PM landing. America/Chicago is **display-only** | The 3-day window was padding for per-report human review; with auto-send it is a conversion hurdle on an impulse purchase |
| **§3.2** | The clock starts from the **Stripe event timestamp**, never from webhook processing time | New requirement created by the shorter window — see the ⚠️ in §3.2 |
| **§1.2** | The launch gate **moved** from "copy must not ship" to "traffic must not be pointed at the site" | The site has no traffic and is not indexed, so the copy ships in final form now |
| **§1.4** | Confirmation and attestation now happen **pre-payment**. **The gate stays, unweakened** | It becomes an assertion that should rarely fire, rather than a routing fork |
| **§3.1** | The both-objects read is **reduced, not eliminated** | The five `intent_*` fields stay on the PaymentIntent |
| **§2.2, §7.1, §7.4** | Three recovery/cost assumptions that silently depended on a multi-day window | Flagged. §7.1 has since been **RESOLVED** — ROC has its own DataForSEO account |
| §1.2 | `src/thank-you.njk` citation corrected from line 64 to **line 63** | It was wrong |

**`docs/FUNNEL_REORDER_SPEC.md` is the authority for the funnel order, the attestation, and the launch gate.** This document is the authority for the worker. Where the two touch, that one describes *when things happen* and this one describes *what the worker does about it*.

**What this document is for:** the funnel takes money and captures a verified target. Nothing consumes that. This worker is the missing half of the business — see §6.

---

## 0. Three things to settle before any code is written

Read these first. Each one blocks or reshapes the build.

1. **The live site promises human review. This worker makes that promise false.** Hard launch-gate — §1.2.
2. **The research procedure this worker executes currently instructs a human review step**, in its own words, twice. The repo's copy must be forked and edited or the worker will generate drafts addressed to a reviewer who does not exist — §1.3.
3. **The owned procedure's tool table points at SEO-Scout MCP tools this worker is forbidden to call.** Every tool row needs a direct-call replacement; all are now designated, listings discovery included — §1.3, §7.4.

---

## 1. Locked decisions

Settled. Non-reversible. They keep getting re-litigated; they are recorded here so a future session stops reopening them. **If a build detail requires breaking one, surface it explicitly — do not quietly route around it.**

### 1.1 Full auto-send

**Reports generate, self-check, and send WITHOUT a human read at send time.** This is a deliberate reversal of the previous "a person reads every report" model. **FINAL — do not reopen.**

What earns the right to send unread is **the deterministic checkpoint layer (§4, Checkpoint 4)** — not a human, and not a model reviewer. The distinction is the whole argument: a model reviewer shares blind spots with the generator and the two can hallucinate agreement. A regex/rules sweep shares no blind spots with anything. It is dumb, and that is precisely why it can be trusted to be the last gate.

"Full automation" explicitly **includes the failure path**. The system auto-sends successes **and auto-quarantines failures**. A report that fails a hard checkpoint halts and routes to a holding state automatically, with no human required to catch it. Detect-and-quarantine is the floor. **Silent send-anyway is never acceptable.**

### 1.2 ⚠️ LAUNCH GATE — MOVED 2026-08-01: it is now about TRAFFIC, not copy

> **This gate has moved and is no longer specified here.** The authoritative statement is the **STANDING RULE in the front matter of `docs/FUNNEL_REORDER_SPEC.md`**, which lists the four conditions that must all hold before traffic may be pointed at the site. **Do not restate those conditions anywhere else** — there is one source of truth and it is that block.

**What changed.** Irene ruled on 2026-08-01 that the site has no traffic, is not indexed, and is not advertised, so the copy should be built **exactly as it will finally read** rather than deferred. The gate was *"the copy must not ship."* It is now *"traffic must not be pointed at the site."*

**What did NOT change: the reasoning.** A live claim the product cannot honour is a false statement to a paying customer. That is as true of the new 24-hour delivery promise as it was of the human-review claim — which is precisely why the gate moved rather than being dropped.

> ⚠️ **To a future session: shipped copy is not permission to launch.** If you are reading this and the site copy already reads as final, that tells you nothing about whether the four conditions hold. Go and check them.

The two claims that must be removed as part of the copy pass, recorded here because this document is where they were first identified:

| File | Line | Live text |
|---|---|---|
| `src/index.njk` | 72 | "And nothing goes out unread — a person reads every report before it reaches your inbox." |
| `src/thank-you.njk` | **63** | "Every report gets read by a person before it's sent — that's what the time is for." |

`src/index.njk` also carries a build-time comment (lines 64–68) recording per-report review as a **COMMITTED PRODUCT FEATURE** with an explicit instruction not to quietly drop it. That comment must be updated in the same change, or the next session will read it as authority and restore the claim.

Both landed 2026-07-25 in commit `fe132db`; `git log -S` confirms neither string has been touched since.

**This is a deliberate product reversal, not an implementation detail** — and it is now a decision Irene has made, not one awaiting her. Note that the thank-you copy used the review to justify the delivery wait; with the wait cut to 24 hours (§3.2) that justification is no longer needed at all, so removing the claim leaves nothing requiring a replacement explanation.

### 1.3 Self-contained — this worker calls no existing MCP worker

**It calls none of `productivity-irene`, `productivity-mcp-server`, or `seo-scout`.** No MCP transport, no shared credentials, no runtime dependency on Irene's or Micaiah's infrastructure. It lives in the `rank-on-call` repo and holds its own keys.

| Capability | How this worker gets it |
|---|---|
| Research procedure | **Owned copy in this repo**, forked from **`web-deep-dive`** — `docs/RESEARCH_PROCEDURE_v3.0-roc.md`. ⚠️ Source corrected 2026-08-01, see below |
| Ranking data | **DataForSEO directly**, HTTP Basic auth, ROC's own `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` |
| Google Business Profile | **Places API (New) directly**, existing `GOOGLE_PLACES_API_KEY` |
| Report generation | **Anthropic API directly**, ROC's own key |
| Delivery | **Resend**, already configured |

Rationale: fulfillment must not break because someone redeployed a productivity worker, rotated a shared secret, or drained a shared API balance. A paid order is a contractual obligation with a **24-hour deadline** attached; it cannot hang off infrastructure this project doesn't control. **The shorter window makes this argument stronger, not weaker** — there is no longer a weekend of slack in which someone else's outage can be noticed and worked around.

#### ⚠️ CORRECTED 2026-08-01 — `v3.0-roc` is the SUCCESSOR procedure, derived from `web-deep-dive`

**`docs/RESEARCH_PROCEDURE_v3.0-roc.md` (DRAFT) is the research procedure.** Irene's definition of it: ***`web-deep-dive`'s research depth, PLUS real GBP data, MINUS the privacy layer, with the checkpoint system built in end to end.***

**`deep-dive-client-report` is not a source to derive from — it is the NAME this procedure takes when finished.** Whatever exists under that name on the Productivity MCP today is a **placeholder**; Irene cannot recall whether it was ever completed, and either way it is not accurate. **On completion, `v3.0-roc` replaces it and inherits the name.** It is a successor, not a parallel fork.

**It lives in this repo, version-controlled and wired to the ROC workers — not on the MCP.** That follows from §1.3 above: this worker calls no MCP worker, so a procedure it cannot legally call is not a useful place to keep the procedure.

Everything below in this subsection was written against the wrong source and is superseded by that document. It is kept only because the *kind* of edits it demanded — delivery framing and tool bindings — still had to be made, and the table records where they came from.

> ⚠️ **`AUTOMATION_PIPELINE_SPEC.md` §1 item 5 claimed this work was already DONE.** It was not. That item has been **corrected in place** (dated note, 2026-08-01) as a factual correction rather than a reopened decision — the rebuild remains locked and correct, only the completion claim was false.
>
> **The rest of that item stands and is worth keeping:** its description of the owner-privacy problems as **STRUCTURAL, not incidental** — the Owner/Address/Phone opening table, the identity-verification Phase 1, the WHOIS-registrant and LLC lookups — is accurate, and is exactly the strip `v3.0-roc` §2 actually performs. The item correctly identified the work; it was wrong only that the work had happened.

**Required edits, as originally written against `deep-dive-client-report` v2.1 — retained for the audit trail:**

| Location in v2.1 | What it says | Required change |
|---|---|---|
| §0 | *"The method is hand-built. The digging is automated. Nothing goes out unread."* quoted as "the product claim this report has to earn" | Remove. Ties to the same dead claim as §1.2 — and the exact three-sentence string doesn't appear in the site copy anyway |
| §0 | *"Every report is read by a human before it sends. That is permanent, not scaffolding."* | Remove — directly contradicts §1.1 |
| §0 | *"This skill produces a draft for that human, not a send-ready artifact."* | **Invert.** The output IS the send-ready artifact, subject to Checkpoint 4 |
| §9 heading | *"Run before handing the draft to the human reviewer"* | Reframe as the model self-check that precedes the deterministic sweep. Keep all 13 items — they are good — but they are now Checkpoint 3's checklist, not a handoff note |
| §6 | *"flag it for the human reviewer rather than padding it out"* (thin-report case) | Route to **quarantine** (§3, stage 9) instead |
| §10 (tools) | `seo_analyze`, `seo_test`, `seo_domain_whois`, `seo_domain_check`, `web_fetch`, `web_search` | Rewrite entirely — see §7.4. These name MCP tools this worker cannot call |

**Everything else in v2.1 transfers unchanged and should be preserved carefully** — the deleted-owner-identity spine (§2), the four hard locks (§3), the research set (§4), the CUT list (§5), the fetch scar (§6), the voice rules and banned words (§7), and the report template (§8). That material is hard-won and re-deriving it would lose things. **The fork edits the delivery framing and the tool bindings. It does not touch the research or the locks.**

**Version discipline:** the repo copy is a fork with its own version — **`v3.0-roc`**, at `docs/RESEARCH_PROCEDURE_v3.0-roc.md` — and every generated report records which version produced it. The MCP-hosted `web-deep-dive` and the repo fork will drift; that is expected and fine, but a report must be traceable to the exact procedure that made it.

### 1.4 No generation without a confirmed business

**Hard, deterministic gate.** No report generates unless **both** hold:

- `confirmed_place_id` is present and non-empty, **and**
- `ownership_attested === "true"`

Anything else — missing, empty, `confirmation_method === "manual"` with no place_id — **routes to manual/hold. Never generate on a guess.**

This is not a quality preference. Three businesses can share a name, and emailing a polished, confident, completely wrong report about someone else's company — with a Stripe receipt attached — is the single highest-consequence failure available to this product. The confirmation gate exists so that never happens; this worker must not be the thing that undoes it.

**Note the interaction with §1.1:** full auto-send is safe *because* this gate is upstream of it. The buyer verified the target at the moment of highest engagement. Auto-send without buyer confirmation would be indefensible; auto-send after it is merely automated.

> #### ⚠️ AMENDED 2026-08-01 — confirmation is now PRE-payment. The gate STAYS.
>
> Per `docs/FUNNEL_REORDER_SPEC.md`, confirmation and attestation now happen **before** the Checkout Session is created, not on `/thank-you/` afterwards. That changes what this gate *is*, but not whether it exists.
>
> **Before:** a genuine routing fork. A buyer could pay and then abandon the confirmation step, so a meaningful share of paid orders would legitimately arrive with no `confirmed_place_id`, and the gate decided where they went.
>
> **Now:** an **assertion that should rarely fire.** Nobody can reach payment without confirming and attesting first, so a paid order lacking these fields means something upstream is broken — `checkout.js` failed to write the metadata, a session was created by some other path, or the fields were tampered with.
>
> **⚠️ Do not weaken or remove this gate on the grounds that the funnel already guarantees it. Belt and suspenders.** The reasoning is unchanged and is in the paragraph above: emailing a confident, polished, completely wrong report about someone else's company is the highest-consequence failure available to this product. A gate that never fires costs one string comparison. A gate that was removed because it "couldn't fire" costs a wrong report the first time an upstream assumption turns out to be false.
>
> **What does change is the response.** A firing gate is now a **signal of a defect**, not ordinary traffic. It still routes to manual/hold and still never generates — but it warrants an alert, because under the new funnel it should be approximately never. If it fires regularly, the funnel is broken and the gate is the only thing that noticed.
>
> The manual path (`confirmation_method === "manual"`, no `place_id`) still fails this gate by design and still routes to hold — see `FUNNEL_REORDER_SPEC.md` §5 for the no-GBP resolution step that unblocks those orders.

### 1.5 Internal accuracy bar — never printed

The internal standard: at generation and send, every finding traces to something retrieved **this run**, is date-stamped where it is a ranking claim, and has passed the privacy/banned-word sweep.

**This is an engineering bar, not a customer promise.** No accuracy percentage, confidence score, or guarantee appears anywhere in report copy — *"100% accurate," "verified," "guaranteed findings"* are all forbidden. A printed guarantee is a refund liability. Checkpoint 4 enforces this as a hard check.

---

## 2. Architecture — Worker + VPS split

### 2.1 The shape

```
Stripe (checkout.session.completed)
        │
        ▼
┌───────────────────────────────┐
│  Cloudflare Worker            │   signature verify → read metadata →
│  (rank-on-call repo)          │   gate (§1.4) → enqueue
└───────────────┬───────────────┘
                ▼
        ┌───────────────┐
        │ Durable queue │   a paid order survives any crash
        └───────┬───────┘
                ▼
┌───────────────────────────────┐        ┌──────────────────────────┐
│  Pipeline consumer (Worker)   │◄──────►│  Render VPS              │
│  Places · DataForSEO · crawl  │  HTTPS │  headless full Chrome    │
│  Anthropic · checkpoints      │  +auth │  desktop + mobile capture│
│  Resend send                  │        │  measured load timing    │
└───────────────────────────────┘        └──────────────────────────┘
```

**The durable queue is the crash-proofing, and it is not optional.** A job is not acknowledged until the pipeline finishes. Crash, reboot, thrown exception, network drop — the job was never acked, so it returns to the queue and retries. **A paid order cannot be lost.** This property has nothing to do with any single machine's reliability, and it is why the webhook handler must do almost nothing except enqueue: the less work before the durable write, the smaller the window in which a paid order can evaporate.

**Retry discipline:** the pipeline must be safe to run twice. A retry that re-sends an already-delivered report is its own failure. Record delivery state keyed by PaymentIntent id and make the send step idempotent — check-then-send, with the check inside the same durable record.

### 2.2 Why a VPS at all

A Cloudflare Worker cannot run a real browser, and the **rendered-vs-code check is the product's core differentiator** — seeing the page as a human does and comparing it to what the code claims. That needs full Chrome.

Settled during prior recon, **do not re-litigate:**

- **Headless full Chrome works on this segment.** 13/14 target sites rendered clean first try, 14/14 with one retry, zero permanent blocks — from a datacenter/VPN ASN that bot vendors score harshly. Small-contractor sites (WordPress/Wix/Squarespace/small-shop custom) don't deploy aggressive bot management.
- **UA/fingerprint spoofing produced no measurable improvement. Do not build stealth machinery.**
- **The real risk is render COMPLETENESS, not blocking.** A lazy-loading site returns HTTP 200 with full text and screenshots as garbage — placeholders, duplicated nav — because images load on scroll-intersection. **A false "your site looks broken" in a paid audit is the single most expensive mistake this product can make.** The render service must wait for network-idle, scroll the full page height, await image decode, and/or neutralize lazy-load before capture (force `loading="eager"`, strip plugin `data-*` attrs, set `src` from `data-src`). This deserves real engineering attention, not a screenshot call.
- **Not Cloudflare Browser Rendering** — evaluated and declined: metered, unconfirmed plan entitlement, and binding it into a Pages project is unproven. **Not Irene's laptop** — the business cannot stop when a machine sleeps.
- **Detect "is this page real" by rendered content** (body text > 500 chars AND ≥3 nav/header links), **never by marker strings** — passive Cloudflare scripts and contact-form reCAPTCHA widgets produce false "blocked" readings on perfectly good pages. **Do not use `<h1>`/`<h2>` presence as a content signal** — Squarespace puts hero copy in `<p>`.

The box is disposable. If it dies, spin up another; the queue holds the work meanwhile.

> #### ⚠️ AMENDED 2026-08-01 — "spin up another" assumed a multi-day window
>
> That recovery model was written against a 3-business-day deadline, where a box dying on Friday night could be replaced Monday morning and still deliver comfortably. **§3.2 is now 24 hours, and manual re-provisioning is not a viable recovery path unless someone happens to be awake.**
>
> The queue still holds the work — that part is unaffected, and no order is lost. What is lost is the *deadline*, silently, for every order that arrives while the box is down.
>
> **OPEN — needs an answer before launch, not decided here.** Three shapes, roughly in increasing cost:
>
> 1. **A pre-baked image plus a documented one-command rebuild**, so recovery is minutes of someone's attention rather than an evening of it. Cheapest; still requires a human.
> 2. **A second standby box.** Doubles a $5–12/mo line item and removes the human from the critical path entirely.
> 3. **Accept it and rely on the delay email** (`FUNNEL_REORDER_SPEC.md` §8.5), which converts a missed deadline into an early, specific revised promise. Free, and genuinely adequate for a rare failure — but it is a customer-communication answer to an infrastructure problem, and it stops being adequate if the box is unreliable rather than unlucky.
>
> Related and unresolved: §7.2 records that the VPS is **not yet rented**, so none of this is actionable until it exists.

### 2.3 Worker ↔ VPS: the interface

**A narrow HTTP API, ROC-owned on both ends, doing one thing.**

```
POST https://<vps-host>/render
  Authorization: Bearer <RENDER_SERVICE_TOKEN>
  { "url": "...", "viewports": ["desktop","mobile"], "timeout_ms": 30000 }

→ { "status": "ok" | "unread",
    "desktop": { "screenshot": "<url-or-b64>", "html": "...", "content_ok": true },
    "mobile":  { "screenshot": "...", "html": "...", "content_ok": true,
                 "time_to_usable_ms": 8140 },
    "checks":  { "tel_link_present": false, "images_unresolved": 0,
                 "data_uri_placeholders": 0 } }
```

Design constraints:

- **The VPS renders. It does not decide.** It returns observations and a completeness signal; the Worker runs Checkpoints 1 and 2 against them. Judgment stays in one place.
- **`status: "unread"` is a first-class response.** The VPS must be able to say "I could not read this" without the Worker inferring absence. This is the fetch scar rendered as an API contract — see §4.
- **Timeouts belong to the Worker.** A hung render must not hold a queue message open indefinitely.

#### ⚠️ The VPS must not become a new open door

This project just spent considerable effort discovering that three MCP workers were serving anyone on the internet with no authentication. **Do not repeat it.** A public box that renders arbitrary URLs on demand is a worse liability than an unauthenticated MCP server — it's an open SSRF proxy and a free rendering farm.

Required, minimum:

1. **Bearer token on every request** (`RENDER_SERVICE_TOKEN`), compared in **constant time**, failing **closed** — an unset token serves nothing rather than reverting to open.
2. **Network-level restriction in front of the token, not instead of it.** Prefer Cloudflare Tunnel so the box has **no public inbound ports at all** and is reachable only through Cloudflare; a firewall allowlist is the weaker fallback.
3. **SSRF guard on the render target** — reuse the discipline already in `functions/api/scan.js`, which rejects private/internal addresses before fetching. The VPS renders attacker-influenceable URLs; without this it will happily fetch `169.254.169.254` and cloud metadata.
4. **No secrets on the box beyond its own token.** No Stripe key, no Anthropic key, no Places key. It renders pages; it has no business holding anything else.
5. **Rate limit per source**, so a leaked token is a nuisance rather than an unbounded bill.

**Verify from outside after deploy.** An unauthenticated request must fail. "It's a random IP nobody knows" is not a control.

---

## 3. End-to-end flow

Every stage marked **[W]** Worker, **[V]** VPS, **[Q]** queue.

| # | Stage | Where | Detail |
|---|---|---|---|
| 1 | `checkout.session.completed` webhook | **[W]** | Net-new endpoint. Stripe's own retries are the outer safety net |
| 2 | **Verify signature** | **[W]** | Constant-time HMAC against `STRIPE_WEBHOOK_SECRET`. **Reject before parsing.** An unverified webhook is an untrusted stranger asking for a free report |
| 3 | Read the input contract | **[W]** | **Both Stripe objects** — see §3.1 |
| 4 | **Confirmation gate (§1.4)** | **[W]** | `confirmed_place_id` present AND `ownership_attested === "true"`, else → **manual/hold**, exit |
| 5 | **Enqueue** | **[Q]** | Durable write. Ack the webhook only after this succeeds. Everything downstream is retry-safe |
| 6 | Research passes | **[W]** + **[V]** | Per §4 of the pipeline spec. Each step runs Checkpoints 1 & 2 — §4 below |
| 7 | Assemble the report | **[W]** | Anthropic API + the owned procedure. Top 5 + nerd-out, per §7 / template §8 |
| 8 | **Checkpoint 3** — provenance | **[W]** | Model call. Quality lift, **not** the safety floor |
| 9 | **Checkpoint 4** — deterministic sweep | **[W]** | `lib/report-precheck.js`. **Hard pass/fail. This is the gate that earns auto-send** |
| 10a | Clean → **send** | **[W]** | Resend. Includes the Google review link (Phase 4 flywheel). Mark delivered, ack the job |
| 10b | Fail → **quarantine** | **[W]** | Halt. Alert. **Never send.** Job stays un-acked or moves to a holding record |

### 3.1 The input contract — read BOTH Stripe objects

**The most likely silent bug in this build.** The metadata is split across two objects:

| Key | Lives on | Notes |
|---|---|---|
| `confirmed_place_id` | **PaymentIntent** | The gate. Empty on the manual path |
| `ownership_attested` | **PaymentIntent** | Must be `"true"` (string) |
| `confirmation_method` | **PaymentIntent** | `"places"` or `"manual"` |
| `confirmed_name`, `confirmed_address`, `confirmed_phone` | **PaymentIntent** | `confirmed_phone` manual-path only. **Never printed** (§6 output lock) |
| `attested_at` | **PaymentIntent** | ISO 8601 |
| `report_due_at`, `report_due_display` | **PaymentIntent** | The SLA clock — §3.2 |
| `intent_service`, `intent_target_area`, `intent_paid_leads`, `intent_pain`, `intent_competitors` | **PaymentIntent** | **Absent, not empty**, when skipped — `intake.js` skips blanks entirely |
| **`scanned_url`** | **Checkout Session** `metadata` | ⚠️ Not on the PaymentIntent |
| **`businessname`, `citystate`** | **Checkout Session** `custom_fields` | ⚠️ Not metadata at all |

**A consumer reading only the PaymentIntent gets no website to analyze and no business name.** Retrieve the Session with `expand[]=payment_intent` — the pattern `loadPaidSession()` in `functions/api/confirm-business.js` already uses — and read both.

Two details from the existing code worth matching:

- **Re-verify `payment_status === "paid"` server-side.** `confirm-business.js` never trusts a client flag; neither should this. A webhook body is not proof of payment on its own.
- **`custom_fields` key fallbacks exist.** `confirm-business.js` accepts `businessname`/`business_name`/`company`/… and `citystate`/`city_state`/`city`/… because sessions could be created by another path. Mirror that tolerance rather than hard-coding one key.

**Steering inputs, not report content.** The five `intent_*` fields shape the research (query set, location parameter, Top-5 tie-breaking) and **never appear as text in the report.** Never write "not provided."

> #### ⚠️ AMENDED 2026-08-01 — the split is REDUCED but NOT eliminated
>
> Under the funnel reorder (`FUNNEL_REORDER_SPEC.md` §1.2), every confirmation field moves from PaymentIntent metadata onto **Checkout Session metadata**, written at session creation. The Stripe `custom_fields` are dropped entirely, since the business name and city/state are collected and disambiguated on our own page first.
>
> **What that fixes:** the exact failure this section warns about — *"a consumer reading only the PaymentIntent gets no website to analyze and no business name"* — is gone. Post-reorder, the Checkout Session alone carries everything needed to run the §1.4 gate and aim the report.
>
> **What survives: the five `intent_*` fields stay on the PaymentIntent**, because `intake.js` is still post-payment and still appends there. So the `expand[]=payment_intent` retrieval does **not** go away, and a consumer that wants steering inputs still holds both objects. The table above remains correct for `intent_*`; the rows above it become Session-side.
>
> #### ⚠️ OPEN for Piece 3 — the `intent_*` timing race
>
> `checkout.session.completed` fires the instant payment succeeds. The buyer fills the intake form on `/thank-you/` **afterwards**. So **at webhook time the `intent_*` fields do not exist yet.**
>
> This is pre-existing — not caused by the reorder — but it has never been written down, and the 24-hour turnaround (§3.2) sharpens it in both directions: a tighter deadline pushes the pipeline to start immediately, which is exactly what makes it beat a buyer who is still typing, while also shrinking the room for the obvious fix.
>
> - **Piece 1 is correct as built** — it reads only the four confirmation fields and never touches `intent_*`.
> - **The Piece 3 consumer must read them at research time, not from the queue message.** This is one of the reasons the queue carries ids only.
> - **The failure is silent and mild:** absent `intent_*` is explicitly not an error ("Absent, not empty"), so the result is a less-targeted report and no alarm anywhere.
> - **Candidate mitigations, undecided:** a short delay before the first research call, or a re-read of the PaymentIntent immediately before query construction. A deliberate delay was cheap against three days and is a real bite out of twenty-four hours, so the two pressures pull against each other and this needs choosing rather than assuming.

### 3.2 The delivery clock

**AMENDED 2026-08-01 — the rule is now 24 HOURS.** The previous rule (3 business days, weekends and US holidays skipped, 5:00 PM America/Chicago) is retired. Rationale, recorded in `FUNNEL_REORDER_SPEC.md` §8.1: the 3-day window was **padding for per-report human review**, and with full auto-send (§1.1) the thing it was protecting no longer exists. What remained was a conversion hurdle on a $39 impulse purchase.

`report_due_at` is computed **once**, at `checkout.session.completed`: **payment timestamp + 24 hours**, stored ISO with offset alongside a human `report_due_display`.

**What this removes:** no business-day counting, no weekend skipping, no US holiday table, no 5:00 PM landing hour, and no DST-safe zoned wall-time arithmetic. A fixed 24-hour offset is an absolute duration and needs no zone maths to be correct. **`America/Chicago` is now DISPLAY-ONLY** — it re-enters solely when rendering `report_due_display` for a human, and the zone must still be named explicitly in buyer-facing text.

**Where it is computed also moves.** Confirmation is now pre-payment (§1.4 amendment), so computing the deadline at confirmation would start a delivery clock for someone who has not paid. It is computed in the **Piece 1 webhook** and written to the D1 `jobs` row. It is **not** written back to Stripe metadata — the Worker has a durable store and Stripe metadata is not the system of record for anything the Worker owns.

> #### ⚠️ The clock starts from the STRIPE EVENT TIMESTAMP, never from webhook processing time
>
> **This is a hard requirement, and it is new.** At three business days it did not matter. At 24 hours it matters a great deal.
>
> The natural implementation is to call the clock with "now" — the moment the webhook handler runs. **That is wrong, because the webhook does not necessarily run when payment happened.** Piece 1 deliberately returns **500 on a transient Stripe failure, on a D1 write failure, and on an enqueue failure**, in each case to invite a Stripe retry. **Stripe's retry schedule spreads over hours.** A webhook that only succeeds on its third attempt would compute a deadline hours later than the buyer's expectation — an expectation set at checkout by site copy promising 24 hours from **paying**.
>
> **The divergence is silently in our favour, which is exactly why nobody would notice it** until a customer held up their receipt and asked.
>
> **Use the payment's own timestamp** — the Stripe event's `created` field, or the Checkout Session's own timestamps, both of which are already retrieved. Compute from that, not from `Date.now()`. One line, correct by construction, and it makes the deadline independent of our own retry behaviour.
>
> **Same reasoning applies to the resume path.** A stranded order recovered hours later (the `processing_pending` re-drive in `worker/src/index.js`) must not silently receive a fresh 24 hours.

The buyer has been shown a specific deadline. **The pipeline must treat it as a real commitment:**

- Jobs should complete far inside it — the window is a promise, not a target.
- **Quarantine does not pause the clock.** A held job is still running out of time. **At 24 hours this is materially more urgent than it was at three days**, where a weekend absorbed an overnight failure and nothing absorbs it now. The buyer-facing answer is the **delay email** (`FUNNEL_REORDER_SPEC.md` §8.5), which fires on **failure, not on lateness** — a job failing at hour 2 emails at hour 2, so a missed promise is never experienced silently. The operational answer is §7.5, still undesigned.
- Nothing in the pipeline may extend or recompute the deadline. It is fixed at payment.

### 3.3 Delivery

Resend, one consistent from-address for all ROC transactional mail. **The email carries a Google review link** — the Phase 4 review flywheel — and the report itself.

**From-address — DECIDED: `reports@rankoncall.com`** (plural). Decided by Irene at review, consistent with the address already recorded as DECIDED in `AUTOMATION_PIPELINE_SPEC.md` §9. **The build uses this address consistently for all ROC transactional mail** — confirmation and report delivery both. Settled; do not substitute a singular variant.

Also from §9, both still open and both affecting delivery: **DMARC is at `p=none`** pending SPF+DKIM confirmation, and **`rankoncall.com` has no MX records**, so replies to that address currently bounce. Customers *will* reply to a report email. Cloudflare Email Routing (inbound-only) is the fix and should land before or with first send.

---

## 4. Where the four checkpoints live

The template is `AUTOMATION_PIPELINE_SPEC.md` §3. Every research step runs the same pattern; the purpose of every checkpoint is to answer *"is there any way this could be wrong, and did we check?"*

| Checkpoint | Kind | Runs on | Role |
|---|---|---|---|
| **1 — did data arrive?** | Deterministic | **Worker** (render case involves **VPS**) | Retry, then stamp `unread` |
| **2 — is it complete/usable?** | Deterministic + light model | **Worker**, over **VPS** output | Render completeness — earns the most care |
| **3 — does each finding trace?** | Model | **Worker** → Anthropic API | Quality lift. **Not the safety floor** |
| **4 — did anything forbidden leak?** | Deterministic | **Worker** | **The gate that earns auto-send** |

### Checkpoint 1 — Gate: did the data arrive?

Per source: Places returned a usable result; DataForSEO returned a SERP; the crawl got responses; the VPS returned a real page (content rule from §2.2 — body text > 500 chars **and** ≥3 nav/header links).

On failure: **retry with exponential backoff** (~2 attempts, 5–10s apart — measured cold pass rates climb from ~67% to ~96% by the third try). Still failing → **stamp `unread` and say so.** The gate does not fabricate.

**"We couldn't read it" is never reported as "it isn't there."** An `unread` check produces **no finding, no red flag, no severity rating** — it appears only under "What we couldn't check," worded plainly and without alarm. This is the fetch scar rendered as code, and in a *paid* report it is worse than in the free scan: a confident "your title tag is missing" against a site we simply couldn't render is a refund and a credibility loss.

### Checkpoint 2 — Gate: is the artifact usable?

**The signature case, and the one that most protects against the most expensive mistake.** The data arrived — is the screenshot faithful or half-painted?

Deterministic, over the VPS payload: do all `<img>` resolve to real `src`; are data-URI placeholders still in the DOM at capture; did the full-height scroll complete; did image decode settle. Optionally a light model glance — *does this look like a rendered page or a skeleton?*

Fail after retries → the render-dependent findings are `unread`, **or** the job quarantines if the visual pass is central to what was going to be said. **Never publish a "your site looks broken" finding sourced from a half-painted capture.**

### Checkpoint 3 — Review: does each finding trace to evidence?

A model pass over the drafted findings: does every claim trace to something retrieved **this run**, and does the evidence actually say what the claim says? Did it claim "you rank #7" when the data said #4? Did it invent a competitor's review count?

**The 13-item self-check in the forked procedure's §9 is this checkpoint's checklist** — reframed from a human-handoff note (§1.3) but otherwise intact.

⚠️ **A reviewer model shares blind spots with the generator; they can hallucinate agreement. This is a quality lift, not the safety floor. Do not let a future build lean on it as the thing that makes auto-send safe.**

### Checkpoint 4 — Safety sweep: did anything forbidden leak?

**Deterministic. No opinions. Binary pass/fail. This layer — not the model reviewer — is what earns the right to send unread, because it shares no blind spots with the generator.**

Pure functions over the drafted report:

| Check | Fails on |
|---|---|
| Leaked phone | Any phone-number-shaped string |
| Leaked address | Any full street-address string |
| Surviving placeholder | Unrendered template token |
| Banned word | `traffic` · `impressions` · `funnel` · `conversion rate` · `SEO strategy` · `optimize your presence` · `leverage` · `synergy` |
| Missing section | Any required section absent |
| Unstamped ranking claim | Ranking claim without query + location + date |
| Blank / truncated | Empty or cut-off finding |
| **Accuracy claim (§1.5)** | Any percentage, confidence score, or guarantee |

**`lib/report-precheck.js` + `lib/report-precheck.test.js` are the head-start.** Now tracked (commit `47693b2`) but **UNVERIFIED — never run, wired to nothing.** `package.json` has no `test` script and there is no CI, so the tests have never executed. **Treat it as a starting point to inspect, not a dependency.** It validates the *current* report format and will need rework if the format changes.

**Before this worker ships, that module must be: run, tested against real drafted output, and reviewed against the table above.** It is load-bearing for §1.1 — the entire auto-send argument rests on it. Shipping auto-send on an unverified precheck would be the single worst decision available in this build.

> Stale line to fix: `AUTOMATION_PIPELINE_SPEC.md` §3 (line ~58) still calls `lib/report-precheck.js` *"currently an untracked… module."* Untrue since `47693b2`. The §5 instance was corrected; this one was missed.

### Failure path

- **Soft failure** (one signal unavailable): pipeline continues, finding stamped `unread`, report says so.
- **Hard failure** (Checkpoint 4 catches a leaked phone/address; Checkpoint 2 declares the capture unfaithful after retries): **HALT and quarantine automatically. Not sent. No human needed to catch it.**

**The holding state is still UNDESIGNED** — see §7.

---

## 5. Secrets and environment

All **ROC's own**, in ROC's own environment. Nothing shared with the productivity or seo-scout workers.

| Secret | Status | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | **Exists** | Already a Pages var (used by checkout/confirm/intake) |
| `STRIPE_WEBHOOK_SECRET` | **NET-NEW** | Created when the webhook endpoint is registered in Stripe. No webhook exists today |
| `ANTHROPIC_API_KEY` | **NET-NEW** | ROC's own. Not borrowed from any other project |
| `DATAFORSEO_LOGIN` | **NET-NEW** | **ROC-owned, from ROC's own completely separate DataForSEO account** (§7.1, RESOLVED). Not the shared account. HTTP Basic auth |
| `DATAFORSEO_PASSWORD` | **NET-NEW** | With the above, same isolated account. ⚠️ Account holds only the $1 signup credit — **must be funded before the first live report** (§7.1) |
| `GOOGLE_PLACES_API_KEY` | **Exists** | Server-side only, never reaches the browser |
| `RESEND_API_KEY` | **Exists** (per Irene) | Domain verification was in progress per §9 — confirm before first send |
| `RENDER_SERVICE_TOKEN` | **NET-NEW** | Worker ↔ VPS. Same value on both ends; the VPS holds nothing else |
| `RENDER_SERVICE_URL` | **NET-NEW** | VPS endpoint. Config, not a secret |

**Six net-new, three existing.** Discipline, unchanged from the current codebase: secrets live only in the Cloudflare environment, never in the repo, never in client-side JS, never in a build artifact, never logged. The existing endpoints already hold this line — `scan.js` makes zero keyed calls, and `checkout.js` places `STRIPE_SECRET_KEY` in exactly one Bearer header and never in a returned object.

> #### ⚠️ ORDER OF OPERATIONS — secrets go LAST, and the reason is not obvious
>
> **`wrangler secret put` cannot set a secret on a Worker that does not exist.** Running it early either errors or prompts to create a placeholder Worker, which is not the same thing as the deployed one and quietly diverges from it. **The correct order:**
>
> ```
> 1. npx wrangler d1 create roc-fulfillment
> 2. paste the printed database_id into wrangler.toml   ← deploy fails until this is done
> 3. npx wrangler queues create roc-fulfillment
>    npx wrangler queues create roc-fulfillment-dlq     ← BOTH; the DLQ must exist before deploy
> 4. npx wrangler deploy                                 ← the Worker now exists
> 5. npx wrangler secret put …                           ← only now
> ```
>
> **`STRIPE_WEBHOOK_SECRET` is later still**, because Stripe only generates it when the endpoint is registered — and the endpoint URL comes from step 4. So that one is: deploy → register in Stripe → `secret put`.
>
> Full runbook in `worker/README.md`.

**Infrastructure bindings** — Cloudflare Queues (`roc-fulfillment`, `roc-fulfillment-dlq`) and **D1** for the job store and delivery-idempotency record — are not secrets but are also net-new. **`worker/wrangler.toml` now exists** and declares all three; `database_id` is still a placeholder until `wrangler d1 create` is run.

---

## 6. Net-new vs. existing

**Existing and live** — the funnel works end to end and is capturing real data:

| Component | File | Does |
|---|---|---|
| Free scan | `functions/api/scan.js` | Server-side site parse, zero Places calls, no verdicts, SSRF-guarded |
| Checkout | `functions/api/checkout.js` | Stripe Checkout Session, custom fields, `metadata[scanned_url]` |
| Confirmation gate | `functions/api/confirm-business.js` | Places candidates, records `confirmed_place_id` + attestation + deadline |
| Intent capture | `functions/api/intake.js` | Five optional `intent_*` keys onto the PaymentIntent |
| Site | `src/**` | 11ty, live |

**Net-new — all of it. Zero fulfillment code exists today:**

- Stripe webhook handler + signature verification
- The durable queue and its consumer
- The render VPS and its `/render` service
- The owned fork of the research procedure
- Every research caller: Places (direct), DataForSEO (direct), the polite one-level crawler, listings discovery, domain facts
- Report assembly via the Anthropic API
- Checkpoints 1–3, and the verification/wiring of Checkpoint 4
- The Resend send path and email template
- Quarantine + alerting

**The read side of the metadata contract has never been built.** The contract is documented in `docs/BOT_ARCHITECTURE.md`, correct, and populated on every live purchase — and nothing has ever consumed it. Every `intent_*` field collected so far is **write-only data**.

**This worker is the missing half of the business.** Today the product takes $39, verifies the target, promises delivery **within 24 hours** (§3.2) — and has no mechanism to deliver anything.

---

## 7. Open questions for Irene

### 7.1 ✅ RESOLVED 2026-08-01 — DataForSEO billing coupling is ELIMINATED

> ### ROC has its own completely separate DataForSEO account.
>
> **Not a sub-account. Not the shared ~$31.46 balance.** Irene created a **new, independent account** for Rank On Call and verified it in the dashboard: new account, **$1 signup credit**, **no prior usage**, account verified.

**The coupling is gone at the billing layer, which is where it survived.** §1.3 removed it from the code layer — ROC calls DataForSEO directly with its own credentials rather than through a shared worker — but a shared *balance* would have re-created exactly the same failure mode one level down. It no longer exists.

#### What this closes

| Closed | Was |
|---|---|
| **Shared-balance drain** | A report failing because an unrelated project spent the money. Structurally impossible now — nothing else can reach this balance |
| **"Monitored balance floor" vs. sub-account** | Moot. Neither option was taken; full isolation is stronger than both |
| **The sharpened 24-hour concern** | A balance drained overnight by unrelated work, with no slack to notice and top up before the deadline. Cannot happen |

**A `40200` insufficient-funds error is still possible** — but **only from ROC's own spend**, which is *attributable* and *predictable*. That is an entirely different class of problem: a known burn rate against a known balance, not an outside actor with no visibility into our deadlines. It becomes ordinary capacity planning.

**`PROJECT_MASTER.md` §210's false-balance warning still stands** as an operational note, and its cause is now diagnosed and closed (see §7.4, anti-pattern 2 — a `-1` sentinel propagating through a subtraction in the client, never a DataForSEO fault). Any automated balance check ROC builds must still treat a failed probe as **unknown, never as a number.**

#### ⚠️ What this ENABLES — the real gain

**Per-report API cost is now measurable.** With a shared balance, ROC's spend was indistinguishable from everyone else's; with an isolated account, **every cent that moves is a Rank On Call report.**

**That means a $39 report has a knowable COGS**, which is the number the entire business model rests on and which has never been measured. It also means burn rate becomes a forecastable input rather than a mystery, and an anomaly — a runaway loop, an unbounded retry — is visible as a cost spike instead of hiding in someone else's usage.

> **⚠️ Record the actual API spend of the FIRST live report.** Current estimates are **~3–5 cents per report** and are **unverified**. They are dominated by the **depth-100 branded sweep**, where the depth multiplier is the least certain term — DataForSEO prices deeper result sets above shallow ones, and a depth-100 call is not simply one call's worth of cost.
>
> This is a one-time, five-minute measurement with a permanently useful answer, and it is cheapest to take on the very first report. **Take it before the estimate hardens into a number people quote.**

#### Pricing facts — verified against DataForSEO's published pricing

| Fact | |
|---|---|
| Model | **Pay-as-you-go.** No monthly fee, no subscription |
| Minimum deposit | **$50** |
| Credit expiry | **None — credits do not expire** |
| Signup credit | **$1** (currently the account's entire balance) |
| Live SERP | **~$0.002 / query** |
| Standard queue | ~$0.0006 / query |

**Live costs roughly 3× the standard queue, and that is a deliberate choice**, not an oversight — the live-only decision in §7.4 was made on latency grounds against the 24-hour deadline (§3.2). At five to eight SERP calls per report the difference is well under two cents. **Do not "optimize" this back to the queue without reopening §7.4**; the latency tail is the thing that was being bought off.

#### ⚠️ FUNDING — a hard prerequisite before traffic

**The account currently holds only the $1 signup credit.** It **must be funded before the first live report**, or generation fails with `40200` and a paid order quarantines for a reason that has nothing to do with the code.

**This is LAUNCH-GATE-adjacent, not a build blocker.** The $1 comfortably covers fixture capture and development calls — at ~$0.002 a query that is roughly 500 calls, far more than Piece 3 needs to be written and tested. **But it is a hard prerequisite before traffic is pointed at the site**, alongside the standing rule's four conditions in `FUNNEL_REORDER_SPEC.md`.

Note the $50 minimum deposit: funding is not a $5 top-up decision, and credits do not expire, so there is no cost to doing it early.

### 7.2 VPS provider and sizing

~$5–12/mo Linux box, headless full Chrome. Not yet rented — an open blocker in §9 of the pipeline spec. Needs: provider, region, size, and who holds root. Related: whether it fronts with Cloudflare Tunnel (recommended, §2.3) which affects setup.

### 7.3 The email template and review link

Not designed. `PROJECT_MASTER.md` Phase 4 specifies the delivery email carries a **Google review link** — the review flywheel — and nothing else about delivery exists in any project doc. Open: template and format (inline HTML? attached PDF? hosted link?), review-link placement and wording, and the from-address question in §3.3. Resend handles transactional; Courier handles sequences.

### 7.4 The tool-binding gap in the forked procedure

v2.1 §10 binds each research task to an MCP tool this worker cannot call. Replacements:

| Task | v2.1 tool | Replacement |
|---|---|---|
| Unbranded ranking | `seo_analyze` | **DataForSEO SERP API, direct** |
| Balance baseline | `seo_test` | Direct balance endpoint, or drop (§7.1 handles it) |
| Domain facts | `seo_domain_whois` | **RDAP/WHOIS direct** — dates + registrar only (§6 sourcing lock) |
| Name variants | `seo_domain_check` | Registrar availability API — net-new, unchosen |
| Site fetch + render | `web_fetch` + render | Worker fetch + the VPS `/render` service |
| Listings discovery | `web_search` | **DataForSEO SERP API (branded queries) — DECIDED, keep NAP** |

**Listings discovery — settled.** NAP consistency requires finding the business's directory listings. **NAP is kept, not cut**, and listings discovery is sourced from the **DataForSEO SERP API repurposed for branded queries** — the same integration already required for unbranded ranking. **No additional search API and no additional key are needed**, so the cost model gains only query volume on an account this worker already calls.

**✅ PLATFORM LIST — TEN (Irene's ruling, 2026-08-01).** This previously named six. The full `web-deep-dive` list stands:

> **GBP · Yelp · Angi · HomeAdvisor · BBB · Facebook · Nextdoor · Houzz · Thumbtack · Porch**

`HomeAdvisor`, `Thumbtack` and `Porch` were missing from the earlier six.

#### ✅ DECIDED 2026-08-01 — how many branded queries, and why it is not ten

> ### ONE deep branded sweep, plus targeted verification only where absence would itself be a finding.
>
> **Sweep:** `"<business name>" <city> <state>` on `serp/google/organic/live/advanced` at **depth ~100**, scanned for the ten platform domains.
> **Verification:** targeted `site:` queries for **Yelp, BBB, Facebook** only.
> **Worst case: four calls.** Not one shallow query, and not ten blanket queries.

**First, the honest part: cost is NOT the deciding argument.** Live SERP calls run on the order of fractions of a cent, so ten-vs-one is roughly **$0.03 per report** — negligible against $39 and not worth designing around. Latency does not decide it either: the queries are independent and sit in the parallel stage, so ten of them cost about as much wall-clock as one. **Anyone arguing this on cost or speed is arguing the wrong axis.**

**Correctness decides it, in both directions:**

| Approach | Problem |
|---|---|
| **One shallow query** (default depth ~10) | A listing that exists but ranks below the fold is **missed**. Under the fetch scar we may not report that as absence — so most platforms end up `unread`, the NAP section goes thin, and a future session is tempted into "you're not on Yelp" from a result it never checked |
| **Ten blanket `site:` queries** | Maximum recall and clean per-platform answers, but nine of the ten calls are spent confirming platforms whose absence we would never actually report on |

**The design that works:**

1. **One branded sweep at increased depth** — `"<business name>" <city> <state>`, depth ~100 rather than the default 10. One call, and it surfaces far more than a shallow query. Scan the results for the ten known platform domains.
2. **Every platform found → audit its NAP.** Adding platforms to the audit list is free; they all come out of the same sweep. That is why going from six to ten costs nothing here.
3. **Targeted `site:` verification ONLY for platforms where absence would itself be a finding.** For a contractor that is realistically **Yelp, BBB, and Facebook** — absence there is actionable. "You're not on Houzz" is not a finding a plumber cares about.

**Worst case: 1 + 3 = four calls, not ten** — and every claim made is one we actually checked.

> ### ⚠️ HARD CONSTRAINT — A PLATFORM MAY ONLY BE REPORTED AS ABSENT IF IT WAS SPECIFICALLY CHECKED
>
> This is the real output of the decision, and it binds the generator regardless of how discovery is implemented.
>
> | Sweep result | Verified? | What the report may say |
> |---|---|---|
> | **Found** | — | Audit its NAP. Report the mismatch type, never the values |
> | **Not found** | **not verified** | `unread`. **NOT MENTIONED AT ALL** — no finding, no red flag, no severity |
> | **Not found** | **verified absent** | Reportable — *"we looked for a Yelp listing and couldn't find one"* |
>
> ⚠️ **Never write "you have no Yelp listing."** Google's `site:` coverage is incomplete, so **a miss is not proof of non-existence.** The honest phrasing is a statement about our search, not about the world, and it is the only one we can defend.
>
> **The honest phrasing is also still the useful one** — which is why this costs the product nothing. **An unfindable listing costs the contractor exactly the same call as a nonexistent one.** Either way the answer is the same: if it exists, it is not working; if it does not, that is the gap. He does not need us to know which to act on it.
>
> This is the fetch scar (§4, Checkpoint 1) applied to a case where the temptation is unusually strong, because absence *looks* like a finding sitting right there.

**This had to be decided here rather than during Piece 3**, because it is a 10× difference on a critical-path line item and the two implementations are not interchangeable after the fact.

Note the volume for §7.1's COGS measurement: branded listing lookups are additional billed SERP calls per report, on top of the 2–4 unbranded ranking queries — now bounded at roughly four rather than ten. With an isolated account this is a measurable line item rather than a shared-drain risk.

#### ✅ RESOLVED 2026-08-01 — LIVE/instant endpoints only. Task-based is not used.

**This OPEN item is closed.** It was opened because the 24-hour turnaround (§3.2) made endpoint latency material where it had been invisible. It is answered by **reading SEO-Scout's deployed source** — a real, working implementation against the same API, which is stronger evidence than a docs comparison.

**What SEO-Scout actually calls. Every one is live or instant; there is no `task_post` anywhere in it:**

| Endpoint | Used for |
|---|---|
| `serp/google/organic/live/regular` | SERP results — ⚠️ **ROC uses `live/advanced` instead**, see anti-pattern 4 |
| `dataforseo_labs/google/related_keywords/live` | Keyword discovery |
| `keywords_data/google_ads/search_volume/live` | Volume |
| `on_page/instant_pages` | Page analysis — see the OPEN note below |
| `appendix/user_data` | Balance |

> ### DECISION: ROC uses LIVE / instant endpoints only.
>
> Task-based endpoints are **not used**. A deployed implementation running this workload has never needed them, which removes the latency tail from the §3.2 critical path entirely and settles the wall-clock question in favour of a report measured in minutes.
>
> The cost consequence stands and feeds §7.1: **live endpoints cost more per call** (~$0.002 vs ~$0.0006 for the standard queue). Since §7.1 resolved with ROC holding a **fully isolated account**, that is now a plain, attributable line item on ROC's own balance rather than a shared-drain risk — it is a COGS input, not a coupling.

### ⚠️ ANTI-PATTERNS in the reference implementation — do NOT carry these into the fork

SEO-Scout is the proof that live endpoints work. **It is not a model to copy.** Four specific defects, recorded precisely enough that a future session cannot reintroduce them by accident while "matching the reference":

**1. ⚠️ `seo_discover` accepts a `location` argument and then IGNORES it.** It hardcodes `location_code: 2840` (United States) regardless of what the caller passes.

For a national keyword tool that is a shortcut. **For local contractor SEO it is fatal, and it silently produces confident wrong answers** — a national-average ranking for "emergency roof repair" tells a roofer in Tulsa precisely nothing about Tulsa, while looking exactly like a real finding. **Every ROC query must pass a real location**, and the location it passed must be recorded on the finding, because §4's research set requires every ranking claim to carry exact query + location + date.

**2. ⚠️ `getBalance` is called TWICE per tool call, purely to print a cost footer. Strip it.**

Two extra round-trips per call to render a nicety no automated pipeline reads. In a pipeline with a delivery deadline that is pure overhead on the critical path.

> **And it resolves a standing mystery.** Cost is computed as `(balance_before − balance_after)`, and `getBalance` **returns `-1` on failure**. So any single hiccup in either probe produces arithmetic on a sentinel value and prints nonsense — a negative cost, or a huge one.
>
> **This is the documented cause of the false balance readouts in `PROJECT_MASTER.md` §210** ("it will report `-$1.00` or `$33+ cost` and scream that you're out of credit... a display glitch, not real spending"). The real balance held steady at ~$32.38 throughout. **That diagnosis is now CLOSED** — it was never a DataForSEO problem, it was `-1` propagating through a subtraction in the client.
>
> Consequence for §7.1: a balance check built for ROC must **treat a failed probe as unknown, never as a number.** The §7.1 note that any automated balance check must confirm via a real call before alarming was correct, and this is exactly why.

**3. ⚠️ No retries and no timeouts anywhere.** `dataForSeoRequest` throws on any non-ok response, full stop.

That is not acceptable under Checkpoint 1 (§4), which requires **exponential backoff, ~2 attempts, 5–10 seconds apart** before a signal may be stamped `unread` — measured cold pass rates climb from ~67% to ~96% by the third try. Copying this client verbatim would convert a routine transient failure into a quarantined paid order.

**4. ✅ RESOLVED 2026-08-01 — `live/regular` cannot see the local pack. ROC uses `live/advanced`.**

**The gap was real.** `serp/google/organic/live/regular` returns **organic and paid results only**, and DataForSEO's own documentation states it does not provide a complete overview of featured snippets and other extra SERP elements. **For a local contractor the three-pack is the whole game** — ranking #4 organically while invisible in the map pack **is the finding**, arguably the single most valuable one this product delivers, and that endpoint is structurally incapable of seeing it. It also undercut §4's framing of unbranded ranking as *"the single sharpest finding"*, since for a local business the sharpest version of that finding lives in the pack, not the organic list.

> ⚠️ **This is a context difference, not a defect in SEO-Scout.** `live/regular` is the *correct* choice for content and keyword research, which is what that tool does. It is the wrong choice for local business audits. **Do not read this as a bug in that codebase** — read it as the reason its endpoint selection cannot be copied across without checking what it was selected for. Unlike anti-patterns 1–3, there is nothing here for SEO-Scout to fix.

**The decision is recorded immediately below.**

#### ✅ DECIDED 2026-08-01 — `serp/google/organic/live/advanced`, for every SERP call

Verified against DataForSEO's official documentation (`docs.dataforseo.com/v3/serp-google-organic-overview`, `/v3/serp-overview`), not from memory.

> ### ROC uses **`serp/google/organic/live/advanced`** for ALL SERP calls — the unbranded ranking queries AND the branded sweep. One endpoint, no exceptions.

| Why | |
|---|---|
| **It answers the headline finding** | `live/advanced` provides a complete overview of search results and is required for Google Maps data. The **`local_pack`** element type is available here and nowhere in `live/regular`. This closes anti-pattern 4. |
| **It covers the branded sweep with no second endpoint** | Depth up to **100** supports the one-deep-sweep design below directly. No separate integration, no second call shape. |
| **It is live** | No `task_post` / `task_get` polling. Consistent with the live-only decision above, and it keeps the §3.2 critical path free of the latency tail. |
| **Cost** | More per call than `live/regular`, still fractions of a cent against a $39 report. Noted in §7.1 **without reopening the billing question** — the sub-account decision there is unaffected by this choice. |

**One endpoint for everything is itself part of the decision.** Two endpoints would mean two response shapes, two parsers, and two failure modes on the critical path, for no capability the advanced response does not already carry.

##### What Piece 3 must EXTRACT from the advanced response

Recorded here so the caller does not have to rediscover it:

| Extract | For |
|---|---|
| **Organic rank of the target domain** | the "Where you show up" ranking finding |
| **`local_pack` presence AND position for the target business** | the headline three-pack finding — presence first, position second |
| **The page-1 competitor set** | the competitor section, which **re-reads this response and never fetches a competitor site** (§4 CUT list) |

Every ranking claim derived from this carries **exact query + location + date measured** (§4). The location must be the one actually sent — see anti-pattern 1.

> #### OPEN — not blocking, Irene's call later: `serp/google/maps/live/advanced`
>
> A dedicated maps endpoint would give **local-finder depth** — the business's actual position in the full map listing, rather than the binary in-or-out of the three-pack that the `local_pack` element provides.
>
> **Deferred for v1.** *"You're not in the three-pack"* is the actionable finding, and it is the one a contractor can do something about; "you're 14th in the map listing" is more precise without being more useful. **Revisit if the reports read thin**, which is the honest trigger for reconsidering it.

> #### OPEN — `on_page/instant_pages` and `enable_javascript`
>
> SEO-Scout calls `on_page/instant_pages` with **`enable_javascript: false`**. DataForSEO supports `true`.
>
> **If JS-enabled instant_pages covers enough of the rendered-vs-code comparison, it may reduce the scope of the render VPS — the longest pole in the build (§7.6 step 2, §7.2 not yet rented).** That would be a material simplification and it is cheap to find out.
>
> **Worth TESTING before building the VPS.** A single call against a known JS-heavy contractor site answers it.
>
> ⚠️ **This does NOT claim instant_pages replaces the VPS, and nobody should read it that way.** The product's differentiator is seeing the page *as a human does* — **desktop and mobile screenshots and measured mobile load timing (§2.2, §4) almost certainly still require real Chrome.** The realistic upside is narrowing what the VPS must do, not deleting it. Test first, then decide.

### 7.5 The quarantine holding state — still undesigned

`AUTOMATION_PIPELINE_SPEC.md` §8 flags this as **OPEN / UNDESIGNED** and it remains the largest hole. Unanswered: where a quarantined job goes; how Irene is notified; whether it auto-retries or waits; and **what the buyer sees while a job is held with their deadline still running** (§3.2).

This is the one place a narrow, earned human touch may re-enter — **not for every report, only for the ones that fail a gate.** That is not a reversal of §1.1; it is what §1.1 always said the failure path would look like.

**Until it is designed, a hard failure must at minimum HALT rather than send.** That is sufficient to start building; it is not sufficient to launch, because a silently-held job becomes a missed deadline with no one notified.

### 7.6 Build sequencing — recommendation

1. **Webhook + signature verification + the both-objects metadata read + the §1.4 gate + the durable queue.** This is the trigger everything hangs off, it is testable end-to-end against Stripe test mode with no research at all, and it stops paid orders from being unrecoverable. **Build first.**
2. **The render service on the VPS** — longest pole, hardest engineering (render completeness, §2.2), and everything conversion-related depends on it. Start early; it can be developed in parallel with (3).
3. **Research callers + report generation** — Places and DataForSEO direct, the forked procedure, Anthropic assembly.
4. **Checkpoint 4 verification** — run and test `lib/report-precheck.js` against real drafted output. **Must be genuinely done before any auto-send**, not after.
5. **Resend send path** + the email template (blocked on §7.3).
6. **Quarantine + alerting** (blocked on §7.5).

> **⚠️ AMENDED 2026-08-01 — this line previously read "Then, and only then, the §1.2 copy change — and only then enable."** That ordering is retired. **The copy change now ships early**, in its final form, because the gate moved from copy to traffic (§1.2). Steps 4, 5 and 6 above are no longer prerequisites for the *copy* — they are prerequisites for **pointing traffic at the site**, and they map onto conditions (d), (a) and (b)/(c) of the standing rule in `FUNNEL_REORDER_SPEC.md`'s front matter.
>
> **The sequence above is otherwise unchanged, and nothing in it got easier.** What changed is only which artifact the gate guards.

A useful intermediate: run the full pipeline in **dry-run mode**, generating and checkpointing real reports for real paid orders but writing them to a holding location instead of sending, with Irene reading each one. That produces the evidence that Checkpoint 4 actually works before it becomes the only thing standing between a generated report and a customer's inbox.

> Note that the original justification for the dry run — *"it does it without touching the live copy, since nothing auto-sends yet"* — no longer applies, because the copy ships first now. **The dry run's real value was never the copy; it was the evidence.** It stands unchanged on that ground: it is the only way to know Checkpoint 4 works on real drafted output before it becomes load-bearing. And under the moved gate it is *easier* to run, since there is no traffic to disturb.

---

## 8. Cross-document contradictions found while writing this

Recorded here as found. Struck items are kept for the audit trail.

> ⚠️ **REOPENED 2026-08-01 — entries 1 and 5 below are no longer resolved.** Both were closed on the premise that `deep-dive-client-report` v2.1/v2.2 was a completed rebuild whose research set matched §4. **Irene ruled on 2026-08-01 that it is a degraded, never-completed copy, and that `web-deep-dive` is the source of truth** (§1.3). So entry 1's resolution — *"now described as done"* — records the wrong fact, and entry 5's resolution points at a skill this project no longer forks from.
>
> **The real state:** the fork is `docs/RESEARCH_PROCEDURE_v3.0-roc.md` (DRAFT), taken from `web-deep-dive`, and it performs the owner-identity strip that entry 1 believed had already happened. `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 is wrong in **both** halves and sits in that document's LOCKED section — it needs its own dispatch; this document may not edit it.

1. ~~**`AUTOMATION_PIPELINE_SPEC.md` §1 item 5** — says the client report skill *"is being rebuilt fresh."* v2.1 exists and matches §4. Stale.~~ **RESOLVED in `39d1c611`:** now described as done, naming `deep-dive-client-report` v2.1.
2. ~~**`AUTOMATION_PIPELINE_SPEC.md` §3 (~line 58)** — still calls `lib/report-precheck.js` *"untracked."* Untrue since `47693b2`; the §5 instance was fixed and this one missed.~~ **RESOLVED in `39d1c611`:** the "untracked" claim removed; the UNVERIFIED / never-run / wired-to-nothing warning kept.
3. ~~**`AUTOMATION_PIPELINE_SPEC.md` §1 item 2** — quotes the live tagline as *"The method is hand-built. The digging is automated. Nothing goes out unread."* That exact string appears nowhere in `src/`; `hand-built` returns zero matches. The claims are real, the wording is a paraphrase.~~ **RESOLVED in `39d1c611`:** replaced with the actual live copy, quoted with file:line for both `src/index.njk:72` and `src/thank-you.njk:63` (the line number was corrected from 64 in the 2026-08-01 amendment).
4. ~~**From-address** — `report@` vs `reports@`.~~ **RESOLVED at review 2026-07-31:** `reports@rankoncall.com` (plural), matching §9. See §3.3.
5. ~~**`deep-dive-client-report` v2.1 §0 and §9** — assert permanent human review. Contradicts §1.1 and must be edited in the fork. §1.3.~~ **RESOLVED:** skill saved as **v2.2**, delivery-neutral; the ROC worker runs a fork with the human-review framing removed per §1.3.
6. ~~**`AUTOMATION_PIPELINE_SPEC.md` status line** — reads `DRAFT` while its §1 is written as locked, non-reversible decisions this spec treats as settled.~~ **RESOLVED in `39d1c611`:** now reads "§1 decisions LOCKED and being built against."
