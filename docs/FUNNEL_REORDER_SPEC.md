# Rank On Call — Funnel Reorder Spec

**Status:** DRAFT — awaiting Irene's review. Nothing here is built. No file has been changed.
**Governed by:** `docs/AUTOMATION_PIPELINE_SPEC.md` §1 (locked decisions), §6 (privacy locks), §7 (deliverable shape) and `docs/FULFILLMENT_WORKER_SPEC.md` §1.4 (the confirmed-business gate), §3.1 (the input contract). Where this document and either of those disagree, they win and this one is wrong.
**Scope:** moving business confirmation and affiliation attestation ahead of payment, the attestation record store, and everything that has to move with them.

**Why now:** Piece 1's webhook is committed but **not deployed** — no Stripe webhook endpoint is registered, and `docs/FULFILLMENT_WORKER_SPEC.md` §5 confirms "No webhook exists today." Nothing anywhere reads the confirmation metadata. `confirm-business.js` and `intake.js` only ever *write* it. **This is the cheapest moment this reorder will ever be**, and the cost rises the day the webhook goes live.

---

## 0. Three things to read before the rest

1. **Attestation is a CLAIM, not a check.** Nothing verifies it. Nobody validates affiliation. §2 says this at length because a future session will otherwise "improve" it into a verification step and break the product.
2. **The reorder does not fully eliminate the §3.1 both-objects read.** It eliminates most of it. The five `intent_*` fields survive on the PaymentIntent, and they bring a timing race with them. §1.3.
3. **Pre-payment Places lookups spend money on unpaid traffic, on the Enterprise SKU's 1,000-call/month budget — not the 5,000 one.** §7 proposes a field-mask split that puts most of that spend back behind the paywall.

---

## 1. The reorder

### 1.1 Today vs. target

| | Flow |
|---|---|
| **Today** | free scan → Stripe checkout (business name + city collected by Stripe `custom_fields`) → `/thank-you/` confirmation gate → optional intake |
| **Target** | free scan → **confirmation + attestation on our own page** → Stripe checkout → optional intake |

The buyer picks their own Google listing and attests to affiliation **before** any money moves. Payment becomes the last step, not the middle one.

**What this buys.** Three things, in order of value:

1. **A wrong-business order stops being a refund.** Today the buyer can pay and only then discover we cannot find their listing. Post-reorder that conversation happens for free.
2. **The attestation is contemporaneous with the purchase decision**, which is what makes it worth anything as a record (§6).
3. **The confirmation gate stops depending on Stripe's `custom_fields`**, which is a data-entry surface we do not control, cannot validate, and cannot re-prompt on.

**What it costs.** One more step before the payment button, and Places spend on unpaid traffic (§7). The first is a real conversion risk and is Irene's call, not a technical one — noted in §10.

### 1.2 Precisely what moves

Today `confirm-business.js` writes nine keys onto the **PaymentIntent** after payment (`functions/api/confirm-business.js`, the POST handler). Post-reorder they are known before the Checkout Session exists, so they are written into **Checkout Session metadata at session creation** instead.

| Key | Today | Post-reorder | Note |
|---|---|---|---|
| `confirmed_place_id` | PaymentIntent metadata | **Session metadata** | The §1.4 gate input |
| `ownership_attested` | PaymentIntent metadata | **Session metadata** | Key name kept — see the ⚠️ below |
| `confirmation_method` | PaymentIntent metadata | **Session metadata** | `"places"` or `"manual"` |
| `confirmed_name` | PaymentIntent metadata | **Session metadata** | |
| `confirmed_address` | PaymentIntent metadata | **Session metadata** | Never printed (§6 output lock) |
| `confirmed_phone` | PaymentIntent metadata | **Session metadata** | Manual path only. Never printed |
| `attested_at` | PaymentIntent metadata | **Session metadata** | ISO 8601 |
| `report_due_at` | PaymentIntent metadata | **→ computed at the webhook, written to D1** | Moves entirely — §8 |
| `report_due_display` | PaymentIntent metadata | **→ computed at the webhook, written to D1** | Moves entirely — §8 |
| `attestation_id` | — | **Session metadata**, net-new | Foreign key into the attestation store (§6) |
| `scanned_url` | Session metadata | Session metadata | **Unchanged** — already correct |
| `businessname`, `citystate` | Session **`custom_fields`** | **Dropped** | We now collect these ourselves; see below |
| `intent_*` ×5 | PaymentIntent metadata | **PaymentIntent metadata** | **Unchanged — the split survives.** §1.3 |

**Drop the Stripe `custom_fields` entirely.** `checkout.js` currently makes Stripe ask for "Business name" and "City and state" (`functions/api/checkout.js:89–98`). Post-reorder we have already collected and *disambiguated* that information, so asking again on the Stripe page is a redundant step that can only introduce a mismatch between what the buyer confirmed and what they typed at Stripe. Dropping them also retires the seven-key fallback lists in `confirm-business.js` (`NAME_KEYS`, `LOCATION_KEYS`) for new sessions.

> ⚠️ **Keep the metadata key `ownership_attested` even though the wording now asserts affiliation.** The name is wrong post-reorder, but it is load-bearing in four places: `confirm-business.js` writes it, `worker/src/index.js` reads it, `FULFILLMENT_WORKER_SPEC.md` §1.4 gates on it, and `AUTOMATION_PIPELINE_SPEC.md` §1 item 4 names it in a **locked** decision. Renaming the wire key to buy accuracy in a string nobody sees is not worth touching a locked decision and a deployed gate. **The displayed text asserts affiliation; the key keeps its name.** Recorded in §10 as a docs-only cleanup for Irene to approve.

