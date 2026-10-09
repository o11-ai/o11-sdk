# Session recordings with o11 and PostHog

PostHog and o11 recordings coexist. Native capture uses the pinned `@rrweb/record` 2.1.6 recorder and the existing player/analysis stack. Choose the recording source in Monitoring. Raw uploads remain available alongside normalized replay artifacts.

New business events use server-only o11 tracking. Add recording when the routine needs replay or the user requests it, and reuse the application's capture lifecycle across routines. Preserve existing PostHog analytics, recording settings, routines and historical recordings. Do not disable PostHog recording as an incidental setup action.

## Choose one recorder

| Application setup | Recording choice |
| --- | --- |
| No PostHog | Native o11 replay. |
| PostHog analytics without replay | Keep analytics and use native o11 replay. |
| PostHog replay enabled | Share its recording with o11, with one recorder. |
| PostHog replay disabled, sampled out or blocked | Respect that state; independent recording needs an explicit choice and consent. |

Native and shared recordings use the same authenticated o11 upload and reporting pipeline. The shared client never changes PostHog configuration, payloads, uploads, consent, sampling or recording lifecycle. Unsupported formats stop only o11 sharing; no automatic native fallback.

## PostHog sharing

<img src="https://docs.o11.ai/integrations/posthog.svg" alt="PostHog" width="88" height="48" />

Provide the actual instance: `createReplayClient({ endpoint, session, consent, posthog })`. Authenticate and authorize the session exactly as for native capture below. Start o11 independently at the existing application initialization boundary, without changing PostHog's init arguments or making PostHog wait for o11 authentication. The listener queues a bounded copy while o11 authentication finishes. A late listener reports `waiting-for-replay` until a full snapshot arrives. SDK dependency presence does not prove replay is active. For analytics-only PostHog, omit the option and use native capture.

The public `eventCaptured` subscription copies only `$snapshot` batches. No PostHog OAuth, private API, network interception or second recorder. Every callback operation is isolated; copying errors must never interrupt PostHog uploads. Stop, reset and consent withdrawal unsubscribe only o11. Withdrawal uses the existing authenticated deletion endpoint; retry unconfirmed deletion.

Compatibility follows the recording format, not an SDK version allowlist. **1.297.4**, **1.335.2**, **1.438.1** and **1.438.3** have real Chromium capture, archive and dashboard playback coverage; other versions work with the same supported rrweb shapes. Both plain rrweb and compression marker `2024-10` are accepted. Preserve the actual SDK version for diagnostics. If the data format changes, isolate the o11 sharing failure, investigate the installed source and update the decoder with regression tests. Continue independent setup work; never downgrade or reconfigure PostHog to match a test version. Stop/start retries after correcting conversion. Disabled or sampled-out PostHog replay is not silently bypassed.

The shared copy preserves PostHog's recorded public text, DOM attributes, inline and inlined stylesheets, stylesheet rules/declarations, adopted stylesheets, fonts, asset URLs, pointer movement, scrolling, selections and media state. PostHog owns DOM text and attribute privacy: configure its masking/blocking for sensitive rendered text, attributes, hidden fields and images before recording. o11 additionally masks form values and input updates, excludes `data-o11-block` subtrees, strips executable DOM attributes, and omits custom/plugin, console/network and unsafe canvas commands. It never unmasks content PostHog has already masked. Asset query strings are retained because signed URLs and versioned assets need them; page URL credentials/query strings are removed. Canvas pixels, cross-origin iframe content and assets PostHog never captured cannot be reconstructed. `blockSelector` and `approvedTextSelector` are native-only and rejected with `posthog`. PostHog's own payload and lifecycle remain unchanged. Older o11 copies that discarded CSS/text require a fresh recording; their missing bytes cannot be recovered from the archived o11 copy.

Bounded queues and decompression protect the page. Batch UUIDs deduplicate recent captures; source SDK/session/window IDs persist in redacted original chunks. The manifest records actual recorder versions and capture method. Browser IDs never establish authenticated customer identity. Use the verified o11 recording ID for event correlation. o11 token rotation waits for the next full snapshot; missing coverage remains explicit.

Server-only o11 business events remain separate and must follow committed operations. Both capture paths normalize to `rrweb-jsonl-v1` for existing reports. Sharing reduces recorder work but still adds copying, uploading and storage. Publish the SDK and deploy the matching ingestion before using this option in production; verify received evidence and playback rather than claiming readiness from local tests.

