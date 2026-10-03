# Signal sources

Call signals_sources and signals_resources to discover connected sources and their real fields. PostHog provides events, properties and session replay. Product database is a direct PostgreSQL connection; chat history is content in a source, not a separate connector. o11 tracking provides explicitly instrumented business events.

PostgreSQL credentials must be SELECT-only and queries run within read-only transactions with bounded results and timeouts. signals_database_connect verifies the connection before saving; use signals_database_status for the current configuration and expectedUpdatedAt. Use the existing compiled inactivity query preview. Arbitrary SQL execution is not exposed.

Active published event definitions run automatically for all/any/ordered steps, customer or session scope, bounded windows, per-step counts, distinct items, missing actions and verified cross-source identity. PostgreSQL inactivity runs at its daily schedule. Jev/Gemini can confirm recorded message text and replay evidence. Read the signals guide for exact behavior and limits. Missing properties, general joins, arbitrary SQL and unsupported sources must be reported, not silently inferred. Fetch current validation and readiness: documentation examples are not proof a worker is deployed.

Within a source, stable customer identity links sessions. Across sources, identities are namespaced and require explicit verified links, even when external IDs match. Similar names or emails are not enough. Missing events and incomplete history remain unconfirmed.