### 1.3 What this fixes in the §3.1 both-objects read — and what it does not

`FULFILLMENT_WORKER_SPEC.md` §3.1 calls the split contract "the most likely silent bug in this build." Being honest about the remainder:

**Eliminated.** Every confirmation field moves onto the Session. `custom_fields` disappears as a source. After the reorder, a consumer reading **only the Checkout Session** has everything it needs to run the §1.4 gate and aim the report: place id, attestation, method, name, address, scanned url. The class of bug §3.1 warns about — "a consumer reading only the PaymentIntent gets no website to analyze and no business name" — is gone, and its mirror image does not replace it.

**Survives.** The five `intent_*` fields stay on the PaymentIntent, because `intake.js` still runs **after** payment on `/thank-you/` and still appends to the PaymentIntent (`functions/api/intake.js:71`). A consumer that wants them must still hold both objects. The expand is therefore still required — `loadPaidSession()`'s `expand[]=payment_intent` does not go away.

**And it gets slightly worse in one specific way — a race nobody has written down yet.**

`checkout.session.completed` fires the instant payment succeeds. The buyer fills the intake form on `/thank-you/` *after* that. So at webhook time the `intent_*` fields **do not exist yet**. This is already true today and is not caused by the reorder, but the reorder is the moment to record it:

- **Piece 1's webhook is correct as built** — it reads only the four confirmation fields and never touches `intent_*`.
- **The Piece 3 consumer must read `intent_*` when it starts research, not from the queue message**, which is exactly why the queue carries ids only.
- **A fast pipeline can still beat a slow typist.** A buyer who spends four minutes on the intake form may have their research already underway with no steering inputs. `intent_*` are optional by design and their absence is not an error (§3.1: "Absent, not empty"), so the failure is silent and mild — a less-targeted report — which is precisely why it needs to be written down rather than discovered.
- **Cheapest mitigation:** a short delay before the consumer's first research call, or a re-read of the PaymentIntent immediately before query construction. Not designed here. §10.

---

## 2. Attestation — a claim, not a check

### 2.1 The hard rule

**Nothing verifies the attestation. There is no check, and there must not be one.**

No email-domain matching, no phone verification, no GBP "claim this listing" handshake, no document upload, no cross-reference against Secretary of State records — that last one is independently forbidden by `AUTOMATION_PIPELINE_SPEC.md` §6's sourcing lock, which bars LLC filings outright.

**Why this is deliberate and not laziness.** The attestation's job is to move responsibility for the claim onto the person making it and to create a durable record that they made it. It is a legal and ethical instrument, not a security control. A verification step would:

- **exclude the honest majority case** — an office manager, a spouse, a bookkeeper, or a marketing contractor ordering on behalf of the business, none of whom can pass an ownership check and all of whom are legitimate buyers;
- **imply a guarantee we then have to honour** — once we verify, a wrong-business report becomes our failure rather than a false attestation;
- **cost conversion at the exact point the buyer is closest to paying.**

> ⚠️ **To the next session:** if you are reading this and thinking about adding verification, that is a product reversal requiring Irene's sign-off, not a hardening task. The gate that protects against a wrong-business report is the buyer picking their own listing off a candidate card (`FULFILLMENT_WORKER_SPEC.md` §1.4), plus the owner-name friction in §3. It is not the checkbox.

### 2.2 Affiliation, not ownership

The wording must be true for **an administrative assistant buying a report for her boss.** "I am the owner" makes that person either lie or abandon. Three candidates for Irene to choose from — all plain, all contractor-voice, none legalese:

**Candidate A — plainest**
> I own this business or work for it, and I'm authorized to order this report.

**Candidate B — widest, covers outside help**
> I'm the owner of this business, or I work for it or with it and I'm authorized to order this report on its behalf.

**Candidate C — shortest**
> This is my business, or I'm authorized to order this report for it.

**Recommendation: A.** B is the most legally complete and the only one that clearly covers an outside marketing contractor, but it is 27 words and reads like terms. C is tightest but "my business" quietly re-implies ownership, which is the exact failure we are avoiding. A covers owner + employee, stays under 15 words, and an assistant can tick it honestly without pausing.

Whichever is chosen, the **exact string** is what gets stored (§6) and what the version number tracks.

### 2.3 Presentation rules

- **Unchecked by default.** A pre-ticked box is worthless as a record and unlawful in several consent regimes.
- **Adjacent to the payment button**, in the same visual block. **Not** in terms, not behind a link, not in a collapsed panel.
- **Required on the paid path.** The button is disabled or the POST is rejected until it is ticked — server-side, mirroring the `payload.attested !== true` check already in `confirm-business.js:344`, which requires an explicit boolean `true` and never infers.
- **Full text visible without scrolling or expanding.** If the buyer has to open something to read it, we cannot claim they read it.
- Owner name (§3) sits in the same block.

### 2.4 Free tier — a line of text, nothing more

On the free scan, near the scan button:

> Free scans are for checking your own business's website.

**No checkbox. No gate. Nothing stored. Nothing blocked.** A visitor who scans a competitor's site sees the same result they would get from viewing the page themselves.

**This is a deliberate risk-tier decision, not an oversight.** The two tiers are not equivalent:

