# Tracking SDK

Install @o11/tracking@0.2.1 in the customer's JavaScript/TypeScript server application. The package exports createTrackingClient. No o11 GitHub connection is needed. Prefer existing PostHog events or read-only database records when they already prove the behavior.

Use signals_tracking_register with a stable source ID, name and manifest. A manifest has version: 1 and events with name, description and fields. Each field has name, type (string, number or boolean) and required. Discover the exact schema through the tool catalog. Updates require expectedUpdatedAt from status. Registration preserves omitted events and rejects field removal, type/required changes or new required fields on an existing event. Add optional fields or use a new event name for a breaking change.

Create or reuse a source through Integrations → Application tracking or signals_tracking_createSource; copy its setup prompt into your coding agent. Read the repository AGENTS.md and current SDK/API docs before editing, complete authorized checks, then request required production/deployment approval. Use signals_tracking_createKey with projectId, environment (test or production), name, expiresInDays and profiles when authorized for o11:credentials. Development and production keys are separate; choose only the needed scopes. Up to two active keys per source/environment allow rotation: verify replacement receipts, drain deliveries, then revoke the old key. Store the returned token in the application's server secret store. This write-only source key is separate from agent OAuth credentials. Never embed it in frontend code or paste it into the routine prompt. Revoke with signals_tracking_revokeKey.

```ts
import { createTrackingClient } from '@o11/tracking';
const tracking = createTrackingClient({
  endpoint: 'https://YOUR_O11_API/api/tracking/events',
  key: process.env.O11_TRACKING_KEY!,
  environment: 'test', // production server uses its own key and environment
});
// After a real report creation commits; reuse this ID for retries.
const receipt = await tracking.track({
  eventId: 'report.created:' + report.id,
  name: 'report.created',
  customerId: report.customerId,
  occurredAt: report.createdAt.toISOString(),
  properties: { reportId: report.id },
});
```

Use stable application customer IDs. Identity is scoped to each source: using the same ID in PostHog and the SDK does not automatically join accounts. Resolve actual identities with signals_identities_find, verify the shared signed-in account, then explicitly link through signals_identities_link. Include sessionId only for a genuine analytics session; an authentication session is not an analytics session. Include the same report/order ID on every related event so correlationProperty can keep items separate. Track successful outcomes after database commit. For durable delivery, enqueue into the application's existing transactional outbox and retry the same eventId when retryable is true. The SDK uses bounded retries; in-memory retries cannot guarantee delivery after process exit. Await delivery or use the runtime's supported background task lifetime. Do not delay or fail the user's business operation because analytics delivery failed.

Only declared scalar properties are accepted, with at most 20 fields and 2,000 characters per text field. Conversation checks need explicitly approved, limited message text plus fields identifying the author and item; do not upload entire transcripts, documents, credentials or DOM content. Server SDKs cannot securely capture arbitrary browser clicks themselves. Continue using PostHog for browser navigation and replay; native/client integrations need an authenticated server endpoint that derives the customer ID from the signed-in account.

Use tracking.identify with a UUID operationId and monotonically increasing updatedAt to synchronize full source-owned contacts/permissions snapshots. Contacts require real verifiedAt and verification evidence before automated outreach. Permissions require channel, purpose, status, changedAt and evidence; never infer consent from analytics. Omitted contacts retire and omitted source-owned permissions block; operator/other-source blocks survive. Phones require E.164; emails normalize. Deletion uses deleted:true and empty contacts/permissions. Never silently restore deleted identities.

Poll tracking.receipt(receiptId) for processed/rejected status and code. Retry durable transport failures with the same content and occurrence ID. Reconcile rejected prerequisites before explicit resubmission; changed content conflicts. Queued payloads erase after processing and queued work expires after 24 hours with an inspectable rejection for reconciliation and receipt metadata expires after 30 days. Rate limits are 600 requests/min/source and 6,000/min/workspace, including polling; respect retryAfterMs.

Absence requires tracking.coverage with operationId, startedAt and through after every outbox item through that time has a successful processed receipt. Continue contiguous coverage; never attest an interval with dropped or unresolved events. Coverage gaps remain unconfirmed and can be reconciled by replaying/draining the gap and reporting an overlapping interval. Manifest evidence is server or client; browser observations forwarded by a server remain client evidence. For consequential rules set requireServerEvidence:true and instrument real committed backend outcomes.

Read signals_tracking_status with includeDisabled=true to inspect per-environment readiness, sanitized key metadata and recent receipts. Pause/resume through signals_tracking_disable/signals_tracking_resume using the current updatedAt. After deployment, signals_tracking_status shows missing events and server-observed receipts. An HTTP 202 means accepted into the queue, not yet verified in storage. A locally generated test event does not prove production deployment. SDK tracking validates incoming events and does not itself activate any routine.
