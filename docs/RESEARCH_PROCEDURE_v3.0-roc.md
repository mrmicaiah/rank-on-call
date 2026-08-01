# Research Procedure `v3.0-roc`

**Status:** DRAFT — awaiting Irene's review. Nothing is built against this yet.
**Version:** `v3.0-roc`. **Every generated report must record this version string**, so any report is traceable to the exact procedure that produced it.
**Forked from:** `web-deep-dive`, the internal sales-prep skill, read via MCP on 2026-08-01. **Not** from `deep-dive-client-report`, which Irene ruled on 2026-08-01 is a degraded, never-completed copy (`FULFILLMENT_WORKER_SPEC.md` §1.3, corrected).
**Governed by:** `docs/AUTOMATION_PIPELINE_SPEC.md` §4 (research set + CUT list), §5 (deterministic safety layer), §6 (privacy locks), §7 (deliverable shape). Where this document and that one disagree, **that one wins and this one is wrong.**

---

## 0. What this is, and the one thing to understand about it

`web-deep-dive` is a **sales-prep** skill. Its job was to tell Irene everything knowable about a business she was about to call — including who owns it, where they live, and how to reach them. It is good at that job.

**This fork sells a report to that business.** That inverts the privacy posture completely: the subject of the research is now the customer, the artifact is a compiled product they receive, and everything that made `web-deep-dive` useful for a cold call is a liability in a document with our name on it.

> **The fork is therefore not a light edit.** An entire phase is deleted, the report's opening is rebuilt rather than adjusted, and one whole research tool is removed rather than rebound. That is the strip `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 believed had already been done. It had not; it is done here.

**What is NOT changed:** the research itself. The listings audit, NAP consistency, competitor snapshot, services, red flags, and recommendations all carry across intact. This fork changes **who the report is about the way it is written**, not what it looks at.

---

## 1. Hard locks — inherited, non-negotiable

These come from the governing specs. They are restated here because this is the document a generator will actually follow.

1. **Sourcing lock (§6).** Contact and business data ONLY from what the business publishes about itself: its Google Business Profile, its own site, its own claimed listings. **Never** Secretary of State / LLC filings, people-search sites, court or property records.
2. **Output lock (§6).** The report **never prints full street addresses or phone numbers.** NAP discrepancies are reported by *which platforms disagree* and *what kind of mismatch* (formatting variation vs. full change) — **never by value.**
3. **By construction, not post-hoc (§6).** Personal data is not filtered out of the draft. **It never enters the generator's input.** A field that is stored but never printed must be absent from the object handed to report assembly — not present-and-trusted-to-a-regex.
4. **Competitor lock (§6).** Competitors are **named; judged never.** Rank position, website yes/no, public review count, business type. **No adjectives about quality.**
5. **Fetch scar (§4, Checkpoint 1).** "We couldn't read it" is **never** reported as "it isn't there." An unretrievable signal produces **no finding, no red flag, no severity rating** — it appears only under "what we couldn't check," worded plainly and without alarm.
6. **No printed accuracy claims (§1.5).** No percentage, no confidence score, no guarantee. "100% accurate", "verified", "guaranteed findings" are forbidden. A printed guarantee is a refund liability.

---

## 2. ⚠️ What is STRIPPED

### 2.1 Phase 1 (Company Verification) — DELETED IN FULL

**This is a whole phase removed, not a phase edited.** `web-deep-dive` Phase 1 matched owner name, address, and phone against candidate businesses to establish it had the right company.

**It is obsolete.** The funnel now supplies a **buyer-confirmed `place_id` before payment** (`FUNNEL_REORDER_SPEC.md` §1). The identity question Phase 1 existed to answer has already been answered — by the one person who can answer it instantly and with certainty, at the moment of highest engagement.

Phase 1 was also the single largest concentration of personal data in the procedure. Deleting it removes the problem rather than managing it.

**The procedure begins at what was Phase 2.2.** There is no verification step in this fork. If `confirmed_place_id` is absent, the job never reaches the generator at all — that is the §1.4 gate's job, upstream, and the generator must never attempt to compensate for it.

### 2.2 Owner identity fields — REMOVED EVERYWHERE