| | Free scan | Paid report |
|---|---|---|
| What it reads | one public page, as any browser would | Places + DataForSEO SERP + crawl + rendered capture |
| What it produces | observations of a public surface | a **compiled artifact** — findings, rankings, competitor context |
| Places calls | **zero** | yes |
| Delivered to | the browser that asked | an inbox, with our name on it |

I verified the zero-Places property rather than taking the comment's word for it: `functions/api/scan.js` contains exactly one outbound `fetch` (line 88, to the target URL), zero references to Places, `googleapis`, or any `GOOGLE_*` variable, and its `onRequestPost` does not even destructure `env`. **The reorder does not change this.** The free scan makes no Places calls before or after.

> ⚠️ **Revisit this line if the free scan ever deepens.** The moment the free tier gains a Places call, a competitor comparison, or anything that compiles rather than observes, the risk tiers converge and the free path needs the same attestation the paid path has. Tie any such change to a review of this section.

---

## 3. Owner name — a friction signal that is never printed

### 3.1 Why it is collected

**Required field on the paid path**, beside the attestation.

Someone genuinely affiliated with the business types the owner's name without thinking. A competitor has to go and look it up. That asymmetry is the entire point: it raises the cost of a false attestation **without requiring verification** and without excluding any legitimate buyer. It is friction aimed at exactly one person.

It is not evidence and it is not checked against anything. A determined competitor will spend the ninety seconds. That is fine — the goal is to make casual misuse feel like fraud, which it is, at the moment it is committed.

### 3.2 ⚠️ HARD RULE — `owner_name` is intake-only

**`owner_name` is stored. It is NEVER passed to the report generator. It is NEVER printed. It never appears in any prompt, any research query, any email, or any report.**

This is the identical treatment `confirmed_phone` already receives, and it is required by `AUTOMATION_PIPELINE_SPEC.md` §6, whose output lock is explicit: *"All personal info (owner names, personal phones, residential addresses) is stripped BY CONSTRUCTION during generation, not removed post-hoc."* **By construction** means the field must not be in the object handed to the generator at all — not filtered out afterwards, not trusted to a regex.

Concretely, three requirements:

1. **Do not include it in the job payload passed to report assembly.** The D1 row may hold it; the generator's input object must not.
2. **Add it to the never-print list `lib/report-precheck.js` eventually enforces.** That module currently has no owner-name check. Note the standing finding from the Piece 1 review: three of the eight Checkpoint 4 checks are severity `warn` rather than `block`, and the §1.5 accuracy-claim check is absent entirely, so the module is **not yet** the gate `FULFILLMENT_WORKER_SPEC.md` §1.1 assumes. Adding `OWNER_NAME_LEAKED` at severity `block` belongs to that same work (§7.6 step 4), not to this reorder.
3. **The precheck needs the value to check for it.** Unlike a phone number, an owner name has no shape — it is just words. A generic detector is impossible; the check must be *"does the drafted report contain this specific job's `owner_name` string."* That means the precheck signature gains a per-job context argument. Flagged here because it is the one place this field touches the pipeline, and it is easy to miss.

Reason it matters beyond privacy: this is a business-intelligence report about a company. A report that names the owner reads as a dossier compiled about a person, which is the exact framing `AUTOMATION_PIPELINE_SPEC.md` §1 item 5 says the skill was rebuilt to eliminate.

---

## 4. Candidate disambiguation via domain match

### 4.1 The signal

The free scan already captured `scanned_url`, and `checkout.js` already carries it into session metadata. It is the strongest disambiguator available and it is currently unused at confirmation time.

**A Places candidate whose GBP website domain matches `scanned_url`'s registrable domain sorts first and is visually marked.**

This matters because the failure it prevents is the expensive one. Three plumbers named "Ace Plumbing" in the same metro produce three near-identical candidate cards; address is often the only difference and buyers do not read addresses carefully. A website match is unambiguous to the buyer at a glance — *that's my site* — in a way that "1420 vs 1424 W Cedar" is not.

### 4.2 Normalization — exactly

Applied to both `scanned_url` (already an absolute normalized URL from `normalizeAndValidateUrl`) and the candidate's `websiteUri` (Places already returns it — `confirm-business.js` requests `places.websiteUri` in its field mask and maps it to `c.website`):

1. Lowercase the whole string.
2. Drop the scheme (`https://`, `http://`).
3. Keep the host only — drop path, query, fragment, port, and any credentials.
4. Strip a single leading `www.`.
5. Strip a trailing dot (the FQDN root form `example.com.`).
6. Compare the **registrable domain** (eTLD+1), case-insensitively.

**Match tiers:**

| Tier | Condition | Treatment |
|---|---|---|
| **Strong** | normalized hosts are identical | sort first, badge |
| **Strong** | registrable domains are identical (`shop.ace.com` vs `ace.com`) | sort first, badge |
| **Weak** | phone match (§4.3) | small sort boost, no badge |
| **None** | anything else | unchanged order |

> ⚠️ **Registrable domain is not "the last two labels."** That heuristic is wrong for `example.co.uk`, `example.com.au`, and every other multi-label public suffix. The correct source is the Public Suffix List. **Do not bundle the full PSL for this** — it is a large, frequently-updated file for a US-only product. Recommended: exact-host equality as the primary rule, plus a short embedded list of multi-label suffixes relevant to this market, and treat anything else as last-two-labels.
>
> The failure mode is deliberately asymmetric and safe: a suffix we get wrong produces a **missed** match — no badge, no boost, candidates in their original order and the buyer still chooses correctly. It can never produce a **false** match, because the strong tier requires exact string equality after normalization. Getting it wrong costs a convenience, not a correctness.

