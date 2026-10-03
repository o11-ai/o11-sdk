import { agentKitVersion } from './prompt';
import { signalDoc } from './signal-doc';
export type AgentDoc = { id: string; title: string; description: string; markdown: string };
export const agentDocs: AgentDoc[] = [
  { id: 'setup', title: 'Set up with your agent', description: 'Configure a complete routine from your coding agent.', markdown: `# Set up with your agent

Describe the complete routine in o11, then choose **Copy prompt into your agent**. Paste it into your coding agent in your application repository. You can also start directly in your agent.

Connect to the workspace MCP endpoint given in the prompt. Call **o11_setup** first: it returns your workspace, granted permissions, runtime readiness and links for human sign-in. Agents edit the same saved configuration as the dashboard and sidebar.

If your client cannot connect through MCP, install @o11/cli@${agentKitVersion} and run **o11 login --server YOUR_MCP_URL**. Login opens browser authorization and stores tokens in your operating system credential store. Run **o11 tools list**, **o11 tools describe TOOL**, then **o11 call TOOL --input FILE**. The CLI uses the same server, policies and validators. **o11 mcp** exposes those same tools over local stdio. A server outage, missing permission or invalid input cannot be fixed by switching clients.

Fetch the current routine and its revision. Discover sources, senders and tools, then save an inactive draft covering both detection and action. Use structured definitions directly; no calls to another configuration agent. Read the routines guide before editing. Register SDK tracking only when connected sources lack required evidence.

Validate and preview without sending messages. Report missing connections or unsupported behavior. Deployment, activation and customer outreach require the user's authorization. The dashboard remains available for detailed manual edits.\n` },
  { id: 'routines', title: 'Routine configuration', description: 'Prompts, graphs, follow-ups, validation and activation.', markdown: `# Routine configuration

Use engagement_routines_list or engagement_routines_get to read a routine. Use engagement_routines_create to create one or engagement_routines_save to replace the complete draft. Inspect each tool's input schema: it is generated from the same validators used by the dashboard. Never guess IDs or fields. Save requires the current revision; conflicts require reading and reconciling current state.

The **description** is the user's whole-routine request. Preserve it unless the user changes their request. The **nodes**, **edges** and **agent** fields are the executable configuration. Manual structured edits do not rewrite the description. Each signal node's signalAuthoring retains its own original prompt and structured definition. Follow-up nodes use agentFlow for exact messages, waits, reply branches, tool actions and stopping conditions. Both the complete graph and all nested settings can be configured through the same save operation.

Discover signal sources and use signals_check and the appropriate historical preview. Do not treat a bounded sample as proof of absence. Use engagement_routines_validate for the whole routine; unsupported automatic detection prevents publication. Existing graphs start with one signal and end on all paths. Opt-out ends outreach.

Configure persona, sender, timezone, channels, knowledge selections and tools explicitly. Discover available settings with the tool catalog. Configure knowledge and connection access only within granted permissions. Provider login and consent remain interactive.

Saving is inactive. Publish the exact validated revision with engagement_routines_publish, then use engagement_routines_release to activate or pause an immutable version when authorized. Activation can contact customers. Inspect versions/releases to confirm the result. Never report an activated version merely because draft validation succeeded.\n` },
  { id: 'tracking', title: 'Tracking SDK', description: 'Install minimal server-side event tracking and verify delivery.', markdown: `# Tracking SDK

Install @o11/tracking@${agentKitVersion} in the customer's JavaScript/TypeScript server application. The package exports createTrackingClient. No o11 GitHub connection is needed. Prefer existing PostHog events or read-only database records when they already prove the behavior.

Use signals_tracking_register with a stable source ID, name and manifest. A manifest has version: 1 and events with name, description and fields. Each field has name, type (string, number or boolean) and required. Discover the exact schema through the tool catalog. Updates require expectedUpdatedAt from status. Registration preserves omitted events and rejects field removal, type/required changes or new required fields on an existing event. Add optional fields or use a new event name for a breaking change.

Use signals_tracking_createKey with the source ID when authorized for o11:credentials. Store the returned token in the application's server secret store. This write-only source key is separate from agent OAuth credentials. Never embed it in frontend code or paste it into the routine prompt. Revoke with signals_tracking_revokeKey.

\`\`\`ts
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
\`\`\`

Use stable application customer IDs. Identity is scoped to each source: using the same ID in PostHog and the SDK does not automatically join accounts. Resolve actual identities with signals_identities_find, verify the shared signed-in account, then explicitly link through signals_identities_link. Include sessionId only for a genuine analytics session; an authentication session is not an analytics session. Include the same report/order ID on every related event so correlationProperty can keep items separate. Track successful outcomes after database commit. For durable delivery, enqueue into the application's existing transactional outbox and retry the same eventId when retryable is true. The SDK uses bounded retries; in-memory retries cannot guarantee delivery after process exit. Await delivery or use the runtime's supported background task lifetime. Do not delay or fail the user's business operation because analytics delivery failed.

Only declared scalar properties are accepted, with at most 20 fields and 2,000 characters per text field. Conversation checks need explicitly approved, limited message text plus fields identifying the author and item; do not upload entire transcripts, documents, credentials or DOM content. Server SDKs cannot securely capture arbitrary browser clicks themselves. Continue using PostHog for browser navigation and replay; native/client integrations need an authenticated server endpoint that derives the customer ID from the signed-in account.

Read signals_tracking_status with includeDisabled=true to inspect and re-enable a disabled source through register using its current updatedAt. After deployment, signals_tracking_status shows missing events and server-observed receipts. An HTTP 202 means accepted into the queue, not yet verified in storage. A locally generated test event does not prove production deployment. SDK tracking validates incoming events and does not itself activate any routine.\n` },
  { id: 'sources', title: 'Signal sources', description: 'PostHog, read-only PostgreSQL and o11 events.', markdown: `# Signal sources

Call signals_sources and signals_resources to discover connected sources and their real fields. PostHog provides events, properties and session replay. Product database is a direct PostgreSQL connection; chat history is content in a source, not a separate connector. o11 tracking provides explicitly instrumented business events.

PostgreSQL credentials must be SELECT-only and queries run within read-only transactions with bounded results and timeouts. signals_database_connect verifies the connection before saving; use signals_database_status for the current configuration and expectedUpdatedAt. Use the existing compiled inactivity query preview. Arbitrary SQL execution is not exposed.

Active published event definitions run automatically for all/any/ordered steps, customer or session scope, bounded windows, per-step counts, distinct items, missing actions and verified cross-source identity. PostgreSQL inactivity runs at its daily schedule. Jev/Gemini can confirm recorded message text and replay evidence. Read the signals guide for exact behavior and limits. Missing properties, general joins, arbitrary SQL and unsupported sources must be reported, not silently inferred. Fetch current validation and readiness: documentation examples are not proof a worker is deployed.

Within a source, stable customer identity links sessions. Across sources, identities are namespaced and require explicit verified links, even when external IDs match. Similar names or emails are not enough. Missing events and incomplete history remain unconfirmed.\n` },
  signalDoc,
  { id: 'cli', title: 'CLI and MCP', description: 'Authentication, discovery, JSON calls and safe retries.', markdown: `# CLI and MCP

Install @o11/cli@${agentKitVersion}. Run **o11 login --server https://YOUR_API/api/mcp** once, then **o11 status**. Use --profile NAME to keep workspace credentials separate. Login supports browser OAuth with PKCE; tokens are stored in the OS credential store. Use O11_TOKEN only for an explicitly supplied scoped key in environments without a credential store. Never put tokens in command arguments.

- o11 tools list [--search TEXT] — list every authorized operation.
- o11 tools describe TOOL — retrieve the current input schema.
- o11 call TOOL --input FILE — execute a tool; use - for standard input.
- o11 docs [PAGE] — read bundled versioned setup documentation without authentication.
- o11 mcp — expose the same server tools over local stdio.
- o11 logout — delete locally stored credentials; revoke agent access in o11 to invalidate the grant remotely.

Calls return JSON. Errors exit nonzero. Credential calls should use --output-file PATH to reserve a private file before dispatch and keep secrets out of agent transcripts. An existing destination is never overwritten. An empty file after a transport error is not proof that a mutation failed; inspect the operation receipt before retrying. Supply _operationId (a UUID) on every mutation and preserve it with identical input for retries. A timeout leaves the outcome uncertain: inspect o11_operation_status and the affected record before doing anything again. Remote MCP and CLI may authenticate as different grants; operation recovery must remain scoped to the same authorizing user and workspace. Never generate a new ID to repeat an uncertain action.

Configuration, credentials, publication and sending have separate permissions. Scope failures require consent for that permission, not a different endpoint. All tools retain membership, ownership, revision and provider checks. Provider passwords, 2FA and OAuth consent are completed by the account owner.\n` },
];
export function readDoc(id: string): AgentDoc | undefined { return agentDocs.find(doc => doc.id === id); }
export function searchDocs(query = '') { const terms = query.toLowerCase().split(/\s+/).filter(Boolean); return agentDocs.filter(doc => terms.every(term => `${doc.title} ${doc.description} ${doc.markdown}`.toLowerCase().includes(term))).map(({ markdown: _, ...doc }) => ({ ...doc, version: agentKitVersion, uri: `o11://docs/${doc.id}` })); }
