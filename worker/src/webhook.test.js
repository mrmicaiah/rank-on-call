/**
 * Tests for the fulfillment webhook — run with: npm test  (node --test src/*.test.js)
 *
 * Three layers:
 *   1. verifyStripeSignature, against signatures produced by node:crypto rather
 *      than by the code under test. A self-signed fixture would pass even if the
 *      HMAC construction were wrong; an independently-generated one cannot.
 *   2. evaluateGate + the both-objects readers, as pure functions.
 *   3. The webhook end to end through the real default export, over a fake D1 and
 *      a fake queue. This is what actually pins the duplicate/resume behaviour —
 *      "does it enqueue?" is only meaningfully answerable by watching the queue.
 *
 * No network: globalThis.fetch is stubbed per test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import worker, { evaluateGate } from "./index.js";
import {
  verifyStripeSignature,
  readBusiness,
  readMetadata,
  extractPaymentIntent,
} from "./stripe.js";
import { STATES } from "./jobs.js";

const SECRET = "whsec_testsecret_abc123";
const STRIPE_KEY = "sk_test_dummy";

/* Sign the way Stripe does — independently of the implementation under test. */
function stripeSign(body, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { header: `t=${ts},v1=${v1}`, ts, v1 };
}

/* ========================================================================== *
 *  1. Signature verification
 * ========================================================================== */

const BODY = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1" } },
});

test("signature: a genuine Stripe signature is accepted", async () => {
  const { header } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), true);
});

test("signature: accepts a valid v1 among several (secret rotation)", async () => {
  const { ts, v1 } = stripeSign(BODY);
  const header = `t=${ts},v1=${"0".repeat(64)},v1=${v1}`;
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), true);
});

test("signature: ignores the v0 scheme and still finds v1", async () => {
  const { ts, v1 } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY, `t=${ts},v0=deadbeef,v1=${v1}`, SECRET), true);
});

test("signature: a signature from the wrong secret is rejected", async () => {
  const { header } = stripeSign(BODY, "whsec_wrong");
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), false);
});

test("signature: a tampered body is rejected", async () => {
  const { header } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY + " ", header, SECRET), false);
});

test("signature: a stale timestamp is rejected (replay window)", async () => {
  const old = Math.floor(Date.now() / 1000) - 400;
  const { header } = stripeSign(BODY, SECRET, old);
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), false);
});

test("signature: a future timestamp is rejected", async () => {
  const ahead = Math.floor(Date.now() / 1000) + 400;
  const { header } = stripeSign(BODY, SECRET, ahead);
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), false);
});

test("signature: 299s old is still inside tolerance", async () => {
  const nearly = Math.floor(Date.now() / 1000) - 299;
  const { header } = stripeSign(BODY, SECRET, nearly);
  assert.equal(await verifyStripeSignature(BODY, header, SECRET), true);
});

test("signature: the timestamp is bound into the MAC, not merely parsed", async () => {
  // A signature computed over t-10 but presented with t must fail. If the
  // implementation ever hashed the body alone, this would wrongly pass.
  const now = Math.floor(Date.now() / 1000);
  const { v1 } = stripeSign(BODY, SECRET, now - 10);
  assert.equal(await verifyStripeSignature(BODY, `t=${now},v1=${v1}`, SECRET), false);
});

test("signature: a truncated v1 is rejected (length mismatch)", async () => {
  const { ts, v1 } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY, `t=${ts},v1=${v1.slice(0, 32)}`, SECRET), false);
});

test("signature: an overlong v1 is rejected", async () => {
  const { ts, v1 } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY, `t=${ts},v1=${v1}00`, SECRET), false);
});

test("signature: fails closed when the secret is unset", async () => {
  const { header } = stripeSign(BODY);
  assert.equal(await verifyStripeSignature(BODY, header, ""), false);
});

