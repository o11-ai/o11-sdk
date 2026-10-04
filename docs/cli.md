# CLI and MCP

Install @o11/cli@0.1.2. Run **o11 login --server https://YOUR_API/api/mcp** once, then **o11 status**. Use --profile NAME to keep workspace credentials separate. Login supports browser OAuth with PKCE; tokens are stored in the OS credential store. Use O11_TOKEN only for an explicitly supplied scoped key in environments without a credential store. Never put tokens in command arguments.

**o11 docs** is the CLI's bundled documentation snapshot. After connecting, read the current server documentation with **o11 call o11_docs --input FILE**, where FILE contains `{"page":"tracking"}` (or another returned page ID). Use the server's SDK version and tool schemas when its documentation is newer than the installed CLI.

- o11 tools list [--search TEXT] — list every authorized operation.
- o11 tools describe TOOL — retrieve the current input schema.
- o11 call TOOL --input FILE — execute a tool; use - for standard input.
- o11 docs [PAGE] — read bundled versioned setup documentation without authentication.
- o11 mcp — expose the same server tools over local stdio.
- o11 logout — delete locally stored credentials; revoke agent access in o11 to invalidate the grant remotely.

Calls return JSON. Errors exit nonzero. Credential calls should use --output-file PATH to reserve a private file before dispatch and keep secrets out of agent transcripts. An existing destination is never overwritten. An empty file after a transport error is not proof that a mutation failed; inspect the operation receipt before retrying. Supply _operationId (a UUID) on every mutation and preserve it with identical input for retries. A timeout leaves the outcome uncertain: inspect o11_operation_status and the affected record before doing anything again. Remote MCP and CLI may authenticate as different grants; operation recovery must remain scoped to the same authorizing user and workspace. Never generate a new ID to repeat an uncertain action.

Configuration, credentials, publication and sending have separate permissions. Scope failures require consent for that permission, not a different endpoint. All tools retain membership, ownership, revision and provider checks. Provider passwords, 2FA and OAuth consent are completed by the account owner.
