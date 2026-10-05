# How signals run

The user's original request remains saved. Dashboard validation uses Gemini with Mastra discovery tools to produce a supported definition. Your coding agent and the sidebar edit that definition directly through the same tools. Neither asks a second agent to configure it. Call signals_check, then engagement_routines_validate, publish, and explicitly activate the published version. Publishing alone does not run anything.

## Recorded actions

New SDK receipts and synced PostHog events wake only routines subscribed to those event names. Checks read the selected user's relevant events after activation, within the configured window. Simple rules use zero model calls. A sequence requires increasing event times, allows unrelated actions between steps, and never reuses one event for two actions. Equal timestamps cannot prove order.

- “Pricing → Export → Home in one session”: kind events, scope session, operator sequence, three filtered steps.
- “Created a report on Monday, exported it in a different session by Sunday”: scope customer, windowSeconds 604800. Session IDs may differ; customer identity must be verified.
- “Created a report on web, exported that report twice on desktop”: each step selects its source; the export step has minimumOccurrences 2; correlationProperty is the shared report ID. Explicitly link the web and desktop identities first.
- “Opened Excel, then left after at least two minutes”: scope session, operator sequence, observed opening and departure events, minimumElapsedSeconds 120. windowSeconds remains the upper bound; it cannot express the minimum by itself. Reuse the existing PostHog events and discovered Excel filters. A page leave proves departure from the add-in page, not closure of the desktop Excel process.
- “Created three different reports”: one counted event with minimumOccurrences 3 and distinctProperty set to the report ID. Repeated delivery of an event never increases counts.
- “Pricing → Export → Home three times”: nine ordered steps with unique IDs, minimumOccurrences 1 and one occurrence per step. Two cycles cannot match. A fixed expansion must fit the 12-step limit; general recurrence counting and larger expansions are unsupported. Counts on individual conditions do not count complete cycles.

Use signals_identities_find to resolve native IDs, signals_identities_group to inspect them, and signals_identities_link only after the application verifies that they are the same person. Names, email similarity and matching external IDs alone are insufficient. Links preserve source records and do not copy contact addresses or permission. signals_identities_unlink reverses a mistaken link. Pending matches are invalidated when their identity group changes.

## Missing actions

“Created report R but did not export R within a day”: an events definition with correlationProperty, a positive creation step, and absence containing the export step, seconds 86400 and graceSeconds 3600. The window must include both deadline and grace. The check schedules a durable recheck; an export within the deadline cancels the match. PostHog imports must cover the whole interval before absence can be confirmed. SDK delivery relies on the customer's reliable outbox and configured grace: we cannot prove an action did not happen if the customer failed to record or deliver it.

## Text and replay

“Asked for help exporting”: semantic with evidence ai_conversations, an actual message event, textProperty, a bounded window, and filters such as role=user. “Tried exporting three times, then asked for help with that report”: exact counted events plus text and a shared correlationProperty. Set text.timing to after_actions for “then asked”; within_window permits messages anywhere inside the selected interval. Text is checked only when the action conditions qualify, or a new selected message arrives for an existing candidate.

Jev screens condensed, timestamped evidence. Gemini confirms flagged candidates and must cite real evidence IDs. When a pattern spans several passages, it checks the entire bounded window even if no single passage proves the full pattern. Empty, incomplete, malformed or uncertain results cannot enroll outreach. Identical evidence and definitions reuse saved checks. Text windows are limited to 31 days, 1,000 messages and 64,000 characters; narrow the definition rather than silently dropping text. These are recorded message events, not automatic database transcript scans. Add explicitly permitted SDK events when the application's source lacks them.

For behavior visible only in a recording, use semantic, evidence replay and scope session. PostHog session monitoring uses the saved, refreshable connector credential and reconstructs click/navigation/state evidence, screens it with Jev, then asks Gemini to confirm cited moments. Progress is saved between model calls. A screenshot or masked content cannot prove an unseen action. Week-long behavior uses exact events and linked identities; replay interpretation does not join separate recordings into one unrestricted model prompt.

## Daily PostgreSQL checks

“Paid users who have not used the app for seven days”: inactivity over a discovered table and customer/timestamp columns, inactiveDays 7, plan=paid filter, and schedule time/timezone. The server compiles a parameterized SELECT grouped by customer using the latest recorded activity. Null activity is excluded. A dedicated SELECT-only login, read-only transactions, timeouts and result limits prevent production writes. There is no arbitrary SQL execution tool.

Checks run at the saved daily time in its timezone. Results use keyset pages of 100 with one fixed check time, rather than loading the whole database or using OFFSET. SQL identifies accounts but never invents consent or joins accounts automatically. A stable unchanged inactivity result does not enroll repeatedly; after new activity, a later inactive period can create new evidence. PostHog warehouse inactivity remains preview-only. General account joins and arbitrary SQL are unsupported.

## Delivery and recovery

A confirmed match and its queued enrollment save in one transaction. Before enrollment and again before delivery, the worker checks the active release, version, identity group, source access, consent, sender, ownership and stopping conditions. Existing contact cooldowns still apply even when different routines match. Duplicate event receipts, queue retries and repeated model checks do not send duplicate messages. Temporary ownership or timing holds wait for retry; uncertain provider delivery requires reconciliation before another send.

Routine cooldowns are limited to 365 days. They cannot express a lifetime once-per-customer rule; report that requirement explicitly rather than substituting a cooldown.

Production work uses Cloudflare Queues and durable PostgreSQL outbox records. Expired worker leases and lost signal queue messages recover; failures remain retryable. Local Bun uses the same handlers. API readiness reports missing workers/connections; repository changes are not evidence of production deployment.
