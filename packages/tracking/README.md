# o11 tracking

Dependency-free **server-only** JavaScript/TypeScript SDK. Reuse connected PostHog or read-only database evidence first; instrument missing business events.

Create an application source in **Integrations → Application tracking**, copy its setup prompt into your coding agent, and register actual event schemas. Create a named key for **Local development**, select contact sync only when needed, and store the one-time secret in server configuration. Production uses a separate key and server secret. Neither key belongs in a browser bundle, public environment variable, prompt, log or source control.

```ts
import { createTrackingClient } from '@o11/tracking';
const tracking = createTrackingClient({
  endpoint: 'https://api-v2.o11.ai/api/tracking/events',
  key: process.env.O11_TRACKING_KEY!,
  environment: 'test', // use 'production' only for the deployed production server
});
const delivery = await tracking.track({
  eventId: 'report.created:' + report.id,
  name: 'report.created', customerId: report.customerId,
  occurredAt: report.createdAt.toISOString(), properties: { reportId: report.id },
});
if (delivery.receiptId) await tracking.receipt(delivery.receiptId);
```

`track` sends business activity after a successful commit. Preserve its event ID across retries. `identify` synchronizes a full source-owned customer profile snapshot: stable customer ID, UUID operation ID, monotonically increasing `updatedAt`, contacts, verification timestamps/evidence, and recorded channel/purpose permissions with evidence. Omitted source-owned contacts retire; omitted source-owned permissions block. Profile snapshots never erase an operator/other-source block. Email addresses normalize; phones require international E.164. An analytics ID or email property alone grants no outreach permission. Deleted profiles use `deleted: true` with empty contacts/permissions; restoring a deleted identity requires operator reconciliation. Cross-source matching requires explicit verified identity links.

`coverage` records a continuous interval with UUID operation ID, `startedAt` and `through`. Only report it after **all** application outbox work through that time has completed with processed receipts. Absence rules wait for coverage and delivery grace. A rejected gap can be reconciled by draining the gap and submitting an interval overlapping the last confirmed watermark. Do not use the newest observed event as proof of completeness.

HTTP 202 and `accepted: true` mean queued. Poll `receipt` for `processed` or `rejected`; inspect its code. `eligible` events can wake activated production routines; `late` and `future` events do not. Development evidence never starts outreach. The SDK has bounded retries/timeouts, returns long `Retry-After` holds, and does not survive process termination. Use your application's transactional outbox; await delivery or the runtime's background-task lifecycle. Retry transport failures when `retryable` is true, keeping identical occurrence content. Correct rejected prerequisites, then explicitly resubmit the same occurrence; changing content under the same ID is a conflict. Queued work expires after 24 hours into a rejected receipt for reconciliation; receipt metadata expires after 30 days.

Rotate keys with at most two active keys per source/environment. Install the replacement, confirm receipts using it, drain pending deliveries, then revoke the old key. Inspect key expiry, last use and recent results in Integrations. Pause a source to stop ingestion/detection; resume after reconciling it.

The browser export refuses credential use. HTTPS is required except loopback, redirects are refused, payloads are bounded to 32 KB, and event properties are declared scalars (20 fields, 2,000 characters per string). Default environment is production for existing server installations; development/test runtimes require explicit `environment: 'test'`. Keys have source/environment scopes, optional profile permission, hash-only storage and expiry. API limits: 600 authenticated requests/minute/source and 6,000/minute/workspace, including receipt polling.

For browser activity, use PostHog or an authenticated application backend that derives the signed-in customer ID. Label forwarded client observations `evidence: 'client'` in the event manifest. Select **Require confirmed business activity** for rules requiring server facts. Do not label browser claims as server-confirmed business outcomes.

Read versioned docs with `o11 docs tracking` or `/api/agent-docs/tracking`. Replay/autocapture, SMS, arbitrary SQL/account joins and implicit identity/permission merging are not provided by this SDK.
