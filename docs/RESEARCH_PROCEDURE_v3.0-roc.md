# Research Procedure `v3.0-roc`

**Status:** DRAFT — awaiting Irene's review. Nothing is built against this yet.
**Version:** `v3.0-roc`. **Every generated report must record this version string**, so any report is traceable to the exact procedure that produced it.
**Derived from:** `web-deep-dive`, the internal sales-prep skill, read via MCP on 2026-08-01.
**Governed by:** `docs/AUTOMATION_PIPELINE_SPEC.md` §4 (research set + CUT list), §5 (deterministic safety layer), §6 (privacy locks), §7 (deliverable shape). Where this document and that one disagree, **that one wins and this one is wrong.**

> ## What this is, in one sentence
>
> ### `web-deep-dive`'s research depth, PLUS real GBP data, MINUS the privacy layer, with the checkpoint system built in end to end.
>
> — Irene, 2026-08-01. That sentence is the statement of intent; every decision in this document should be checkable against it.

---

## 0. This is the SUCCESSOR procedure, not a parallel fork

**When complete, this document replaces `deep-dive-client-report` and takes that name.**

`deep-dive-client-report` is **not a source to derive from — it is the name this procedure will carry when finished.** Whatever exists under that name on the Productivity MCP today is a **placeholder**: Irene cannot recall whether it was ever completed, and either way it is not accurate. **Nothing in this document is derived from it, and no future session should go looking there for material.** The research lineage runs from `web-deep-dive`; the *name* is inherited separately, on completion.

### It lives here, not on the MCP

**This procedure is version-controlled in this repo and wired to the ROC workers. It is not hosted on the Productivity MCP, and it must not be moved there.**

That follows directly from the **self-contained-worker lock** (`FULFILLMENT_WORKER_SPEC.md` §1.3): the fulfillment worker calls **no MCP worker at all** — no transport, no shared credentials, no runtime dependency on Irene's or Micaiah's infrastructure. **A procedure the fulfillment worker cannot legally call is not a useful place to keep the procedure.** Keeping it in the repo also means it is diffable, reviewable, and versioned alongside the code that executes it, which the MCP copy never was — and that is precisely how the placeholder was able to drift into inaccuracy without anyone noticing.

### The one thing to understand about the derivation

`web-deep-dive` is a **sales-prep** skill. Its job was to tell Irene everything knowable about a business she was about to call — including who owns it, where they live, and how to reach them. It is good at that job.

**This procedure sells a report to that business.** That inverts the privacy posture completely: the subject of the research is now the customer, the artifact is a compiled product they receive, and everything that made `web-deep-dive` useful for a cold call is a liability in a document with our name on it.

> **So this is not a light edit.** An entire phase is deleted and the report's opening is rebuilt rather than adjusted. That is the strip `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 believed had already been done. It had not; it is done here.

**What is NOT changed:** the research itself. The listings audit, NAP consistency, competitor snapshot, services, red flags, and recommendations all carry across intact. This changes **who the report is about and the way it is written**, not what it looks at. **What is ADDED**, per the statement of intent, is real GBP data from Places and the four-checkpoint system wired through end to end — neither of which `web-deep-dive` has.

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

**The procedure begins at what was Phase 2.2.** There is no verification step in this procedure. If `confirmed_place_id` is absent, the job never reaches the generator at all — that is the §1.4 gate's job, upstream, and the generator must never attempt to compensate for it.

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

### 2.3 ✅ RDAP — PERMITTED, narrowly. Three fields only.

> **RESOLVED 2026-08-01.** An earlier draft of this document removed all WHOIS/RDAP outright. **That was wrong and has been reverted.** `AUTOMATION_PIPELINE_SPEC.md` §6's existing lock was already correct and already drew this line precisely.

**Permitted, and nothing beyond it:**

| Field | Status |
|---|---|
| Domain **registration date** | ✅ permitted |
| Domain **expiry date** | ✅ permitted |
| **Registrar** name | ✅ permitted |
| Registrant name, organization, email, address, phone | ❌ **never requested, never read, never stored** |

**Bound to RDAP direct**, per `FULFILLMENT_WORKER_SPEC.md` §7.4's DECIDED row. The `seo_domain_whois` MCP tool is not called (self-contained-worker lock).

#### ⚠️ Why this is safe — record this so it is not re-stripped later

**Restriction is by QUERY CONSTRUCTION, not by filtering a response after the fact.** That distinction is what makes this compatible with lock 3 ("by construction, not post-hoc"), and it is why "just remove it" was the wrong instinct:

- **RDAP responses for `.com` / `.net` and most gTLDs have redacted registrant contact fields by default** since the post-GDPR registration-data policy. The personal fields are not present in the response to be filtered.
- A query reading only the `events` array (registration, expiration) and the registrar name **does not receive personal data at all**.
- So the implementation reads **three named fields** and never deserializes the rest. Not a filter, not a scrub — a field allowlist at the parse boundary.

