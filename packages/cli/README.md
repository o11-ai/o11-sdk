# o11 CLI

Configure the entire o11 workspace through the same authorized tools as remote MCP. Start with `o11 login --server https://api-v2.o11.ai/api/mcp`, then `o11 status`, `o11 tools list` and `o11 docs setup`.

`o11 tools describe TOOL` returns the exact current input schema. `o11 call TOOL --input request.json` executes it and returns JSON. Use `--input -` for standard input. Every mutation requires a stable UUID `_operationId`; after a timeout inspect `o11_operation_status` and saved state before retrying. Use `--output-file FILE` to write credential-bearing results to a new private file without printing them.

`o11 mcp` provides a stdio bridge for MCP clients. Login first. Remote MCP and CLI enforce the same roles, scopes, revision checks and backend readiness. Only transport/client incompatibility is a reason to fall back; permission and validation errors must be resolved.

OAuth credentials stay in the OS credential store. Use named `--profile` values for separate workspace logins. `O11_TOKEN` supports explicitly provisioned scoped keys in headless environments. Never place credentials in command arguments. `logout` removes local login; revoke the grant in o11 to disable it remotely.

This package requires Node 22.12+ or Bun. Linux persistent login requires Secret Service. Documentation is bundled and available offline with `o11 docs`.
