# o11 tracking

Small, dependency-free **server-only** JavaScript/TypeScript SDK. Connect PostHog or a read-only database first; instrument only missing business events.

```ts
import { createTrackingClient } from '@o11/tracking';
const tracking = createTrackingClient({ endpoint: 'https://YOUR_API/api/tracking/events', key: process.env.O11_TRACKING_KEY! });
const receipt = await tracking.track({ eventId: 'report.created:' + report.id, name: 'report.created', customerId: report.customerId, occurredAt: report.createdAt.toISOString(), properties: { reportId: report.id } });
```

Register the event manifest using the o11 CLI/MCP before sending. Keep the source-scoped key in server secrets. Send after successful commit; preserve eventId across retries. Await the result or use your runtime's background-task lifecycle. `accepted` means the API accepted the event; verify persisted receipts in o11. Use an existing transactional outbox for durable delivery and retry only when `retryable` is true. SDK retries are bounded and do not survive process termination.

Read the matching version's tracking guide through `o11 docs tracking` or the server's `/api/agent-docs/tracking`. No replay, autocapture or browser secrets are included.
