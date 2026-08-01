/**
 * Rank On Call — fulfillment worker, Piece 1.
 *
 * Scope of THIS file: the Stripe webhook, the durable job record, and the queue
 * enqueue. Nothing else. No research, no rendering, no generation, no email —
 * the queue consumer is a deliberate stub (spec §7.6 build order, step 1).
 *
 * Spec: docs/FULFILLMENT_WORKER_SPEC.md
 *   §2.1  the durable queue and its retry discipline
 *   §3    the end-to-end flow, stages 1–5
 *   §3.1  the both-objects input contract — the flagged "most likely silent bug"
 *   §1.4  the confirmed-business gate
 *
 * The webhook does almost nothing except enqueue, on purpose. Spec §2.1: "the
 * less work before the durable write, the smaller the window in which a paid
 * order can evaporate."
 */

import {
  verifyStripeSignature,
  loadPaidSession,
  readBusiness,
  readMetadata,
  extractPaymentIntent,
} from "./stripe.js";
import { insertJob, setState, getJob, incrementAttempts, STATES } from "./jobs.js";

const MAIN_QUEUE = "roc-fulfillment";
const DLQ = "roc-fulfillment-dlq";

/* Plain-text responses. Stripe reads only the status code; the body exists for
   humans reading logs. Failure bodies are deliberately generic — an attacker
   probing the endpoint learns nothing about WHY a request was rejected. */
function respond(message, status = 200) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    return handleWebhook(request, env);
  },

  async queue(batch, env) {
    return handleQueueBatch(batch, env);
  },
};

/* ========================================================================== *
 *  WEBHOOK
 * ========================================================================== */

