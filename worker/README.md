# rank-on-call-fulfillment

The fulfillment worker. **Piece 1 only: Stripe webhook → durable job record → queue enqueue.**

Nothing downstream is built. No research, no rendering, no report generation, no email. The queue consumer is a stub that records "picked up" and acks.

Spec: `docs/FULFILLMENT_WORKER_SPEC.md` — §7.6 step 1.

## Why this is a separate Worker

The site and its API endpoints are a **Cloudflare Pages** project (`functions/api/*.js`). Pages Functions have no `queue()` handler, so a Queues consumer cannot live there. This is a standalone Worker with its own `wrangler.toml`, deployed separately. **Nothing in `functions/api/` is modified or redeployed by anything in this directory.**

## What it does

1. Receives `checkout.session.completed` from Stripe.
2. Verifies the signature against the raw body, constant-time, before parsing anything.
3. Re-retrieves the Checkout Session from Stripe with `expand[]=payment_intent` and re-checks `payment_status === "paid"` server-side.
4. Reads **both** Stripe objects — business name / city+state / scanned_url off the **Session**, confirmation fields off the **PaymentIntent** (spec §3.1).
5. Writes a durable D1 row keyed by PaymentIntent id (`ON CONFLICT DO NOTHING` = idempotency).
6. Applies the §1.4 gate: `confirmed_place_id` non-empty **AND** `ownership_attested === "true"`. Fail → `manual_hold`, no enqueue.
7. Pass → enqueues `{payment_intent_id, session_id, stripe_event_id}` and only those. The consumer re-reads Stripe.

## Setup

All commands run from **this directory** (`worker/`).

### 0. Install

```sh
cd worker
npm install
```

### 1. Create the D1 database

```sh
npx wrangler d1 create roc-fulfillment
```

This prints a `database_id`. **Open `wrangler.toml` and replace `REPLACE_ME_AFTER_WRANGLER_D1_CREATE` with it.** Deploys fail until you do.

### 2. Apply the schema

Local (for `wrangler dev`):

```sh
npm run db:init
```

Remote (the real database):

```sh
npm run db:init:remote
```

Equivalent to `npx wrangler d1 execute roc-fulfillment --remote --file=./schema.sql`.

### 3. Create both queues

```sh
npx wrangler queues create roc-fulfillment
npx wrangler queues create roc-fulfillment-dlq
```

Both must exist before deploy — `wrangler.toml` declares a producer and two consumers against them, and the dead-letter target must already exist.

### 4. Set the secrets

Secrets are never in `wrangler.toml`, never in the repo, never logged.

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

- `STRIPE_SECRET_KEY` — the same live/test key the Pages project already uses, but this Worker needs its **own** copy; bindings are not shared across projects.
- `STRIPE_WEBHOOK_SECRET` — **net-new.** You do not have this yet. Stripe generates it in step 6, so run that step first and come back for this one.

### 5. Deploy

```sh
npm run deploy
```

Note the deployed URL, e.g. `https://rank-on-call-fulfillment.<subdomain>.workers.dev`.

### 6. Register the endpoint in Stripe

Stripe Dashboard → **Developers → Webhooks → Add endpoint**.

- **Endpoint URL:** the Worker URL from step 5. The Worker serves the webhook at the root path, so no suffix is needed.
- **Events to send:** select exactly one —

  ```
  checkout.session.completed
  ```

  Any other event type is acked with a 200 and ignored, so adding more just creates noise.

- Click **Add endpoint**, then reveal the **Signing secret** (`whsec_…`) and feed it to `wrangler secret put STRIPE_WEBHOOK_SECRET` from step 4.

Do this in **test mode first**. Test and live mode have different signing secrets and different endpoints.

### 7. Verify

Stripe's dashboard has a "Send test webhook" button on the endpoint. A correctly-signed `checkout.session.completed` for a session that does not exist should return **200** with a logged permanent-failure warning (not a 500 — a bad session id must not make Stripe retry).

Then confirm the negative case from outside:

```sh
curl -X POST https://<worker-url> -d '{}'
```

Must return **400**. An unsigned request has to fail closed.

Watch it live with:

```sh
npx wrangler tail
```

## Job states

| State | Meaning |
|---|---|
| `processing_pending` | Row written, gate not yet evaluated. Transient — a row here means the gate or the enqueue died mid-flight. **Self-healing:** a Stripe redelivery finding this state re-drives the enqueue rather than acking it as a duplicate (see "Stranded-order recovery" below). |
| `manual_hold` | §1.4 gate failed. `gate_reason` says why. **Never enqueued, never generated.** |
| `queued` | Gate passed, message is on the queue. |
| `processing` | Consumer picked it up. |
| `delivered` | Report sent. **Not reachable yet** — Piece 5. |
| `quarantined` | Exhausted queue retries and landed in the DLQ. **Not delivered. Needs a human.** |

Useful queries:

```sh
npx wrangler d1 execute roc-fulfillment --remote --command \
  "SELECT state, COUNT(*) FROM jobs GROUP BY state"

npx wrangler d1 execute roc-fulfillment --remote --command \
  "SELECT payment_intent_id, gate_reason, created_at FROM jobs WHERE state = 'manual_hold'"
```

## Stranded-order recovery

Idempotency is `INSERT ... ON CONFLICT(payment_intent_id) DO NOTHING`, which makes a duplicate Stripe delivery a no-op at the database with no SELECT-then-INSERT race.

That alone is not sufficient, because `ON CONFLICT` protects the **insert**, not the **enqueue**. Without the resume branch this sequence loses a paid order outright:

1. Delivery #1 inserts the row, passes the gate, then `JOB_QUEUE.send()` throws — we return 500.
2. Stripe redelivers. The insert conflicts, so a naive handler sees "duplicate" and acks.
3. The row sits in `processing_pending` forever: no queue message, no DLQ entry, no alert, and the 3-business-day clock still running.

So a redelivery that finds the row in **`processing_pending`** — and only that state — falls through to the gate and enqueue instead of acking. Every other state is a genuine duplicate and returns 200 without enqueueing.

A double enqueue is possible if delivery #1's send actually succeeded and only the state stamp failed. That is bounded, not unbounded: the send step in Piece 5 must be idempotent against the delivery record keyed by PaymentIntent id (spec §2.1), so a duplicate job re-runs research and stops at the send. One wasted pipeline run beats one undelivered paid order.

## Tests

```sh
npm test
```

Runs `node --test src/*.test.js`. No network and no `wrangler dev` — `globalThis.fetch` is stubbed and D1/Queues are in-memory fakes, so the suite is a plain unit run.

Covers signature verification against signatures generated independently by `node:crypto` (a self-signed fixture would pass even if the HMAC construction were wrong), the §1.4 gate, the both-objects read, and the full duplicate/resume matrix including an end-to-end stranded-order recovery over one shared database.

## Known gaps, carried from the spec

- **Alerting does not exist.** A quarantined job logs loudly and nothing else. Spec §7.5 — the holding state is still UNDESIGNED, and a silently-held job becomes a missed deadline with nobody notified. This is a launch blocker, not a build blocker.
- **The delivery clock keeps running during a hold** (spec §3.2). `report_due_at` is fixed at confirmation and nothing here recomputes it.
- **The consumer acks immediately.** That is correct only while it is a stub. When Piece 3 lands, the ack must move to after the pipeline completes, or the crash-proofing in spec §2.1 is lost.
- **§1.2 launch gate is unrelated to this directory but blocks switching anything on:** the live site still promises a human reads every report.