Removed from Phase 2.1 and from every downstream reference:

| Field | Status |
|---|---|
| Owner / principal name | **REMOVED** |
| Business structure / LLC status | **REMOVED** — also independently barred by §6's sourcing lock, which forbids LLC filings outright |
| Email address | **REMOVED** |
| "Alt Phone" | **REMOVED** |

**Kept from Phase 2.1**, because all of it is self-published and non-personal: legal/trading name, years in business *as the business itself states it*, **service area** (the area, not a street address), and phone numbers **for NAP comparison only** — collected, compared, never printed.

> ⚠️ **`owner_name` is collected at checkout as an anti-fraud friction signal** (`FUNNEL_REORDER_SPEC.md` §3) and stored in D1. **It must never be passed to this procedure.** It is not research input, it is not report content, and it must not appear in any prompt. It needs a `block`-severity check in `lib/report-precheck.js` — noted in §8.

### 2.3 ⚠️ ALL WHOIS / RDAP — REMOVED, NOT REBOUND

`web-deep-dive` used `seo_domain_whois` in Phase 2.2 for registration date, expiry, and registrar. **The tool is removed entirely. It is not rebound to a direct RDAP call.**

**Rationale as instructed:** WHOIS/RDAP responses can carry registrant name, organization, and email. The strip is total rather than filtered, on the same "by construction, not post-hoc" principle as lock 3.

> ### ⚠️ THIS CONFLICTS WITH THREE THINGS. Irene must rule before this fork is built against.
>
> **1. `AUTOMATION_PIPELINE_SPEC.md` §6 explicitly PERMITS it, narrowly.** Its sourcing lock reads: *"WHOIS is restricted to domain facts only: registration date, expiry, registrar."* That is a deliberate, already-drawn line — the governing spec anticipated this exact tension and chose narrow permission over removal. **That spec wins on conflict**, so this section is currently in violation of it.
>
> **2. `FULFILLMENT_WORKER_SPEC.md` §7.4 has already rebound it** — *"Domain facts | `seo_domain_whois` | **RDAP/WHOIS direct** — dates + registrar only (§6 sourcing lock)"* — as a DECIDED row.
>
> **3. ⚠️ It breaks a machine-enforced requirement.** `lib/report-precheck.js` `REQUIRED_SECTIONS` includes **`"Your domain"`**. With no domain-facts source, that mandatory section has no data, and **every report trips `MISSING_SECTION`** — a check the spec intends to be `block` severity at Checkpoint 4.
>
> **The product cost is real, not cosmetic.** Domain expiry is one of the genuine "this paid for itself" findings: the sample report's Company B has a domain **expiring in under five months**, which is a business-ending event the owner does not know about. There is no alternative source for it. Certificate-transparency logs give a weak first-seen proxy for age and say nothing at all about expiry.
>
> **Factual note offered for the ruling, not as an override:** for `.com` / `.net` and most gTLDs, RDAP responses have redacted registrant contact fields by default since the post-GDPR registration-data policy. A query that reads only `events` (registration, expiration) and the registrar name does not receive personal data in the response at all. That is very likely why §6 drew the line where it did.
>
> **Three options:**
> **(a)** Keep the removal as written; drop "Your domain" from `REQUIRED_SECTIONS` and accept losing the expiry finding.
> **(b)** Revert to §6's line — RDAP for dates + registrar only, with a field allowlist so nothing else is ever read into memory.
> **(c)** Remove for now, revisit after a lawyer reviews (§6.4 of the reorder spec already routes privacy questions there).
>
> **This document implements the removal as instructed.** It is flagged here, loudly, because it is a DRAFT and this is precisely the kind of decision that should not be resolved silently by whoever builds Piece 3.

### 2.4 The Quick Facts table — the opening must be REBUILT, not edited

`web-deep-dive`'s report opened with: **Owner / Address / Phone / Alt Phone / Website / Years in Business.**

Strip the personal rows and **four of six are gone.** What survives — a website URL and a founding year — is not an opening; it is a fragment.

**Being honest about this: stripping guts the top of the report.** The opening cannot be patched by deleting rows. It has to be rebuilt around a different idea, and §3 below proposes one.