async function handleWebhook(request, env) {
  // 1. Method gate.
  if (request.method !== "POST") {
    return respond("Method Not Allowed", 405);
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeKey) {
    // Fail CLOSED. An unset secret must serve nothing, never fall back to
    // accepting unverified requests.
    console.error("Webhook misconfigured: a required secret is not set");
    return respond("Server configuration error", 500);
  }

  // 2. Raw body FIRST, then verify against those exact bytes. JSON.parse must not
  //    happen before verification — an unverified webhook is an untrusted stranger
  //    asking for a free report (spec §3 stage 2), and re-serializing the body
  //    would break the HMAC anyway.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");

  const verified = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  if (!verified) {
    console.warn("Webhook rejected: signature verification failed");
    return respond("Invalid signature", 400); // generic — the reason is not leaked
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn("Webhook rejected: verified body was not valid JSON");
    return respond("Bad request", 400);
  }

  // 3. Only one event type matters. Anything else is acked immediately so Stripe
  //    stops redelivering it — a 200 here means "received", not "acted on".
  if (!event || event.type !== "checkout.session.completed") {
    console.log(`Webhook ignored: event type ${event && event.type}`);
    return respond("Ignored", 200);
  }

  const stripeEventId = (event.id && String(event.id)) || null;
  const sessionId = event.data && event.data.object && event.data.object.id;
  if (!sessionId || typeof sessionId !== "string") {
    console.warn(`Webhook ignored: checkout.session.completed with no session id (event ${stripeEventId})`);
    return respond("Ignored", 200);
  }

  // 4. Re-retrieve and re-gate server-side. The webhook body is not proof of
  //    payment on its own (spec §3.1).
  const loaded = await loadPaidSession(sessionId, stripeKey);
  if (!loaded.ok) {
    if (loaded.retryable) {
      // Stripe is unwell. Let Stripe's own retry schedule be the outer safety net.
      console.error(`Session lookup failed transiently (${loaded.code}, http ${loaded.status}) for event ${stripeEventId} — asking Stripe to retry`);
      return respond("Upstream error, retry", 500);
    }
    // Permanent. Retrying will never help, so ack it rather than letting Stripe
    // hammer a session that will never be paid or will never exist.
    console.warn(`Session lookup failed permanently (${loaded.code}) for event ${stripeEventId} — acking without enqueue`);
    return respond("Acknowledged", 200);
  }
  const session = loaded.session;

  // 5. THE BOTH-OBJECTS READ.
  //    Spec §3.1 calls this "the most likely silent bug in this build": the
  //    metadata is split across two Stripe objects, and a consumer reading only
  //    the PaymentIntent gets no website to analyze and no business name.
  //
  //    From the SESSION: business name + city/state (custom_fields, with the
  //    full fallback key lists, then metadata), and scanned_url (metadata only).
  const business = readBusiness(session);
  const scannedUrl = readMetadata(session, ["scanned_url"]);

  //    From the EXPANDED PAYMENT INTENT: every confirmation field. No existing
  //    code reads these back — confirm-business.js only writes them — so there is
  //    no second source if the expand did not return an object.
  const { id: paymentIntentId, object: paymentIntent } = extractPaymentIntent(session);

  if (!paymentIntentId) {
    // A paid session with no PaymentIntent at all. Legitimately possible for a
    // zero-amount session (a 100%-off coupon creates no PI), and there is no key
    // to record the job under. Retrying cannot conjure one, so ack and log loudly.
    console.error(`Paid session ${sessionId} has NO payment_intent — cannot key a job. Event ${stripeEventId}. NEEDS MANUAL ATTENTION.`);
    return respond("Acknowledged", 200);
  }
  if (!paymentIntent) {
    // We have an id but the expand came back as a bare string, so the metadata is
    // absent. That is anomalous — the request explicitly asks for the expand — and
    // it is almost certainly transient. Retry rather than gate on data we do not have.
    console.error(`payment_intent did not expand for session ${sessionId} (event ${stripeEventId}) — asking Stripe to retry`);
    return respond("Upstream error, retry", 500);
  }

  const confirmedPlaceId = readMetadata(paymentIntent, ["confirmed_place_id"]);
  const ownershipAttested = readMetadata(paymentIntent, ["ownership_attested"]);
  const confirmationMethod = readMetadata(paymentIntent, ["confirmation_method"]);
  const reportDueAt = readMetadata(paymentIntent, ["report_due_at"]);

  // 6. Durable write, BEFORE the gate is evaluated. A gate-failing paid order
  //    still gets a row — spec §2.1's "a paid order cannot be lost" applies to
  //    held orders too, and a row in manual_hold is findable where a bare log line
  //    is not. ON CONFLICT makes a duplicate delivery a no-op at the database.
  let inserted;
  try {
    ({ inserted } = await insertJob(db(env), {
      payment_intent_id: paymentIntentId,
      session_id: sessionId,
      stripe_event_id: stripeEventId,
      state: STATES.PROCESSING_PENDING,
      gate_passed: 0,
      gate_reason: null,
      confirmed_place_id: confirmedPlaceId,
      business_name: business.name,
      city_state: business.location,
      scanned_url: scannedUrl,
      report_due_at: reportDueAt,
    }));
  } catch (err) {
    // The durable write itself failed. This is the one window where a paid order
    // could evaporate, so hand it back to Stripe's retry schedule.
    console.error(`Durable write failed for ${paymentIntentId}: ${errText(err)} — asking Stripe to retry`);
    return respond("Storage error, retry", 500);
  }

  if (!inserted) {
    // Already seen. Stripe retried, or two deliveries raced.
    //
    // The default answer is to enqueue NOTHING — a second queue message would
    // mean a second report for one payment. But there is exactly one state where
    // that default strands a paid order forever, so it is checked first.
    //
    // ── THE RESUME BRANCH ──────────────────────────────────────────────────
    // Failure mode this recovers: delivery #1 inserted the row, passed the gate,
    // then `JOB_QUEUE.send()` threw (a Queues outage, a transient binding error).
    // We returned 500 to ask Stripe to retry — but on that retry the insert hits
    // ON CONFLICT and reports `inserted === false`. Returning 200 here would ack
    // an order that has a durable row and NO queue message: no consumer will ever
    // pick it up, no DLQ entry exists, nobody is alerted, and the 3-business-day
    // delivery clock (spec §3.2) keeps running. Spec §2.1 — "a paid order cannot
    // be lost" — is violated precisely because ON CONFLICT makes the INSERT
    // retry-safe but does nothing for the ENQUEUE.
    //
    // `processing_pending` is the tell. It is written before the gate is
    // evaluated and is overwritten by `queued` or `manual_hold` within
    // milliseconds on any healthy request, so a row still sitting in it on a
    // REDELIVERY means the first attempt died between the insert and the state
    // stamp. That is the only state worth re-driving; every other state is a
    // genuine duplicate and returns 200 exactly as before.
    //
    // Why a double enqueue is acceptable here: if delivery #1's send actually
    // succeeded and only the state stamp failed, this resume can produce a second
    // queue message. That is bounded, not unbounded — the send step in Piece 5 is
    // required to be idempotent against the delivery record keyed by PaymentIntent
    // id (spec §2.1, "check-then-send, with the check inside the same durable
    // record"), so a duplicate job re-runs research and stops at the send. One
    // wasted pipeline run is a far cheaper failure than one undelivered paid order.
    let existing;
    try {
      existing = await getJob(db(env), paymentIntentId);
    } catch (err) {
      // Cannot tell duplicate from stranded. Ask Stripe to retry rather than
      // guessing — the insert already conflicted, so a retry creates no second row.
      console.error(`Duplicate check could not read row ${paymentIntentId}: ${errText(err)} — asking Stripe to retry`);
      return respond("Storage error, retry", 500);
    }

    if (!existing || existing.state !== STATES.PROCESSING_PENDING) {
      console.log(
        `Duplicate delivery for ${paymentIntentId} (event ${stripeEventId}) — already recorded as '${existing ? existing.state : "missing"}', no enqueue`
      );
      return respond("Duplicate, already recorded", 200);
    }

    // Stranded. Fall through to the gate and enqueue below, which is the same
    // code path a first delivery takes — a gate failure still lands in
    // manual_hold, so this also repairs a row whose manual_hold stamp failed.
    console.warn(
      `RESUMING stranded order ${paymentIntentId} (event ${stripeEventId}) — row exists in '${STATES.PROCESSING_PENDING}' with no queue message; a prior enqueue must have failed`
    );
  }

  // 7. THE GATE (spec §1.4). Both conditions, no inference, no guessing.
  //    Anything else routes to manual/hold. "Never generate on a guess."
  const gate = evaluateGate(confirmedPlaceId, ownershipAttested, confirmationMethod);
  if (!gate.passed) {
    console.warn(`Gate FAILED for ${paymentIntentId}: ${gate.reason} — routing to manual_hold`);
    try {
      await setState(db(env), paymentIntentId, STATES.MANUAL_HOLD, {
        gate_passed: 0,
        gate_reason: gate.reason,
      });
    } catch (err) {
      // The row exists in processing_pending; the state stamp failed. Ack anyway —
      // a Stripe retry would hit ON CONFLICT and change nothing. The row is durable
      // and findable, which is what matters.
      console.error(`Could not stamp manual_hold for ${paymentIntentId}: ${errText(err)}`);
    }
    return respond("Held for manual review", 200);
  }

  // 8. Enqueue. IDS ONLY — the consumer re-reads Stripe for everything else, so
  //    the queue never carries a stale or partial copy of the order.
  try {
    await env.JOB_QUEUE.send({
      payment_intent_id: paymentIntentId,
      session_id: sessionId,
      stripe_event_id: stripeEventId,
    });
  } catch (err) {
    // 9. Hand it back to Stripe's retry schedule. The row stays in
    //    processing_pending, which is exactly the marker the resume branch above
    //    looks for — that is what makes the redelivery re-drive this enqueue
    //    instead of acking a stranded order.
    console.error(`Enqueue failed for ${paymentIntentId}: ${errText(err)} — asking Stripe to retry`);
    return respond("Enqueue failed, retry", 500);
  }

  try {
    await setState(db(env), paymentIntentId, STATES.QUEUED, { gate_passed: 1, gate_reason: null });
  } catch (err) {
    // Enqueued but not stamped. The message is real and will be processed; the
    // row simply reads processing_pending. Do NOT return 500 — that would make
    // Stripe redeliver, and the ON CONFLICT would then suppress the row insert
    // while the enqueue succeeded a second time. Better a stale label than a
    // duplicate job.
    console.error(`Enqueued ${paymentIntentId} but could not stamp 'queued': ${errText(err)}`);
  }

  console.log(`Enqueued ${paymentIntentId} (session ${sessionId}, event ${stripeEventId})`);
  return respond("Queued", 200);
}

