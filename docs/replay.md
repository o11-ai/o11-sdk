# Session replay with o11 and PostHog

Business events use the server entry @o11/tracking. Native recordings use the separate browser entry @o11/tracking/replay. Server event imports do not bundle the recorder. Reuse application tracking across routines; do not install another SDK or recorder for each prompt.

## Choose one recorder

Inspect the routine's evidence needs, existing SDK initialization, recording settings and received o11 evidence before changing application code. An installed PostHog dependency does not prove recording is enabled. Accept the actual initialized PostHog instance; it may be imported as a module rather than exposed on window.

| Application setup | Recording choice |
| --- | --- |
| No PostHog | Native o11 recording after consent and sampling. |
| PostHog analytics without replay | Keep its analytics and use native o11 replay. |
| PostHog replay enabled | Share its recording with o11 instead of starting another recorder. |
| Recording disabled, sampled out or blocked | Keep that condition explicit; do not silently start an independent recorder. |

Native and PostHog-shared replay use the same authenticated o11 upload, storage, playback and reporting pipeline. Sharing is additive: Never disable or reconfigure a customer's PostHog recording as an incidental routine setup action. Do not call its init, set_config, startSessionRecording, stopSessionRecording, capture or flush methods from the o11 adapter. Preserve its consent, sampling, payloads, uploads, analytics, existing routines and historical evidence.

Include replay in new SDK setup by default when the application has a browser client. Reuse an existing recorder and preserve an explicitly disabled recording setting. An event-only routine does not require an additional recorder. Consent, allowed origins, sampling and retention still require the application's approved settings.

## Authenticated o11 setup

Inspect signals_tracking_status and engagement_replay_readiness, including the selected application/environment and received evidence. Recording settings (allowed origins, sampling and retention) are inspected by the human in Application tracking. Recording settings require human review in Application tracking; prepare authorized code and give the exact remaining setting when human approval is needed. Source registration or an SDK installation alone does not prove recording readiness.

Create a same-origin authenticated application endpoint that derives customerId from the signed-in account and verifies the requesting origin. Rate-limit it. Call `tracking.replaySession({ customerId, origin })` on the server and return its result with Cache-Control: no-store. Keep the application tracking key in the server secret store. Never accept an arbitrary browser customerId or return the server key. The resulting token is limited to one recording, environment and origin for 30 minutes.

Import createReplayClient from @o11/tracking/replay. Provide endpoint ending in /api/replay, a consent callback and a session callback that fetches the authenticated endpoint with same-origin credentials. Start after consent; stop on normal session end; reset on identity changes. Call revokeConsent immediately on withdrawal and retry unconfirmed deletion. Reset is not deletion. New recording setup defaults to enabled, with 10% sampling and 30-day retention. Capture requires saved allowed origins, recording storage and browser consent. Preserve existing saved settings, including an explicit disabled choice.

Inputs and text are masked by default. Canvas, media and iframes are blocked; console and network bodies are not collected. Add blockSelector for sensitive regions. approvedTextSelector permits only explicitly reviewed static text, never arbitrary customer content. Preserve consent, masking, origin restrictions and sampling.

Link event sessionId to the o11 recordingId only after the server verifies that the recording belongs to its authenticated customer and application. Long visits rotate recordings before token expiry, so use the current recording ID. Browser observations do not prove committed server operations. Missing chunks, dropped navigation uploads and masked content remain explicit evidence limits.

Use one o11 client per application capture lifecycle, lazy-load after consent/sampling and reuse existing server handlers and durable event delivery. Confirm received uploads, playback and verified customer/session links before reporting readiness. Installation or a local test alone does not prove production deployment.

## PostHog sharing

<img src="/integrations/posthog.svg" alt="PostHog" width="88" height="48" style={{ backgroundColor: "white", padding: "8px", borderRadius: "6px" }} />

Pass the actual PostHog instance as the optional `posthog` argument to createReplayClient. The adapter subscribes only to the public eventCaptured callback. It copies $snapshot batches, decodes supported compressed rrweb events and masks the copy in the browser before o11 uploads. It does not forward arbitrary PostHog analytics events. No PostHog OAuth or private API access is required. The authenticated session endpoint, o11 consent, allowed origins, sampling and retention above still apply.

`const replay = createReplayClient({ endpoint, session, consent, posthog });`

Start o11 independently at the application's existing initialization boundary; never make PostHog initialization wait for o11 authentication or uploads. The listener queues a bounded copy while o11 authentication finishes. Preserve PostHog's initialization arguments and existing settings. If attachment is late, status remains waiting-for-replay until PostHog emits its next full snapshot. Do not request a snapshot by restarting or flushing PostHog. A dependency alone does not prove replay is enabled. If the application uses PostHog only for analytics, omit the posthog option and use native capture. Reuse this client for all routines; do not install a recorder on every tracking request.

Compatibility is based on recording data, not an SDK version allowlist. PostHog 1.335.2 and 1.438.1 have real browser regression coverage; other SDK versions use the same adapter when their emitted data matches the supported rrweb shapes. Preserve the actual SDK version for diagnostics. Compression marker 2024-10 and uncompressed rrweb events are accepted. Never refuse routine setup solely because the SDK version differs from the tested versions.

If the emitted format actually changes, isolate the failure to o11 sharing and leave PostHog running. Inspect the installed SDK's source and current docs, extend the copy decoder with focused regression tests, and continue independent event/routine setup. Explain the concrete unresolved recording conversion only if it cannot be fixed within the authorized repository; provide the exact recovery step. Do not change or downgrade the customer's PostHog SDK to match our test versions. Stop/start retries after correcting the conversion. There is no automatic native fallback. Disabled, blocked or sampled-out PostHog capture remains explicit and cannot be made available by the listener.

The o11 copy masks all page and input text, removes arbitrary attributes, blocks data-o11-block regions and media, and excludes stylesheets, canvas, console, network, plugin and custom event payloads. Shared replay omits inline styles and stylesheet updates, so visual fidelity is limited. blockSelector and approvedTextSelector are native-only; passing them with posthog fails explicitly. PostHog's original payload is never redacted or changed. Consent withdrawal deletes the o11 recording and unsubscribes only the o11 listener; it does not change PostHog's consent or recording lifecycle. The application remains responsible for its PostHog privacy policy.

Queues, decompression and retries are bounded. Every listener operation is isolated because exceptions in this callback could interrupt PostHog's own upload. SDK version and source session/window IDs are retained in o11's redacted original chunks; batch UUIDs deduplicate a bounded recent window in the adapter. Authenticated o11 recording identity remains separate. Long visits rotate o11's short-lived credentials and wait for a subsequent PostHog full snapshot; coverage gaps remain explicit.

Native o11 and shared PostHog recordings normalize to rrweb-jsonl-v1 and feed the same reports. The manifest records the actual recorder version and capture method; shared data is never labeled as native rrweb 2.1.6. PostHog upload envelopes differ across SDK versions, which is why the listener observes the public callback rather than intercepting network traffic. Sharing saves a second DOM recorder but still adds copying, upload and storage. Validate received uploads, playback, deletion and authenticated customer/session links in the target environment before claiming deployment readiness. Publish the supporting SDK and deploy ingestion before rolling out setup prompts that require this option.

Business outcomes still use server-only o11 tracking after commit. Browser events remain client observations, even when forwarded through a server. Use explicit event mapping and stable IDs to avoid duplicates. Extra upload/storage remains even with one recorder; keep conversion off the page where policy permits. Server business events remain separate from recording observations.
