# Rank On Call — Project Master Document

> The single source of truth for Rank On Call: a national, self-serve paid "Deep Dive" report that diagnoses a contractor's online presence for $39 — a profit center in its own right and the warm-lead engine feeding Sites On Call.

**Owner of doc:** Untitled Publishers
**Created:** 2026-07-21
**Version:** 1.0

---

## Purpose

Rank On Call sells a paid business-intelligence audit — the "Deep Dive" report — direct to contractors anywhere in the US. It is built to catch a contractor at the moment they search their *problem* ("why isn't my phone ringing") rather than a product they've never heard of, and to convert that pain into a $39 purchase. The report earns money on its own terms, and every buyer is simultaneously a qualified, warm lead for Sites On Call — the sister business that does the actual websites and SEO. One product, two returns: revenue at the front, pipeline at the back.

---

## The Business (Facts)

| Item | Detail |
|---|---|
| Product name | Rank On Call |
| Model | Self-serve paid report. National — no geographic tether. Never meets the customer. |
| Owner | Irene |
| Sister business | Sites On Call — the high-ticket back end (websites + SEO) |
| Domain | rankoncall.com — purchased, registrar GoDaddy (DNS → GitHub Pages at launch) |
| Repo | `mrmicaiah/rank-on-call` |
| Price | $39 intro / $249 stated anchor value / limited-time through end of September |
| The Product Engine | The existing `web-deep-dive` skill in the Productivity MCP |

---

## Why This Product Exists

The old model died of two separate wounds, and this product is the single fix for both.

**Problem 1 — the free scorecard leaked value.** Sites On Call gave away the diagnostic: a free scorecard telling a contractor exactly what was wrong with their online presence. Contractors took those findings straight to their own web designer and had them fixed there. SOC did the hard diagnostic work; a competitor collected the repair fee. The value walked out the door the moment it was handed over.

**Problem 2 — cold calling stopped converting.** That channel was the entire top of the funnel. When it dried up, there was no replacement behind it.

**The paid pivot fixes both at once.** A paid diagnosis *cannot* leak — the sale completes the moment they pay, regardless of what they do with the findings afterward. If they take the report to another designer, Rank On Call still got paid for the diagnosis; that was the product. And the price is a qualifying filter: someone who hands over $39 for a report about their own business has demonstrated budget and intent that a free-taker never did. The free scorecard attracted the exact people least likely to buy anything. The paid report attracts the opposite.

**And the property that makes it a real business:** the report has **no geographic tether**. It runs entirely on public data and never meets the customer — no site visit, no local presence, no service radius. Sites On Call is bounded by a region. Rank On Call's market is the entire country from day one.

---

## Settled Decisions (DO NOT REOPEN)

- **Contractors only, for now.** The `web-deep-dive` skill is tuned for home-services signals. Widen **geography** first (already national — push volume, not verticals); add verticals later, one at a time, deliberately.
- **Price is a RAMP, not a fixed number.** $39 → $69 → $99 → toward the $249 anchor. Reviews are the permission slip to raise it. The intro price buys the first wave of social proof; the social proof buys the higher price.
- **It is NOT free.** Free re-creates the exact value leak that killed the old model. A payer is a qualified lead; a free-taker is a stranger.
- **The product IS the `web-deep-dive` skill's output.** Do not reinvent it. It was tested cold on a real stranger and it works. Refine the packaging, not the engine.
- **Sites On Call is NOT abandoned.** It is the premium back end. Report delivery includes a soft upsell — *"want someone to just fix all this? → sitesoncall.com"*.
- **Larger contractors are a LATER roadmap tier.** A company with a real marketing budget reads "$39" as *toy*. That segment needs a separate, higher-priced offer with a human sales touch. It is a roadmap item, **not a launch concern** — do not let it distort the $39 product.

---

## The Funnel — CONTENT, NOT CITY PAGES

> ⚠️ **This is the most important section in this document.** The go-to-market decision here was tested against real keyword data and it overturns the intuition carried over from the sister project.

**Nobody searches the product name.** "Website audit for contractors" returns **0 SERP results**. There is no existing demand pool sitting behind the words that describe what this product is. Building pages around product language means building pages nobody will ever type their way to.

**Contractors search the SYMPTOM, in plain English.** The demand is enormous, high-intent, and emotionally charged — but it's all attached to *pain* language:

- "why isn't my phone ringing"
- "why can't people find me on Google"
- "why isn't my website getting leads"