test("signature: malformed headers are rejected, never thrown", async () => {
  const now = Math.floor(Date.now() / 1000);
  const hostile = [
    null, undefined, "", 123, {}, [],
    "not-a-signature", `t=${now}`, "t=,v1=", "=,=", "t=1,v1=",
    `t=abc,v1=${"a".repeat(64)}`,
  ];
  for (const h of hostile) {
    assert.equal(await verifyStripeSignature(BODY, h, SECRET), false, `should reject: ${JSON.stringify(h)}`);
  }
});

/* ========================================================================== *
 *  2. The §1.4 gate
 * ========================================================================== */

test("gate: place_id present and attested \"true\" passes", () => {
  assert.equal(evaluateGate("ChIJabc", "true", "places").passed, true);
});

test("gate: a missing place_id is held", () => {
  assert.equal(evaluateGate("", "true", "manual").passed, false);
});

test("gate: a whitespace-only place_id is held", () => {
  assert.equal(evaluateGate("   ", "true", "places").passed, false);
});

test("gate: boolean true is not the string \"true\" and is held", () => {
  assert.equal(evaluateGate("ChIJabc", true, "places").passed, false);
});

test("gate: \"TRUE\" is held — the compare is exact", () => {
  assert.equal(evaluateGate("ChIJabc", "TRUE", "places").passed, false);
});

test("gate: every held case carries a reason", () => {
  for (const [placeId, attested] of [["", "true"], ["ChIJabc", ""], ["", ""], ["  ", "TRUE"]]) {
    const result = evaluateGate(placeId, attested, "manual");
    assert.equal(result.passed, false);
    assert.ok(result.reason && result.reason.length > 0, "a held job must record why");
  }
});

/* ========================================================================== *
 *  3. The both-objects read (spec §3.1)
 * ========================================================================== */

const SESSION_FIXTURE = {
  id: "cs_test_1",
  payment_status: "paid",
  custom_fields: [
    { key: "businessname", text: { value: " Ace Plumbing " } },
    { key: "citystate", text: { value: "Austin, TX" } },
  ],
  metadata: { scanned_url: "https://aceplumbing.example" },
  payment_intent: {
    id: "pi_123",
    metadata: {
      confirmed_place_id: "ChIJxyz",
      ownership_attested: "true",
      confirmation_method: "places",
      report_due_at: "2026-08-06T17:00:00-05:00",
    },
  },
};

test("read: business name comes off the SESSION custom_fields, trimmed", () => {
  assert.equal(readBusiness(SESSION_FIXTURE).name, "Ace Plumbing");
});

test("read: city/state comes off the SESSION custom_fields", () => {
  assert.equal(readBusiness(SESSION_FIXTURE).location, "Austin, TX");
});

test("read: scanned_url comes off SESSION metadata", () => {
  assert.equal(readMetadata(SESSION_FIXTURE, ["scanned_url"]), "https://aceplumbing.example");
});

test("read: the custom_fields fallback key lists are honoured", () => {
  const session = {
    custom_fields: [
      { key: "company", text: { value: "Bob HVAC" } },
      { key: "city", text: { value: "Reno, NV" } },
    ],
  };
  assert.deepEqual(readBusiness(session), { name: "Bob HVAC", location: "Reno, NV" });
});

test("read: metadata is used when custom_fields are absent", () => {
  const session = { metadata: { business_name: "Solo LLC", city_state: "Boise, ID" } };
  assert.deepEqual(readBusiness(session), { name: "Solo LLC", location: "Boise, ID" });
});

test("read: confirmation fields come off the EXPANDED payment_intent", () => {
  const { object } = extractPaymentIntent(SESSION_FIXTURE);
  assert.equal(readMetadata(object, ["confirmed_place_id"]), "ChIJxyz");
  assert.equal(readMetadata(object, ["ownership_attested"]), "true");
});

test("read: THE SILENT BUG — confirmation fields are NOT on the session", () => {
  // Spec §3.1 calls this the most likely silent bug in the build. A consumer that
  // reads only one object gets an empty string and would fail the gate on a
  // perfectly good order, or worse, treat empty as absent-and-fine.
  assert.equal(readMetadata(SESSION_FIXTURE, ["confirmed_place_id"]), "");
  assert.equal(readMetadata(SESSION_FIXTURE, ["ownership_attested"]), "");
});

