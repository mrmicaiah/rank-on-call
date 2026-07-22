# Pre-Launch Checklist

> **What this is:** the single tracked list of everything that must be resolved before rankoncall.com goes live. Placeholders and owner-actions were previously scattered across commit messages and dispatch reports; this is their one home. **When an item is resolved, check it off and append the resolving commit hash** (e.g. `— resolved in abc1234`). Build-sequence work itself (steps 3–8) is tracked in `docs/SITE_BUILD_SPEC.md` → *Build sequence*, not here — this list is the gates and loose ends, not the build plan.

---

## Owner actions (only Irene can do these)

- [ ] **Confirm rankoncall.com is registered and owned** — currently hardcoded as the canonical URL in `src/_data/site.json`, unverified.
- [ ] **Add an application restriction to the Google Places API key** (IP or HTTP referrer). Key is currently API-restricted only. Console: *APIs & Services → Credentials → rank-on-call-places-server*. **Deploy target now known (Cloudflare Pages) — open question:** Cloudflare's egress IPs are not fixed, so an IP restriction likely won't hold; the restriction will probably need to be HTTP referrer, or handled by keeping the key server-side only in Pages Functions (its only location anyway, per `docs/BOT_ARCHITECTURE.md`). Decide which before launch.
- [ ] **Add `GOOGLE_PLACES_API_KEY` to the deploy host's environment variables panel.**
- [ ] **Decide the Deep Dive intake destination:** on-site page at `/deep-dive/` vs. direct payment-processor link. This determines whether build step 6 creates a form or a redirect.

## Assets to replace

- [ ] `src/assets/img/og-image.png` — currently a 1×1 transparent PNG placeholder. Needs a real **1200×630** brand image. In-repo only — no external CDN (spec non-inheritance rule #3).
- [ ] `src/assets/img/favicon.png` — currently a 1×1 transparent PNG placeholder. Needs a real favicon. Same in-repo rule.

## Code placeholders

- [ ] **`ctaHref` default `/deep-dive/`** in `src/_includes/deep-dive-cta.njk` — resolve at build step 6.
- [ ] **Nav CTA href `/deep-dive/`** in `src/_includes/base.njk` — resolve at build step 6, **must match the above** (both are comment-marked `PLACEHOLDER` in-file).
- [ ] **Hardcoded copyright year** (`© 2026`) in `src/_includes/base.njk` footer — replace with a computed date filter.
- [x] **`/sample/` href placeholder** — **RESOLVED**: `src/sample.njk` now publishes at permalink `/sample/`, matching both homepage hrefs. *(Resolved in the "feat: add anonymized sample report page" commit.)*

*(Repo-wide grep for `PLACEHOLDER`/`TODO`/`FIXME` on 2026-07-22 surfaced only the two `/deep-dive/` href markers above — no others exist in `src/` or `docs/`.)*

## Content decisions still open

- [ ] **Canonical meta description** in `src/_data/site.json` is authored, not spec-sourced — confirm or replace.
- [ ] **Header has no Sites On Call cross-link; footer does.** The spec's cross-linking section implies both. Confirm intent.
- [ ] **Nav links beyond the CTA** (Sample / Pricing / About) — add as those pages land.

## The Places API gate (spec: pre-launch gate, authoritative)

Per `docs/SITE_BUILD_SPEC.md` → *Google Business Profile rating*, these block go-live:

- [ ] **Build + connect the Google Places API skill** (official API, structured JSON — no scraping).
- [ ] **Populate real verified GBP figures**, including re-running the two sample-report businesses so the sample shows real verified numbers.
- [ ] **Confirm no "pending verification" wording remains anywhere on the site.**

## Verification before launch

- [ ] **Visual browser pass** confirming DM Serif Display and Outfit actually render (font loading moved from `@import` to `<link>` preconnect in `ec7e52c` — verified by URL 200, not yet by eyeball).
- [ ] **Keyboard-only pass:** skip link, nav CTA, all CTA buttons, footer links all reachable with visible `:focus-visible` states.
- [ ] **Confirm `.env` is not tracked:** `git check-ignore -v .env` returns a match. *(Passed 2026-07-22; re-verify before launch.)*
- [ ] **Confirm no API key appears in git history** (e.g. `git log --all -p | grep -i "AIza"` returns nothing).
- [ ] **OG image renders correctly in a link-preview debugger** once the real 1200×630 asset lands.
- [ ] **Sample page is anonymized** — re-verify no identifying details before launch, and revisit if a consenting business becomes available for a named case study. (The `/sample/` GBP rows also carry the `[populated at launch]` placeholder — replaced by the Places API gate above.)