## Install

1. In Integrations → o11 SDK → your application → Recordings, save exact application origins, sample percentage and retention for the application/environment. New recording setup defaults to enabled, with 10% sampling and 30 days retention. Capture starts only after settings are saved, recording storage is available and browser consent is granted. Existing saved settings, including disabled recording, are preserved.
2. Keep the application tracking key on your server. Add an authenticated, same-origin application endpoint that derives the customer ID from the authenticated session and verifies the requesting origin. Rate-limit that application endpoint; never accept an arbitrary customer ID from the browser.
3. Return the result of `tracking.replaySession` from that endpoint. The returned bearer token grants only capture for that recording, environment and origin, for 30 minutes. It cannot submit business events, edit profiles or grant contact permission.
4. Load the browser entry after consent. The rrweb bundle loads only for selected sessions.

Server example (inside your existing authenticated endpoint):

```ts
import { createTrackingClient } from '@o11/tracking';
const tracking = createTrackingClient({
  endpoint: 'https://YOUR-O11-BACKEND/api/tracking/events',
  key: serverSecret,
  environment: 'test', // Use a separate production key in production.
});
// authenticatedCustomerId comes from server authentication, not request JSON.
const session = await tracking.replaySession({
  customerId: authenticatedCustomerId,
  origin: verifiedApplicationOrigin,
});
// Return session with Cache-Control: no-store. Do not log its token.
```

Browser example:

```ts
import { createReplayClient } from '@o11/tracking/replay';
const replay = createReplayClient({
  endpoint: 'https://YOUR-O11-BACKEND/api/replay',
  consent: () => consentStore.sessionRecordingAllowed,
  session: async () => {
    const response = await fetch('/YOUR-AUTHENTICATED-REPLAY-ENDPOINT', {
      method: 'POST', credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('Recording session unavailable');
    return response.json();
  },
  blockSelector: '[data-sensitive-region]',
  // Optional: allow only reviewed static labels, never arbitrary customer content.
  approvedTextSelector: '[data-approved-static-label]',
  onStatus: status => { /* Optional diagnostics without payloads/tokens. */ },
  onError: error => { /* Optional capture/conversion error; never log payloads/tokens. */ },
});
await replay.start();
// On a normal session end:
await replay.stop();
// On identity/logout changes, stop the old capture before starting another:
await replay.reset();
```

Forward the recording ID from the authenticated session response to your server if you want to link business events. Set `tracking.track({ ..., sessionId: recordingId })` only after the server verifies that this recording belongs to its authenticated customer/application. Existing event IDs, receipts, durable outbox and coverage attestations are unchanged. Browser observations do not prove committed business outcomes.

## Privacy and lifecycle

All inputs and page text are masked by default. Canvas, media and iframes are blocked; console and request/response bodies are not collected. Extra block selectors augment the defaults. `approvedTextSelector` permits explicitly reviewed text; inputs/contenteditable stay masked. Arbitrary attributes are removed; native CSS selectors dependent on IDs or custom data attributes therefore need class-based structural styling. SVG geometry and paint attributes are retained. URLs lose credentials, queries and fragments; URL paths, class names, permitted structural attributes and reviewed static text can remain identifiable. Mark sensitive areas `data-o11-block`.

On consent withdrawal, call `await replay.revokeConsent()` immediately. It stops collection, clears pending events and requests deletion of the current/latest recording. Check `{ deleted, retryable }` and retry an unconfirmed request; an offline browser cannot guarantee server deletion. Retryable cancellation stays pending across stop/reset/start and is retried before a new capture. Terminal denial (for example an expired token) requires the authenticated server privacy workflow; local capture remains stopped until the application starts again after consent. Persist older recording IDs in the application's server privacy workflow and use the scoped admin deletion API when needed. `reset()` changes recorder identity; it is not a deletion request. Customer deletion/merge denies access immediately and is picked up for storage purge by recovery work.

There is no browser disk spool. Bounded in-memory retries avoid persisting sensitive DOM in localStorage/IndexedDB. Page hide attempts a bounded keepalive upload; navigation/crash/offline loss remains explicit. BFCache restoration retains its recorder/mirror. Before token expiry, healthy capture finalizes and requests a new authenticated recording through the session callback. Long visits therefore span multiple recording IDs; use replay.recordingId for the current ID. If final upload cannot drain, capture pauses rather than abandoning queued bytes; retry start() after connectivity improves. Capture stops on a structural-event or buffer limit; it does not drop mutations and continue a falsely complete replay. Watch `paused`/`failed`, stop, then start a fresh recording after connectivity or blocking the oversized region improves.