**Edge cases that must not be treated as evidence of anything:** a GBP with no website at all (extremely common for contractors); a GBP whose website points at a Facebook page, a directory listing, or a lead-gen aggregator. All produce no match. **None of them is a signal that the candidate is wrong**, and none may downrank a candidate — absence of a match is absence of information.

### 4.3 Phone as a weaker secondary

Normalize both sides to digits only, drop a leading `1`, compare the final 10 digits. Places returns `nationalPhoneNumber` in the existing field mask.

Weaker because contractors route through call-tracking numbers, answering services, and cell phones that differ between their GBP and their website footer — a mismatch is common and means nothing. Use it only to break ties among otherwise-equal candidates. **No badge**, because a phone match is not visible to the buyer as self-evidently correct the way a domain is.

### 4.4 ⚠️ This RANKS. It does not SELECT.

**The buyer still chooses. Always.**

- **Never auto-select. Never pre-select. Never pre-tick.** A domain match reorders the list and adds a marker; it does not advance the flow.
- **Never hide or collapse unmatched candidates.** All of them stay visible, in full, with the same information.
- **The manual path stays available even when a strong match exists.** A confident-looking match that is wrong is precisely the scenario `FULFILLMENT_WORKER_SPEC.md` §1.4 exists to prevent: *"emailing a polished, confident, completely wrong report about someone else's company is the single highest-consequence failure available to this product."*
- Badge copy should describe the evidence, not assert the conclusion — *"Matches the website you scanned"*, not *"This is your business."*

---

## 5. The manual path and the no-GBP question

### 5.1 The manual path

When Places returns no usable candidate — or the buyer says none of them is theirs — they type business name and address themselves, attest, and pay. `confirmation_method = "manual"`, `confirmed_place_id` empty.

Under `FULFILLMENT_WORKER_SPEC.md` §1.4 that order **fails the gate** (place id present AND attested — manual has no place id), so Piece 1 records it as `manual_hold` and never enqueues it. That behaviour is correct and stays. What follows is what happens next, which is currently nothing.

### 5.2 ⚠️ Why a resolution step is required, and why it cannot be skipped

**From inside the pipeline, these two situations are indistinguishable:**

- this business genuinely has no Google Business Profile, and
- this business has a GBP and our search failed to find it.

Both present as "zero usable candidates." Nothing downstream can tell them apart, because the evidence for both is the same evidence: an empty result.

**Auto-generating on the wrong one produces a headline-level wrong claim.** "You have no Google Business Profile" is not a footnote in this report — for a contractor it is close to the most alarming sentence the document can contain, and it will sit near the top under "Fix these first." Sending that to someone whose listing is live, verified, and carrying 240 reviews destroys the credibility of every other finding in the report, invites an immediate refund, and is exactly the confident-and-wrong failure `AUTOMATION_PIPELINE_SPEC.md` §8 and `FULFILLMENT_WORKER_SPEC.md` §1.4 are both built to prevent.

It also inverts the fetch scar. `AUTOMATION_PIPELINE_SPEC.md` §8 is unambiguous: *"Never 'we couldn't read it' reported as 'it isn't there.'"* Auto-generating an absent-GBP finding from a failed search is that error, printed in the loudest position in the document.

**One question, asked once, of the only person who can answer it.**

### 5.3 The question and the two answers

Irene answers exactly one question per manual order:

> **Is there genuinely no Google listing for this business, or did we miss it?**

| Answer | What is recorded | What the pipeline does |
|---|---|---|
| **Genuinely absent** | `gbp_resolution = 'absent'` | Generates a **FULL report**, treating the absent GBP as a finding in its own right, and **auto-sends**. No further human involvement. |
| **Found it** | `gbp_resolution = 'found'` + the `place_id` | Runs normally, exactly as a `places`-path order. |

**Either answer unblocks full auto-generation.** This is not a review step and it is not a re-introduction of human read-before-send — it is one factual question that only a human can settle, answered once, after which §1.1's full auto-send applies unchanged.

> ⚠️ **Note what the `absent` answer does:** it converts an unretrievable signal into an affirmative finding. That is the only place in the entire pipeline where that conversion is permitted, and it is permitted *only* because a human asserted the fact. Checkpoint 1's rule — an `unread` signal produces no finding, no red flag, no severity — otherwise still stands absolutely. The pipeline must not be able to reach an absent-GBP finding by any other route.

### 5.4 Where the state lives

**Extend the existing `jobs` table in the existing D1 database.** No new store. Four columns:

| Column | Type | Meaning |
|---|---|---|
| `gbp_resolution` | TEXT | `NULL` (unanswered) \| `'absent'` \| `'found'` |
| `gbp_resolved_place_id` | TEXT | set only when `'found'` |
| `gbp_resolved_at` | TEXT | ISO 8601 |
| `gbp_resolved_by` | TEXT | who answered — a name or email, for the audit trail |

**No new state value.** The queue is "needs Irene" when:

```sql
SELECT * FROM jobs WHERE state = 'manual_hold' AND gbp_resolution IS NULL;
```

Introducing an `awaiting_gbp_resolution` state would mean the same thing as `manual_hold` and split every query against it. Resolution stays a property of a held job, not a state of its own. On answer, the job is stamped and enqueued, moving `manual_hold → queued` through the ordinary path.

**Answering must enqueue.** A resolution that only writes a row leaves the order exactly as stranded as before. The action that records the answer is also the action that puts the job on the queue — and it must be idempotent against double-clicks, which the existing `payment_intent_id` keying already gives us.

