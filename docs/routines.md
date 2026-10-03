# Routine configuration

Use engagement_routines_list or engagement_routines_get to read a routine. Use engagement_routines_create to create one or engagement_routines_save to replace the complete draft. Inspect each tool's input schema: it is generated from the same validators used by the dashboard. Never guess IDs or fields. Save requires the current revision; conflicts require reading and reconciling current state.

The **description** is the user's whole-routine request. Preserve it unless the user changes their request. The **nodes**, **edges** and **agent** fields are the executable configuration. Manual structured edits do not rewrite the description. Each signal node's signalAuthoring retains its own original prompt and structured definition. Follow-up nodes use agentFlow for exact messages, waits, reply branches, tool actions and stopping conditions. Both the complete graph and all nested settings can be configured through the same save operation.

Discover signal sources and use signals_check and the appropriate historical preview. Do not treat a bounded sample as proof of absence. Use engagement_routines_validate for the whole routine; unsupported automatic detection prevents publication. Existing graphs start with one signal and end on all paths. Opt-out ends outreach.

Configure persona, sender, timezone, channels, knowledge selections and tools explicitly. Discover available settings with the tool catalog. Configure knowledge and connection access only within granted permissions. Provider login and consent remain interactive.

Saving is inactive. Publish the exact validated revision with engagement_routines_publish, then use engagement_routines_release to activate or pause an immutable version when authorized. Activation can contact customers. Inspect versions/releases to confirm the result. Never report an activated version merely because draft validation succeeded.