test("read: a bare-string payment_intent yields an id but no object", () => {
  assert.deepEqual(extractPaymentIntent({ payment_intent: "pi_456" }), { id: "pi_456", object: null });
});

test("read: an absent payment_intent yields an empty id", () => {
  assert.deepEqual(extractPaymentIntent({}), { id: "", object: null });
});

/* ========================================================================== *
 *  4. End-to-end webhook behaviour — duplicates and the resume path
 * ========================================================================== */

/**
 * Minimal D1 stand-in. Backs `jobs` with a Map keyed by payment_intent_id and
 * understands only the three statement shapes this worker issues. Deliberately
 * strict: an unrecognised statement throws rather than silently returning a
 * success, so a future query change cannot pass these tests by accident.
 */
function fakeDb(seed = []) {
  const rows = new Map();
  for (const row of seed) rows.set(row.payment_intent_id, { ...row });

  const INSERT_COLUMNS = [
    "payment_intent_id", "session_id", "stripe_event_id", "state",
    "gate_passed", "gate_reason",
    "confirmed_place_id", "business_name", "city_state", "scanned_url", "report_due_at",
    "created_at", "updated_at",
  ];

  return {
    rows,
    prepare(sql) {
      const statement = sql.trim().replace(/\s+/g, " ");
      let bound = [];
      const api = {
        bind(...values) { bound = values; return api; },
        async run() {
          if (statement.startsWith("INSERT INTO jobs")) {
            const id = bound[0];
            if (rows.has(id)) return { meta: { changes: 0 } }; // ON CONFLICT DO NOTHING
            const row = { attempts: 0, delivered_at: null, last_error: null };
            INSERT_COLUMNS.forEach((col, i) => { row[col] = bound[i]; });
            rows.set(id, row);
            return { meta: { changes: 1 } };
          }
          if (statement.startsWith("UPDATE jobs SET attempts = attempts + 1")) {
            const row = rows.get(bound[bound.length - 1]);
            if (!row) return { meta: { changes: 0 } };
            row.attempts += 1;
            row.updated_at = bound[0];
            return { meta: { changes: 1 } };
          }
          if (statement.startsWith("UPDATE jobs SET")) {
            const setClause = statement.slice("UPDATE jobs SET ".length, statement.indexOf(" WHERE "));
            const columns = setClause.split(",").map((c) => c.trim().split(" ")[0]);
            const row = rows.get(bound[bound.length - 1]);
            if (!row) return { meta: { changes: 0 } };
            columns.forEach((col, i) => { row[col] = bound[i]; });
            return { meta: { changes: 1 } };
          }
          throw new Error(`fakeDb: unhandled statement: ${statement}`);
        },
        async first() {
          if (statement.startsWith("SELECT * FROM jobs WHERE payment_intent_id")) {
            return rows.get(bound[0]) || null;
          }
          throw new Error(`fakeDb: unhandled statement: ${statement}`);
        },
      };
      return api;
    },
  };
}

function fakeQueue() {
  const sent = [];
  return { sent, async send(message) { sent.push(message); } };
}

/* Stub globalThis.fetch so loadPaidSession resolves without network. */
function stubStripe(session, { status = 200 } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => session,
  });
  return () => { globalThis.fetch = original; };
}

function webhookRequest(body, { header, method = "POST" } = {}) {
  return new Request("https://worker.example/", {
    method,
    headers: header === null ? {} : { "stripe-signature": header || stripeSign(body).header },
    body: method === "POST" ? body : undefined,
  });
}

function eventBody(sessionId = "cs_test_1", eventId = "evt_1", type = "checkout.session.completed") {
  return JSON.stringify({ id: eventId, type, data: { object: { id: sessionId } } });
}

