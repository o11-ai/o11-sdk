# How signals run

The user's original request remains saved. Dashboard validation uses Gemini with Mastra discovery tools to produce a supported definition. Your coding agent and the sidebar edit that definition directly through the same tools. Neither asks a second agent to configure it. Call signals_check, then engagement_routines_validate, publish, and explicitly activate the published version. Publishing alone does not run anything.

Ongoing routines use o11 events and native o11 replay. PostHog is a bounded getting-started preview for active unpaid trials with no past paid usage. Imported evidence cannot activate live routines.

## Recorded actions

New SDK receipts and synced PostHog events wake only routines subscribed to those event names. Checks read the selected user's relevant events after activation, within the configured window. Simple rules use zero model calls. A sequence requires increasing event times, allows unrelated actions between steps, and never reuses one event for two actions. Equal timestamps cannot prove order.

- “Pricing → Export → Home in one session”: kind events, scope session, operator sequence, three filtered steps.
- “Created a report on Monday, exported it in a different session by Sunday”: scope customer, windowSeconds 604800. Session IDs may differ; customer identity must be verified.
- “Created a report on web, exported that report twice on desktop”: each step selects its source; the export step has minimumOccurrences 2; correlationProperty is the shared report ID. Explicitly link the web and desktop identities first.
- “Opened Excel, then left after at least two minutes”: scope session, operator sequence, observed opening and departure events, minimumElapsedSeconds 120. windowSeconds remains the upper bound; it cannot express the minimum by itself. Use received o11 events and discovered Excel filters for new setup. A page leave proves departure from the add-in page, not closure of the desktop Excel process.
- “Created three different reports”: one counted event with minimumOccurrences 3 and distinctProperty set to the report ID. Repeated delivery of an event never increases counts.
- “Pricing → Export → Home three times”: three ordered steps and repetitions 3, with minimumOccurrences 1. Two cycles cannot match. All expanded per-step counts must fit 100 required records. Counts on individual conditions do not count complete workflows.

Use signals_identities_find to resolve native IDs, signals_identities_group to inspect them, and signals_identities_link only after the application verifies that they are the same person. Names, email similarity and matching external IDs alone are insufficient. Links preserve source records and do not copy contact addresses or permission. signals_identities_unlink reverses a mistaken link. Pending matches are invalidated when their identity group changes.

## First recorded session

Use an events definition with scope session and firstSession.filters selecting the application, for example app equals excel. Count five unique chat_message_sent events in that session with minimumOccurrences 5. The history condition considers all matching application activity, including visits with zero messages, rather than only the selected action events. It excludes later sessions even when the first visit falls before activation or the preview window. Discover actual field values before configuring them.

Use signals_previewEvents through o11 MCP/CLI to inspect candidates and firstSessionHistory. o11 queries its connected source internally; the coding agent needs no separate provider connection. Native previews inspect the source's retained history. Automatic checks require a complete imported source backfill through the candidate's activity. Missing session IDs, tied earliest sessions, incomplete imports and partial history remain unconfirmed. This proves first activity in retained recorded history; it cannot establish activity that was erased or never captured. The live validator must support firstSession before saving the rule as complete.

First-session monitoring enrolls each verified customer group once per routine. More actions, linked identities, source reconnections, a new release and an expired cooldown do not create another enrollment. Recover a failed review through its existing run. A historical preview does not enroll earlier customers or activate monitoring.

## Missing actions

“Created report R but did not export R within a day”: an events definition with correlationProperty, a positive creation step, and absence containing the export step, seconds 86400 and graceSeconds 3600. The window must include both deadline and grace. The check schedules a durable recheck; an export within the deadline cancels the match. PostHog imports must cover the whole interval before absence can be confirmed. SDK delivery relies on the customer's reliable outbox and configured grace: we cannot prove an action did not happen if the customer failed to record or deliver it.

## Text and replay