That is a person in trouble, actively looking for an answer, at the exact moment they'd pay $39 to be told what's wrong.

**Therefore: the go-to-market is a CONTENT ENGINE.**

- **Pillar pages on head terms** — e.g. *contractor website*: **720/mo**, MEDIUM difficulty, **$19.44 CPC** (that CPC is the tell — real commercial intent, real money already chasing these words).
- **Clusters of pain-symptom articles** hanging off each pillar, written in the contractor's own words.
- **Every one of them ends in the $39 Deep Dive CTA.**

The content catches the pain. The report converts it. That's the whole machine.

> ⚠️ **WARNING — DO NOT BUILD CITY PAGES FOR THIS PRODUCT.**
> City pages are the **Sites On Call local model**. They work there because that business is geographically bounded and sells locally. They **FAIL here** — tested against real keyword data. This product has no geographic tether and no local search demand behind its product language.
> **Any future session must actively resist adding city pages out of muscle memory.** If you find yourself scaffolding `/locations/` or `{{ city }}` templates in this repo, stop — you have imported the wrong playbook from the sister project.

**Cannibalization note:** this content competes in Sites On Call's own keyword pool. The two sites must **cross-link and reinforce each other**, not compete. Treat them as one funnel with two doors — symptom content into Rank On Call, "just fix it for me" traffic into Sites On Call.

### The lane split — Sites On Call teaches, Rank On Call diagnoses

Sites On Call already runs a mature content engine (~22 published articles as of July 2026) that ranks across most of the same keyword pool Rank On Call targets — contractor SEO, contractor leads, "why isn't my business showing up on Google," GBP/NAP mechanics, the free-leads trap. Rank On Call must NOT mirror those topics head-on, or the two sites compete for the same searches and split their own authority.

The resolution: **the two sites own different intent in the same keyword pool, divided by what each sells.**

- **Sites On Call = teach / fix.** It sells the website, so its content answers *"how does this work / how do I fix it"* — playbooks, guides, "how Google decides who to show." This is what its existing library already does.
- **Rank On Call = diagnose.** It sells the $39 diagnosis, so its content answers *"is MY site broken — show me what's wrong with mine, specifically."* Not "how does local SEO work" (SOC owns that), but "find out what's wrong with your online presence right now" → the Deep Dive.

Same symptom, different verb. SOC's article ends in knowledge; Rank On Call's ends in *your specific problem, for $39.*

**The cross-link is the mechanism, not a courtesy:**

- SOC teaching article → *"want to know if this is happening to YOU? → Rank On Call Deep Dive"*
- Rank On Call diagnosis → *"want someone to just fix all this? → sitesoncall.com"*

Two doors, one funnel. Every Rank On Call article must be written in the diagnostic lane and must cross-link to the relevant SOC teaching article where one exists.

---

## The Product & Proof (the "Rob" cold test)

The `web-deep-dive` skill was run **cold** on a randomly chosen Nashville contractor — "Nashville Seamless Gutters," owner Rob — using only **4 intake fields**, no prior relationship, no account access, no inside information. Every tool returned real, specific, checkable data:

- Ranks **#4 in their own city**.
- Domain is roughly **3 years old**.
- The fuller version of the business name is **already taken by someone else**.
- **Broken stat counters** rendering as **"0+ Gutter Installs"** — the site literally advertises zero completed jobs to every visitor.
- **Brand-identity conflict** — the logo says "Gutters & Roofing," while the domain and all SEO signals say gutters only.
- **The killer — NAP inconsistency:** **three different addresses and two different phone numbers** scattered across their own website, Yelp, and BBB. BBB listing shows **"Not Rated."**

That last finding is worth the $39 on its own. It is invisible from the inside, it directly suppresses local ranking, and it is the kind of thing an owner immediately recognizes as a real problem the moment it's laid out. **It is the centerpiece of the sample report.**

**Verdict:** the report is genuinely worth the price, and the tool-dependent layer held up on a total stranger. This is not a demo that works because we picked a friendly target — it worked cold.

---

## Launch Model — Human Insight Pass (NOT full automation)

The skill generates the raw report **sections** reliably. What it does not generate on its own is the **insight** — connecting three scattered addresses into the single finding *"your NAP is inconsistent and it's costing you local rank,"* or noticing that a stat counter rendering "0+" is worse than no counter at all. On the Rob run, that judgment played out across roughly **8 tool calls** and required a human reading the output.

**Launch model = automated data-gathering + a FAST HUMAN INSIGHT PASS before delivery.**

