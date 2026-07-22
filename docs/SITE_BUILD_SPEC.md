# Rank On Call — Site Build Spec (Phase 3)

> The build plan for rankoncall.com: what gets built, in what order, and the two hard requirements nobody may quietly skip.

**Owner of doc:** Untitled Publishers
**Created:** 2026-07-21
**Version:** 1.0
**Read first:** `docs/PROJECT_MASTER.md`

---

## Purpose

This is the build plan for **rankoncall.com** — an 11ty static site whose entire job is to catch a contractor in the moment they search their symptom, show them a real sample Deep Dive, and convert them to the $39 report. Four moving parts: the **content engine** (pillar pages and diagnostic articles that catch the pain), the **intake form** (what a buyer fills in), the **sample report** (the sales centerpiece — nobody buys a $39 report sight-unseen), and **pricing** ($39 intro against the $249 anchor). All of it cross-linked with Sites On Call so the two sites reinforce each other instead of competing for the same searches.

---

## Tech stack (locked)

- **Eleventy (11ty) / Nunjucks**
- **GitHub + GitHub Actions** deploy
- **GitHub Pages** hosting
- **Domain: rankoncall.com** — purchased, registrar **GoDaddy**. DNS → Pages via **A records + CNAME** at launch.
- Reuses the **Sites On Call pattern** end to end — same workflow, which is what makes cross-linking natural rather than a bolt-on.
- Build output **`_site` is git-ignored.**

> ⚠️ **Nunjucks gotcha, carried from the sister project: there is NO `split` filter.** Using it **breaks the 11ty build.** This is written here so nobody rediscovers it the hard way at build time.

---

## Design System (LOCKED)

> Reconciliation against the SOC repo is **done**. The system below is locked — a builder writes the stylesheet from this section alone, zero guessing.

### Typography

| Role | Face | Details |
|---|---|---|
| Display | **DM Serif Display** | ital axis `0;1`. Used for headlines, wordmark, prices, step numbers. **Nothing else.** |
| Body/UI | **Outfit** | weights 300–700. All body copy, nav, buttons, labels. |

Source: **Google Fonts**, same loading pattern as Sites On Call.

### Wordmark

Text only — **no image asset.** Markup: `Rank On <span>Call</span>`

- DM Serif Display, `letter-spacing: -0.02em`
- "Rank On" = ink `#0f1114`. "Call" (the span) = accent `#1e40af`.
- On dark backgrounds (footer): "Rank On" flips to light, and the span uses the dark-bg accent `#60a5fa` (see Color — WCAG).
- Mirrors SOC's `Sites On <span>Call</span>` pattern exactly — this is the deliberate sibling signal.

### Color

| Role | Hex | Rules |
|---|---|---|
| Accent | `#1e40af` (royal blue) | **HARD RULE: accent ONLY, NEVER a background fill.** Permitted uses: buttons, labels, wordmark span, hero italic phrase, step numbers, pricing card border. A saturated-blue background panel was tested and **REJECTED** — it reads spammy. Do not reintroduce it. **Second hard rule: as TEXT, `#1e40af` is for light backgrounds only** — it measures ~2.2:1 on the dark backgrounds, a WCAG failure. |
| Accent — dark-bg text | `#60a5fa` | **Accent-colored TEXT on dark backgrounds ONLY** (hero italic phrase on ink, footer wordmark span). Measured 7.4:1 on `#0f1114` and 6.9:1 on `#0c1836` — clears WCAG AA normal-text (4.5:1). Never a fill, never on light backgrounds; the accent-never-a-background rule applies to both tokens. |
| Dark bg (near-black) | `#0f1114` | Hero, footer. |
| Dark bg (deep navy) | `#0c1836` | **"See It First" band only.** |
| Light sections | `#ffffff` and `#fbfbfc` | Cool neutrals. Explicitly **NOT SOC's warm cream** — do not port SOC's neutral palette. |

### Buttons

- Default: `border-radius: 8px; padding: 0.85rem 2rem; font-weight: 600;`
- Nav CTA variant: `background: #0f1114` (ink), `border-radius: 6px`.
- Build these cleanly with normal specificity. SOC's nav CTA uses six `!important` declarations — do **NOT** replicate that.

### Spacing / layout

| Token | Value |
|---|---|
| Section padding | `section { padding: 6rem 2rem }` |
| Container — wide | `1200px` |
| Container — default | `1100px` |
| Container — prose/narrow | `720px` |
| Nav height | `72px` |

### Strategic rationale (Option B)

Rank On Call is a **standalone brand** that must survive independently of Sites On Call. Sibling signal comes from shared **typography + wordmark structure + spacing** — **NOT** shared color. Note for the record: SOC's brand color is **terracotta `#c45d3e`, not green**; an earlier assumption in this project was wrong and has been corrected.

### Explicit NON-inheritance from SOC (three known defects — do not carry them over)

