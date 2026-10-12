# Check and connect email channels

Start with `o11 channels setup-options --persona-id PERSONA_ID --environment production --json`. This read-only check works without a routine. It inspects the selected persona's sender, Gmail and Microsoft setup availability, the signed-in user's Cloudflare connection, and pending mailbox approvals. It returns supported setup actions and the server dependencies that still need work.

Reuse your verified server and profile on every command. All commands below use the currently selected profile. Add `--server URL --profile NAME` when working across servers or workspaces. Do not log in again for each persona or routine.

## Find the persona and inspect setup

```sh
o11 personas list --json
o11 channels setup-options --persona-id PERSONA_ID --environment production --json
o11 status --routine-id ROUTINE_ID --environment production --json
```

Use the persona the user selected. The standalone result is under `result.senderSetup`; routine status includes `result.workflow.preflight.senderSetup`. The check also returns `emailMethods`, `cloudflare`, `domainEmail`, and `inspectionErrors`. `domainEmail.domains` lists saved domains with `readyForSender`; `domainEmail.currentSender` gives the current address and revision. `domainEmail.action` identifies the same save operation used by the domain-email modal, with its known input and remaining `requiresInput` fields.

| Result | What to do |
| --- | --- |
| `connected` | Reuse the saved sender address. Check recipient permissions before delivery. |
| `setup_required` | Offer the available provider options in this chat. Execute the chosen setup action and return its link. |
| `uninspected` | Retry the failed inspection in `inspectionErrors`. Missing evidence does not establish a missing connection. |
| Provider `available_with_setup` | Follow its `action.tool`, `action.input`, `requiredScope`, and `nextStep`. |
| Provider `confirmation_required` | Confirm the already authorized inbox using its mailbox ID and generation. Do not start OAuth again. |
| Provider `unavailable` | Follow its reason and operator requirements, then recheck. Do not invent a working authorization link. |

Read-only checks require `o11:read`. Configuration mutations require the scope shown by live discovery and an administrator role. Preparing a Gmail link requires `o11:configure`; mailbox confirmation and sender assignment require `o11:send`. Provider consent is a separate browser approval. Use `o11 commands --search email --json` and each command's `--help` to inspect the current schemas.

## Connect Gmail for a persona

```sh
o11 engagement email-setup capabilities --environment production --json
o11 engagement email-setup list --environment production --json
o11 operation-id
o11 engagement email-setup start --provider google --persona-id PERSONA_ID --sending-setup persona --environment production --operation-id OPERATION_ID --json
```

Replace `OPERATION_ID` with the UUID returned by `o11 operation-id`. Return `result.authorizationUrl` to the user as a clickable link. They sign in with the requesting account and workspace, review read/send permissions and automatic sending consent, then approve Google access. The callback saves the connection and opens the completion dialog. Reuse the mailbox address returned by Google; do not ask the user to type the same address again.

The setup link expires after ten minutes and can be claimed once. A new setup attempt needs a new operation ID. Retrying an identical mutation after a timeout must reuse its original ID and inspect `o11 operations status --id OPERATION_ID` before starting another attempt.

For Gmail history without sending, use `--read-only=true` and omit `--persona-id` and `--sending-setup`. Read-only Gmail approval does not make a sender ready. For Microsoft email, use `--provider microsoft` with the selected persona and omit `--sending-setup`; confirm the inbox if the callback requests review.

```sh
o11 engagement email-setup list --environment production --json
o11 channels setup-options --persona-id PERSONA_ID --environment production --json
o11 channels status --environment production --json
```

If the result reports an authorized pending mailbox, use the returned confirmation action with its current `mailboxId`, `expectedGeneration`, and requested persona. The browser completion dialog can also confirm it. Reconnection must use the saved mailbox ID and generation. A disconnected or action-required mailbox needs recovery; its old address alone is not evidence of readiness.

## Connect Cloudflare and provision domain email

For an unlinked Cloudflare account, return the Cloudflare option's `authorizationUrl` from `channels setup-options`, or `result.links.cloudflareSetup` from `o11 status`. The link opens a focused connection dialog. The user approves Cloudflare access; the callback verifies the saved connection and says to return to their agent. This connects DNS access. Email setup continues below.

```sh
o11 channels setup-options --persona-id PERSONA_ID --environment production --json
o11 channels zones --json
o11 channels connect-domain --help
o11 channels connect-domain --zone-id ZONE_ID --hostname UNUSED_SUBDOMAIN --environment production --operation-id OPERATION_ID --json
o11 channels domain verify --domain-id DOMAIN_ID --environment production --operation-id ANOTHER_OPERATION_ID --json
o11 channels status --environment production --json
```

Choose an actual zone returned by `channels zones`. Confirm the domain or subdomain and unused sender address with the user before provisioning. Cloudflare account creation, domain purchase, DNS transfers, and changes to an existing mail service are separate actions; connecting DNS access does not perform them.

Wait for sending and receiving verification. Then inspect `o11 channels set-channel --help` and use the current channel revision:

```sh
o11 channels set-channel --persona-id PERSONA_ID --channel email --enabled=true --revision CURRENT_REVISION --domain-id DOMAIN_ID --local-part EMAIL_NAME --confirmed-unused=true --environment production --operation-id OPERATION_ID --json
o11 channels setup-options --persona-id PERSONA_ID --environment production --json
```

Read `channels status` first; a new channel starts at revision zero. A successful save may still be provisioning. Check the saved sender and delivery state before reporting readiness. Sender setup can trigger verification messages and requires the advertised send scope. Do not replace an existing Gmail sender with `set-channel`; inspect `email-setup switch-to-domain` and use its current mailbox generation and channel revision when a switch is explicitly requested.

If Cloudflare is unavailable, inspect `channels domain create --help`. A confirmed unused domain can use manual DNS setup through `channels domain create`, the returned DNS records, `channels domain verify`, and `channels set-channel`. If the domain email service is unavailable too, follow the reported server-operator requirements before retrying.

## Verify and resume the same routine

Recheck `channels setup-options`, mailbox state, and channel readiness after browser consent. Save the chosen persona in the same routine, preserving its other settings. Read the routine's current revision before editing, then validate that revision. Provider authorization and a saved sender do not publish or activate a routine, verify recipient permission, or establish that a customer message was sent.

Keep independent tracking and detection work moving while sender setup waits. For cancellation, an expired link, a wrong account/workspace, a provider outage, or missing server configuration, report the affected setup step and its retry action. Preserve the saved routine, other connections, and the existing CLI login.
