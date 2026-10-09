export const setupRepairsDoc = `# Complete setup through the CLI

Start with the same workspace, routine and environment. These reads do not activate outreach:

\`\`\`sh
o11 setup plan --routine-id ROUTINE --environment production --json
o11 organization setup-options --json
o11 billing status --organization-id WORKSPACE --json
o11 docs channels
\`\`\`

The plan includes workflow.repairs with CLI commands, known input, requiresInput, requiredScope and available. workflow.next contains source import and validation actions. workflow.preflight.workspace reports effective analysis access, administrator links and missing server settings. Inspection errors mean unknown state. Retain unresolved blockers and retry the affected inspection.

Run each command's --help for its live schema. Use --input with a JSON file for nested definitions, patches and manifests. Add a stable UUID _operationId to each mutation, including read probes implemented as mutations. Use the same ID and identical input after a timeout; inspect o11 operations status before starting another write. After repairing a failed prerequisite, use a new ID for a new check. Re-read the current revision after each saved change.

| Setup task | CLI action | What establishes completion |
| --- | --- | --- |
| Conversation analysis access | organization setup-options; organization current; billing status | Effective analysis.conversations access passes the same gate as execution. |
| Edit signal and follow-up | routines get; routines diff; routines patch | Current saved graph contains the requested definition, source choices and follow-up settings. |
| Validate conversation signal | signals check; signals llm-conversations status; signals llm-conversations classify-preview | Real retained evidence matches the intended criterion; exclusions also tested. |
| Capture all requested chats | signals sources; tracking status; tracking setup-prompt; tracking register; tracking create-key | Every requested route delivers real committed text with stable IDs and processed receipts. |
| Verify recipient contact | customers overview; customers verify-email | Actual mailbox ownership recorded for the exact customer/contact/revision. |
| Verify email-purpose permission | customers overview; customers contact-history | Recorded channel/purpose permission and evidence for the real recipient. |
| Resume source imports | analytics status; analytics control; analytics continue-import | Selected source is active, imports completed and coverage rechecked. |
| Enable messaging runtime | organization setup-options; engagement capabilities | Authorized operator deployed the missing configuration and worker prerequisites; readiness passes. |
| Activate outreach | routines validate; routines publish; routines releases; routines release | Authorized version is active in the intended environment and read back. |

## Analysis access

Use organization setup-options rather than guessing from a plan name. Contract, override and legacy access are evaluated by the execution gate. Analysis is included in every plan unless a workspace entitlement restricts it. If blocked, give the workspace administrator the returned entitlementSetup.billingUrl and contactUrl to review the subscription and restrictions. The CLI cannot grant itself an entitlement. After access changes, rerun setup-options, signals check and classify-preview with new operation IDs. This setup request does not authorize a purchase or sending a support email.

## Signal, follow-up and source choices

\`\`\`sh
o11 routines get --organization-id WORKSPACE --id ROUTINE --json
o11 signals sources --organization-id WORKSPACE --environment production --json
o11 routines diff --input patch.json --json
o11 routines patch --input patch.json --json
o11 signals check --input definition-check.json --json
o11 signals llm-conversations status --organization-id WORKSPACE --environment production --source-id SOURCE --json
o11 signals llm-conversations classify-preview --input conversation-check.json --json
\`\`\`

patch.json contains organizationId, id, revision, patch and a UUID _operationId for execution. A patch replaces each supplied array completely; preserve the other nodes and settings. For a full save, routines save takes organizationId and a nested routine object. definition-check.json contains organizationId, definition and _operationId. conversation-check.json also contains environment and sourceId. Inspect status before using signals llm-conversations configure: it needs the complete desired config and expectedUpdatedAt. Its sync command schedules conversation import. Configuration or a bounded preview cannot prove all chat routes are captured.

## Capture and deployment evidence

\`\`\`sh
o11 tracking status --organization-id WORKSPACE --environment production --include-disabled true --json
o11 tracking setup-prompt --organization-id WORKSPACE --project-id SOURCE --json
o11 tracking register --input tracking-manifest.json --json
o11 tracking resume --input tracking-resume.json --json
\`\`\`

Read o11 docs tracking before adding code. Trace every requested chat route to its real committed user-message boundary. Reuse existing delivery; add only confirmed missing capture. Use stable message/customer IDs, a durable outbox, receipt polling and restart recovery. Register the real manifest and use tracking create-key only when a source key is missing. Store keys privately in server configuration. Verify production processed receipts after an authorized deployment; queued receipts, a PR or test data cannot prove deployment. Save verified tracking evidence through routines patch or save, with the setup report tied to the next saved revision. Git changes, merging and deployment use the application's repository and deployment CLI under its authorization rules; o11 does not merge or deploy arbitrary repositories.

## Recipients

\`\`\`sh
o11 customers overview --organization-id WORKSPACE --environment production --customer-id CUSTOMER --json
o11 customers contact-history --organization-id WORKSPACE --environment production --customer-id CUSTOMER --json
o11 customers verify-email --input contact-confirmation.json --json
\`\`\`

contact-confirmation.json contains organizationId, environment, customerId, contactId, current revision, verified and _operationId. The administrator must have actual ownership confirmation before setting verified:true. Conflicting ownership and retired contacts are rejected. Verification does not grant email-purpose permission. Synchronize actual recorded permissions through the source application's tracking.identify API as documented in o11 docs tracking; never invent consent to clear a blocker. Re-read the exact contact and purpose permission before delivery.

## Imports and automatic messaging

\`\`\`sh
o11 analytics status --organization-id WORKSPACE --environment production --connector-id posthog --json
o11 analytics control --input resume-import.json --json
o11 analytics continue-import --input continue-import.json --json
o11 routines refresh-setup --input recheck.json --json
\`\`\`

Use the exact input returned in workflow.next for resume/sync/continue actions. analytics control requires o11:send because resumed imports can trigger other active routines. Obtain authorization for that effect; setup apply does not resume imports automatically. Confirm completed checkpoints and retained/live coverage before clearing an import requirement.

For messaging, organization setup-options exposes missing setting names without secret values: CONTACT_EXECUTION_ENABLED, CHANNELS_ENABLED, the messaging worker, CHANNEL_RUNTIME_URL and CHANNEL_RUNTIME_SECRET. An authorized server operator can configure and deploy these through the infrastructure CLI, then recheck setup. There is no workspace API that changes deployment configuration. Keep customer messaging authorization separate from configuration access. A missing runtime does not prevent independent draft, capture and signal work.

Finish with current validation, setup status and recipient/sender checks. Publish and activate only when authorized; read o11 docs routines for exact version and release revision handling. Never report setup complete while live prerequisites or requested capture remain unverified.
`;
