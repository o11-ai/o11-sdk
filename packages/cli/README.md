# o11 CLI

Configure o11 with readable terminal commands and plain HTTP JSON requests. Start with `o11 login --server https://api-v2.o11.ai`, then `o11 status`, `o11 commands` and `o11 docs setup --live`.

```sh
o11 routines list
o11 routines get --id ROUTINE_ID
o11 routines save --help
o11 tracking status --environment test
o11 signals sources --json
o11 operation-id
o11 routines save --input draft.json --operation-id UUID --json
o11 operations status --id UUID
```

Human terminals show readable results and command help. Agents use `--json`; redirected output is JSON by default. Errors go to stderr and exit nonzero. The connected workspace supplies the organization when omitted. Common fields have flags; other fields use `--set 'field=JSON'`, and nested configuration uses `--input FILE|-`. Conflicting input and flag values are rejected. `--limit`, `--offset` and `--fields` control bounded array results; native cursor pages retain their native cursor fields.

Run `o11 login` once on each host/profile. Later `login` calls verify and reuse the saved grant, refreshing access automatically. Use `o11 login --reauth` only for a fresh sign-in; new scopes require consent. New server grants have a renewable 100-year refresh lifetime (the provider requires a finite expiry). Revocation and workspace access checks still apply. `o11 logout` clears the local grant.

Normal commands call `/api/agent/v1` using fetch. There is no MCP initialization, session, JSON-RPC envelope, SSE stream, or tool-list round trip before execution. Discovery lists compact command summaries; command help retrieves only one schema. OAuth authorization and refresh use the existing tested OAuth helpers, with the same protected resource and credential profiles as prior releases. The optional `o11 mcp` command alone opens the remote MCP transport.

Compatibility commands `o11 tools describe TOOL` and `o11 call TOOL --input request.json` now use HTTP too. Every mutation requires a stable UUID `--operation-id` or input `_operationId`; after a timeout inspect `o11 operations status --id UUID` and saved state before retrying. Use `--output-file FILE` to write credential-bearing results to a new private file without printing them.

Use the CLI first. MCP is the secondary interface if the CLI cannot run or the HTTP API is unavailable. `o11 mcp` provides a stdio bridge for MCP clients. Login first. Both interfaces enforce the same roles, scopes, revision checks and backend readiness. Permission and validation errors must be resolved; an uncertain write must be inspected before switching interfaces.

The CLI checks command arguments and call JSON before connecting. File and stdin input are limited to 1 MiB. Invalid JSON errors omit the input so credential values stay out of logs.

OAuth credentials stay in the OS credential store by default. On POSIX hosts without an available keyring, explicitly select `o11 login --server URL --credential-store file --no-browser`. This stores credentials under the o11 config directory in a private directory (0700) and files (0600); the profile remembers the selection for later commands. The CLI rejects public permissions and symbolic links rather than falling back automatically. Use named `--profile` values for separate workspace logins. `O11_TOKEN` supports explicitly provisioned scoped keys in headless environments. Never place credentials in command arguments. `logout` removes local login; revoke the grant in o11 to disable it remotely.

For a VM, SSH session, or browser on another computer, start `o11 login --server URL --no-browser` and keep it running. SSH and headless environments print the sign-in link automatically. Open the link on your computer, approve access, and copy the sign-in code from the approval page. Give the code to the coding agent in the same environment as the waiting login, or save it to a private file there and run `o11 login --input FILE`. Delete that input file after submission. Use `o11 login --input -` to read the code from standard input. Do not put the code in shell arguments or logs. The code is a one-use authorization response.

The second command sends the response to the waiting login; that original command verifies state and PKCE, exchanges the response, and confirms workspace setup. If the original command has stopped or timed out, start a new login and approve its new request. An old code cannot restore a stopped login. The registered loopback callback remains available when the browser and CLI run on the same computer.

An unsuccessful sign-in or workspace setup check preserves the previous local login. New credentials replace it after setup succeeds. Concurrent logins for different profiles update the profile file under a shared lock and write it atomically.

This package requires Node 22.12+ or Bun. Linux keyring storage requires Secret Service; explicit file storage works without it. Documentation is bundled and available offline with `o11 docs`.

Parallel commands and the stdio MCP bridge coordinate OAuth updates per profile,
server and credential store. A waiting command reloads the saved credentials and
reuses another process's completed refresh. Refresh authentication is bounded to
20 seconds; lock acquisition waits at most 30 seconds before returning a retryable
busy error. Explicit browser login and logout share that coordination; a bridge
holds no lock while idle. Noninteractive insufficient-scope responses require
explicit human login rather than widening consent automatically.

Coordination files contain only a process ID and random owner identifier, never
credentials. A dead owner is recovered; a live owner is never age-unlocked. For
an abandoned owner whose PID has been reused, inspect and stop the affected local
process or remove the confirmed abandoned claim before retrying. Commands must
use this fixed release together: older releases do not participate in the lock.

Run `o11 setup plan --routine-id ID` to inspect current blockers and the next setup steps. `o11 setup apply --routine-id ID` applies available signal validation and monitoring configuration actions with server checks that prevent customer contact. Each action uses a persisted operation ID; `setup resume` uses the same journal after interruption. Imports that could trigger other routines remain explicit actions. The journal records receipt IDs and input hashes, without prompts or credentials. A changed revision is read back after every action. Setup apply exits 2 until the current routine has verified execution evidence.

