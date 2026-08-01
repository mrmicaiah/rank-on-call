/**
 * D1 access for the fulfillment job record.
 *
 * The job row IS the durability guarantee. Spec §2.1: "A paid order cannot be
 * lost." Every write here is designed so that a retried Stripe delivery, a
 * re-driven queue message, or a crash mid-pipeline converges on the same row
 * rather than creating a second one.
 */

/** Lifecycle states. `processing_pending` is written by the webhook before the
 *  §1.4 gate is evaluated, so a gate-failing paid order still leaves a record. */
export const STATES = {
  PROCESSING_PENDING: "processing_pending",
  QUEUED: "queued",
  MANUAL_HOLD: "manual_hold",
  PROCESSING: "processing",
  DELIVERED: "delivered",
  QUARANTINED: "quarantined",
};

/* Columns setState is permitted to write. The SET clause is built from caller
   input, so the column names are whitelisted rather than interpolated blind —
   values always go through bind(), never string concatenation. */
const UPDATABLE_COLUMNS = new Set([
  "gate_passed",
  "gate_reason",
  "confirmed_place_id",
  "business_name",
  "city_state",
  "scanned_url",
  "report_due_at",
  "stripe_event_id",
  "delivered_at",
  "attempts",
  "last_error",
]);

function nowIso() {
  return new Date().toISOString();
}

/* D1 reports affected rows on `meta.changes`. Older/alternate runtimes have only
   `meta.rows_written`. Read whichever is present rather than assuming. */
function changedRows(result) {
  const meta = (result && result.meta) || {};
  if (typeof meta.changes === "number") return meta.changes;
  if (typeof meta.rows_written === "number") return meta.rows_written;
  return 0;
}

/**
 * Insert the job row, keyed by PaymentIntent id.
 *
 * `ON CONFLICT(payment_intent_id) DO NOTHING` is the idempotency mechanism, and
 * it is deliberately NOT a SELECT-then-INSERT: two concurrent deliveries of the
 * same Stripe event would both see "no row" in the gap between the two
 * statements and both proceed. The conflict clause pushes that decision into the
 * database, where it is atomic.
 *
 * Returns { inserted: boolean }. `inserted === false` means this exact
 * PaymentIntent has been seen before — the caller must enqueue NOTHING.
 */
export async function insertJob(db, record) {
  const ts = nowIso();
  const result = await db
    .prepare(
      `INSERT INTO jobs (
         payment_intent_id, session_id, stripe_event_id, state,
         gate_passed, gate_reason,
         confirmed_place_id, business_name, city_state, scanned_url, report_due_at,
         created_at, updated_at, attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(payment_intent_id) DO NOTHING`
    )
    .bind(
      record.payment_intent_id,
      record.session_id,
      record.stripe_event_id || null,
      record.state,
      record.gate_passed ? 1 : 0,
      record.gate_reason || null,
      record.confirmed_place_id || null,
      record.business_name || null,
      record.city_state || null,
      record.scanned_url || null,
      record.report_due_at || null,
      ts,
      ts
    )
    .run();

  return { inserted: changedRows(result) > 0 };
}

/**
 * Move a job to `state`, stamping updated_at. `fields` may carry any whitelisted
 * column; unknown keys are ignored rather than silently injected.
 */
export async function setState(db, paymentIntentId, state, fields = {}) {
  const assignments = ["state = ?", "updated_at = ?"];
  const values = [state, nowIso()];

  for (const [column, value] of Object.entries(fields)) {
    if (!UPDATABLE_COLUMNS.has(column)) continue;
    assignments.push(`${column} = ?`);
    values.push(value === undefined ? null : value);
  }

  values.push(paymentIntentId);

  const result = await db
    .prepare(`UPDATE jobs SET ${assignments.join(", ")} WHERE payment_intent_id = ?`)
    .bind(...values)
    .run();

  return { updated: changedRows(result) > 0 };
}

/** Fetch one job row, or null. */
export async function getJob(db, paymentIntentId) {
  return await db
    .prepare(`SELECT * FROM jobs WHERE payment_intent_id = ?`)
    .bind(paymentIntentId)
    .first();
}

/** Bump the attempt counter — used by the queue consumer on each delivery. */
export async function incrementAttempts(db, paymentIntentId) {
  await db
    .prepare(`UPDATE jobs SET attempts = attempts + 1, updated_at = ? WHERE payment_intent_id = ?`)
    .bind(nowIso(), paymentIntentId)
    .run();
}