### 5.5 Notification

`RESEND_API_KEY` already exists and `reports@rankoncall.com` is the DECIDED from-address (`AUTOMATION_PIPELINE_SPEC.md` §9). **Per-order, immediately, by email to Irene** — not a digest. The 3-business-day clock is already running (§8), a manual order has burned some of it before the question is even asked, and a daily digest can spend a third of the window doing nothing.

The email needs: business name, city/state, the scanned URL, what the buyer typed, what Places was asked and what it returned, and a link or a command that records each answer. Enough to answer in under a minute without opening anything else.

> ⚠️ **Overlap with the undesigned quarantine — flagged, not designed.** `AUTOMATION_PIPELINE_SPEC.md` §8 and `FULFILLMENT_WORKER_SPEC.md` §7.5 both mark the quarantine holding state **OPEN / UNDESIGNED**, and §7.5 calls it "the largest hole." Its open questions are nearly identical to this one's: where a held job lives, how Irene is notified, whether it auto-retries or waits, and what the buyer sees while the deadline runs.
>
> **This resolution queue is the natural home for that design** — same table, same notification path, same "one earned human touch on the exception, never on the rule" shape that §7.5 describes. **Do not design quarantine here.** Build the manual-resolution queue in a way that a quarantine reason can be added to later: one holding surface, a reason field, one notification path. That is the whole of the coupling; the rest is §7.5's to answer.

---

## 6. The attestation record store

### 6.1 Companion table, not columns on `jobs` — and the reason is structural

**Recommendation: a new `attestations` table in the same D1 database** (`roc-fulfillment`). This is not a new store — `FUNNEL_REORDER` adds no infrastructure — it is a second table alongside `jobs`.

**The argument is not preference, it is a key problem.** `jobs.payment_intent_id` is the PRIMARY KEY, and the whole idempotency design rests on that (`worker/schema.sql`, `worker/src/jobs.js`). Post-reorder, **the attestation is captured before the Checkout Session exists**, which is before any PaymentIntent exists. There is no key to write the row under. Columns on `jobs` are not merely awkward here; they are unwritable at the moment the data is created.

Three further consequences that all point the same way:

1. **Abandoned checkouts produce attestations with no job, ever.** Someone attests, then closes the tab. That claim was still made and is still the record we want. A companion table holds it naturally; a `jobs` column cannot hold it at all.
2. **The lifecycles differ.** A job is operational and finishes. An attestation is a legal record retained indefinitely (§6.4). Mixing a permanent record into an operational table means every future `jobs` change has to reason about legal retention.
3. **One buyer can attest more than once** — abandon, come back, attest again, maybe pick a different listing. Each attempt is its own record. A one-to-one column set silently overwrites the earlier claim, destroying the evidence that it was made.

**Schema:**

| Column | Type | Meaning |
|---|---|---|
| `attestation_id` | TEXT PRIMARY KEY | Generated (`crypto.randomUUID()`), goes into Session metadata as the link |
| `attestation_text` | TEXT NOT NULL | The **VERBATIM** string displayed to this buyer |
| `attestation_version` | TEXT NOT NULL | Bumped on **any** wording change |
| `attested_at` | TEXT NOT NULL | ISO 8601 |
| `owner_name` | TEXT NOT NULL | §3 — stored, never printed |
| `attested_ip` | TEXT | Personal data — §6.4 |
| `attested_user_agent` | TEXT | Personal data — §6.4 |
| `confirmed_place_id` | TEXT | What they were attesting *about* |
| `confirmed_name` | TEXT | |
| `confirmation_method` | TEXT | `places` \| `manual` |
| `scanned_url` | TEXT | |
| `session_id` | TEXT | Set once the Checkout Session is created; NULL for abandonment |
| `payment_intent_id` | TEXT | Backfilled by the webhook; NULL until paid. Index it — this is the join to `jobs` |

Linkage: `attestation_id` rides in Session metadata; the webhook backfills `payment_intent_id` onto the attestation row when the payment completes, giving a two-way join without either table depending on the other's write order.

### 6.2 ⚠️ Why the verbatim text and the version are the whole point

**Proving someone ticked a box is worthless without proving what the box said.**

A record showing `attested = true, 2026-09-14` establishes nothing. Six months later the copy has been reworded twice and nobody can say which sentence that buyer agreed to. The claim being disputed is precisely *what they asserted* — and the only artifact that answers it is the exact string on their screen at that moment.

So: **store the string, not a reference to it.** Not a key into a constants file, not a version number alone — the literal characters. A constants file is edited; a stored string is not. That is the entire mechanism.

`attestation_version` is what makes the record hold up **when copy changes**, which it will: it lets us say "every attestation between these dates carried exactly this text," and it makes an unexpected version in the data a visible bug rather than silent drift.

**Version discipline:** bump on **any** change, including punctuation and capitalization. Text and version live in one constant, together, so they cannot drift:

```
ATTESTATION = { version: "v1", text: "I own this business or work for it, and I'm authorized to order this report." }
```

Changing `text` without changing `version` should be treated as a defect. The row stores both, always, from the same object that rendered the page.

### 6.3 Write path

The attestation is captured by a **Pages Function** (pre-payment, on our own page), while D1 is currently bound only to the **Worker**. Two options; the first is recommended:

1. **Bind the same `roc-fulfillment` D1 database to the Pages project as well.** D1 supports multiple bindings. Simplest, no new auth surface, no network hop.
2. Pages Function calls the Worker over HTTP with a shared token. More moving parts and a new authenticated endpoint for no benefit here.