/* The §1.4 gate, isolated so it is trivially testable and impossible to
   accidentally soften. Pass requires BOTH conditions. */
function evaluateGate(confirmedPlaceId, ownershipAttested, confirmationMethod) {
  const hasPlaceId = typeof confirmedPlaceId === "string" && confirmedPlaceId.trim() !== "";
  const attested = ownershipAttested === "true"; // string compare — metadata values are strings

  if (!hasPlaceId && !attested) {
    return { passed: false, reason: "no confirmed_place_id and ownership_attested is not \"true\" (buyer never completed confirmation)" };
  }
  if (!hasPlaceId) {
    return {
      passed: false,
      reason: `confirmed_place_id is missing or empty (confirmation_method=${confirmationMethod || "unset"})`,
    };
  }
  if (!attested) {
    return {
      passed: false,
      reason: `ownership_attested is ${JSON.stringify(ownershipAttested || "")}, expected the string "true"`,
    };
  }
  return { passed: true, reason: null };
}

/* ========================================================================== *
 *  QUEUE CONSUMER — STUB
 * ========================================================================== */

async function handleQueueBatch(batch, env) {
  if (batch.queue === DLQ) {
    return handleDeadLetterBatch(batch, env);
  }
  return handleMainQueueBatch(batch, env);
}

