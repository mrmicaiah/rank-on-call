# Session Handoff — Rank On Call

**Written:** 2026-08-02, end of session. **Read this before anything else.**
**Audience:** a new manager in a fresh claude.ai pane, with zero context, when Irene says *"where were we."*
**Assume:** an indefinite gap since this was written. Nothing here has moved unless a later commit says so.

---

## 1. Read this first

**Rank On Call is a national, self-serve web product that sells a $39 "Deep Dive" — a business-intelligence audit of a contractor's online presence.** It runs entirely on public data and never meets the customer, so it sells anywhere in the US with no geographic tether. It is both a profit centre and the warm-lead engine for the sister business Sites On Call, replacing a dead cold-call channel.

### The Studio87 setup

| | |
|---|---|
| **Manager** | you, in claude.ai. You hold the strategy and write dispatches. |
| **Worker** | Claude Code, running in the `mrmicaiah/rank-on-call` repo on Irene's machine. |
| **Dispatch** | you write a ```PROMPT block; it reaches the worker as a file; the worker replies in a file. |
| **⚠️ The worker NEVER pushes.** | It commits when told. **Irene runs every `git push`, personally.** This is the control that makes everything else safe. |

### Governing docs, in reading order

| Doc | Owns |
|---|---|
| **`SESSION_HANDOFF.md`** (this) | orientation, security posture, what's decided, what's next |
| **`FULFILLMENT_WORKER_SPEC.md`** | **the build.** APPROVED. The worker from Stripe webhook to delivered email. §7.6 is the build order; §7 is the open-questions register |
| **`AUTOMATION_PIPELINE_SPEC.md`** | **the constitution.** §1 locked decisions, §4 research set + CUT list, §5 safety layer, §6 privacy locks, §7 deliverable shape. **Wins on conflict with everything else** |
| **`FUNNEL_REORDER_SPEC.md`** | the funnel order, attestation, the launch gate. DRAFT but its decisions are made |
| **`RESEARCH_PROCEDURE_v3.0-roc.md`** | what the report actually researches and says. DRAFT |
| **`BOT_ARCHITECTURE.md`** | the free/paid tier boundary and the Stripe metadata contract |

`PROJECT_MASTER.md` is the strategy doc and predates all of this.

---

## 2. ⚠️ SECURITY POSTURE — why Irene can walk away from this

**Every claim below was verified against the repo at the time of writing, not asserted from memory.** The verification commands are given so you can re-run them.

### Not deployed. Not reachable. Not spending money.

| Claim | Verified how | Result |
|---|---|---|
| **The fulfillment worker has NEVER been deployed** | `npx wrangler whoami` | **"You are not authenticated."** Nothing could have been deployed from this machine |
| **No D1 database exists** | `grep database_id worker/wrangler.toml` | `database_id = "REPLACE_ME_AFTER_WRANGLER_D1_CREATE"` — a deploy would fail on this alone |
| **No queues created** | `roc-fulfillment` / `roc-fulfillment-dlq` declared in `wrangler.toml`, never created | both absent |
| **No secrets set on any worker** | not authenticated; `wrangler secret put` never run | none |
| **No Stripe webhook endpoint registered** | `STRIPE_WEBHOOK_SECRET` appears only as a variable *name* in code and comments | the secret does not exist |
| **No DataForSEO credentials anywhere** | grep for assigned values across the repo | only `{ DATAFORSEO_LOGIN: "user@example.com", DATAFORSEO_PASSWORD: "pw" }` in `dataforseo.test.js` — obvious dummies for a stubbed `fetch`, never a real call |
| **`functions/api/` — the LIVE money path — untouched** | `git diff --name-only 04faccc..HEAD -- functions/ src/` | **0 files.** Not one byte of the live checkout, scan, confirm or intake path changed this session |
| **`.env` is gitignored and untracked** | `git check-ignore .env` / `git ls-files .env` | ignored at `.gitignore:1`; git does not know it exists. Holds only the pre-existing `GOOGLE_PLACES_API_KEY` |

### Two things that ARE exposed — both pre-existing, neither opened by this work

- **The site is fully indexable.** No `robots.txt`, no `_headers`, no `<meta name="robots">` anywhere in `src/`. It is dark today only by obscurity — nothing links to it. **This is covered by the standing traffic gate** (`FUNNEL_REORDER_SPEC.md` front matter, §9.5), which forbids advertising, indexing or campaign links until four conditions hold. Adding `noindex` is on the list; it was not introduced by this session.
- **The three unauthenticated MCP workers are Micaiah's separate track.** Not this project's to fix. **The ROC worker calls none of them** — verified: the only reference to SEO-Scout in `worker/src/` is a comment documenting anti-patterns *not* to copy. That isolation is a locked decision (`FULFILLMENT_WORKER_SPEC.md` §1.3), and it exists precisely so ROC's fulfillment cannot break because of someone else's infrastructure.

> ### Nothing built this session is reachable from the internet.
>
> Every artifact is source code, documentation, or a test fixture sitting in a git repo. There is no running service, no bound database, no queue, no registered webhook, and no credential. The most that exists is a Worker that *would* accept a Stripe webhook **if** it were deployed, **if** a database existed, **if** secrets were set, and **if** an endpoint were registered in Stripe. None of those four is true.

---

## 3. What was accomplished this session

**Eleven commits, all pushed.** Session started at `04faccc`.

### Piece 1 — the trigger everything hangs off

| Commit | |
|---|---|
| `d950011` | **feat:** fulfillment worker webhook, job store, queue enqueue. Net-new `worker/` — a standalone Worker, because Pages Functions have no `queue()` handler |

### The doc reconciliation sweep

Nine commits' worth of decisions and the reconciliation they forced. Specs were contradicting each other; a session building from them would have built the wrong thing.

| Commit | |
|---|---|
| `a3ab778` | **docs:** funnel reorder spec — confirmation + attestation move ahead of payment |
| `5d01ecc` | **docs:** amend it — 24-hour turnaround, the delay email, launch gate moves to traffic |
| `c332bc4` | **docs:** reconcile `FULFILLMENT_WORKER_SPEC` with both |
| `b64db65` | **docs:** reconcile `BOT_ARCHITECTURE` + `AUTOMATION_PIPELINE_SPEC`. **The highest-value fix in the repo** — the metadata contract table listed eight keys on the wrong Stripe object |
| `9cf2387` | **docs:** bound the crawl, decide DataForSEO endpoints, fork the research procedure as `v3.0-roc` |
| `e8b147d` | **docs:** `v3.0-roc` is the successor; restore narrow RDAP, cut review themes, ten platforms |
| `85b4717` | **docs:** select `live/advanced`, adopt the branded sweep design |
| `48ed83a` | **docs:** resolve §7.1 — ROC has its own DataForSEO account |

### Piece 3, first caller

| Commit | |
|---|---|
| `549378d` | **feat:** DataForSEO SERP client, allowlist parser, first captured live fixture |
| `ffaab20` | **test:** weak-performer fixture — target absent from the local pack |

**Test suite: 89 passing, 0 skipped, 0 failing.** `npm test` in `worker/`.

---

## 4. ⚠️ DECIDED — do not reopen

These cost real argument. Each has a one-line reason; the full reasoning is in the cited doc. **If a build detail seems to require breaking one, surface it explicitly — do not quietly route around it.**

**Architecture**

| Decision | Because |
|---|---|
| **Full auto-send** — no human reads a report at send time | the deterministic Checkpoint 4 sweep earns it; a model reviewer shares blind spots with the generator |
| **Self-contained worker** — calls no MCP worker | a paid order with a deadline cannot hang off infrastructure this project doesn't control |
| **A separate Worker, not Pages Functions** | Pages Functions have no `queue()` handler |
| **D1 for durable state** | chosen over KV/Durable Objects; `jobs` keyed by PaymentIntent id |
| **The durable write happens BEFORE the §1.4 gate** | a gate-failing paid order still leaves a findable row instead of a log line |

**Product**

| Decision | Because |
|---|---|
| **24-hour turnaround**, not 3 business days | the 3-day window was padding for human review; with auto-send it is a hurdle on an impulse buy |
| **The delay email fires on FAILURE, not lateness** | a job failing at hour 2 emails at hour 2 — the buyer never experiences a silent miss |
| **The launch gate moved from copy to TRAFFIC** | the site has no audience, so copy ships final now. **Shipped copy is not permission to launch** |
| **Confirmation + attestation happen PRE-payment** | a buyer whose listing can't be found finds out before paying — a free conversation instead of a refund |
| **Attestation is a CLAIM. Nothing verifies it. Ever.** | verification would exclude the honest assistant/spouse/bookkeeper case and imply a guarantee we'd owe |
| **`owner_name` is a friction signal** — stored, never printed, never sent to the generator | someone affiliated knows it instantly; a competitor must look it up |
| **Candidate disambiguation by domain match** — ranks, never auto-selects | the buyer still chooses; a confident wrong match is the worst failure available |

**Research**

| Decision | Because |
|---|---|
| **Review themes CUT entirely** | Places returns 5 relevance-selected reviews out of thousands — the same sampling defect that cut recency |
| **Ten listing platforms** | GBP, Yelp, Angi, HomeAdvisor, BBB, Facebook, Nextdoor, Houzz, Thumbtack, Porch |
| **Narrow RDAP restored** — registration date, expiry, registrar, nothing else | restriction is by *query construction*; registrant fields are redacted by default post-GDPR. Domain expiry is a business-ending finding |
| **ROC has its own separate DataForSEO account** | not a sub-account. No unrelated project can drain the balance |
| **`serp/google/organic/live/advanced` only** | `live/regular` cannot see the local pack, and for a contractor the three-pack is the whole game |
| **Crawl bounded: 50 links, 120s ceiling** | hitting a cap is a normal outcome, not an error; remaining pages stamp `unread` |
| **Competitor sites are NEVER fetched, rendered or crawled** | it multiplies the two most expensive operations by the competitor count and buys nothing §6 permits us to print |
| **`v3.0-roc` is the SUCCESSOR to `deep-dive-client-report`**, derived from `web-deep-dive` | it takes that name on completion. Whatever sits under that name on the MCP is an inaccurate placeholder |

---

## 5. THE NEXT MOVE

### ⚠️ Recommended: fix `lib/report-precheck.js` BEFORE continuing Piece 3

`FULFILLMENT_WORKER_SPEC.md` §7.6 puts Checkpoint 4 verification at step 4, after the research callers. **This session produced evidence for doing it now instead.**

**The state of the module:**

- **Three of its eight checks are severity `warn`, not `block`** — `BANNED_WORD`, `MISSING_SECTION`, `UNSTAMPED_RANKING`. A report tripping all three still returns `passed: true`.
- **The §1.5 accuracy-claim check does not exist at all.** Zero grep hits for accuracy/guarantee/percentage/confidence.
- It passes 13/13 tests, which is misleading — the tests assert the current lenient behaviour.

**Why this session changed the priority.** Checkpoint 4 was previously load-bearing *in theory*. It is now load-bearing **in evidence**:

> An organic result's `title` can contain a street address. The gutters fixture has a live one — Lowe's is titled **"Gutter installation in Decatur, AL, 1641 BELTINE ROAD SW"**. `title` is on the parser's allowlist and **cannot be stripped**, because a competitor cannot be identified without it. So a street address reaches parser output through a legitimately allowlisted field, by design, with no bug anywhere.

**That means the precheck sweep over drafted text is the actual last line of defence against §6's output lock — and it is currently unverified and partly advisory.** Every further research caller adds more real-world text flowing toward a gate that does not yet close.

**The work:** make the three `warn` checks `block`, add the §1.5 accuracy-claim check, add `OWNER_NAME_LEAKED` at `block` (needs a per-job context argument — an owner name has no detectable shape, so the check is "does this draft contain *this job's* stored name"), and run the whole thing against real drafted output.

### Alternatives, if you disagree

1. **Continue Piece 3 as §7.6 sequences it** — Places details caller next, then the bounded crawl, then RDAP. All three are unblocked and the SERP caller's shape is proven. Defensible; it just accumulates exposure against an open gate.
2. **Test `on_page/instant_pages` with `enable_javascript: true`.** One call. **Time-sensitive** — see §6.
3. **Rent the render VPS.** The longest pole, and nothing else unblocks it.

---

## 6. Open items, grouped by what they block

### Blocks one caller each — build that caller last, everything else proceeds

- **The render VPS is not rented** (`FULFILLMENT_WORKER_SPEC.md` §7.2). Blocks the render caller only. Places, DataForSEO, the crawl and RDAP are all independent of it. §2.2 also has an open question about its recovery model: at 24 hours, "spin up another" needs someone awake — pre-baked image, standby box, or accept-and-rely-on-the-delay-email.
- **The registrar availability API is unchosen.** Blocks `v3.0-roc` §5.1's **no-website branch** only. A contractor with no website is a real and valuable case — arguably the one where the report has most to say.
- **⚠️ `on_page/instant_pages` with `enable_javascript: true` is untested, and this is TIME-SENSITIVE.** One call answers whether it narrows what the VPS must do. **Its value expires the moment the box is built to a wider spec than it needed.** Cheapest item on this list, shortest window.

### Blocks auto-send, not construction

- **Checkpoint 4 verification** — see §5. The recommended next move.
- **`OWNER_NAME_LEAKED` check** at `block` severity in `lib/report-precheck.js`.
- **Quarantine (§7.5) is still UNDESIGNED.** Where a held job goes, how Irene is notified, whether it retries, what the buyer sees. Under the 24-hour clock this is a named launch-gate condition, not a nicety.

### Blocks first traffic

- **⚠️ The DataForSEO account holds only its $1 signup credit.** That is ~500 calls at $0.002 — plenty for development, **nothing for production.** It must be funded (minimum deposit $50; credits do not expire) or generation fails with `40200`. Launch-gate-adjacent, not a build blocker.

### Lands during Piece 3, belongs to the pipeline

- **The `intent_*` timing race.** `checkout.session.completed` fires *before* the buyer fills the intake form, so the five steering fields do not exist at webhook time. The consumer must read them at research time, and a slow typist can still lose them. Pre-existing; the 24-hour turnaround sharpens it in both directions. `FULFILLMENT_WORKER_SPEC.md` §3.1.

---

## 7. ⚠️ Working style — non-negotiable

- **One dispatch at a time on anything touching git.** Never queue two.
- **The worker never pushes. Irene pushes.**
- **Verify before reporting done.** Run the thing. Paste the actual output.
- **Spec before build**, but **build over deliberate** — Irene is direct and impatient with hedging. Decide, state the reason in one line, move.
- **The commit trailer must read exactly:**
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
  **The harness generates a different one by default.** Correct it every time.
- **Own mistakes plainly.** State it, fix it, move on. No over-apologising, no ruminating.

### What this session demonstrated, and should be repeated

**The worker should STOP rather than fabricate a missing input.** It happened twice — a promised fixture was not on the filesystem, and a dispatch's `WRITE VERBATIM` section arrived empty. Both times the worker stopped, said so, and listed concrete ways to deliver the file. **Both were correct.** A hand-built fixture would have encoded assumptions and then confirmed them.

**The worker should flag an override rather than proceed silently.** When it did unblocked work after being told to stop, it said so explicitly and offered to revert. When it committed despite a failed privacy assertion — because the assertion itself was wrong — it led the report with that fact. **Keep both habits.** The value is that you can trust the reports without re-reading the diffs.

---

## 8. Lessons worth not relearning

**A fixture that encodes your assumptions and then confirms them is worse than no test.** Real captured responses only. If a fixture is missing, the tests that need it must **skip with a visible reason**, never pass vacuously.

**Write a control that asks "can this check still fail?"** After narrowing the privacy sweep, a control test planted every withheld value and required the sweep to catch each one. It failed — revealing that **the sweep could not detect a leaked multi-line value at all**, because `JSON.stringify` escapes newlines. The multi-line fields are exactly the `local_pack` descriptions carrying the banned verbatim review quotes. The check had been weakest precisely where it mattered most, and only the control found it.

**Endpoint and library choices cannot be copied without checking what they were chosen for.** SEO-Scout's use of `live/regular` is *correct* for content and keyword research, which is what that tool does. It is *wrong* for local business audits, because it cannot see the local pack. Nothing was broken in that codebase — the context differed. Ask what a decision was optimising for before inheriting it.

**A "13/13 passing" headline can hide the thing you care about.** `report-precheck.js` passes every test while three of its eight checks are advisory. Read what the tests assert, not the count.