**Order of writes: attestation row first, then the Checkout Session.** If session creation fails after the row is written, the orphan is harmless — arguably desirable, since the claim genuinely was made. The reverse order can produce a paid session with no attestation record, which is the failure that matters.

### 6.4 Personal data, retention, and the limits of this document

**`attested_ip` and `attested_user_agent` are personal data.** They must be disclosed in the privacy policy: what is collected, why (fraud prevention and consent records), and how long it is kept. **They are collected for exactly this purpose and must not be reused** for analytics, for rate limiting (§7 keeps its own counters), or for anything else.

**Retention: indefinite.** A consent record whose value is proving what was agreed cannot have a deletion schedule shorter than the period in which a dispute could arise, and that period is not knowable in advance. Note that indefinite retention of personal data interacts with deletion-request regimes; that interaction is a question for a lawyer, not for this document.

> ⚠️ **This is a standard consent-record shape. It is NOT legal advice.** The columns above are the conventional fields (what was agreed, in what words, by whom, when, from where) and they are a reasonable engineering starting point. **A lawyer should review the terms of service and this record design before launch** — in particular the attestation wording itself, the privacy-policy disclosure, and the indefinite retention decision. Nothing here should be read as a substitute for that review.

---

## 7. Rate limiting — new exposure

### 7.1 The invariant that breaks

Today, **payment gates all Places spend.** Every Places call happens in `confirm-business.js`, which is unreachable without a paid session — `loadPaidSession()` re-checks `payment_status === "paid"` server-side on every request. Pre-payment confirmation ends that. Places calls now happen on **unpaid, unauthenticated traffic**, from anyone who reaches the confirmation step.

**There is no rate limiting anywhere in `functions/` today.** I checked; nothing matches. Whatever is specified here is entirely net-new.

### 7.2 ⚠️ The budget is 1,000/month, not 5,000

`docs/BOT_ARCHITECTURE.md:58` is explicit: *"requesting ratings or reviews in a Places call moves it from the Pro SKU (5,000 free calls/month) to Enterprise (1,000/month)."* The existing field mask in `confirm-business.js:190` requests `places.rating` and `places.userRatingCount`, so **today's confirmation lookup is an Enterprise-SKU call.**

Moving that call in front of the paywall exposes a **1,000-call monthly budget to anonymous traffic.** At the proposed 5 lookups per IP per hour, a single determined visitor can consume 120 in a day. That is not a theoretical abuse case; it is one bored person.

**Recommendation — split the field mask, and put most of the spend back behind payment:**

| Stage | When | Field mask | SKU |
|---|---|---|---|
| **Candidate list** | pre-payment, on unpaid traffic | `places.id`, `places.displayName`, `places.formattedAddress`, `places.websiteUri` | **Pro — 5,000/mo** |
| **Detail fetch** | post-payment, once, on the confirmed `place_id` only | ratings, review count, phone, category, types | **Enterprise — 1,000/mo** |

The candidate card needs name, address, and website — website is what powers the §4 domain match, and it is the buyer's strongest disambiguator anyway. Ratings and review counts are *nice* on the card but are not what tells someone which listing is theirs.

This restores most of the broken invariant: **unpaid traffic spends only from the 5x-larger Pro budget, and the scarce Enterprise budget stays behind payment, consumed once per paid order.** It costs one extra Places call per paid order and a small loss of richness on the candidate card.

> The tier figures are dated 2026-07-22 and `BOT_ARCHITECTURE.md:59` warns Google has restructured Maps pricing before. **Verify against current pricing before relying on the numbers**, though the structural argument holds regardless of the exact thresholds.

### 7.3 Mechanism

**Proposed limit: 5 confirmation lookups per IP per hour.** Generous for a real buyer — who typically needs one, occasionally three if they mistype — and tight enough that scripted abuse is capped at 120/day/IP.

Layered, because a single control that can be deleted from a dashboard is not a control:

1. **Primary — a Cloudflare Rate Limiting (WAF) rule** on the confirmation-lookup path, keyed on client IP. Runs at the edge, before the Function executes, so it protects the API budget even if the Function has a bug. Zero code. Fails closed by nature.
2. **Secondary — an in-Function counter** in KV or D1, keyed by hashed IP + hour bucket. Defense in depth: the WAF rule is zone configuration that can be removed without a code review, and this one lives in the repo where a change is visible in a diff.
3. **Response caching.** Cache Places results by normalized (business name, city/state) for ~24h. Contractors retry, refresh, and share links; a cached repeat costs nothing. This is likely a larger saving than the rate limit itself.
4. **Cheap rejections before the spend.** Require a plausible business name (minimum length, not whitespace) and a city/state before calling Places at all. `findCandidates()` already returns `no_query` without calling out when the query is empty (`confirm-business.js:176`) — extend that discipline rather than inventing new machinery.

**Failure behaviour, stated because it is a real trade-off:** if the secondary counter's store is unavailable, **fail open and log**, because the WAF rule is still standing and blocking real buyers at the payment step is worse than a brief accounting gap. If the WAF rule is what fails, that is a Cloudflare-level outage with larger problems attached. Irene should confirm she is comfortable with fail-open on layer 2 (§10).

**Unchanged:** the free scan still makes zero Places calls (§2.4). Rate limiting the confirmation lookup has no effect on it, and `scan.js` needs no change for this. Whether `scan.js` should have its own rate limit is a separate, pre-existing question — noted in §10, out of scope here.

---