Use `o11 check --routine-id ID` in CI. A saved definition, enabled schedule, or old execution does not pass this check. `--require-capability replayMonitoring` and `--max-lag-seconds 3600` add health assertions. `--check` also works on ordinary commands and fails on invalid results or failed/deferred import outcomes. Exit 1 means a command or transport error; exit 2 means the requested check did not pass.

`o11 wait --routine-id ID --timeout 300000 --interval 2000` waits for verified execution. `o11 wait --id UUID` watches an operation receipt. For durable analysis jobs, use the returned progress path with `o11 wait --path research.selectedProgress --input progress-input.json`; the CLI verifies that the procedure is read-only before polling. `watch` accepts the same arguments and emits one JSON object per line when state changes. Ctrl-C stops local waiting; remote work continues.

`o11 profiles list`, `profiles inspect`, and `profiles select NAME` manage local selection. `profiles pin --organization-id ID --environment production` saves expected context. Conflicting input fails before connecting. `--expect-organization` and `--expect-environment` set the expectation for one invocation. `O11_PROFILE` selects a profile for a headless job.

`O11_TOKEN_FILE` reads a provisioned service token from a private file owned by the current user. It cannot be combined with `O11_TOKEN`. For connector credentials, `--set-file apiKey=/private/key.txt` reads the field value without putting it in shell arguments. These files must be regular files with private permissions, such as mode 0600 on Linux and macOS. Symbolic links are rejected.

`o11 validate routines save --input draft.json` checks input against the current command schema without executing it. After fetching a schema, use `--offline` to validate locally before loading credentials. Cached schemas include their timestamp and may be stale; ordinary execution uses server validation so an outdated local schema cannot reject a valid request. `o11 routines save --help --offline` reads cached help. `o11 completion bash`, `zsh`, or `fish` includes the last complete allowed command list cached for this profile and server, with local command groups as a fallback. It needs no credentials or network; cached suggestions do not grant permission to execute.

`o11 batch --input batch.json` executes up to 100 independent items with concurrency 1–8. A manifest contains `version: 1`, optional `organizationId` and `environment`, and `items` with unique `id`, dotted `path`, and `input` fields. Every write must supply its own stable `_operationId`. Each item is schema-checked; a failed item leaves others running. The private journal skips completed items on rerun and preserves operation IDs for uncertain writes. Change a manifest deliberately: a supplied journal must match its original manifest and target.

`o11 diagnostics --routine-id ID --output-file support.json` saves a support bundle with build identity, readiness, blocker codes, and import health. It excludes customer content, raw errors, tokens, and workspace identifiers. Normal `--output-file` output remains private and refuses overwrites. If a remote request completes but the file cannot be saved, the CLI reports remote completion and its receipt instead of implying that the write failed.

`o11 verify --input evaluations.json` compares caller-labeled recordings with saved detector results for the exact routine revision. Include both matching and nonmatching recordings. This checks recorded evidence and reports precision, recall, coverage, and inconclusive cases; it does not start analysis. Use `check` separately to verify worker health.

`o11 example routines save` generates placeholder input from the live schema and checks it locally. If a constraint requires a real resource value, the command exits 2 and identifies the field. Replace placeholders before writing. `o11 completion bash --live` includes commands available to the current grant. Cached schemas are separated by host, profile, schema version, and permission fingerprint; a newly observed version makes earlier entries unavailable to offline help.

`o11 benchmark --set iterations=5` measures process startup and offline documentation reads. It reports each sample and the median and 95th percentile. It does not include authentication or provider time.

`o11 install --input manifest.json` installs the exact release described by the server's `/api/agent-docs/cli-install` endpoint. It verifies the archive and executable checksums, installs dependencies with lifecycle scripts disabled, and probes the executable before replacing its managed launcher. It returns the launch command and retains previous releases. Existing profiles and the executable on your PATH are preserved.

`o11 research runtime-check --input probe.json --operation-id UUID` probes deployed database columns and a temporary storage object, including cleanup. The input selects `organizationId`, `environment`, and `connectorId`. This requires configuration permission and an administrator role. Queue delivery and provider access stay unknown until actual execution supplies evidence.

`o11 research analyze-selected-only --input request.json --operation-id UUID` submits recording analysis without customer contact or owner previews. Supply a stable `requestId`, source context, `sessionIds`, and `routineIds`. Poll the returned progress call. Configuration and read permissions are sufficient; source access, billing, and worker prerequisites still apply.

## Inbox, replies, delegation, and email branding

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

## Updates

Run `o11 update --check --json` to compare the installed version and executable checksum with the release advertised by your server. `o11 --version --json` reports both. `o11 update` installs a newer release or repairs the same release after verifying its archive and executable. It never treats an older advertised release as an upgrade. Bun global installs are updated in place; other installs stage an isolated verified replacement and return the exact command to use without overwriting the original. On a missing command or schema/version disagreement, inspect live schemas, attempt this update, and retry through the returned command before reporting a blocker. Credentials and workspace profiles are preserved. Restart a running MCP bridge after updating.

Interactive `o11 status` reports an available update without blocking workspace access if the check fails. Scripts and offline documentation do not perform automatic update checks. The server advertises its tested version, which may be older than npm latest during a rollback.
