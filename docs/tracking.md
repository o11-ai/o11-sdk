# Tracking SDK

Install @o11/tracking@0.1.3 in the customer's JavaScript/TypeScript server application. The package exports createTrackingClient. No o11 GitHub connection is needed. Prefer existing PostHog events or read-only database records when they already prove the behavior.

Use signals_tracking_register with a stable source ID, name and manifest. A manifest has version: 1 and events with name, description and fields. Each field has name, type (string, number or boolean) and required. Discover the exact schema through the tool catalog. Updates require expectedUpdatedAt from status. Registration preserves omitted events and rejects field removal, type/required changes or new required fields on an existing event. Add optional fields or use a new event name for a breaking change.

Use signals_tracking_createKey with the source ID when authorized for o11:credentials. Store the returned token in the application's server secret store. This write-only source key is separate from agent OAuth credentials. Never embed it in frontend code or paste it into the routine prompt. Revoke with signals_tracking_revokeKey.

```ts
import { createTrackingClient } from '@o11/tracking';
const tracking = createTrackingClient({
  endpoint: 'https://YOUR_O11_API/api/tracking/events',
  key: process.env.O11_TRACKING_KEY!,
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

Read signals_tracking_status with includeDisabled=true to inspect and re-enable a disabled source through register using its current updatedAt. After deployment, signals_tracking_status shows missing events and server-observed receipts. An HTTP 202 means accepted into the queue, not yet verified in storage. A locally generated test event does not prove production deployment. SDK tracking validates incoming events and does not itself activate any routine.
