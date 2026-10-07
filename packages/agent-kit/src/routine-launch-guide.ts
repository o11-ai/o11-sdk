export const routineLaunchGuide = `
## Validate and launch through o11

Start with \`o11_setup({routineId})\` for an existing routine. It returns the saved revision, current import state and next tool calls, including any missing permissions. Without a routine ID, it points to the routine list. Use the same o11 CLI profile or MCP grant throughout. Inspect each tool's current input schema. Retain the returned workspace ID, routine ID, draft revision, version ID and release revision; they identify different records.

| Step | o11 tool | Verify before continuing |
| --- | --- | --- |
| Inspect access | o11_setup, engagement_capabilities | Correct workspace, required scopes and runtime readiness. |
| Inspect sources and history | signals_sources, signals_resources, signals_sample, research_sessions, research_customer | Existing evidence, identity, session boundaries and complete history for the requested rule. |
| Configure | engagement_routines_create or engagement_routines_save | Exact detection, delivery mode, sender, email and stopping conditions saved in one inactive draft. |
| Check the rule | engagement_routines_validateSignal, signals_previewEvents | Validate the saved definition and instruction at the current revision. Test matching and excluded cases separately; structural validation does not establish detection accuracy. |
| Check the routine | engagement_routines_validate | Valid result for the current saved revision and intended environment. |
| Inspect setup controls | engagement_routines_setupStatus | Source import progress, retained history coverage and messaging availability for that revision. |
| Enable session detection | engagement_routines_configureMonitoring | For session search or manual review, add the exact validated revision using sourceId and expectedVersion from research_monitoring. Preserve other selections and verify current setup state. |
| Publish | engagement_routines_publish | New immutable version returned. Publishing does not activate it. |
| Activate | engagement_routines_release | That version active in the intended environment. Activation can start outreach. |
| Confirm and observe | engagement_routines_releases, engagement_runs_list, engagement_runs_inspect, engagement_inbox_list | Release state and actual matches/runs/delivery; a lack of matches is not proof of a broken campaign. |

Session search and manual review finish setup through detection configuration. They do not require a published outreach version. Re-read \`o11_setup({routineId})\` after every change; check ingestion, worker readiness, selected revision and observed execution. Use research_evaluation to inspect recorded outcomes for labeled sessions at the exact current revision. Missing or outdated evidence is inconclusive.

The CLI supports o11 setup plan and o11 setup apply for resumable setup. Inspect its plan and blockers. Apply uses stable operation receipts and stops on failed prerequisites. It cannot repair unavailable server storage, grant itself permissions or resume imports that may trigger other routines.

For automatic customer contact, after validation, the publish input contains organizationId, id (the routine ID), revision (the validated draft revision), environment and a stable UUID _operationId. Use the publish result's id as versionId in release, alongside organizationId, routineId, environment, status="active", the current release revision and a different stable UUID _operationId. Read releases first; use revision zero only when no release exists in that environment. To pause, call release with status="paused" and the current version ID and release revision. Pausing remains available when an execution dependency fails.

Publish and release require o11:publish. Sending a manual message or owner preview requires its own tool's permission, often o11:send. The default CLI login grants configuration access; it does not grant publication. Request only the scopes needed by the discovered tools through explicit o11 login --scope consent. Keep the same server and profile. Never interpret an unavailable tool as an absent product feature until you inspect the granted scopes.

The routine workspace and MCP operate the same saved settings independently. Agent access does not block a user from editing or activating through the UI. Use analytics_control to load, pause or resume the selected source and analytics_continueImport for another manual page. Inspect setupStatus again, then use engagement_routines_refreshSetup to clear confirmed import requirements. Setup blockers may identify history_import, automatic_imports, agent_access or delivery in their requirement field; retain unresolved tracking and scope evidence. A source-specific import opt-in does not enable other workspaces or messaging.

Current unresolved scope choices or pending tracking changes must be resolved before launch. Update saved setup evidence after verifying the change. Stale agent reports do not override live validation. Activation also checks the published sender against its current connection. Reconnect a disconnected sender and retry; do not create a replacement routine to bypass the failure. Demo policy and missing runtime dependencies cannot be removed by an agent grant.

Use a stable operation ID for each mutation. If publication or activation times out, inspect o11_operation_status plus versions/releases before retrying identical input with the same ID. Never create another version or activation merely because the response was lost. No customers are contacted by event previews; owner tests and historical analyses that can deliver messages require explicit authorization.
`;