## 8. `report_due_at` moves to the webhook

### 8.1 Why it has to move

`report_due_at` is computed today inside `confirm-business.js`'s POST handler (`computeDeliveryDeadline()`, line 285), at confirmation. Post-reorder, **confirmation happens before payment** — so leaving the computation there would start a delivery clock for someone who has not paid and may never pay.

`FULFILLMENT_WORKER_SPEC.md` §3.2 is unambiguous that the deadline is a real commitment and that nothing may extend or recompute it. It must be computed **once**, at the first moment a paid obligation exists. That moment is `checkout.session.completed`.

### 8.2 The code MOVES. It is not rewritten.

**Same 3-business-day rule. Same `America/Chicago`. Same US federal holiday table. Same 5:00 PM landing. Same ISO-with-offset plus human display string.** This is a relocation, not a redesign, and re-deriving the DST-safe zoned-wall-time arithmetic would be a pure downside.

Moving from `functions/api/confirm-business.js` to a new **`worker/src/delivery-clock.js`**, as a whole unit:

| Symbol | Current line |
|---|---|
| `DELIVERY_TIMEZONE`, `DELIVERY_ZONE_LABEL`, `DELIVERY_SLA_BUSINESS_DAYS`, `DELIVERY_HOUR` | 45–48 |
| `US_HOLIDAYS` (2026–2027, observed weekdays) | 53–76 |
| `pad2`, `dateKey`, `isBusinessDay`, `addCalendarDay` | 229–245 |
| `zonedCalendarDate`, `zoneOffsetMinutes`, `zonedWallTimeToInstant`, `offsetIso` | 248–280 |
| `computeDeliveryDeadline` | 285–299 |

Export `computeDeliveryDeadline(instant)` returning `{ iso, display }`, unchanged in shape. It has no dependencies beyond `Intl` and `Date`, both available in Workers, so it moves without modification.

> The `US_HOLIDAYS` set covers 2026–2027 only and the source comment says "extend as years roll." Moving it does not fix that. **It silently produces wrong deadlines from 2028-01-01** — every day becomes a business day. Worth an explicit calendar reminder or a startup assertion that the table covers the current year. §10.

### 8.3 What writes it

In `worker/src/index.js`, after the §1.4 gate passes and before `insertJob`: call `computeDeliveryDeadline(new Date())` and write `report_due_at` (and a new `report_due_display` column) into the job row as part of the same insert. It is then set once, in the durable record, by the only component that knows payment has actually happened.

**Do not write it back to Stripe.** Today it round-trips through PaymentIntent metadata because the Pages Function had nowhere else to put it. The Worker has D1. Stripe metadata is not the system of record for anything the Worker owns.

**`schema.sql` gains `report_due_display TEXT`.** `report_due_at` already exists.

### 8.4 ⚠️ The buyer-facing consequence

Today `/thank-you/` shows the deadline because the confirmation POST returns it in the response body (`confirm-business.js:405–410`). Post-reorder, the deadline is computed inside the Worker, **after** redirect to `/thank-you/`, and the page has no way to read it.

Options, none free:

1. `/thank-you/` polls a small read endpoint until the webhook has landed. Accurate; needs a loading state and a fallback if the webhook is slow.
2. The page computes the same deadline client-side for display only, with D1 remaining the record. Instant, but two implementations of one rule is exactly how they drift — **not recommended**.
3. Show the *rule* rather than the date — "within 3 business days" — and put the exact deadline in the confirmation email.

**Recommendation: 3, with 1 as a later improvement.** It removes the dependency entirely, is honest, and the exact timestamp reaches the buyer in the email where it is more useful. Note this is a **copy change on a live page** and touches the same file as the §1.2 launch gate. Irene's call — §10.

---

## 9. Migration and rollback

**These are live files taking real money.** Every step below is written so the funnel keeps working if the next step never happens.

### 9.1 What changes, by file

| File | Change | Risk |
|---|---|---|
| `src/` confirmation UI | **NET-NEW** page/step: candidate cards, attestation, owner name | New surface, no existing behaviour to break |
| `src/index.njk` scan area | **+1 line** of free-tier expectation text (§2.4) | Copy only |
| `functions/api/confirm-lookup.js` | **NET-NEW** — pre-payment Places lookup, rate limited, Pro-SKU mask | New route |
| `functions/api/checkout.js` | Accepts confirmation + attestation; writes the attestation row; puts confirmation into Session metadata; **drops `custom_fields`** | **Live payment path — highest risk** |
| `functions/api/confirm-business.js` | POST retired; GET superseded | See ⚠️ below |
| `functions/api/intake.js` | None | Still post-payment, still PaymentIntent |
| `functions/api/scan.js` | **None** | Untouched; zero-Places property preserved |
| `worker/src/index.js` | Read confirmation from **Session** metadata; compute + store the deadline | Not deployed — free to change |
| `worker/schema.sql` | `attestations` table; `gbp_resolution*` columns; `report_due_display` | Not deployed |
| `worker/src/delivery-clock.js` | **NET-NEW** — the moved clock | Relocation |

> ⚠️ **`confirm-business.js` cannot simply be deleted.** `intake.js:20` imports `json`, `loadPaidSession`, and `stripePost` from it. Deleting the file breaks a live endpoint. **Leave the file in place**, neuter the POST (return `410 Gone`), and keep the helpers exported. Extracting them into a shared module is tidier and is a separate, later change — not part of this migration, where the goal is the smallest possible diff on live money paths.

### 9.2 Order of operations

Each step is independently safe and independently revertible.