“Asked for help exporting”: semantic with evidence ai_conversations, an actual message event, textProperty, a bounded window, and filters such as role=user. “Tried exporting three times, then asked for help with that report”: exact counted events plus text and a shared correlationProperty. Set text.timing to after_actions for “then asked”; within_window permits messages anywhere inside the selected interval. Text is checked only when the action conditions qualify, or a new selected message arrives for an existing candidate.

OpenAI Decisions screens timestamped evidence. A separate model confirms candidates and must cite real evidence IDs. When a pattern spans several passages, it checks the entire bounded window even if no single passage proves the full pattern. Empty, incomplete, malformed or uncertain results cannot enroll outreach. Identical evidence and definitions reuse saved checks. Text windows are limited to 31 days, 1,000 selected records and 512,000 bytes for one complete text check; narrow the definition rather than silently dropping text. These are recorded message events, not automatic database transcript scans. Add explicitly permitted SDK events when the application's source lacks them.

For behavior visible only in a recording, use semantic, evidence replay and scope session. Native o11 session monitoring uses received recordings and reconstructs click/navigation/state evidence, screens it with OpenAI Decisions, then asks a separate verifier to confirm cited moments. Progress is saved between model calls. A screenshot or masked content cannot prove an unseen action. Week-long behavior uses exact events and linked identities; replay interpretation does not join separate recordings into one unrestricted model prompt.

## Accounts, items and large originals

Use account scope only with explicit SDK accountId; use subject scope with subject {kind,id}. Related records use references {kind,id,relation}. Use one application source for shared account and item rules; separate services can use that source with verified shared IDs. No names, emails or inferred accounts create a relationship. Per-step semantic checks classify the entire registered text or JSON value. Add semantic.contextProperties for other explicitly required fields on that record, such as the source order and the reviewed invoice. The SDK stores each large field separately and reuses identical originals; the check reads only selected context. References alone do not supply another record’s content. Capture the approved necessary fields, or use record reads to inspect related records before configuring the rule. Checks classify these selected values before exact code counts or orders those records. Repeated workflows use repetitions. Account and item records may have no person; they save a detection but never invent a contact recipient. A live person’s completing activity can select that person, subject to existing verification and permission checks.

Small searchable fields stay in PostgreSQL. Larger original JSON or text values upload once in numbered, compressed parts with complete size and checksum verification before the occurrence is accepted. Retries resume confirmed parts. The original remains available through paged record reads. Checks save a short reason and original-content references; they do not copy the entire original back into PostgreSQL. Use evaluationId on readContent to read the original used by a saved check after a correction. A check exceeding its bounded work allowance remains incomplete; it never drops original text or turns missing context into a negative. Narrow the subject or time window when the work limit is reached. Exact checks can read stored originals within a 2 MiB work window; keep common status, item and result fields small so most rules need no content reads. Grouping and distinct counts require scalar IDs. Edits use a higher version of the same occurrence; later messages and corrections invalidate pending findings before delivery.

Database inactivity signals are unavailable. Capture actual operations and attest delivered coverage before confirming missing activity.

## Delivery and recovery

A confirmed match and its queued enrollment save in one transaction. Before enrollment and again before delivery, the worker checks the active release, version, identity group, source access, consent, sender, ownership and stopping conditions. Existing contact cooldowns still apply even when different routines match. Duplicate event receipts, queue retries and repeated model checks do not send duplicate messages. Temporary ownership or timing holds wait for retry; uncertain provider delivery requires reconciliation before another send.

Routine cooldowns are limited to 365 days. They cannot express a general lifetime once-per-customer rule outside a first-session condition; report that requirement explicitly rather than substituting a cooldown.

Production work uses Cloudflare Queues and durable PostgreSQL outbox records. Expired worker leases and lost signal queue messages recover; failures remain retryable. Local Bun uses the same handlers. API readiness reports missing workers/connections; repository changes are not evidence of production deployment.
