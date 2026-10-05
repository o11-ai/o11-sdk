# o11 CLI

Configure the entire o11 workspace through the same authorized tools as remote MCP. Start with `o11 login --server https://api-v2.o11.ai/api/mcp`, then `o11 status`, `o11 tools list` and `o11 docs setup`.

`o11 tools describe TOOL` returns the exact current input schema. `o11 call TOOL --input request.json` executes it and returns JSON. Use `--input -` for standard input. Every mutation requires a stable UUID `_operationId`; after a timeout inspect `o11_operation_status` and saved state before retrying. Use `--output-file FILE` to write credential-bearing results to a new private file without printing them.

`o11 mcp` provides a stdio bridge for MCP clients. Login first. Remote MCP and CLI enforce the same roles, scopes, revision checks and backend readiness. Only transport/client incompatibility is a reason to fall back; permission and validation errors must be resolved.

OAuth credentials stay in the OS credential store by default. On POSIX hosts without an available keyring, explicitly select `o11 login --server URL --credential-store file --no-browser`. This stores credentials under the o11 config directory in a private directory (0700) and files (0600); the profile remembers the selection for later commands. The CLI rejects public permissions and symbolic links rather than falling back automatically. Use named `--profile` values for separate workspace logins. `O11_TOKEN` supports explicitly provisioned scoped keys in headless environments. Never place credentials in command arguments. `logout` removes local login; revoke the grant in o11 to disable it remotely.

For a VM, SSH session, or browser on another computer, start `o11 login --server URL --no-browser` and keep it running. SSH and headless environments print the sign-in link automatically. Open the link on your computer, approve access, and copy the sign-in code from the approval page. Give the code to the coding agent in the same environment as the waiting login, or save it to a private file there and run `o11 login --input FILE`. Delete that input file after submission. Use `o11 login --input -` to read the code from standard input. Do not put the code in shell arguments or logs. The code is a one-use authorization response.

The second command sends the response to the waiting login; that original command verifies state and PKCE, exchanges the response, and confirms workspace setup. If the original command has stopped or timed out, start a new login and approve its new request. An old code cannot restore a stopped login. The registered loopback callback remains available when the browser and CLI run on the same computer.

This package requires Node 22.12+ or Bun. Linux keyring storage requires Secret Service; explicit file storage works without it. Documentation is bundled and available offline with `o11 docs`.