1. **Accessibility:** SOC has no `:focus` or `:active` states anywhere. Rank On Call ships `:focus-visible` states on **every** interactive element from day one.
2. **Specificity:** SOC's nav CTA relies on six `!important` hacks. Build ours with clean cascade.
3. **Assets:** SOC's favicons live on a shared Cloudinary account, which caused a documented broken-image incident. Rank On Call hosts its favicon **AND** OG image **in-repo** from the start. No external CDN for brand assets.

### Approved homepage structure (mock v4)

Section order, top to bottom:

1. **Header** — nav, 72px, wordmark left, ink CTA right
2. **Hero** — near-black `#0f1114`, DM Serif Display headline containing the italic accent-blue phrase *"Why can't people find you on Google?"*
3. **Problem** — 3 cards, light background
4. **How It Works** — 3 steps, serif numerals in accent blue
5. **"See It First"** sample-hook band — deep navy `#0c1836`
6. **Pricing** — single card, accent-blue border
7. **Footer** — near-black `#0f1114`

Note the hero headline is a **symptom** in the contractor's own words, not a product description — that is the whole funnel thesis, applied to the front door.

### Voice

**Honest-broker house voice throughout**, per the voice section of `docs/SEO_CONTENT_ARCHITECTURE.md`: contractor language, never marketer language. *"Get the phone ringing."* Never *traffic*, *impressions*, or *funnel* — the keyword data showed a 60x gap between how contractors phrase this and how marketers do.

---

## Page inventory

| Page | Notes |
|---|---|
| **Home** | The mock's section flow above. |
| **Sample report page** | Renders `samples/sample-deep-dive-comparison.md` as a styled, clickable page. **The sales centerpiece** — every CTA on the site is asking for $39 sight-unseen without it. |
| **Pricing** | **Recommend both:** a pricing section on Home *and* a dedicated `/pricing` page, with the home section anchor-linking to it. Costs nothing extra and gives the nav somewhere to point. |
| **Deep Dive intake / order page** | The form — spec'd below. |
| **Content engine** | Pillar pages + cluster articles across the 3 hubs (Visibility, Leads, Website/Presence) per `docs/SEO_CONTENT_ARCHITECTURE.md`. **Built out over time — not all 18 at once.** Phase 3 ships the architecture plus Hub 1's pillar and top 2–3 articles. |
| **About** | Brief, honest-broker, "sister of Sites On Call." |
| **Privacy** | Standard. |
| **Terms** | Standard. |

---

## The intake form

Two tiers of fields, plus one optional, plus a hard exclusion.

### REQUIRED — mandatory plumbing

Aims the research, delivers the report, invoices the customer. No report can be produced without these.

- Name
- Business name
- City / State
- Website URL
- Phone
- Email

### HIGH-VALUE INTENT — zero-login, sharpens the diagnosis

All answerable from memory in seconds. These are what turn a generic audit into a report that feels personal.

- The **#1 service** they want more of
- The **city/area** they most want to win
- Whether they currently **pay for leads or ads**
- **Anything already bugging them** about their site
- **1–2 competitors** they lose to

### OPTIONAL but worth it

- **"Paste your Google Business Profile link"** — zero-login, one paste. Lets a targeted fetch (and the Places API skill) grab the *specific* GBP page rather than guessing which business is which.

### DELIBERATELY NOT ASKED — do not add this later

**Anything requiring account access.** No GBP login, no analytics login, no ad account access.

That friction **rebuilds a consulting engagement**: it turns a 60-second purchase into a back-and-forth onboarding, and it kills self-serve. The entire product design depends on the customer never having to grant us anything. This is stated explicitly here so that a future session doesn't add an "connect your Google Analytics for a deeper report" field thinking it's an improvement. **It isn't. It's the product's core constraint.**

### Form tech

**TBD.** Courier is the sister project's form pattern and is the obvious first candidate. **Stripe for payment is a later phase** (Phase 5 in the master roadmap) — Phase 3 ships the form, not the checkout.

---

## The CTA — reusable include (locked decision)

Every article and every page ends in the same CTA. **Build it as a SINGLE reusable 11ty include/partial** — e.g. `_includes/deep-dive-cta.njk` — **from day one. NOT hardcoded per page.**

**This is a hard requirement, and here is why:** the offer is a **price ramp** ($39 → $69 → $99 → toward $249) and the *"through end of September"* line is **time-bound**. When the price or the date changes — and both will — it must be a **one-file edit**, not an 18-file find-and-replace across every article ever published. Hardcoding it is cheap today and expensive every month after.

The include contains, all in one place:

- The price — **$39**
- The anchor — **$249**
- The urgency line — *through end of September*
- The primary CTA button
- **The SOC cross-link** — *"want someone to just fix all this? → sitesoncall.com"*

That last item matters: both doors ship together. The reader who wants to *know* goes to the Deep Dive; the reader who wants it *handled* goes to Sites On Call. Neither is a lost visitor.

---