> ⚠️ **To a future session:** if you are considering stripping RDAP on privacy grounds, that has already been considered, tried, and reverted. The correct control is the three-field allowlist above, not removal. If you widen what is read, *that* is the change that needs review.

#### The product value, plainly

**Domain expiry is a business-ending event that owners routinely do not know about.** `samples/sample-deep-dive-comparison.md` carries a real case: a domain **expiring in under five months**, on an established business with twelve years of history behind that address. Losing it would take the site, the email, and every inbound link with it. This is a genuine "this paid for itself" finding, it is cheap to retrieve, and there is **no alternative source** — certificate-transparency logs give a weak first-seen proxy for age and say nothing whatever about expiry.

**It also un-breaks a machine-enforced requirement.** `lib/report-precheck.js` `REQUIRED_SECTIONS` includes **`"Your domain"`**. Under total removal that mandatory section had no data source at all, so **every report would have tripped `MISSING_SECTION`** — a check the spec intends to be `block` severity at Checkpoint 4. Restoring the narrow query restores the section's source.

### 2.4 The Quick Facts table — the opening must be REBUILT, not edited

`web-deep-dive`'s report opened with: **Owner / Address / Phone / Alt Phone / Website / Years in Business.**

Strip the personal rows and **four of six are gone.** What survives — a website URL and a founding year — is not an opening; it is a fragment.

**Being honest about this: stripping guts the top of the report.** The opening cannot be patched by deleting rows. It has to be rebuilt around a different idea, and §3 below proposes one.

This is not incidental damage. That table *was* the sales-prep thesis — *here is who this person is and how to reach them* — and the reason it cannot survive is the same reason the fork exists.

### 2.5 The entire review-text layer — REMOVED. Quotes AND themes.

`web-deep-dive` Phase 2.5 is a "Reviews Deep Dive": ratings, counts, **key themes**, **2–3 verbatim standout quotes**, and **negative patterns**. Two separate rulings remove most of it, for two unrelated reasons.

**What survives: total review count and overall rating. Nothing else.** Both are **true totals** from Places (§4: *"these are TRUE TOTALS, safe"*) — not samples, not inferences.

#### (a) Verbatim quotes — REMOVED. ⚠️ A NEW constraint.

Those quotes are **Google's and Yelp's platform content, reproduced inside a document Rank On Call sells for $39.** That is a materially different act from reading them once to prepare a sales call.

> ⚠️ **This constraint does not exist in `web-deep-dive` and has no precedent in the governing specs.** §6's output lock covers personal data, not third-party content reproduced commercially. **It is introduced here** and should be recorded in `AUTOMATION_PIPELINE_SPEC.md` §6 so it survives independently of this document.

#### (b) ✅ Themes and negative patterns — CUT ENTIRELY (Irene's ruling, 2026-08-01)

An earlier draft kept paraphrased themes. **It should not have.** The reasoning was already written down in §4's own CUT list and simply had not been applied to this case:

**The Places API returns only 5 reviews out of potentially thousands** — relevance-selected, non-chronological, with no sort control and no paging. §4 **CUT review recency for exactly that sampling problem**, on the grounds that the visible newest review is a floor rather than the true newest.

**A theme drawn from a 0.08% relevance-biased sample has precisely the same defect.** "Several reviewers mention slow scheduling" is not a finding about the business — it is a finding about which five reviews Google chose to surface today. Worse, the bias is not random: relevance selection is exactly the mechanism most likely to over-represent unusual reviews, so **"negative patterns" is the single least trustworthy thing that sample can produce**, and it is also the most damaging to state wrongly.

**Paraphrasing does not fix it.** The earlier draft's hedge — themes are fine if paraphrased — confused the copyright problem with the statistics problem. Paraphrasing solves (a). It does nothing for (b).

> ⚠️ **Recorded in `AUTOMATION_PIPELINE_SPEC.md` §4's CUT list so it cannot return as an "enrichment."** Themes are the obvious thing a future session will want to add back, because they read as insight and the data appears to be sitting right there.

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
| `seo_domain_whois` | **RDAP direct** | ✅ **Permitted, narrowly** — registration date, expiry, registrar. Nothing else, by query construction (§2.3) |

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

**§5.1 — Website analysis** *(was 2.2)*. Has-website path: fetch homepage / about / services / contact within the bounded crawl; check contact-info presence, services listed, SSL, mobile behaviour, platform, and red flags (placeholder content, outdated information, stale copyright year, broken pages). **Domain facts via narrow RDAP** — registration date, expiry, registrar, and nothing else (§2.3). **No-website path:** domain availability checks — the registrar API is unchosen (§4), so that branch is **not yet buildable**.

**§5.2 — Local listings audit** *(was 2.3)*. **TEN platforms** — ✅ Irene's ruling, 2026-08-01, keeping `web-deep-dive`'s full list:

> GBP · Yelp · Angi · HomeAdvisor · BBB · Facebook · Nextdoor · Houzz · Thumbtack · Porch

