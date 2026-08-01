# Rank On Call — Fulfillment Worker Spec

**Status:** APPROVED — Irene reviewed 2026-07-31. Build may proceed per §7.6 sequencing. No worker code exists yet; nothing here is built.
**Governed by:** `docs/AUTOMATION_PIPELINE_SPEC.md` — its §3/§4 (checkpoint template + research set), §5 (deterministic safety layer), §6 (privacy locks), and §7 (deliverable shape) are **inputs to this spec, not things it redefines.** Where this document and that one disagree, that one wins and this one is wrong.
**Scope:** the worker that implements that architecture. Everything from the Stripe webhook to the delivered email.

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

### 1.2 ⚠️ LAUNCH GATE — the live copy must change first

**This is a hard gate on enabling the worker in production, tracked separately from the build. The worker can be built, tested, and staged while the copy still says what it says. It cannot be switched on.**

Two live claims become false the moment this worker auto-sends:

| File | ~Line | Live text |
|---|---|---|
| `src/index.njk` | 72 | "And nothing goes out unread — a person reads every report before it reaches your inbox." |
| `src/thank-you.njk` | 64 | "Every report gets read by a person before it's sent — that's what the time is for." |

`src/index.njk` also carries a build-time comment (~line 64) recording per-report review as a **COMMITTED PRODUCT FEATURE** with an explicit instruction not to quietly drop it. That comment must be updated in the same change, or the next session will read it as authority and restore the claim.

Both landed 2026-07-25 in commit `fe132db`; `git log -S` confirms neither string has been touched since.

**This is a deliberate product reversal, not an implementation detail.** It is a decision for Irene — and note the thank-you copy uses the review to justify the 3-business-day wait, so removing it leaves the delivery window needing a different explanation rather than none.

**Sequencing:** copy change ships → verified live → worker enabled. Never the other order. A single auto-sent report while that copy is live is a false statement to a paying customer, and it is the kind of thing that gets screenshotted.

### 1.3 Self-contained — this worker calls no existing MCP worker

**It calls none of `productivity-irene`, `productivity-mcp-server`, or `seo-scout`.** No MCP transport, no shared credentials, no runtime dependency on Irene's or Micaiah's infrastructure. It lives in the `rank-on-call` repo and holds its own keys.

| Capability | How this worker gets it |
|---|---|
| Research procedure | **Owned copy in this repo** of `deep-dive-client-report` v2.1 — see the fork note below |
| Ranking data | **DataForSEO directly**, HTTP Basic auth, ROC's own `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` |
| Google Business Profile | **Places API (New) directly**, existing `GOOGLE_PLACES_API_KEY` |
| Report generation | **Anthropic API directly**, ROC's own key |
| Delivery | **Resend**, already configured |

Rationale: fulfillment must not break because someone redeployed a productivity worker, rotated a shared secret, or drained a shared API balance. A paid order is a contractual obligation with a 3-business-day deadline attached; it cannot hang off infrastructure this project doesn't control.

#### ⚠️ The owned copy of the skill must be FORKED, not copied

`deep-dive-client-report` v2.1 is excellent and should be the basis of the repo copy. **It is also written for the old model and contradicts §1.1 in its own text.** A verbatim copy makes the worker generate drafts for a reviewer who doesn't exist.

**Required edits to the repo copy, at minimum:**

| Location in v2.1 | What it says | Required change |
|---|---|---|
| §0 | *"The method is hand-built. The digging is automated. Nothing goes out unread."* quoted as "the product claim this report has to earn" | Remove. Ties to the same dead claim as §1.2 — and the exact three-sentence string doesn't appear in the site copy anyway |
| §0 | *"Every report is read by a human before it sends. That is permanent, not scaffolding."* | Remove — directly contradicts §1.1 |
| §0 | *"This skill produces a draft for that human, not a send-ready artifact."* | **Invert.** The output IS the send-ready artifact, subject to Checkpoint 4 |
| §9 heading | *"Run before handing the draft to the human reviewer"* | Reframe as the model self-check that precedes the deterministic sweep. Keep all 13 items — they are good — but they are now Checkpoint 3's checklist, not a handoff note |
| §6 | *"flag it for the human reviewer rather than padding it out"* (thin-report case) | Route to **quarantine** (§3, stage 9) instead |
| §10 (tools) | `seo_analyze`, `seo_test`, `seo_domain_whois`, `seo_domain_check`, `web_fetch`, `web_search` | Rewrite entirely — see §7.4. These name MCP tools this worker cannot call |

**Everything else in v2.1 transfers unchanged and should be preserved carefully** — the deleted-owner-identity spine (§2), the four hard locks (§3), the research set (§4), the CUT list (§5), the fetch scar (§6), the voice rules and banned words (§7), and the report template (§8). That material is hard-won and re-deriving it would lose things. **The fork edits the delivery framing and the tool bindings. It does not touch the research or the locks.**

**Version discipline:** the repo copy is a fork with its own version (suggest `deep-dive-client-report v3.0-roc`), and every generated report records which version produced it. The MCP-hosted v2.1 and the repo fork will drift; that is expected and fine, but a report must be traceable to the exact procedure that made it.