This is not incidental damage. That table *was* the sales-prep thesis — *here is who this person is and how to reach them* — and the reason it cannot survive is the same reason the fork exists.

### 2.5 Verbatim review quotes — REMOVED. ⚠️ A NEW constraint.

`web-deep-dive` Phase 2.5 collects **"Standout Quotes" — 2–3 verbatim customer reviews.** Excellent for sales prep, where the quotes are read once by one person and never republished.

**Not acceptable here.** Those quotes are **Google's and Yelp's platform content, reproduced inside a document Rank On Call sells for $39.** That is a different act from reading them.

**Paraphrase themes only.** *"Several reviewers mention punctuality"* — never the sentence a customer wrote.

> ⚠️ **This constraint does not exist in `web-deep-dive` and has no precedent in the governing specs.** §6's output lock covers personal data, not third-party content reproduced commercially. **It is introduced here** and should be recorded in `AUTOMATION_PIPELINE_SPEC.md` §6 so it survives independently of this document.

> ⚠️ **And "themes" themselves need care — the §4 CUT list's own reasoning applies.** The Places API returns only **5 reviews out of thousands, relevance-selected, non-chronological, with no paging.** §4 CUT review recency for exactly that reason. **Theme extraction and "negative patterns" from a 0.08% relevance-biased sample are no more defensible than recency was.** What survives is what §4 says survives: **rating and true `userRatingCount`** — real totals — plus photo author attribution. Any theme statement must be hedged to what a five-review sample can support, or cut. See §8.

---

## 3. The replacement opening — proposed

Replacing the Quick Facts table with a section built **only from self-published business facts**, reframing the opening from *identity* to *visibility*:

> ### How you show up right now
>
> | | |
> |---|---|
> | **Business name** | as it appears on your Google listing |
> | **What Google says you do** | primary category from the GBP |
> | **Where you work** | service area / city — **the area, never a street address** |
> | **Your Google rating** | rating + true total review count |
> | **Your website** | the domain we checked |
> | **Years in business** | only if the business states it on its own site or listing |

**Why this is the right replacement, and arguably a better opening than the original.**

The old table answered *"who is this?"* — a question the buyer already knows the answer to, and which reads as a dossier compiled about a person. **The new one answers "what does a stranger searching for you actually see?"** — which the buyer does *not* know, is the thing they paid to find out, and is the premise of the entire report.

It also earns the rest of the document. Every finding that follows is a gap between this mirror and what the business believes about itself. Opening with the mirror makes "Fix these first" land as consequence rather than assertion.

Every row is self-published, non-personal, and already retrieved for other purposes — **the opening costs no additional API call.**

---

## 4. Tool rebinding

`web-deep-dive`'s tools table was: `web_search`, `web_fetch`, `seo_domain_check`, `seo_domain_whois`, `seo_analyze`, `seo_discover`. **This worker calls no MCP tool** (`FULFILLMENT_WORKER_SPEC.md` §1.3). Every row is rebound to a direct call or removed.

| `web-deep-dive` tool | Rebound to | Notes |
|---|---|---|
| `web_search` | **DataForSEO live SERP, direct** (branded queries for listings discovery) | |
| `web_fetch` | **Direct HTTP crawl + the render service** | Crawl is **bounded** — 50 unique same-registrable-domain links, 120s ceiling (`AUTOMATION_PIPELINE_SPEC.md` §4) |
| `seo_analyze` | **DataForSEO live SERP, direct** | ⚠️ Endpoint selection is a **capability gap** — see below |
| `seo_discover` | **DataForSEO Labs live, direct** | ⚠️ **MUST pass a real location** — see below |
| `seo_domain_check` | Registrar availability API | **STILL UNCHOSEN — OPEN.** `FULFILLMENT_WORKER_SPEC.md` §7.4 |
| `seo_domain_whois` | **REMOVED — not rebound** | §2.3, and see the conflict flagged there |

**All DataForSEO calls use LIVE / instant endpoints. Task-based is not used** (`FULFILLMENT_WORKER_SPEC.md` §7.4, DECIDED 2026-08-01).