/* A row as the webhook would have written it, in a given state. */
function seedRow(state, overrides = {}) {
  return {
    payment_intent_id: "pi_123",
    session_id: "cs_test_1",
    stripe_event_id: "evt_1",
    state,
    gate_passed: state === STATES.QUEUED ? 1 : 0,
    gate_reason: null,
    confirmed_place_id: "ChIJxyz",
    business_name: "Ace Plumbing",
    city_state: "Austin, TX",
    scanned_url: "https://aceplumbing.example",
    report_due_at: "2026-08-06T17:00:00-05:00",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    delivered_at: null,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

async function runWebhook({ session = SESSION_FIXTURE, seed = [], body = eventBody(), header, method, queueThrows = false } = {}) {
  const restore = stubStripe(session);
  try {
    const db = fakeDb(seed);
    const queue = fakeQueue();
    if (queueThrows) queue.send = async () => { throw new Error("Queues unavailable"); };
    const env = { DB: db, JOB_QUEUE: queue, STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: SECRET };
    const response = await worker.fetch(webhookRequest(body, { header, method }), env);
    return { response, db, queue, env };
  } finally {
    restore();
  }
}

test("webhook: rejects a non-POST with 405", async () => {
  const { response, queue } = await runWebhook({ method: "GET" });
  assert.equal(response.status, 405);
  assert.equal(queue.sent.length, 0);
});

test("webhook: rejects an unsigned request with 400 and a generic body", async () => {
  const { response, queue } = await runWebhook({ header: null });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /invalid signature/i);
  assert.equal(queue.sent.length, 0);
});

test("webhook: rejects a request signed with the wrong secret", async () => {
  const body = eventBody();
  const { response, queue } = await runWebhook({ body, header: stripeSign(body, "whsec_wrong").header });
  assert.equal(response.status, 400);
  assert.equal(queue.sent.length, 0);
});

test("webhook: acks and ignores an event type it does not handle", async () => {
  const body = eventBody("cs_test_1", "evt_1", "payment_intent.succeeded");
  const { response, queue, db } = await runWebhook({ body });
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 0);
  assert.equal(db.rows.size, 0, "an unhandled event must not write a row");
});

test("webhook: a clean paid order inserts, passes the gate, and enqueues ids only", async () => {
  const { response, queue, db } = await runWebhook();
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 1);
  assert.deepEqual(queue.sent[0], {
    payment_intent_id: "pi_123",
    session_id: "cs_test_1",
    stripe_event_id: "evt_1",
  });

  const row = db.rows.get("pi_123");
  assert.equal(row.state, STATES.QUEUED);
  assert.equal(row.gate_passed, 1);
  // Both objects were read: session-side and payment-intent-side fields present.
  assert.equal(row.business_name, "Ace Plumbing");
  assert.equal(row.city_state, "Austin, TX");
  assert.equal(row.scanned_url, "https://aceplumbing.example");
  assert.equal(row.confirmed_place_id, "ChIJxyz");
  assert.equal(row.report_due_at, "2026-08-06T17:00:00-05:00");
});

test("webhook: an unpaid session is acked without a row or an enqueue", async () => {
  const session = { ...SESSION_FIXTURE, payment_status: "unpaid" };
  const { response, queue, db } = await runWebhook({ session });
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 0);
  assert.equal(db.rows.size, 0);
});

test("webhook: a gate failure records manual_hold with a reason and does not enqueue", async () => {
  const session = {
    ...SESSION_FIXTURE,
    payment_intent: {
      id: "pi_123",
      metadata: { confirmed_place_id: "", ownership_attested: "true", confirmation_method: "manual" },
    },
  };
  const { response, queue, db } = await runWebhook({ session });
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 0, "a gate failure must never enqueue");

  const row = db.rows.get("pi_123");
  assert.equal(row.state, STATES.MANUAL_HOLD, "a held order must still leave a durable row");
  assert.equal(row.gate_passed, 0);
  assert.match(row.gate_reason, /confirmed_place_id/);
});

