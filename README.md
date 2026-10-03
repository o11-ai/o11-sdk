# o11 CLI and tracking SDK

Source for @o11/cli and @o11/tracking, plus their public setup guides. The private agent-kit workspace provides bundled documentation; it is not published as an npm package.

Read the [developer documentation](https://docs.o11.ai), install [@o11/cli](https://www.npmjs.com/package/@o11/cli) or [@o11/tracking](https://www.npmjs.com/package/@o11/tracking), and report bugs through [GitHub issues](https://github.com/o11-ai/o11-sdk/issues).

Use Bun to install dependencies, then run `bun run build`, `bun test` and `bun check-types`. Start with [the setup guide](docs/setup.md).

Edit the canonical guides in `packages/agent-kit/src/docs.ts` and `signal-doc.ts`, then run `bun run docs:sync`. CI verifies that the Markdown copies match the bundled guides.

Credentials belong in the operating system credential store or server secrets. Never commit tokens, customer data or local configuration.

This snapshot contains only explicitly reviewed source paths. It has no application backend, infrastructure, private configuration, development artifacts or original Git history.
