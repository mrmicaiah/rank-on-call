-- Rank On Call — fulfillment job record (D1).
-- Spec: docs/FULFILLMENT_WORKER_SPEC.md §2.1 (durable queue, retry discipline),
-- §3.1 (the both-objects input contract), §3.2 (the delivery clock).
--
-- The PRIMARY KEY is the PaymentIntent id, not a surrogate. That is the whole
-- idempotency mechanism: `INSERT ... ON CONFLICT(payment_intent_id) DO NOTHING`
-- makes a duplicate Stripe delivery a no-op at the database, with no
-- SELECT-then-INSERT race window. Spec §2.1: "Record delivery state keyed by
-- PaymentIntent id and make the send step idempotent."

CREATE TABLE IF NOT EXISTS jobs (
  payment_intent_id  TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  stripe_event_id    TEXT,

  -- Lifecycle. processing_pending is the pre-gate landing state written by the
  -- webhook before the §1.4 gate runs, so that a gate-failing paid order still
  -- leaves a durable record instead of vanishing.
  --   processing_pending | queued | manual_hold | processing | delivered | quarantined
  state              TEXT NOT NULL,

  -- §1.4 confirmed-business gate. gate_passed is 0 until the gate is evaluated
  -- and passed; gate_reason records WHY a job was held, in plain text.
  gate_passed        INTEGER NOT NULL DEFAULT 0,
  gate_reason        TEXT,

  -- From the PaymentIntent metadata (§3.1).
  confirmed_place_id TEXT,
  report_due_at      TEXT,

  -- From the Checkout Session: custom_fields for the business, metadata for the url (§3.1).
  business_name      TEXT,
  city_state         TEXT,
  scanned_url        TEXT,

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  delivered_at       TEXT,

  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT
);

-- Lookups are by state: "what is queued", "what is held", "what quarantined".
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state);