test("webhook: a failed enqueue returns 500 and leaves the row in processing_pending", async () => {
  // This is the state the resume path below exists to recover.
  const { response, db } = await runWebhook({ queueThrows: true });
  assert.equal(response.status, 500, "must ask Stripe to retry");
  assert.equal(db.rows.get("pi_123").state, STATES.PROCESSING_PENDING);
});

/* ---------------------- duplicates and the resume path --------------------- */

test("resume: a redelivery finding processing_pending re-drives the enqueue", async () => {
  const { response, queue, db } = await runWebhook({ seed: [seedRow(STATES.PROCESSING_PENDING)] });
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 1, "the stranded order must be enqueued");
  assert.deepEqual(queue.sent[0], {
    payment_intent_id: "pi_123",
    session_id: "cs_test_1",
    stripe_event_id: "evt_1",
  });
  assert.equal(db.rows.get("pi_123").state, STATES.QUEUED);
  assert.equal(db.rows.size, 1, "resume must not create a second row");
});

test("resume: the full stranded-order cycle recovers — enqueue fails, Stripe retries, order is queued", async () => {
  // End to end over one shared database, which is the scenario the fix targets.
  const db = fakeDb();
  const brokenQueue = { sent: [], async send() { throw new Error("Queues unavailable"); } };
  const workingQueue = fakeQueue();
  const base = { DB: db, STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: SECRET };
  const restore = stubStripe(SESSION_FIXTURE);
  try {
    const first = await worker.fetch(webhookRequest(eventBody()), { ...base, JOB_QUEUE: brokenQueue });
    assert.equal(first.status, 500);
    assert.equal(db.rows.get("pi_123").state, STATES.PROCESSING_PENDING);

    // Stripe redelivers the same event. Before the fix this returned 200 with no
    // enqueue and the paid order was lost.
    const second = await worker.fetch(webhookRequest(eventBody()), { ...base, JOB_QUEUE: workingQueue });
    assert.equal(second.status, 200);
    assert.equal(workingQueue.sent.length, 1, "the retry must recover the order");
    assert.equal(db.rows.get("pi_123").state, STATES.QUEUED);
  } finally {
    restore();
  }
});

test("resume: processing_pending with a FAILING gate repairs to manual_hold, still no enqueue", async () => {
  const session = {
    ...SESSION_FIXTURE,
    payment_intent: {
      id: "pi_123",
      metadata: { confirmed_place_id: "ChIJxyz", ownership_attested: "false", confirmation_method: "places" },
    },
  };
  const { response, queue, db } = await runWebhook({ session, seed: [seedRow(STATES.PROCESSING_PENDING)] });
  assert.equal(response.status, 200);
  assert.equal(queue.sent.length, 0);
  assert.equal(db.rows.get("pi_123").state, STATES.MANUAL_HOLD);
});

/* Every other state is a genuine duplicate: ack, never enqueue. */
for (const state of [STATES.QUEUED, STATES.PROCESSING, STATES.DELIVERED, STATES.MANUAL_HOLD, STATES.QUARANTINED]) {
  test(`duplicate: a redelivery for a job in '${state}' does not enqueue`, async () => {
    const { response, queue, db } = await runWebhook({ seed: [seedRow(state)] });
    assert.equal(response.status, 200);
    assert.equal(queue.sent.length, 0, `'${state}' must not be re-driven`);
    assert.equal(db.rows.get("pi_123").state, state, "the existing state must be left alone");
    assert.equal(db.rows.size, 1);
  });
}

test("duplicate: a delivered job is never re-enqueued even on repeated redelivery", async () => {
  const seed = [seedRow(STATES.DELIVERED, { delivered_at: "2026-08-02T12:00:00.000Z" })];
  for (let i = 0; i < 3; i++) {
    const { response, queue } = await runWebhook({ seed });
    assert.equal(response.status, 200);
    assert.equal(queue.sent.length, 0);
  }
});
