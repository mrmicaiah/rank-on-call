/**
 * DataForSEO SERP client — live/advanced only.
 *
 * Spec: docs/FULFILLMENT_WORKER_SPEC.md §7.4 (endpoint DECIDED 2026-08-01),
 * §4 Checkpoint 1 (retry discipline), §7.1 (isolated ROC account).
 *
 * Endpoint choice is NOT configurable here, deliberately. `live/advanced` is the
 * only endpoint ROC uses, because `live/regular` returns organic and paid results
 * only and cannot see the local pack — and for a local contractor the three-pack
 * is the whole game. Adding a `regular` option would make it possible to silently
 * lose the headline finding.
 *
 * ⚠️ THREE ANTI-PATTERNS from the SEO-Scout reference implementation are
 * deliberately NOT reproduced here (§7.4):
 *
 *   1. `location` is REQUIRED and always passed through. The reference accepts a
 *      location argument and then hardcodes location_code 2840 (United States).
 *      A national-average ranking is worthless for a local contractor and looks
 *      exactly like a real finding. This module throws rather than defaulting.
 *   2. NO balance probe, NO cost footer. The reference calls getBalance twice per
 *      call to print a cost line, and computes cost as (before - after) while
 *      getBalance returns -1 on failure — which is the documented cause of the
 *      false balance readouts in PROJECT_MASTER.md §210. Not implemented here at
 *      all. The response carries its own `cost`; that is enough.
 *   3. NO unbounded failure. The reference throws on any non-ok response with no
 *      retries and no timeouts. Checkpoint 1 requires backoff before a signal may
 *      be stamped `unread`.
 */

const SERP_LIVE_ADVANCED_URL = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

/** Per-attempt timeout. A hung request must not hold a queue message open (§2.3). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Checkpoint 1: ~2 retries, 5–10s apart. Measured cold pass rates climb from
 *  ~67% to ~96% by the third attempt, which is why 3 total attempts is the shape. */
const RETRY_DELAYS_MS = [5_000, 10_000];

/** DataForSEO status codes. 20000 is the only success value. */
const STATUS_OK = 20000;
const STATUS_INSUFFICIENT_FUNDS = 40200;

/**
 * Every failure from this module is a DataForSeoError, so the caller never has to
 * distinguish a thrown TypeError from an API refusal.
 *
 * `fatal` is the important flag: it means HALT THE JOB. It must never be
 * soft-degraded into an `unread` stamp, because unlike a transient read failure
 * the condition will not clear on its own and every subsequent job hits it too.
 */
export class DataForSeoError extends Error {
  constructor(message, { statusCode, statusMessage, httpStatus, fatal = false, retryable = false } = {}) {
    super(message);
    this.name = "DataForSeoError";
    this.statusCode = statusCode ?? null;
    this.statusMessage = statusMessage ?? null;
    this.httpStatus = httpStatus ?? null;
    this.fatal = fatal;
    this.retryable = retryable;
  }
}

/* HTTP statuses worth another attempt. Everything else is our fault or a refusal. */
function isRetryableHttpStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Basic auth header. The credentials appear here and nowhere else — never logged,
   never returned, never placed in an error message. */
function authHeader(login, password) {
  return `Basic ${btoa(`${login}:${password}`)}`;
}

/**
 * One HTTP attempt. Returns the parsed body, or throws a DataForSeoError carrying
 * `retryable` so the loop above can decide.
 */
async function attempt(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
  } catch (err) {
    // Abort or network failure. Both are worth another go.
    const timedOut = err && err.name === "AbortError";
    throw new DataForSeoError(
      timedOut ? `DataForSEO request timed out after ${REQUEST_TIMEOUT_MS}ms` : "DataForSEO request failed to send",
      { retryable: true }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new DataForSeoError(`DataForSEO returned HTTP ${res.status}`, {
      httpStatus: res.status,
      retryable: isRetryableHttpStatus(res.status),
    });
  }

  const parsed = await res.json().catch(() => null);
  if (!parsed) {
    throw new DataForSeoError("DataForSEO returned a body that is not JSON", {
      httpStatus: res.status,
      retryable: true,
    });
  }
  return parsed;
}

/**
 * Check both status layers and UNWRAP the envelope, returning the task object.
 *
 * ⚠️ THE ENVELOPE IS THIS MODULE'S JOB. The live API returns:
 *
 *   { version, status_code, status_message, time, cost, tasks_count, tasks_error,
 *     tasks: [ { id, status_code, status_message, time, cost, result_count,
 *                path, data, result: [ { …, items: [] } ] } ] }
 *
 * Everything from `tasks[0]` inward is the TASK object, and that is what this
 * function returns. `serp-parse.js` never sees the envelope — it takes a task.
 * That seam is deliberate: envelope handling is transport concern, and keeping it
 * here means the parser's input is exactly the shape a Playground capture has.
 *
 * DataForSEO reports failures in TWO places, and checking only the outer one is a
 * real way to treat a failed task as a success: the envelope can carry
 * status_code 20000 with `tasks_error: 1` while the actual refusal sits on the
 * task. Both are checked, task last so its more specific message wins.
 */