> ### ⚠️ Two inherited defects that must not be reproduced
>
> Both are documented in full at `FULFILLMENT_WORKER_SPEC.md` §7.4; repeated here because this is the document a builder follows.
>
> **1. Every ranking query MUST pass a real location.** The reference implementation accepts a `location` argument and silently ignores it, hardcoding `location_code: 2840` (United States). **A national-average ranking is worthless for a local contractor and looks exactly like a real finding.** The location actually used must be recorded on the claim, because §5 below requires it.
>
> **2. ⚠️ `serp/google/organic/live/regular` cannot see the local pack.** Organic results only. **For a contractor the three-pack is the whole game** — ranking #4 organically while invisible in the map pack *is* the finding. A report built on that endpoint would examine the wrong surface and confidently report that all is well. **`live/advanced` or a local-finder endpoint is required, and must be selected and verified against a real local query before this procedure is built against.** Capability gap, not preference.

---

## 5. The research phases — KEPT

Carried across from `web-deep-dive` substantially unchanged, renumbered from the deletion of Phase 1.

**§5.1 — Website analysis** *(was 2.2)*. Has-website path: fetch homepage / about / services / contact within the bounded crawl; check contact-info presence, services listed, SSL, mobile behaviour, platform, and red flags (placeholder content, outdated information, stale copyright year, broken pages). **No-website path:** domain availability checks only — the registrar API is unchosen (§4), so this path is **not yet buildable**. **WHOIS removed** (§2.3).

**§5.2 — Local listings audit** *(was 2.3)*. Per platform: name / address / phone **as listed**, rating, review count. Values are collected **for comparison only** and never printed (lock 2). Discovered via branded SERP queries.

> ⚠️ **Platform-count discrepancy.** `web-deep-dive` audits **ten**: GBP, Yelp, Angi, HomeAdvisor, BBB, Facebook, Nextdoor, Houzz, Thumbtack, Porch. `FULFILLMENT_WORKER_SPEC.md` §7.4 names **six**: Yelp, Angi, BBB, Facebook, Nextdoor, Houzz. **HomeAdvisor, Thumbtack, and Porch are in the procedure and not in the spec.** Since each platform is a billed SERP call on the critical path, this is a real cost and latency delta, not a wording difference. Needs reconciling — §8.

**§5.3 — NAP consistency** *(was 2.4)*. Across the business's own site plus every listing found. **Reported by which platforms disagree and what kind of mismatch — never by value.**

**§5.4 — Reviews** *(was 2.5)*. Ratings and true counts across platforms. Themes **paraphrased only**, and only to the extent a five-review sample supports (§2.5). **No verbatim quotes. No recency claims. No owner-response-rate claims** — both CUT in §4, the data cannot support them.

**§5.5 — Services and service area** *(was 2.6)*. As the business states them.

**§5.6 — Competitor snapshot** *(was 2.7)*. SERP for "[industry] [city] [state]": who ranks page 1, who has a website, whether the target appears. **Rank position, website yes/no, public review count, business type. No adjectives.**

> ⚠️ **Competitor sites are NEVER fetched, rendered, or crawled.** This section re-reads the SERP already retrieved for §5.1's ranking finding. Added to `AUTOMATION_PIPELINE_SPEC.md` §4's CUT list on 2026-08-01: per-competitor fetching multiplies the render and crawl cost by the competitor count and is the fastest available way to turn a 5-minute report into an hours-long one. Everything §6 permits us to say about a competitor is already in the SERP result.

**§5.7 — Red flags summary** *(was 2.8)*. ⚠️ A red flag may only be raised from a signal that was **actually retrieved this run.** An `unread` signal produces no flag and no severity marker (lock 5).

**§5.8 — Recommendations.** Kept.

---

## 6. ⚠️ Report template — three structures currently disagree

This is the largest unresolved item in the fork, and it is checkable rather than a matter of taste.

**Three documents describe the deliverable's shape, and no two agree:**

| Source | Structure | Enforced? |
|---|---|---|
| **`lib/report-precheck.js` `REQUIRED_SECTIONS`** | Fix these first · Your Google Business Profile · Your website · Name, address, and phone consistency · Where you show up · Your domain · What this means | ✅ **Yes — in code** |
| `AUTOMATION_PIPELINE_SPEC.md` §7 | "Top 5 that are costing you calls", then "fix these 5 and you're in decent shape; if you want to nerd out, here's the rest" | No |
| `web-deep-dive` Phase 3 | Quick Facts · Critical Issues · Digital Presence · NAP · Reviews Summary · Services · Competitive Landscape · Domain Status · Red Flags · Recommendations | No |