Full automation (Stripe → auto-generate → auto-deliver) is a **later phase**, and it cannot ship until it solves the **wrong-business problem**. The skill's Phase 1 is *verification* for a reason: three different businesses can share a name, and the correct one is not always the first result. A bot firing reports at strangers without that safeguard will, eventually and inevitably, email a polished, confident, completely wrong report about someone else's company — with a Stripe receipt attached. That is a refund, a bad review, and a credibility loss in one message. Verification is not optional overhead; it is the thing that makes automation survivable.

---

## The Site — What It Must Contain

### Intake form — two tiers

**REQUIRED** (mandatory plumbing — aim the research, deliver the product, invoice the customer):

- Name
- Business name
- City / State
- Website URL
- Phone
- Email

**HIGH-VALUE INTENT fields** (zero-login, all answerable from memory in seconds — these are what turn a generic audit into a report that feels personal):

- The **#1 service** they want more of
- The **city/area** they most want to win
- Whether they currently **pay for leads or ads**
- **Anything already bugging them** about their site
- **1–2 competitors** they lose to

### DELIBERATELY NOT ASKED

**Anything requiring account access** — Google Business Profile logins, analytics access, ad account access. That friction rebuilds a consulting engagement: it turns a 60-second purchase into a back-and-forth onboarding, and it kills self-serve. The entire product design depends on the customer never having to grant us anything.

**Optional-but-worth-it:** a **"paste your Google Business Profile link"** field. Zero-login, one paste, and it lets a targeted fetch grab the GBP page directly — see *Known Risks & Soft Spots*.

### The rest of the site

- **A clickable SAMPLE Deep Dive report.** Produced by running a real deep dive — **Rob is a ready candidate** — then scrubbing all business-specific data to "Sample/Test." Nobody buys a $39 report sight-unseen; the sample *is* the sales page.
- **Link(s) back to Sites On Call** — the soft upsell path for buyers who'd rather hire the fix than do it.
- **The content engine as a first-class part of the site.** Not "a blog we'll fill in later." The articles *are* the funnel (see *The Funnel*); the site architecture must be built around them from the start.
- **Pricing presentation** — $39 intro, $249 anchor value, September urgency, stated plainly.

---

## Tech Stack

**DECIDED:**

- **Eleventy (11ty) / Nunjucks**
- **GitHub + GitHub Actions** for deploy
- **GitHub Pages** for hosting
- Reusing the **Sites On Call pattern** end to end

