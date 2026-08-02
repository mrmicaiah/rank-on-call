# Test fixtures

Real captured API responses. **Nothing in here is hand-written.**

A synthetic fixture encodes whatever the author assumed the response looked like and then confirms it, which is worse than having no test at all — the entire point is to find out whether the parser survives what the API *actually* returns. If a fixture is missing, the tests that need it **skip with a visible reason** rather than passing vacuously.

---

## ⚠️ These fixtures are TASK objects, not full envelopes — and that is correct

Both were captured via the **DataForSEO Playground, which unwraps responses.** Their top-level fields — `id`, `status_code`, `status_message`, `time`, `cost`, `result_count`, `path`, `data`, `result` — are the fields of `tasks[0]`, not of the outer envelope. The live API returns one layer further out:

```
{ version, status_code, status_message, time, cost,
  tasks_count, tasks_error, tasks: [ <the fixture> ] }
```

**This is the parser's natural input, not a workaround.** The two modules split at exactly that seam:

| Module | Owns |
|---|---|
| `dataforseo.js` | the **envelope** — checks the outer `status_code`, checks `tasks[0].status_code`, checks `tasks_error`, then unwraps and returns the task |
| `serp-parse.js` | the **task** — reads `task.result[0]` and never sees an envelope |

So a fixture goes straight into `parseSerp()` with no wrapping. The one shape difference between a Playground capture and production — the envelope itself — is covered by a dedicated seam test in `dataforseo.test.js`, which wraps a fixture in a synthetic envelope and asserts the unwrap returns the task unchanged.

## ⚠️ Do not redact these files

They contain verbatim customer review quotes, phone numbers, and street addresses in `local_pack[].description`, `local_pack[].phone`, `organic[].description`, and `organic[].highlighted` — and **that is exactly why they are useful.** `serp-parse.test.js` walks each raw fixture collecting every value under those keys at any depth, then asserts none of them appear in the parser's output. **Redacting a fixture would disable the test that matters most.**

## ⚠️ KEEP BOTH. Do not consolidate them.

They are not redundant captures of the same thing — **they cover opposite outcomes**, and the second one covers the outcome the product exists to find:

| | `serp-plumber-decatur.json` | `serp-gutters-decatur.json` |
|---|---|---|
| Target | A Plumber | Betterton Gutter & Sheet Metal |
| Local pack | **#1** | **ABSENT** |
| Organic | **#1** (`rank_absolute` 4) | **#5** (`rank_absolute` 9) |
| Proves | extraction works | `targetInLocalPack === null` |

A future session looking to tidy up will see two ~450-line JSON files from the same city and the same API and reasonably wonder whether one would do. **One would not.** Deleting the strong performer loses the proof that ranks, ratings and the target match are extracted correctly at all. Deleting the weak performer loses the only real-data coverage of the headline finding. Keep both.

---

## The fixtures

### `serp-plumber-decatur.json` — the STRONG performer ✅ captured

| | |
|---|---|
| Endpoint | `POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced` |
| Keyword | `Plumber Decatur AL` |
| `location_code` | `1012990` (Decatur, Alabama) |
| `depth` | `10` |
| Captured | 2026-08-01 |
| Cost | $0.002 |
| Response time | 4.26s |

**Target: `myaplumber.com` — local pack #1 AND organic #1** (`rank_group` 1 / `rank_absolute` 4), 563 reviews at 4.9.

**What it proves:** the extraction contract works against real data. It is also the fixture that demonstrates why the two rank fields must stay distinct — the same business is `rank_absolute` 1 in the pack and `rank_absolute` 4 organically, three true numbers on one page.

**What it does NOT exercise:** any of the report paths that matter. No missing three-pack, no ranking gap, no absent listings. Everything is fine in this response, which is precisely why it is not sufficient on its own.

### `serp-gutters-decatur.json` — the WEAK performer ⚠️ NOT YET CAPTURED

| | |
|---|---|
| Endpoint | `POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced` |
| Keyword | `gutter installation Decatur AL` |
| `location_code` | `1012990` (Decatur, Alabama) |
| `depth` | `10` |
| Captured | 2026-08-02 14:46 UTC |
| Cost | $0.002 |

**Target: `bettertongutters.com`** — Betterton Gutter & Sheet Metal, a real local Decatur gutter company.

> #### Why this fixture exists
>
> **It ranks organic `rank_group` 5 / `rank_absolute` 9, and is ABSENT from the local pack.** The three-pack is held by USA Roofing (`usaroofing.us`), Quality Choice Roofing (`qualitychoice-roofing.com`), and Off Duty-Gutters Unlimited (`offdutyguttersunlimitedllc.com`) — **two of the three are roofers, not gutter specialists.**
>
> **That is the product's headline finding, in real data: on page one, invisible in the three-pack.** A contractor reading his own name on page one assumes he is findable. The pack is where the calls come from, and he is not in it.
>
> Everything downstream depends on that shape being handled correctly — `targetInLocalPack === null` must be a *finding*, not a crash, not an empty object, and not silently omitted. Until this fixture existed, no real response had ever produced it.

**Also first covered here:** one organic item (`bettertongutters`) carries a **`links` array of four sitelinks** — a field absent from the plumber fixture and therefore never tested against the allowlist. It must not reach the output.

---

Consumed by `worker/src/serp-parse.test.js` and `worker/src/dataforseo.test.js`.