> **Doc contradiction to resolve separately:** `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 says the client report skill *"is being rebuilt fresh"*, present tense. v2.1 exists and matches §4's research set — the rebuild appears done. That doc line is stale.

### 1.4 No generation without a confirmed business

**Hard, deterministic gate.** No report generates unless **both** hold:

- `confirmed_place_id` is present and non-empty, **and**
- `ownership_attested === "true"`

Anything else — missing, empty, `confirmation_method === "manual"` with no place_id — **routes to manual/hold. Never generate on a guess.**

This is not a quality preference. Three businesses can share a name, and emailing a polished, confident, completely wrong report about someone else's company — with a Stripe receipt attached — is the single highest-consequence failure available to this product. The confirmation gate exists so that never happens; this worker must not be the thing that undoes it.

**Note the interaction with §1.1:** full auto-send is safe *because* this gate is upstream of it. The buyer verified the target at the moment of highest engagement. Auto-send without buyer confirmation would be indefensible; auto-send after it is merely automated.

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

### 3.2 The delivery clock

`report_due_at` is computed **once**, at confirmation: 3 business days (weekends and US holidays skipped), 5:00 PM **America/Chicago**, stored ISO with offset alongside a human `report_due_display`.

The buyer has been shown a specific deadline. **The pipeline must treat it as a real commitment:**

- Jobs should complete far inside it — the window is a promise, not a target.
- **Quarantine does not pause the clock.** A held job is still running out of time, and the buyer sees nothing. This is the sharpest open question in §7.
- Nothing in the pipeline may extend or recompute the deadline. It is fixed at confirmation.

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
| `DATAFORSEO_LOGIN` | **NET-NEW** | ROC's own copy. HTTP Basic auth |
| `DATAFORSEO_PASSWORD` | **NET-NEW** | With the above. Billing coupling — §7.1 |
| `GOOGLE_PLACES_API_KEY` | **Exists** | Server-side only, never reaches the browser |
| `RESEND_API_KEY` | **Exists** (per Irene) | Domain verification was in progress per §9 — confirm before first send |
| `RENDER_SERVICE_TOKEN` | **NET-NEW** | Worker ↔ VPS. Same value on both ends; the VPS holds nothing else |
| `RENDER_SERVICE_URL` | **NET-NEW** | VPS endpoint. Config, not a secret |

**Six net-new, three existing.** Discipline, unchanged from the current codebase: secrets live only in the Cloudflare environment, never in the repo, never in client-side JS, never in a build artifact, never logged. The existing endpoints already hold this line — `scan.js` makes zero keyed calls, and `checkout.js` places `STRIPE_SECRET_KEY` in exactly one Bearer header and never in a returned object.

**Queue and durable state** (Cloudflare Queues + KV/D1/Durable Object for the delivery-idempotency record) are infrastructure bindings, not secrets, but they are also net-new — there is no `wrangler.toml` in this repo today.

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

**This worker is the missing half of the business.** Today the product takes $39, verifies the target, promises delivery in 3 business days — and has no mechanism to deliver anything.

---

## 7. Open questions for Irene

### 7.1 DataForSEO billing coupling

ROC calling DataForSEO directly with its own credentials **still draws the same account balance** unless given separate billing. That account showed **$31.46** and is shared with whatever else uses it.

**The risk is concrete:** a report fails to generate because an unrelated project drained the balance — a fulfillment failure with a contractual deadline attached, caused by something outside this project entirely. That's the coupling §1.3 exists to eliminate, surviving in the billing layer after being removed from the code layer.

Options: separate DataForSEO sub-account for ROC (cleanest); a monitored balance floor with alerting; or accept the coupling and document it. **Note also that `PROJECT_MASTER.md` §210 records DataForSEO throwing false balance readouts** — so any automated balance check must confirm via a real call before alarming.

**Decision needed before first live report.**

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

**Listings discovery — settled.** NAP consistency (§4.3 of the procedure) requires finding the business's Yelp/Angi/BBB/Facebook/Nextdoor/Houzz listings. **NAP is kept, not cut**, and listings discovery is sourced from the **DataForSEO SERP API repurposed for branded queries** — the same integration already required for unbranded ranking. **No additional search API and no additional key are needed**, so the cost model gains only query volume on an account this worker already calls. Note the volume for §7.1's balance question: branded listing lookups are additional billed SERP calls per report, on top of the 2–4 unbranded ranking queries.

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

**Then, and only then, the §1.2 copy change — and only then enable.**

A useful intermediate: run the full pipeline in **dry-run mode**, generating and checkpointing real reports for real paid orders but writing them to a holding location instead of sending, with Irene reading each one. That produces the evidence that Checkpoint 4 actually works before it becomes the only thing standing between a generated report and a customer's inbox — and it does it **without** touching the live copy, since nothing auto-sends yet.

---

## 8. Cross-document contradictions found while writing this

Recorded, not resolved. Each is a small edit somewhere else.

1. **`AUTOMATION_PIPELINE_SPEC.md` §1 item 5** — says the client report skill *"is being rebuilt fresh."* v2.1 exists and matches §4. Stale.
2. **`AUTOMATION_PIPELINE_SPEC.md` §3 (~line 58)** — still calls `lib/report-precheck.js` *"untracked."* Untrue since `47693b2`; the §5 instance was fixed and this one missed.
3. **`AUTOMATION_PIPELINE_SPEC.md` §1 item 2** — quotes the live tagline as *"The method is hand-built. The digging is automated. Nothing goes out unread."* That exact string appears nowhere in `src/`; `hand-built` returns zero matches. The claims are real, the wording is a paraphrase.
4. ~~**From-address** — `report@` vs `reports@`.~~ **RESOLVED at review 2026-07-31:** `reports@rankoncall.com` (plural), matching §9. See §3.3.
5. **`deep-dive-client-report` v2.1 §0 and §9** — assert permanent human review. Contradicts §1.1 and must be edited in the fork. §1.3.
6. **`AUTOMATION_PIPELINE_SPEC.md` status line** — reads `DRAFT` while its §1 is written as locked, non-reversible decisions this spec treats as settled.