**`REQUIRED_SECTIONS` wins, because it is the only one that executes.** A report using `web-deep-dive`'s headings trips `MISSING_SECTION` on all seven. **This fork targets the precheck's structure**, with §7's Top-5 framing carried inside it:

| Report section (precheck) | Fed by | §7 framing |
|---|---|---|
| *(opening)* **How you show up right now** | §3 | the mirror |
| **Fix these first** | highest-impact findings across all phases | **the Top 5** |
| **Your Google Business Profile** | Places details, §5.4 | |
| **Your website** | §5.1 + render | |
| **Name, address, and phone consistency** | §5.2, §5.3 | |
| **Where you show up** | §5.6 + ranking | ⚠️ needs local pack |
| **Your domain** | §5.1 domain facts | ⚠️ **no source while §2.3 stands** |
| **What this means** | §5.7, §5.8 | the "nerd out" close |

**Two things fall out of this table**, both flagged in §8: the opening section is not in `REQUIRED_SECTIONS` and does not need to be, but **"Your domain" is** — and §2.3 currently leaves it empty.

---

## 7. Claim discipline — carried from the governing specs

Non-negotiable, applies to every finding this procedure produces:

1. **Every SERP claim carries exact query + location + date measured.** No exceptions. This is why §4's location defect is fatal rather than untidy — a claim cannot be stamped with a location that was silently discarded.
2. **No editorial adjectives on competitors.** Position, presence, counts, type. Never quality.
3. **No accuracy percentage, confidence score, or guarantee anywhere in report copy.**
4. **Banned words**, enforced by `lib/report-precheck.js`: `traffic` · `impressions` · `funnel` · `conversion rate` · `SEO strategy` · `optimize your presence` · `leverage` · `synergy`.
5. **Voice:** contractor language, honest broker. "Get the phone ringing", "showing up on Google", "not getting calls".
6. **Every finding traces to something retrieved this run.** Anything else is `unread` and says so plainly.

---

## 8. Open items

**Blocking — must be answered before this procedure is built against**

1. **⚠️ The WHOIS/RDAP removal vs. §6, §7.4, and `REQUIRED_SECTIONS`.** §2.3. Three-way conflict with a mandatory report section left sourceless. **Irene's ruling needed.**
2. **⚠️ SERP endpoint selection — the local pack.** `live/advanced` or a local-finder endpoint, verified against a real local query. Capability gap (§4).
3. **Listings platform count: 6 or 10?** §5.2. Real cost and latency delta on the critical path.

**Needs a decision, not blocking**

4. **Registrar availability API** for the no-website path and name-variant checks — still unchosen, so §5.1's no-website branch is not buildable.
5. **Review themes.** Whether a 5-review relevance-biased sample supports *any* theme statement, or whether §5.4 reduces to ratings and counts only. §2.5.
6. **Record the third-party-content constraint in `AUTOMATION_PIPELINE_SPEC.md` §6** so the no-verbatim-quotes rule survives independently of this document. §2.5.
7. **Add an `OWNER_NAME_LEAKED` check at `block` severity to `lib/report-precheck.js`.** Needs a per-job context argument, since an owner name has no detectable shape — the check is "does this draft contain *this job's* stored `owner_name` string." `FUNNEL_REORDER_SPEC.md` §3.2.
8. **`REQUIRED_SECTIONS` vs. the opening section.** The proposed opening (§3) is deliberately not in the required list. Confirm that is intended rather than an omission.

**Already tracked elsewhere**

9. Three of the eight Checkpoint 4 checks are `warn` rather than `block`, and the §1.5 accuracy-claim check is absent entirely. `FULFILLMENT_WORKER_SPEC.md` §4 / §7.6 step 4.
10. `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 is wrong in both halves — it states the rebuild is done and names the wrong skill. It sits in the LOCKED section and needs its own dispatch.
