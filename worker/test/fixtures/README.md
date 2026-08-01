# Test fixtures

Real captured API responses. **Nothing in here is hand-written.**

A synthetic fixture encodes whatever the author assumed the response looked like and then confirms it, which is worse than having no test at all — the entire point is to find out whether the parser survives what the API *actually* returns. If a fixture is missing, the tests that need it **skip with a visible reason** rather than passing vacuously.

## Expected files

### `serp-plumber-decatur.json` — ⚠️ NOT YET CAPTURED

Captured via the **DataForSEO Playground**, unmodified.

> #### ⚠️ This fixture is a TASK object, not the full envelope — and that is correct
>
> **The Playground unwraps responses.** Its top-level fields — `id`, `status_code`, `status_message`, `time`, `cost`, `result_count`, `path`, `data`, `result` — are the fields of `tasks[0]`, not of the outer envelope. The live API returns one layer further out:
>
> ```
> { version, status_code, status_message, time, cost,
>   tasks_count, tasks_error, tasks: [ <this fixture> ] }
> ```
>
> **This is the parser's natural input, not a workaround.** The two modules split at exactly that seam:
>
> | Module | Owns |
> |---|---|
> | `dataforseo.js` | the **envelope** — checks the outer `status_code`, checks `tasks[0].status_code`, checks `tasks_error`, then unwraps and returns the task |
> | `serp-parse.js` | the **task** — reads `task.result[0]` and never sees an envelope |
>
> So the fixture goes straight into `parseSerp()` with no wrapping. The one shape difference between a Playground capture and production — the envelope itself — is covered by a dedicated seam test in `dataforseo.test.js`, which wraps this fixture in a synthetic envelope and asserts the unwrap returns the task unchanged.

| | |
|---|---|
| Endpoint | `POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced` |
| Keyword | `Plumber Decatur AL` |
| `location_code` | `1012990` (Decatur, Alabama) |
| `depth` | `10` |
| Captured | 2026-08-01 |
| Cost | $0.002 |
| Response time | 4.26s |

**Save the entire response envelope**, from the top-level `status_code` down — not just `tasks[0].result[0]`. The parser navigates the full envelope and `dataforseo.js` checks status codes at both the envelope and task layers, so a trimmed fixture would not exercise either.

**Do not redact it.** It contains verbatim review quotes, phone numbers, and street addresses in `local_pack[].description`, `local_pack[].phone`, `organic[].description`, and `organic[].highlighted` — and **that is exactly why it is useful**. `serp-parse.test.js` scans the raw fixture for every value under those keys and asserts that none of them appear in the parser's output. Redacting the fixture would disable the test that matters most.

Consumed by `worker/src/serp-parse.test.js`.
