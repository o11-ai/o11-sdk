# Inbox, replies, delegation, and email branding

These features use the same saved records through the app and CLI. Run a command with `--help` for its live input schema. Mutations require `--operation-id UUID`; reuse that ID with identical input after a timeout and inspect its receipt before retrying.

| Action | CLI command |
| --- | --- |
| Read conversation addresses, messages, and delivery state | `o11 inbox detail`, `o11 inbox history` |
| Take over, assign a persona, resolve, or snooze a conversation | `o11 inbox take-over`, `o11 inbox update` |
| List authorized Gmail history accounts | `o11 engagement email-setup gmail-history-accounts` |
| Read or confirm mailbox connections | `o11 engagement email-setup list`, `o11 engagement email-setup confirm` |
| Connect or update a source with authorized credentials | `o11 knowledge connect`, `o11 knowledge update-mcp` |
| Read or save agent access for a chat | `o11 engagement conversations agent-access`, `o11 engagement conversations set-agent-access` |
| Copy a routine issue’s diagnostic or repair prompt | `o11 routines setup-prompt` with the current `revision` and `blockerIndex` |
| Prepare a recommendation without sending | `o11 inbox suggest-reply` with `previewOnly: true` |
| Save, edit, or send a reply | `o11 inbox save-draft`, `o11 inbox send-reply` |
| Stop queued automation and take team control | `o11 inbox take-over` |
| Read or configure automatic replies, timing, and handoff routing | `o11 replies settings`, `o11 replies save` |
| Inspect a prepared reply and its scheduled time | `o11 replies status` |
| Read task assignment, review, and notification history | `o11 replies delegations history` |
| List handoffs and eligible assignees | `o11 replies delegations list-page`, `o11 replies delegations teammates` |
| Configure handoff topics, custom rules, and clarification limits | `o11 personas get`, `o11 personas patch` |
| Accept, reassign, wait, resolve, or cancel a handoff | `o11 replies delegations update` |
| Read identity checks before resuming automation | `o11 replies delegations finish-reply-context` |
| Finish a confirmed handoff reply and choose whether automation resumes | `o11 replies delegations finish-reply` |
| Read or save your account’s choice after handoff replies | `o11 account handoff-reply-preference`, `o11 account update-handoff-reply-preference` |
| Read or retry your handoff notification | `o11 replies notifications`, `o11 replies retry-notification-email` |
| Read per-persona email, Slack, and Discord destinations and delivery state | `o11 personas notifications list` |
| Add, enable, disable, or remove a destination | `o11 personas notifications create`, `o11 personas notifications set-enabled`, `o11 personas notifications remove` |
| Retry a destination alert after reviewing uncertain delivery | `o11 personas notifications retry` |
| Read the shared sending-domain branding configuration | `o11 channels identity branding get` |
| Upload a public VMC/CMC certificate chain | `o11 channels identity certificate upload` |
| Inspect, save, or publish domain branding | `o11 channels identity branding get`, `o11 channels identity branding save`, `o11 channels identity branding publish` |
| Read or change the sender name and private photo | `o11 channels identity get`, `o11 channels identity save` |
| Select and inspect recordings | `o11 research sessions`, `o11 research recording-detail`, `o11 research artifact` |
| Configure and verify Postgres conversation ingestion | `o11 database conversations status`, `get`, `preview`, `configure`, `sync` |

Use `--input FILE` for nested settings, webhook URLs, or PEM contents. Certificate upload takes the public PEM chain in `pem`. SES branding uses the certificate’s certified logo. Private keys are rejected. Upload and DNS publication require administrator access. A saved certificate does not establish inbox-provider trust.

Delegation commands act as the user associated with your login or credential. Only the assigned teammate or an administrator can change a task; assignment requires an administrator. Read the task's current `revision` before updating it. Notification email retry requires `o11:send` consent. It sends a teammate notification, not a customer reply. Persona destination setup requires an administrator; destination edits use the current revision. Retry of uncertain provider delivery requires explicit review and send consent because the earlier attempt may have succeeded.

Handoff rules live in `patch.replyEscalation` on `o11 personas patch`. Read the persona first and supply its `id` and current `revision`. Set `flaggedTopics` to any of `refunds`, `cancellations`, `complaints`, `pricing`, `contracts`, and `security`; an empty array clears those selections. `humanOnlyDecisions` holds custom instructions, and `maxClarifyingReplies` accepts 1–5. Omitted fields survive a partial patch. New inbox and flow replies use the current saved rules even when an older persona version is published.

Reply speed uses `delayMode`, `minDelaySeconds`, `maxDelaySeconds`, and `delaySeconds` in `o11 replies save`. Read `o11 replies settings` and preserve the remaining settings and current sender revision. Quick uses 5–20 seconds, Natural 15–90, and Unhurried 60–300; custom ranges accept 0–3,600 seconds. Human timing varies within the range and accounts for draft length. The chosen deadline is saved once and reused on retries.

Handoff drafts use `o11 inbox suggest-reply` with `previewOnly: true`; the handoff keeps automatic sending paused. Send the reviewed reply with `o11 inbox send-reply` and confirm its sent status through `o11 inbox history`. Then `o11 replies delegations finish-reply` takes `taskId`, `taskRevision`, `conversationId`, `conversationRevision`, `threadId`, `inboundMessageId`, and the sent `messageId`, plus `resume` and optional `remember`. It refuses unsent replies, stale state, a different sender, or a new customer message. Account preference commands read or set `preference` to `ask`, `resume`, or `keep_paused`. Terminal clients can read that preference before making the explicit finish call. Read `finish-reply-context` before resuming; it returns the original sender and saved contact addresses. An identity handoff requires explicit `verifySender: true` when verification is allowed. Confirming a recognized alternate email address records that exact customer/contact/address pair for later messages. Retired contacts, changed addresses, other senders, and other review reasons still require their own checks. This does not change the saved reply destination.

For a new Gmail or OAuth-based source connection, run `o11 status --json` and open `result.links.integrations` to authorize the provider in your browser. OAuth state belongs to that browser session; the terminal cannot grant provider consent. After authorization, use the mailbox/account commands above and save the chosen IDs in the chat, persona, or routine settings. Credential-based source connections use `o11 knowledge connect` directly.

Chat access updates take `id`, current `revision`, `scope: "conversation"`, and a complete `agent` object or `agent: null` to reset. Read the current agent first and preserve its remaining fields. Configure `websiteAccessMode` as `selected` or `all`, `websiteUrls`, `blockedWebsiteUrls`, `sourceAccess`, `contextBank`, and `gmailHistoryMailboxes`. All-sites mode allows public HTTPS websites; blocked domains include subdomains and blocked paths include descendants. Source and mailbox selections must belong to this workspace and environment. Updates require an administrator, invalidate stale drafts, and can restart a pending automatic reply under its existing delivery checks. The app configures the whole chat. The API also retains `scope: "next_reply"` for existing clients; it targets only the latest unanswered inbound message.

Reply suggestions return text for review; saving and sending are separate commands. Terminal clients can keep that text while editing, then restore it without requesting another suggestion. The app's spacing, divider, spinner, and Tab controls are visual presentation of the same reply and delivery state.