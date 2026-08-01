/**
 * Tests for dataforseo.js — the envelope seam and the failure contract.
 *
 * The client's job is transport: authenticate, retry transients, check BOTH
 * status layers, and unwrap `tasks[0]`. What a SERP *means* is serp-parse.js's
 * problem and is tested there.
 *
 * `globalThis.fetch` is stubbed throughout. No network, no credentials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { serpLiveAdvanced, DataForSeoError } from "./dataforseo.js";

const ENV = { DATAFORSEO_LOGIN: "user@example.com", DATAFORSEO_PASSWORD: "pw" };
const OK_ARGS = { keyword: "Plumber Decatur AL", locationCode: 1012990, depth: 10 };

/* Retry delays for tests. The production default is 5s/10s — see the guard test
   at the bottom, which asserts this override has not leaked into the default. */
const FAST_RETRIES = [1, 1];

const FIXTURE_URL = new URL("../test/fixtures/serp-plumber-decatur.json", import.meta.url);
let fixture = null;
let loadError = null;
try {
  fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
} catch (err) {
  loadError = err.code === "ENOENT" ? "fixture not yet captured — see dispatch A" : `fixture unreadable: ${err.message}`;
}
const needsFixture = loadError ? { skip: loadError } : {};

/* Stub fetch with a queue of responses. Returns { calls, restore }. */
function stubFetch(responses) {
  const original = globalThis.fetch;
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (typeof next === "function") return next();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/* A minimal well-formed envelope wrapping an arbitrary task. */
function envelope(task, overrides = {}) {
  return {
    version: "0.1.20260101",
    status_code: 20000,
    status_message: "Ok.",
    time: "4.26 sec.",
    cost: 0.002,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [task],
    ...overrides,
  };
}

/* ========================================================================== *
 *  ⚠️ anti-pattern 1 — location is required, never defaulted
 * ========================================================================== */

test("⚠️ a missing locationCode throws — it is NEVER defaulted", async () => {
  for (const bad of [undefined, null, ""]) {
    await assert.rejects(
      () => serpLiveAdvanced(ENV, { keyword: "plumber", locationCode: bad }),
      (err) => err instanceof DataForSeoError && /locationCode/.test(err.message),
      `locationCode ${JSON.stringify(bad)} must be rejected`
    );
  }
});

test("the location actually sent is the one passed in", async () => {
  const stub = stubFetch([{ status: 200, body: envelope({ status_code: 20000, result: [{ items: [] }] }) }]);
  try {
    await serpLiveAdvanced(ENV, OK_ARGS);
    const sent = JSON.parse(stub.calls[0].init.body);
    assert.equal(sent[0].location_code, 1012990, "location_code must be passed through verbatim");
    assert.equal(sent[0].keyword, "Plumber Decatur AL");
    assert.equal(sent[0].depth, 10);
    assert.equal(sent[0].language_code, "en");
  } finally {
    stub.restore();
  }
});

test("the request targets live/advanced and nothing else", async () => {
  const stub = stubFetch([{ status: 200, body: envelope({ status_code: 20000, result: [{ items: [] }] }) }]);
  try {
    await serpLiveAdvanced(ENV, OK_ARGS);
    assert.equal(stub.calls[0].url, "https://api.dataforseo.com/v3/serp/google/organic/live/advanced");
    assert.match(stub.calls[0].init.headers.Authorization, /^Basic /);
  } finally {
    stub.restore();
  }
});

test("missing credentials fail closed", async () => {
  await assert.rejects(
    () => serpLiveAdvanced({}, OK_ARGS),
    (err) => err instanceof DataForSeoError && /credentials/.test(err.message)
  );
});

/* ========================================================================== *
 *  The envelope seam
 * ========================================================================== */

test("⚠️ SEAM: the real fixture wrapped in an envelope unwraps back to the task", needsFixture, async () => {
  // The fixture is a Playground capture and is therefore already a TASK. Wrapping
  // it reconstructs what the live API would have returned, so this covers the one
  // shape difference between the captured artifact and production.
  const stub = stubFetch([{ status: 200, body: envelope(fixture) }]);
  try {
    const task = await serpLiveAdvanced(ENV, OK_ARGS);

    assert.equal(task, fixture, "must return tasks[0] itself, not the envelope");
    assert.ok(Array.isArray(task.result), "the returned task carries result[]");
    assert.ok(Array.isArray(task.result[0].items), "…and result[0].items");
    assert.equal(task.tasks, undefined, "the envelope must not survive");
  } finally {
    stub.restore();
  }
});

test("returns the task object, not the envelope", async () => {
  const task = { status_code: 20000, id: "task-1", result: [{ items: [] }] };
  const stub = stubFetch([{ status: 200, body: envelope(task) }]);
  try {
    const returned = await serpLiveAdvanced(ENV, OK_ARGS);
    assert.equal(returned.id, "task-1");
    assert.equal(returned.status_code, 20000);
    assert.equal(returned.version, undefined, "envelope-only fields must not appear");
  } finally {
    stub.restore();
  }
});

/* ========================================================================== *
 *  Both status layers
 * ========================================================================== */

test("an envelope-level error is thrown with its status_message", async () => {
  const stub = stubFetch([{ status: 200, body: { status_code: 40100, status_message: "Auth error.", tasks: [] } }]);
  try {
    await assert.rejects(
      () => serpLiveAdvanced(ENV, OK_ARGS),
      (err) => err.statusCode === 40100 && /Auth error/.test(err.message)
    );
  } finally {
    stub.restore();
  }
});

test("⚠️ a TASK-level error is caught even when the envelope says 20000", async () => {
  // The failure mode this exists for: checking only the outer status treats a
  // failed task as a success and hands an empty result downstream.
  const body = envelope({ status_code: 40501, status_message: "Invalid Field." }, { tasks_error: 1 });
  const stub = stubFetch([{ status: 200, body }]);
  try {
    await assert.rejects(
      () => serpLiveAdvanced(ENV, OK_ARGS),
      (err) => err.statusCode === 40501 && /Invalid Field/.test(err.message)
    );
  } finally {
    stub.restore();
  }
});

test("an envelope with no task throws rather than returning undefined", async () => {
  const stub = stubFetch([{ status: 200, body: { status_code: 20000, tasks: [] } }]);
  try {
    await assert.rejects(() => serpLiveAdvanced(ENV, OK_ARGS), (err) => /no task/.test(err.message));
  } finally {
    stub.restore();
  }
});

/* ========================================================================== *
 *  ⚠️ 40200 — hard failure, never retried, never soft-degraded
 * ========================================================================== */

test("⚠️ 40200 insufficient funds is FATAL and not retryable", async () => {
  const body = envelope({ status_code: 40200, status_message: "Insufficient credits." }, { tasks_error: 1 });
  const stub = stubFetch([{ status: 200, body }]);
  try {
    await assert.rejects(
      () => serpLiveAdvanced(ENV, OK_ARGS),
      (err) => {
        assert.equal(err.fatal, true, "must halt the job, never degrade to unread");
        assert.equal(err.retryable, false, "retrying cannot conjure credit");
        assert.equal(err.statusCode, 40200);
        return true;
      }
    );
    assert.equal(stub.calls.length, 1, "40200 must not be retried");
  } finally {
    stub.restore();
  }
});

test("a non-40200 business error is not marked fatal", async () => {
  const body = envelope({ status_code: 40501, status_message: "Invalid Field." }, { tasks_error: 1 });
  const stub = stubFetch([{ status: 200, body }]);
  try {
    await assert.rejects(() => serpLiveAdvanced(ENV, OK_ARGS), (err) => err.fatal === false);
  } finally {
    stub.restore();
  }
});

/* ========================================================================== *
 *  Retry discipline (Checkpoint 1)
 * ========================================================================== */

test("a 5xx is retried and the second attempt's success is returned", async () => {
  const ok = envelope({ status_code: 20000, id: "recovered", result: [{ items: [] }] });
  const stub = stubFetch([{ status: 503, body: null }, { status: 200, body: ok }]);
  try {
    const task = await serpLiveAdvanced(ENV, { ...OK_ARGS, retryDelaysMs: FAST_RETRIES });
    assert.equal(task.id, "recovered", "the retry's result is what comes back");
    assert.equal(stub.calls.length, 2, "one retry was enough");
  } finally {
    stub.restore();
  }
});

test("a business error is NOT retried — a refusal is a refusal", async () => {
  const body = envelope({ status_code: 40501, status_message: "Invalid Field." }, { tasks_error: 1 });
  const stub = stubFetch([{ status: 200, body }]);
  try {
    await assert.rejects(() => serpLiveAdvanced(ENV, OK_ARGS));
    assert.equal(stub.calls.length, 1, "one attempt only");
  } finally {
    stub.restore();
  }
});

test("a 4xx that is not 429 is not retried", async () => {
  const stub = stubFetch([{ status: 403, body: null }]);
  try {
    await assert.rejects(() => serpLiveAdvanced(ENV, OK_ARGS), (err) => err.httpStatus === 403);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("retries are exhausted after 3 total attempts, then the last error is thrown", async () => {
  const stub = stubFetch([{ status: 503, body: null }]);
  try {
    await assert.rejects(
      () => serpLiveAdvanced(ENV, { ...OK_ARGS, retryDelaysMs: FAST_RETRIES }),
      (err) => err instanceof DataForSeoError && err.retryable === true && err.httpStatus === 503
    );
    assert.equal(stub.calls.length, 3, "1 initial attempt + 2 retries — the Checkpoint 1 shape");
  } finally {
    stub.restore();
  }
});

test("the default backoff is the Checkpoint 1 schedule, not the test one", async () => {
  // Guard against the injectable delay quietly becoming the production default.
  const src = readFileSync(new URL("./dataforseo.js", import.meta.url), "utf8");
  assert.match(src, /RETRY_DELAYS_MS = \[5_000, 10_000\]/, "5s then 10s, ~2 retries");
  assert.match(src, /retryDelaysMs = RETRY_DELAYS_MS/, "the default must be the real schedule");
});

/* ========================================================================== *
 *  ⚠️ anti-pattern 2 — no balance probe
 * ========================================================================== */

test("⚠️ exactly ONE request per call — no pre/post balance probe", async () => {
  const stub = stubFetch([{ status: 200, body: envelope({ status_code: 20000, result: [{ items: [] }] }) }]);
  try {
    await serpLiveAdvanced(ENV, OK_ARGS);
    assert.equal(stub.calls.length, 1, "the reference implementation makes three; this makes one");
    for (const call of stub.calls) {
      assert.ok(!/user_data|appendix/.test(call.url), "no balance endpoint may be called");
    }
  } finally {
    stub.restore();
  }
});