async function handleMainQueueBatch(batch, env) {
  for (const message of batch.messages) {
    const body = message.body || {};
    const paymentIntentId = body.payment_intent_id;

    console.log(
      `[${MAIN_QUEUE}] received job — payment_intent=${paymentIntentId} session=${body.session_id} event=${body.stripe_event_id} attempt=${message.attempts}`
    );

    if (!paymentIntentId) {
      console.error(`[${MAIN_QUEUE}] message with no payment_intent_id — acking, nothing to do`);
      message.ack();
      continue;
    }

    try {
      await incrementAttempts(db(env), paymentIntentId);
      await setState(db(env), paymentIntentId, STATES.PROCESSING);
    } catch (err) {
      console.error(`[${MAIN_QUEUE}] could not stamp 'processing' for ${paymentIntentId}: ${errText(err)}`);
    }

    // TODO: Piece 3 — research + generation pipeline.
    //
    // Everything downstream of here is unbuilt: Places + DataForSEO callers, the
    // one-level crawl, the VPS /render call, Anthropic assembly, Checkpoints 1–4,
    // and the Resend send. Until that exists this consumer only records that the
    // job was picked up.
    //
    // When it is built, the ack MUST move to after the pipeline finishes (spec
    // §2.1: "A job is not acknowledged until the pipeline finishes"). The ack
    // below is correct ONLY because the stub does no work worth retrying.

    message.ack();
  }
}

async function handleDeadLetterBatch(batch, env) {
  for (const message of batch.messages) {
    const body = message.body || {};
    const paymentIntentId = body.payment_intent_id;

    // Loud on purpose. A DLQ message is a PAID ORDER that exhausted its retries,
    // with a delivery deadline still running against it (spec §3.2: "Quarantine
    // does not pause the clock").
    console.error(
      `[DLQ] QUARANTINE — a paid order exhausted its retries. payment_intent=${paymentIntentId} session=${body.session_id} event=${body.stripe_event_id}. This order will NOT be delivered without intervention.`
    );

    if (paymentIntentId) {
      try {
        await setState(db(env), paymentIntentId, STATES.QUARANTINED, {
          last_error: "Exhausted queue retries; routed to dead-letter queue.",
        });
      } catch (err) {
        console.error(`[DLQ] could not stamp 'quarantined' for ${paymentIntentId}: ${errText(err)}`);
      }
    }

    // Ack, always. Never re-enqueue — spec §3 stage 10b: "Halt. Alert. Never send."
    // Alerting itself is Piece 6 and is not built; this log is the only signal today.
    message.ack();
  }
}

/* ========================================================================== *
 *  helpers
 * ========================================================================== */

function db(env) {
  return env.DB;
}

/* Error text for logs, without dragging a stack (or anything a stack might have
   closed over) into the log stream. */
function errText(err) {
  if (!err) return "unknown error";
  return String((err && err.message) || err);
}

// Exported for future unit tests; not part of the Worker's fetch/queue contract.
export { evaluateGate };