function unwrapAndAssert(body) {
  const envelopeCode = body.status_code;
  if (envelopeCode !== STATUS_OK) {
    throwForStatus(envelopeCode, body.status_message, "envelope");
  }

  const task = Array.isArray(body.tasks) ? body.tasks[0] : null;
  if (!task) {
    throw new DataForSeoError("DataForSEO returned no task", { statusCode: envelopeCode, retryable: false });
  }
  if (task.status_code !== STATUS_OK) {
    throwForStatus(task.status_code, task.status_message, "task");
  }

  // tasks_error is checked AFTER the task's own status, so that when a task did
  // fail we report its specific reason rather than the generic count.
  if (typeof body.tasks_error === "number" && body.tasks_error > 0) {
    throw new DataForSeoError(
      `DataForSEO reported ${body.tasks_error} failed task(s) with no task-level status to explain it`,
      { statusCode: envelopeCode, retryable: false }
    );
  }

  return task;
}

function throwForStatus(statusCode, statusMessage, layer) {
  // 40200 — insufficient funds. HARD failure. §7.1: ROC's account is isolated, so
  // this can only be ROC's own spend, which makes it attributable and predictable
  // — but it does not make it recoverable. Retrying cannot conjure credit, and
  // degrading to `unread` would ship a report missing its headline finding while
  // implying we looked. Halt.
  if (statusCode === STATUS_INSUFFICIENT_FUNDS) {
    throw new DataForSeoError(
      `DataForSEO insufficient funds (40200) — the ROC account needs topping up. ${statusMessage || ""}`.trim(),
      { statusCode, statusMessage, fatal: true, retryable: false }
    );
  }
  throw new DataForSeoError(
    `DataForSEO ${layer} error ${statusCode}: ${statusMessage || "no status_message"}`,
    { statusCode, statusMessage, retryable: false }
  );
}

/**
 * POST one SERP task to live/advanced and return the UNWRAPPED TASK OBJECT.
 *
 * Returns `tasks[0]` — not the envelope. The envelope is validated and discarded
 * here; see unwrapAndAssert. Hand the return value straight to `parseSerp()`.
 *
 * Parsing is deliberately somebody else's job. This module fetches, validates
 * transport, and unwraps; it does not decide what a SERP means.
 *
 * @param {object} env  Worker env — DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD
 * @param {object} opts
 * @param {string} opts.keyword       the search phrase
 * @param {number} opts.locationCode  ⚠️ REQUIRED. Never defaulted (anti-pattern 1)
 * @param {number} [opts.depth=10]    results to retrieve; ~100 for the branded sweep
 * @param {string} [opts.languageCode="en"]  confirmed present on both `data` and `result[0]`
 * @param {number[]} [opts.retryDelaysMs]  backoff schedule. Defaults to the
 *        Checkpoint 1 shape; overridable so tests exercise the retry path without
 *        sleeping for 15 seconds. Production callers should not pass it.
 * @returns {Promise<object>} the task object — `{ id, status_code, …, result: [ { items: [] } ] }`
 */
export async function serpLiveAdvanced(
  env,
  { keyword, locationCode, depth = 10, languageCode = "en", retryDelaysMs = RETRY_DELAYS_MS } = {}
) {
  if (typeof keyword !== "string" || !keyword.trim()) {
    throw new DataForSeoError("serpLiveAdvanced requires a non-empty keyword");
  }
  // ⚠️ anti-pattern 1. A missing location is a BUG, not a value to substitute for.
  // Defaulting it here would produce a national-average ranking that reads exactly
  // like a real local finding — the specific failure §7.4 records.
  if (locationCode === undefined || locationCode === null || locationCode === "") {
    throw new DataForSeoError(
      "serpLiveAdvanced requires an explicit locationCode — it is never defaulted (see anti-pattern 1)"
    );
  }
  if (!Number.isFinite(depth) || depth < 1) {
    throw new DataForSeoError("serpLiveAdvanced requires a positive depth");
  }

  const login = env && env.DATAFORSEO_LOGIN;
  const password = env && env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    // Fail closed. An unset credential serves nothing rather than attempting anonymously.
    throw new DataForSeoError("DataForSEO credentials are not configured");
  }

  const headers = {
    Authorization: authHeader(login, password),
    "Content-Type": "application/json",
  };
  // The API takes an ARRAY of tasks. One task per call keeps the response shape
  // predictable and each claim traceable to its own request.
  const body = JSON.stringify([
    {
      keyword: keyword.trim(),
      location_code: locationCode,
      language_code: languageCode,
      depth,
    },
  ]);

  let lastError = null;
  for (let i = 0; i <= retryDelaysMs.length; i++) {
    if (i > 0) await sleep(retryDelaysMs[i - 1]);

    let parsed;
    try {
      parsed = await attempt(SERP_LIVE_ADVANCED_URL, headers, body);
    } catch (err) {
      lastError = err;
      if (err instanceof DataForSeoError && err.retryable) {
        console.warn(`DataForSEO attempt ${i + 1} failed (retryable): ${err.message}`);
        continue;
      }
      throw err; // business errors and 40200 are not retried
    }

    // Transport succeeded. Status errors are NOT retried — a refusal is a refusal.
    // Returns the unwrapped task, which is what parseSerp() expects.
    return unwrapAndAssert(parsed);
  }

  throw lastError ?? new DataForSeoError("DataForSEO request failed", { retryable: true });
}