Per platform: name / address / phone **as listed**, rating, review count. Values are collected **for comparison only and never printed** (lock 2) — and under lock 3 they must not enter the generator's input object at all, only the derived mismatch types.

**Discovery method — ONE deep branded query, plus targeted verification only where absence will be claimed.** Not ten blanket queries. The rule that makes this safe: **a platform may only be reported as ABSENT if it was specifically checked.** Anything merely not seen in the broad query is `unread` and is not mentioned. Full reasoning and cost model: `FULFILLMENT_WORKER_SPEC.md` §7.4.

**§5.3 — NAP consistency** *(was 2.4)*. Across the business's own site plus every listing found. **Reported by which platforms disagree and what kind of mismatch — never by value.**

**§5.4 — Reviews** *(was 2.5)*. **Overall rating and total review count only.** Both are true totals from Places. **No verbatim quotes, no themes, no negative patterns** (§2.5), **no recency claims, no owner-response-rate claims** (both CUT in §4 — the data cannot support them). This section is deliberately thin, and that is the correct outcome: what remains is everything the available data can actually carry.

**§5.5 — Services and service area** *(was 2.6)*. As the business states them.

**§5.6 — Competitor snapshot** *(was 2.7)*. SERP for "[industry] [city] [state]": who ranks page 1, who has a website, whether the target appears. **Rank position, website yes/no, public review count, business type. No adjectives.**

> ⚠️ **Competitor sites are NEVER fetched, rendered, or crawled.** This section re-reads the SERP already retrieved for §5.1's ranking finding. Added to `AUTOMATION_PIPELINE_SPEC.md` §4's CUT list on 2026-08-01: per-competitor fetching multiplies the render and crawl cost by the competitor count and is the fastest available way to turn a 5-minute report into an hours-long one. Everything §6 permits us to say about a competitor is already in the SERP result.

**§5.7 — Red flags summary** *(was 2.8)*. ⚠️ A red flag may only be raised from a signal that was **actually retrieved this run.** An `unread` signal produces no flag and no severity marker (lock 5).

**§5.8 — Recommendations.** Kept.

---

## 6. ⚠️ Report template — three structures currently disagree

This is the largest unresolved item in this procedure, and it is checkable rather than a matter of taste.

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
| **Your domain** | §5.1 domain facts via narrow RDAP | ✅ source restored (§2.3) |
| **What this means** | §5.7, §5.8 | the "nerd out" close |

**One thing falls out of this table**, flagged in §8: the proposed opening section (§3) is deliberately **not** in `REQUIRED_SECTIONS`, which needs confirming as intended rather than an omission.

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

**✅ Closed 2026-08-01 — kept for the record**

- ~~WHOIS/RDAP removal vs. §6 and `REQUIRED_SECTIONS`.~~ **Narrow RDAP restored** — three fields, by query construction. §2.3.
- ~~Do review themes survive a 5-review sample?~~ **No. CUT entirely.** Rating and total count only. §2.5(b).
- ~~Listings platform count: 6 or 10?~~ **Ten.** §5.2.
- ~~Is `deep-dive-client-report` the fork source?~~ **No — it is the name this procedure takes on completion.** §0.

**⚠️ Blocking — must be answered before this procedure is built against**

1. **⚠️ SERP endpoint selection — the local pack.** `serp/google/organic/live/regular` returns organic results only and cannot see the three-pack, which for a local contractor is the whole game. `live/advanced` or a local-finder endpoint, **verified against a real local query** before Piece 3. Capability gap, not preference. §4 and `FULFILLMENT_WORKER_SPEC.md` §7.4.

**Needs a decision, not blocking**

2. **Registrar availability API** for the no-website path and name-variant checks — still unchosen, so §5.1's no-website branch is not buildable. A contractor with no website at all is a real and valuable case, so this is worth closing before Piece 3 rather than after.
3. **Record the third-party-content constraint in `AUTOMATION_PIPELINE_SPEC.md` §6** so the no-verbatim-quotes rule survives independently of this document. §2.5(a).
4. **Add an `OWNER_NAME_LEAKED` check at `block` severity to `lib/report-precheck.js`.** Needs a per-job context argument, since an owner name has no detectable shape — the check is "does this draft contain *this job's* stored `owner_name` string." `FUNNEL_REORDER_SPEC.md` §3.2.
5. **`REQUIRED_SECTIONS` vs. the opening section.** The proposed opening (§3) is deliberately not in the required list. Confirm that is intended rather than an omission.

**Already tracked elsewhere**

6. Three of the eight Checkpoint 4 checks are `warn` rather than `block`, and the §1.5 accuracy-claim check is absent entirely. `FULFILLMENT_WORKER_SPEC.md` §4 / §7.6 step 4.
7. `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 — corrected in place 2026-08-01 with a dated note. `FULFILLMENT_WORKER_SPEC.md` §8 register entries 1 and 5 remain **open**, correctly.
