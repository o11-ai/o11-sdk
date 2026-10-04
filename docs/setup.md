# Set up with your agent

Describe the complete routine in o11, then choose **Copy prompt into your agent**. Paste it into your coding agent in your application repository. You can also start directly in your agent.

Connect to the workspace MCP endpoint given in the prompt. Call **o11_setup** first: it returns your workspace, granted permissions, runtime readiness and links for human sign-in. Agents edit the same saved configuration as the dashboard and sidebar.

If your client cannot connect through MCP, install @o11/cli@0.1.2 and run **o11 login --server YOUR_MCP_URL**. Login opens browser authorization and stores tokens in your operating system credential store. Run **o11 tools list**, **o11 tools describe TOOL**, then **o11 call TOOL --input FILE**. The CLI uses the same server, policies and validators. **o11 mcp** exposes those same tools over local stdio. A server outage, missing permission or invalid input cannot be fixed by switching clients.

Fetch the current routine and its revision. Discover sources, senders and tools, then save an inactive draft covering both detection and action. Use structured definitions directly; no calls to another configuration agent. Read the routines guide before editing. Register SDK tracking only when connected sources lack required evidence.

Validate and preview without sending messages. Report missing connections or unsupported behavior. Deployment, activation and customer outreach require the user's authorization. The dashboard remains available for detailed manual edits.