## Performance and transport

- Server-only tracking imports never bundle rrweb. The browser bootstrap dynamically imports the recorder after consent/sampling.
- No pointer-move stream; scroll sampled at 150ms; input capture sampled at its last update; periodic full snapshot every five minutes.
- Flush every five seconds, incremental chunks ≤256KB and events ≤240KB; full snapshots up to 1MB are uploaded whole in a dedicated chunk, in-memory buffer ≤2MB. Limits apply to UTF-8 payload bytes.
- Gzip uploads above 8KB where CompressionStream is available. Receiver bounds compressed and expanded bodies independently at 1.024MB.
- Server time anchors and monotonic browser time avoid device-clock jumps affecting event order/token rotation. Stable recording/window/segment/sequence IDs; identical retries accepted, conflicting bytes rejected. Backoff honors rate limits. Source/workspace quotas are shared with tracking.
- Backend cap: 1,000 chunks / 64MB each of original and normalized bytes per recording. Upload acceptance follows durable blob writes and receipt commit. Failed queue publication is repaired from durable revisions.
- Queue messages contain references, never recording payloads. Existing Cloudflare tracking queue and archive R2 bucket are reused; local work uses the filesystem archive.

## Storage / operations

Three scoped PostgreSQL tables hold installations, recording lifecycle and chunk receipts; a storage-retention ledger survives organization deletion until its recording prefix is purged. Replay blobs use the existing R2 archive prefix; ClickHouse is not required. Native uploads retain original JSON plus `rrweb-jsonl-v1` `[window:segment,event]` lines. Both providers expose ArchiveManifest v1 and use the existing decoder/player/analysis pipeline. PostHog originals retain their provider format; we do not alter historical bytes.

Revision manifests are immutable. Replay completeness requires durable contiguous chunks, an initial full snapshot, and the declared finish inventory. Interrupted/missing evidence is exposed. Server event exports retain the common columns/results envelope but never assert complete delivery or absence coverage merely because replay finished. Event exports are bounded to 10,000 currently observed linked events per revision; authoritative event history remains in the existing tracking store.

Recovery uses the existing scheduled tracking worker (and local signals loop). Idle captures close interrupted after ten minutes without chunks, or token expiry. Dirty revisions retry, expired/deleted/merged customer recordings purge their full recording prefix in bounded pages, including originals/manifests/reports/indexes. A follow-up purge catches bounded in-flight report writes; the independent storage ledger also cleans up after organization deletion. Tombstones block late uploads and access before physical purge completes. Operators can retry the deletion API or scheduled work after storage failure; inspect `error_code`, `next_attempt_at`, capture/processed revisions.

Changing retention applies to new recordings. Disabling an installation stops new uploads; it does not delete historical recordings. Re-enabling capture reconnects a paused/disconnected native source; application keys retain their own expiry/revocation checks. Native and PostHog capture are independently controlled; this SDK does not start/stop a customer's PostHog SDK. Explicit independent native capture alongside PostHog creates two recording streams; sharing avoids the second recorder.

## Rollout verification

Apply the TypeScript schema using the approved `bun db:push` workflow on an authorized database; no generated migrations. Existing queue/bucket bindings must be available and scheduled tracking recovery enabled. The recorder/player versions must stay aligned; upgrade with decoder, masking and replay regression checks.

Before production enablement, verify authenticated session creation, tenant/environment/origin rejection, ambiguous retry, partial blob failure, deletion racing an upload, cron recovery, retention, real browser SPA/navigation/BFCache, offline/unload loss and representative complex DOM performance. Exercise Chromium, Firefox and Safari on target devices. Current local coverage includes real Chromium native/PostHog capture, isolated PostgreSQL ingestion and archive checks, and rendered dashboard replays across the four listed PostHog versions. Protocol/lifecycle checks cover malformed data, bounded compression, privacy, retries, deletion and concurrent start/stop/reset. Shadow DOM recordings use direct DOM seeking to avoid rrweb 2.1.6 virtual-seek mirror loss; ordinary recordings retain virtual DOM optimization. Safari, Firefox, PostHog cloud uploads and production infrastructure remain separate rollout checks. Canvas/media/cross-origin iframe replay and console/network telemetry are deliberately outside this recorder's support surface.