1. **D1 schema first** — `attestations`, the `gbp_resolution*` columns, `report_due_display`. Additive only; nothing reads them yet. Zero risk.
2. **Worker changes** (Session-metadata read, moved clock). Still undeployed. **Teach it to read both shapes** — see 9.3.
3. **`confirm-lookup.js`**, the new page, and rate limiting. Reachable but not yet linked from the funnel. Test it live against real Places responses without a single buyer seeing it.
4. **Free-tier line** on the scan page. Copy only, independently revertible.
5. **⚠️ Flip the funnel** — the scan page routes to confirmation instead of checkout, and `checkout.js` starts writing Session metadata and drops `custom_fields`. **This is the only irreversible-feeling step and the only one that touches the payment path.** Ship it alone, watch it, and have step 6 ready.
6. **Deploy the Worker and register the Stripe webhook** — after the reorder has been observed working, so it only ever sees new-shape sessions in practice while still handling old ones.

### 9.3 In-flight sessions created under the old flow

A Checkout Session is created at step 5 and may be paid minutes or hours later. Sessions created just before the flip will complete just after it, carrying the **old** shape: `custom_fields` for business name/city, no confirmation metadata on the Session, and confirmation metadata written to the **PaymentIntent** by the old `/thank-you/` gate.

**The Worker must read both shapes.** Not a permanent compatibility layer — a dated one:

- Read confirmation fields from **Session metadata first**, then fall back to the **PaymentIntent metadata** (this is exactly the both-objects read Piece 1 already implements, so the fallback is *already written* — it becomes the legacy branch rather than the primary one).
- Read business name/city from Session metadata first, then fall back to `custom_fields` via the existing `NAME_KEYS`/`LOCATION_KEYS` lists.
- Stripe Checkout Sessions **expire after 24 hours**, so the legacy branch is provably dead 24 hours after the flip. Remove it on a dated follow-up, not "eventually."

Because the webhook is not deployed until step 6, the realistic worst case is smaller still: any session paid during the flip window has no webhook consuming it at all, and its job row can be created by hand from the Stripe dashboard if needed.

### 9.4 Rollback

**Step 5 is the only one that needs a real plan.** Everything before it is additive and reverts by not being used.

- **Revert is a code revert.** `git revert` the flip commit: the scan page points back at checkout, `checkout.js` restores `custom_fields` and stops writing confirmation metadata, `/thank-you/`'s gate resumes. The old path never stopped working — `confirm-business.js`'s GET/POST are still there in step 5 and are only retired later.
- **Sessions created under the NEW flow, paid after a rollback**, carry confirmation in Session metadata and will hit the restored `/thank-you/` gate, which will ask them to confirm again. Mildly annoying, not broken, and bounded by the same 24-hour session expiry.
- **The attestation rows survive a rollback and should.** They are legal records of claims genuinely made. Never delete them as part of a revert.
- **Nothing in the D1 schema needs reverting.** Unused columns and an unused table cost nothing and re-applying them later is free.

**The window is genuinely cheap right now, and it closes.** No deployed webhook, no live consumer of this metadata, and a `jobs` table with no production rows. Every one of those becomes false the day Piece 1 deploys.

---

## 10. Open questions for Irene

**Product**

1. **Does the extra pre-payment step cost more conversion than the wrong-business refunds it prevents?** The core trade of this entire document, and it is a judgment call about the buyer, not an engineering question. §1.1.
2. **Which attestation string — A, B, or C?** §2.2. A is recommended. Whichever is chosen becomes `v1` and is stored verbatim forever.
3. **`/thank-you/` deadline display** — show "within 3 business days" and put the exact date in the email (recommended), or add a polling endpoint? §8.4. Note this touches the same live page as the §1.2 launch gate.
4. **Is the owner-name field a hard requirement?** It is proposed as required (§3.1). A buyer who genuinely does not know it — a newly hired office manager — is blocked at the payment step. Required is the recommendation; the cost is real.

**Legal**

5. **Lawyer review of the attestation wording, the privacy-policy disclosure for IP/user-agent, and indefinite retention.** §6.4. Explicitly outside what this document can settle.

**Cost and abuse**

6. **Approve the Pro/Enterprise field-mask split?** §7.2. It restores most of the broken payment-gates-Places invariant at the cost of one extra call per paid order and a plainer candidate card.
7. **Fail-open on the secondary rate-limit counter** when its store is unavailable? §7.3. Fail-open risks budget; fail-closed blocks real buyers.
8. **Should `scan.js` have its own rate limit?** Pre-existing exposure, unchanged by this reorder, but there is no rate limiting anywhere in `functions/` today. Out of scope here; worth a decision.

**Deferred / already flagged elsewhere**

9. **The `intent_*` timing race.** §1.3 — the webhook fires before the buyer fills the intake form. Not caused by this reorder, not solved by it. Belongs to Piece 3.
10. **`US_HOLIDAYS` runs out at the end of 2027** and fails silently, treating every 2028 day as a business day. §8.2.
11. **Quarantine overlap.** §5.5 — the manual-resolution queue is the natural home for §7.5's undesigned holding state. Flagged deliberately; not designed here.
12. **Docs-only cleanup:** the metadata key stays `ownership_attested` while the displayed wording asserts affiliation (§1.2). `AUTOMATION_PIPELINE_SPEC.md` §1 item 4 and `FULFILLMENT_WORKER_SPEC.md` §1.4 both use "ownership" language that will read as stale. Worth a one-line note in each rather than a rename.