## Google Business Profile rating — the Places API PRE-LAUNCH GATE

> ⚠️ **This is a launch gate, not a post-launch enhancement.** The master doc previously deferred this; that has changed and this section is now authoritative.

The Deep Dive report displays a **verified Google Business Profile star rating and review count as a REAL, designed field** — not a placeholder, not a caveat. The current toolset **cannot pull this reliably** (there is no Google Maps tool in the stack). Therefore building and connecting a **Google Places API skill** is a **pre-launch gate that must be completed before the site goes live.**

### Sequence

1. **[OWNER ACTION REQUIRED]** — Create a **Google Cloud project + Places API key** tied to Irene's billing (~15 minutes). **This is a prerequisite only the owner can do.** Everything else in this gate is blocked behind it, so **start it early** — it is the single most likely item to hold up launch, and it is also the cheapest to start today.
2. **Build the Google Places API skill** (into the Productivity MCP). The official API returns rating, total review count, and up to 5 reviews as structured JSON.
   **Do NOT build a raw Maps scraper** — it violates ToS and it breaks silently, which is the worst possible failure mode for something feeding a paid deliverable.
3. **Run it to populate real verified GBP figures** — including **re-running it against the two sample businesses** so the sample report shows real verified numbers.
4. **Only THEN flip the site live.**

**State plainly: the site does not launch with "pending verification" wording anywhere.** The GBP field is correct and populated before go-live. A paid report that hedges on its single most important number is not a paid report anyone reviews well.

---

## SOC cross-linking (per the lane split)

Every Rank On Call article cross-links to the relevant **SOC teaching article** — the canonical list is `docs/SOC_CONTENT_INVENTORY.md` (22 articles), and per-article assignments are in `docs/SEO_CONTENT_ARCHITECTURE.md`.

**The flagship bridge:** SOC's *"Most North Alabama Contractors Are Losing Google to Middlemen"* — a market-level data study — ↔ Rank On Call's pitch: **"we run that study on YOU, personally, for $39."** Strongest thematic link in either library, and it works in both directions.

Header and footer link to **sitesoncall.com**. The two sites **reinforce, they do not compete**.

> ⚠️ **NO city pages.** That is Sites On Call's local model and it **fails here** — tested against real keyword data (product-name searches return 0 results; the demand is all in symptom language). See `PROJECT_MASTER.md` → *The Funnel*. Any future session must resist adding them out of muscle memory.

---

## Build sequence (the safe order within Phase 3)

1. **Reconcile design tokens** against the SOC repo CSS; lock the Rank On Call design system (palette from the mock + SOC's fonts/buttons).
2. **Scaffold 11ty** — base layout, header/footer, **the reusable CTA include**, the royal palette as CSS variables.
3. **Build the home page** (the mock's flow).
4. **Build the sample report page** (render the side-by-side sample).
5. **Build the pricing** section/page.
6. **Build the intake form page** (form tech TBD; Stripe later).
7. **Build Hub 1 (Visibility)** — pillar + top 2–3 diagnostic articles, each ending in the CTA include, each cross-linked to SOC.
8. **Point rankoncall.com DNS → GitHub Pages**; HTTPS; verify in Search Console; submit sitemap; GA4.
9. **PRE-LAUNCH GATE** — build + connect the Places API skill, populate real GBP figures (including the sample), confirm **no "pending" wording remains** anywhere.
10. **Go live.**

> **BUILD-ORDER NOTE (CTA include):** `_includes/deep-dive-cta.njk` must be created at **step 2**, before any page that consumes it. The CTA is a **reusable include, not copy-pasted markup.** That ordering is deliberate — it is the one decision that gets expensive if deferred.

---

## Open items

- [ ] **Form backend** — Courier vs. other. Decide at form-build time (step 6).
- [ ] **Stripe integration** — later phase (Phase 5 in the master roadmap), not Phase 3.
- [x] **Design-token reconciliation** against the SOC repo — **DONE.** Locked in the *Design System (LOCKED)* section above.
- [x] **Google Cloud / Places API key** — **DONE 2026-07-22.** Key `rank-on-call-places-server` created, restricted to Places API (New); value lives in local `.env` (never committed — see `.env.example`). Remaining key work (application restriction, deploy-host env var) is tracked in `docs/PRE_LAUNCH_CHECKLIST.md`.

---

## Project Files reference

| File | What it is |
|---|---|
| `docs/PROJECT_MASTER.md` | **Read first.** Strategy, settled decisions, roadmap, scars. |
| `docs/SEO_CONTENT_ARCHITECTURE.md` | Keyword pyramid, 3 diagnostic hubs, 18 article ideas, the voice spec. |
| `docs/SOC_CONTENT_INVENTORY.md` | SOC's 22 articles — cross-link targets + collision check. |
| `samples/sample-deep-dive-comparison.md` | The scrubbed side-by-side sample — the site's sales centerpiece. |
| `docs/SITE_BUILD_SPEC.md` | This document. |
