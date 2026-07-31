# Rank On Call — Automation Pipeline Spec

**Status:** DRAFT (full sections 1–9)
**Guiding stance:** Exhaust FULL AUTOMATION and excellence at every point first. A human eye is not incorporated by default; if some point proves it genuinely requires human judgment, it earns its way back in on the merits at that time. "Full automation" explicitly INCLUDES the failure path: the system auto-sends successes AND auto-quarantines failures — a report that fails a checkpoint is halted and routed to a holding state automatically, without requiring a human to catch it. Detect-and-quarantine is the floor; silent send-anyway is never acceptable.
**Supersedes:** the abandoned "Stripe webhook → headless Anthropic API → reviewer bot → Telegram approval" sketch, which was designed but never built. Almost nothing of it was built; abandoning it costs nothing.

---

## 1. Locked decisions

These were decided in the automation-rebuild brainstorm. Do not silently reverse any of them. If a build detail requires breaking one, surface it explicitly.

1. **Full auto-send.** Reports generate, self-check, and send WITHOUT a human read at send time. This is a deliberate change from the previous "human reviews every report" model.

2. **CONSEQUENCE — live copy must change before this ships.** The tagline *"The method is hand-built. The digging is automated. Nothing goes out unread."* is live on the homepage and thank-you page, and `src/index.njk` carries a claim-ceiling comment recording per-report human review as a committed feature. Full auto-send makes that copy FALSE. Shipping this pipeline REQUIRES a copy change and is a deliberate product reversal — not an implementation detail. Flag to Irene at ship time; do not let the copy quietly go stale.

3. **Accuracy bar (INTERNAL, never printed).** The standard is: at the moment of generation and send, every finding traces to something actually retrieved this run, is date-stamped where it's a ranking claim, and has been swept for privacy/banned-word violations. This is an internal engineering bar, NOT a customer-facing guarantee. "100% accurate" or any accuracy percentage must NEVER appear in report copy — a printed guarantee is a refund liability. The bar is for our confidence, not a promise.

4. **No generation without a confirmed business.** No report generates without a buyer-confirmed `place_id` AND `ownership_attested === true`. This is a hard, deterministic gate. "None of these match" routes to manual handling. Never auto-generate on a guessed match.

5. **The client report is rebuilt from scratch.** The existing `deep-dive-client-report` skill was derived from the internal `web-deep-dive` sales-prep skill and inherited owner-privacy problems that are STRUCTURAL, not incidental (its opening table is Owner/Address/Phone; its Phase 1 is identity verification; it does WHOIS registrant and LLC lookups). It is being rebuilt fresh: keep the non-personal research spine, delete the owner-identity spine, replace identity verification with the confirmed `place_id`, and add new research. `web-deep-dive` remains the internal sales-prep skill and is unchanged.

## 2. Architecture

**The spine:**

Stripe payment → webhook fires → Cloudflare catches it and drops the job into a durable queue (Cloudflare Queues) → the job sits safely in the queue regardless of what's ready to process it → an always-on box pulls jobs off the queue and runs the pipeline → report is assembled, self-checked, and auto-sent.

**Why this shape:**

- **The durable queue is what makes it crash-proof.** A job is not marked complete until the pipeline finishes. If the box dies mid-report — reboot, crash, thrown exception, network drop — the job was never acknowledged, so it returns to the queue and retries. Nothing is lost. This is the core resilience property and it has nothing to do with any single machine's reliability. A job that can be safely retried cannot be lost.

- **Rendering runs on a rented always-on box (small Linux VPS, ~$5–12/mo) running full Chrome**, NOT on Irene's personal machine and NOT on Cloudflare Browser Rendering. Rationale: (a) the visual pass — see the rendered page as a human does, compare to code — is the product's core differentiator and requires a real browser; (b) tying it to Irene's laptop makes the business stop when her machine sleeps/crashes, an unacceptable dependency; (c) Cloudflare Browser Rendering was evaluated and declined — rendering viability was already proven without it, it's metered/billed, its plan entitlement was unconfirmed, and binding it into a Pages project (vs Workers) is an unproven assumption. The box is boring, cheap, proven, and owned. Rendering is the component the product's credibility rides on; boring is correct there.

- **Everything else stays on Cloudflare** (webhook catch, queue). The box is disposable — if it dies, spin up another; the queue holds the work in the meantime.