**Rationale:** it's proven in the sister project, it's content-SEO-friendly (fast static pages — ideal for the article engine that *is* this product's funnel), hosting is free, and the workflow is identical to the sister site, which makes the required cross-linking natural rather than a bolt-on.

**Known gotcha carried from the sister project:** Nunjucks here has **NO `split` filter** — using it **breaks the 11ty build**. Work around it; don't rediscover it.

Build output `_site` is git-ignored.

---

## Known Risks & Soft Spots

**(a) Full automation vs. the insight layer.** Covered in *Launch Model — Human Insight Pass* above. The short version: the data-gathering automates, the judgment does not yet, and automating delivery before solving wrong-business verification is the single highest-consequence mistake available to this project.

**(b) GBP / Google Maps soft spot.** The **live Google Business Profile star rating and review count CANNOT be reliably pulled by the current toolset** — there is no Google Maps tool in the stack. Rob's "5.0, 70+ reviews" came from **their own website**, not from Google. That number could be stale, aspirational, or wrong, and presenting it as verified Google data in a paid report is a credibility risk.

Fixes, in order:

1. **The optional "paste your GBP link" intake field** — cheapest fix, ships with the site, solves most cases.
2. **Build a Google Places API skill** — sanctioned, stable, cheap. The official API returns rating, review count, and up to 5 reviews as clean JSON. Roughly 15 minutes of Google Cloud setup.

**Do NOT build a raw Google Maps scraper.** It violates ToS and it breaks silently — which is the worst failure mode for something feeding a paid deliverable.

**The Places API skill is DEFERRED to AFTER the site is built and running.** The report works without it. It is an enhancement, not a blocker.

---

## Scars — Hard-Won Lessons

Carried over from the sister project and this session. These were paid for once already.

- **SEO-Scout / DataForSEO throws FALSE balance readouts.** It will report "-$1.00" or "$33+ cost" and scream that you're out of credit. It is a **display glitch, not real spending.** Verify the true balance with the `seo_test` tool before believing any alarm. *Confirmed this session:* the real balance held steady at ~**$32.38** the entire time the interface was reporting -$1.00.
- **Top up SEO-Scout before heavy keyword research.** Phase 1 will burn through calls; don't start it near empty and then have to distinguish a real shortfall from the glitch above.
- **"Non-zero control-string proof before trusting any null OR weird result."** Always fire a control query you *know* has an answer, to prove the tool is actually working, before trusting a strange return. This is precisely how the false -$1.00 glitch and the **genuine** "0 results for product-name searches" finding were told apart — one was a broken tool, one was a real market fact, and they looked identical until a control query separated them. That distinction is the foundation of the entire funnel strategy.
- **Web fetch ≠ what a human browser sees.** Cloudflare and JS-rendered pages can serve bots broken or empty content. A blank fetch is not proof of a blank page.
- **Verify before you scale.** Prove it on one real case, *read the actual output with your own eyes*, then scale. The Rob test exists because of this rule.

---

## Roadmap / Phases

The order below is the **safe** order. Each phase de-risks the next.

- [x] **Phase 0 — Foundation.** Repo created ✓. This master doc ✓. Brand chosen (Rank On Call) ✓. Domain rankoncall.com **purchased** (registrar GoDaddy) ✓. **Trademark cleared** ✓. Foundation complete.
- [ ] **Phase 1 — Verify demand / keywords.** (a) Check keyword targets against `docs/SOC_CONTENT_INVENTORY.md` to avoid head-on collisions with SOC's existing library, then (b) run fresh keyword + difficulty research to pin the specific pain-symptom clusters to target. **Verify SEO-Scout balance first** (see *Scars*).
- [ ] **Phase 2 — Build the sample report.** Run a real Rob-style deep dive, then scrub business-specific data to "Sample/Test."
- [ ] **Phase 3 — Stand up the site.** 11ty: content architecture + intake form + sample report + Sites On Call cross-links + pricing page.
- [ ] **Phase 4 — Manual fulfillment first.** Human insight pass on every report + a delivery email that includes a **Google review link** → this is the review flywheel that earns permission for the price ramp.
- [ ] **Phase 5 — Add Stripe self-serve.**
- [ ] **Phase 6 — Automate delivery LAST**, and only **WITH** the wrong-business safeguard in place.

> **Explicit note:** do **NOT** let Stripe or chatbot automation jump the queue. Automation feels like progress and is the most tempting thing to build first; building it before Phases 1–4 means automating a funnel that hasn't been proven and a report that hasn't been reviewed.

---

## Decisions Log

| Date | Decision | Notes |
|---|---|---|
| 2026-07-21 | Brand = **Rank On Call** | Domain rankoncall.com purchased (registrar GoDaddy); trademark cleared. Sibling to Sites On Call. |
| 2026-07-21 | Stack = **11ty / Nunjucks + GitHub Pages** | Reuse the sister-site pattern; no `split` filter in Nunjucks |
| 2026-07-21 | Funnel = **symptom-keyword content + $39 report CTA**, **NO city pages** | Tested against real keyword data; product-name searches return 0 results |
| 2026-07-21 | **Google Places API skill = deferred** | Post-launch; the report works without it |
| 2026-07-21 | **Launch = manual human insight pass**, automation last | Wrong-business verification must precede any auto-delivery |
| 2026-07-21 | **Lane split: SOC teaches/fixes, Rank On Call diagnoses** | Resolves cannibalization — same keyword pool, different intent, mutual cross-linking. SOC has ~22 articles already ranking; do not mirror them head-on. |

---

## Open Items (blocking / to confirm)

- [ ] **Which specific pain-symptom keyword clusters to target** — needs Phase 1 research.
- [ ] **Business email** for the review-request + delivery flow — `[TBD]`
- [ ] **Stripe account setup** — later phase (Phase 5).
- [ ] **Confirm GitHub Pages vs. other hosting** — default is Pages.

---

## Project Files

| File | Status |
|---|---|
| `docs/PROJECT_MASTER.md` | **This document — read first.** |
| `docs/SEO_CONTENT_ARCHITECTURE.md` | ✓ Created — keyword pyramid + 3 diagnostic hubs, 18 article ideas. |
| `docs/SOC_CONTENT_INVENTORY.md` | SOC's ~22 articles — cross-link targets + collision check. |
| Site build spec | `[to be created]` |
| Launch marketing plan | `[to be created]` |
| Execution checklist | `[to be created]` |