**Proven during recon (do not re-litigate):**

- Headless full Chrome renders the target segment (small contractor sites) reliably even from a datacenter/VPN ASN that bot vendors score harshly: 13/14 clean first try, 14/14 with one retry, zero permanent blocks. Bot protection is NOT a real obstacle for this segment (WordPress/Wix/Squarespace/small-shop custom don't deploy aggressive bot management).
- UA/fingerprint spoofing produced NO measurable improvement. Do NOT build stealth/fingerprint-evasion machinery — proven unnecessary.
- **The real rendering risk is render COMPLETENESS, not blocking.** A lazy-loading site can return HTTP 200 with full text but screenshot as garbage (placeholders, duplicated nav) because images load on scroll-intersection. A false "your site looks broken" in a paid audit is the single most expensive mistake this product can make. Render handling MUST: wait for network-idle, scroll full page height, await image decode, and/or neutralize lazy-load before capture (force loading="eager", strip plugin data-* attrs, set src from data-src). This deserves real engineering attention.
- Detect "is this page real" by RENDERED CONTENT (body text > 500 chars AND ≥3 nav/header links), NOT by marker strings — passive Cloudflare scripts and contact-form reCAPTCHA widgets produce false "blocked" readings on perfectly good pages. Do NOT use <h1>/<h2> presence as a content signal — Squarespace puts hero copy in <p>.

## 3. The four-checkpoint template

Every research step in the pipeline follows this pattern. The gates and safety sweep are largely reusable code; the provenance review is tailored per finding type. The purpose of every checkpoint is to answer: *"is there any way this could be wrong, and did we check?"*

**Checkpoint 1 — Gate: did the data arrive? (deterministic)**
Did this step actually retrieve real data, or did it silently fail? E.g. for the render: real page per the content rule above; if not, retry with exponential backoff (~2 attempts, 5–10s apart; measured cold pass rates climb from ~67% to ~96% by the third try). If it still fails, the gate does NOT fabricate — it stamps the signal "could not retrieve" and the report SAYS that rather than guessing. Never confuse "we couldn't read it" with "it isn't there" (the fetch scar), rendered as code.

**Checkpoint 2 — Gate: is the retrieved artifact complete/usable? (deterministic + light model)**
The data arrived, but is it usable? The signature case is the render-completeness problem: is the screenshot faithful or half-painted? Deterministic checks (do all <img> resolve to real src, are data-URI placeholders still in the DOM at capture) plus optionally a model glance (does this look like a rendered page or a skeleton). This checkpoint most protects against the most expensive mistake and earns the most care.

**Checkpoint 3 — Review: does each finding trace to the evidence? (model, provenance)**
Findings are drafted. Does every claim trace to something actually retrieved this run, and does the evidence actually say what the claim says? Did it claim "you rank #7" when the data said #4? Did it invent a competitor's review count? This is where a reviewer pass catches the generator confabulating. NOTE: a reviewer model shares blind spots with the generator — they can hallucinate agreement. This is a quality lift, not the safety floor.

**Checkpoint 4 — Safety sweep: did anything forbidden leak? (deterministic)**
A regex/rules sweep on the drafted text, no opinions, binary pass/fail: did a full phone number or street address leak (output privacy lock); any banned words (traffic, impressions, funnel, conversion rate, SEO strategy, optimize your presence, leverage, synergy); any surviving placeholder tokens; any missing required section; any unstamped ranking claim. This is the `lib/report-precheck.js` instinct (currently an untracked, unverified head-start module in the repo). THIS deterministic layer — not the model reviewer — is what actually earns the right to send unread, because it has no shared blind spots with the generator.

## 4. Research set (finalized)

Every finding must trace to a retrieved source. Ranking claims carry exact query, location, and date measured. The set answers a coherent story: **findability → credibility → conversion.**

**Findability — can a stranger find you?**
- **Unbranded / "near me" ranking.** Does the business rank for the searches a stranger with a problem actually types ("plumber near me", "emergency roof repair [town]"), NOT just its own name. Source: SEO-Scout / DataForSEO. Every claim stamped query + location + date. This is the single sharpest finding; branded-only ranking checks are near-worthless.
- **Indexing / technical blocks.** Accidental noindex tag, robots.txt blocking the site. Rare but catastrophic; catching one is a "this paid for itself" moment. Cheap requests.

**Credibility — does your Google listing make them call?**
- **GBP profile completeness.** Hours present, services listed, service-area set, business description present, category correct. Source: Places data already retrieved for confirmation cards. Very actionable — fixable by the owner in minutes.
- **Rating + true review count vs. competitors.** Observable numbers only, no adjectives (competitor lock). Source: Places `rating` + `userRatingCount` — these are TRUE TOTALS, safe.
- **Photo attribution.** Owner-uploaded vs. customer-uploaded, via `authorAttributions[].displayName` matched against business name. "Most photos on your profile were added by customers, not you" is a real, defensible finding.

**Conversion — does your site turn the click into a call?**
- **Rendered-vs-code reality.** What a human actually sees on the rendered page vs. what the code claims. The core differentiator. Desktop AND mobile capture.
- **Mobile load speed.** Roughly how long to usable on a phone, MEASURED from the render (nearly free once rendering). State honestly ("took ~8 seconds to become usable on a phone"); NEVER a fabricated PageSpeed-style score.
- **Click-to-call on mobile.** Is the phone number a tap-to-dial `tel:` link or plain text? Catchable in the visual pass. On-brand ("get the phone ringing"), and most contractors don't know theirs isn't tappable.
- **Broken links / dead pages.** One-level crawl: extract every link from the homepage, request each, record 200/404/301/timeout. This is a CRAWLER (network requests), NOT a browser — no interaction, no always-on browser needed. Crawl politely: respect robots.txt, reasonable delays, don't hammer a small business's server.
- **NAP consistency.** Does name/phone/address match across the business's own site, its GBP, and its claimed listings. Report by MISMATCH TYPE (formatting variation vs. full change), NEVER by printing the values (output privacy lock).

### CUT — and why (do not re-add)

A live Places API probe (5 billed calls against businesses with 6,000–7,000+ reviews) established these CANNOT be done accurately and must NOT be re-added by a future session:

- **Review recency ("your last review was N months ago") — CUT.** The API returns only 5 reviews out of thousands, selected by "relevance," in NON-chronological order, with no sort control and no paging. The newest review you can see is a floor, not the true newest — on a test business it would have reported "5 months ago" when a 1-month-old review existed, erring in the direction that makes the business look worse. Proving review ABSENCE/staleness from a 0.08% relevance-biased sample is impossible. "Your reviews have dried up" is exactly the claim this product would want AND exactly the claim the data cannot support.
- **Owner response rate — CUT.** The field does not exist. No reply/response/ownerResponse key anywhere on the review object. Not a sampling problem — the data is simply absent.
- **Photo count / photo recency — CUT.** Photos cap at 10 with NO total-count field ("at least 10" is true of every established business, worthless) and NO timestamp metadata of any kind (recency unstateable at any tier).
- **editorialSummary-dependent section — CUT.** Absent for most small local operators; both probe businesses returned none.

What SURVIVES from reviews/photos: rating, true `userRatingCount`, hours completeness, and photo AUTHOR ATTRIBUTION (owner vs. customer). Build the review/photo section around totals + attribution, never recency or rates.

Billing note: requesting `reviews` promotes the ENTIRE Place Details call to the top tier (Enterprise+Atmosphere) — a call bills at the highest tier any field touches. Since review recency is cut, dropping `reviews` from the field mask is a real cost saving with no loss of an accurate finding. Price the mask against the live Places API (New) pricing page before finalizing.

## 5. Deterministic safety layer

The checkpoint-4 sweep. Pure functions, no model calls, binary pass/fail. This layer — NOT the model reviewer — is what earns the right to send unread, because it shares no blind spots with the generator. `lib/report-precheck.js` + `lib/report-precheck.test.js` exist in the repo as an UNVERIFIED head-start (never run, wired to nothing). Treat as a starting point to inspect, not a dependency; it validates the current report format and will need rework if the format changes.

Checks (each a pure function over the drafted report):
- **Leaked phone** — no phone-number-shaped string in output.
- **Leaked address** — no full street-address string in output.
- **Surviving placeholder** — no template placeholder tokens left unrendered.
- **Banned word** — none of: traffic, impressions, funnel, conversion rate, SEO strategy, optimize your presence, leverage, synergy.
- **Missing section** — every required report section present.
- **Unstamped ranking claim** — every ranking claim carries query + location + date.
- **Blank / truncated** — no empty or cut-off findings.

## 6. Privacy locks (build constraints)

Two filters, both hard:

**Sourcing.** Contact/business data ONLY from what the business publishes about itself: GBP, own site, own claimed listings. NEVER WHOIS registrant records, Secretary of State / LLC filings, people-search sites, court or property records. WHOIS is restricted to domain facts only: registration date, expiry, registrar.

**Output.** The report NEVER prints full street addresses or phone numbers. Discrepancies are reported by WHICH platforms disagree and WHAT KIND of mismatch (formatting vs. full change), never by value. All personal info (owner names, personal phones, residential addresses) is stripped BY CONSTRUCTION during generation, not removed post-hoc.

**Competitors.** Named; judged never. Rank position, website yes/no, public review count, business type. No adjectives about quality. Every ranking claim carries exact query, location, date.

## 7. Deliverable shape

**Top 5 that are costing you calls** — the highest-impact findings, with proof, in contractor language. Then a separate section: **"fix these 5 and you're in decent shape; if you want to nerd out, here's the rest."** Depth as evidence, not noise. The 5x research is done behind the scenes to EARN the confident Top 5; most of it stays in the optional section. The checkpoint-3 review verifies the Top 5 are genuinely the highest-impact findings, not just the first five drafted.

Voice: contractor language, honest-broker. Say "get the phone ringing", "showing up on Google", "not getting calls". Banned voice terms as listed in §5.

## 8. Failure path (full-auto quarantine)

Full automation includes handling failure automatically — NOT proceeding silently.

- **Soft failure (one signal couldn't be retrieved):** the pipeline continues; the affected finding is stamped "could not retrieve" and the report says so. Never "we couldn't read it" reported as "it isn't there."
- **Hard failure (a checkpoint fails in a way that makes the report unsafe or wrong):** e.g. checkpoint-4 catches a leaked phone/address in final text, or checkpoint-2 declares the screenshot unfaithful after all retries. The job is HALTED and routed to a holding/manual state AUTOMATICALLY. It is NOT auto-sent. No human is required to CATCH the failure; the system quarantines it itself.

**OPEN / UNDESIGNED:** the mechanics of the holding state — where a quarantined job goes, how Irene is notified it needs attention, whether quarantined jobs auto-retry or wait for a human, and what the buyer sees while a job is held (their promised delivery deadline is still running). This is the point where a narrow, earned human touch may re-enter — not for every report, only for the ones that fail a gate. To be designed. Until designed, a hard failure must at minimum HALT rather than send.

## 9. Open blockers

- **Resend — SETUP IN PROGRESS.** Existing Resend account; rankoncall.com being added as a domain. DNS records (SPF/DKIM) added in Cloudflare, SPF-collision-checked (domain had zero MX and likely no prior SPF). DMARC added at `_dmarc.rankoncall.com` as `p=none` (monitor-only) to start. `RESEND_API_KEY` goes to Pages Production. Once verified, this critical path clears.
  - **DECIDED — from-address: `reports@rankoncall.com`.** Single consistent from-address for ALL ROC transactional mail (confirmation + report delivery). On-brand, reads as a real mailbox, better deliverability than noreply@. The build must use this address consistently.
  - **FOLLOW-UP — tighten DMARC.** Started at `p=none`. After ~2 weeks, confirm Resend mail passes SPF+DKIM via aggregate reports, then tighten to `p=quarantine`, eventually `p=reject`. Do NOT jump to reject before confirming legitimate mail authenticates — it would spam/bounce the product's own emails.
  - **FAST-FOLLOW — inbound for reports@.** Sending from `reports@rankoncall.com` creates an address customers WILL reply to. rankoncall.com currently has zero MX records, so replies bounce. Enable Cloudflare Email Routing (inbound-only) to forward reports@ to a real inbox. Not required for sending to work, but needed soon after so customer replies don't vanish. Watch SPF collision if Email Routing adds records.
- **The rendering box is not rented.** No VPS provisioned yet. Needed before the render step can run in production.
- **Reviewer-model blind-spot caveat.** Checkpoint 3 (model provenance review) shares failure modes with the generator — they can hallucinate agreement. It is a quality lift, not the safety floor. Do not let a future build lean on it as the thing that makes auto-send safe; the deterministic layer (§5) carries that weight.
- **No Google Search Console verification** on the domain.
