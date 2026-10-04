# Trusted package publishing

The `npm-publish.yml` workflow publishes only `@o11/tracking` or `@o11/cli` from reviewed `main`. Choose one package and its exact committed stable version. It builds, tests, typechecks and checks generated documentation before packing. The packed files must match the reviewed public allowlist. Existing versions and registry state changes stop the release; this workflow never overwrites versions or changes package versions.

Before the first release, an npm package maintainer must configure a GitHub Actions trusted publisher on **each package**:

- Organization: `o11-ai`
- Repository: `o11-sdk`
- Workflow filename: `npm-publish.yml`
- Environment: `npm-publish`
- Allow direct publishing. Do not enable separate dist-tag management permission.

Create the GitHub `npm-publish` environment and restrict deployment branches to `main` before configuring npm trust. Keep changes to this workflow and its release script behind reviewed main-branch changes. Environment reviewers are optional policy; adding mandatory reviewers would require approval on every run. Repository dispatch permission controls who can request a release. The workflow itself cannot establish these repository or npm account settings.

The npm Registry API supports exchanging a GitHub OIDC identity for a package-scoped short-lived publishing token. This script requests audience `npm:registry.npmjs.org` and uses `POST /-/npm/v1/oidc/token/exchange/package/{encoded-package}`. npm verifies the signed identity and configured trust. Local claim checks also reject a different repository, branch, workflow, environment, commit, runner or expired identity.

Bun 1.4.2 accepts the exchanged token through `NPM_CONFIG_TOKEN`. Only the fixed `bun publish` subprocess receives it, in memory. Publishing uses an inspected prebuilt tarball, so no lifecycle scripts receive the credential. The subprocess has an isolated temporary home and directory; all publisher output is suppressed. Tokens are never persisted or logged, and provider response bodies are never included in errors. Temporary public tarballs are removed. The registry version is checked after publishing.

This uses the documented npm Registry API with Bun's documented token transport; it is not Bun-native automatic OIDC discovery. A local mock proves actual Bun bearer-token and tarball transport. The first trusted GitHub run remains the required production integration test. No long-lived publishing secret or account-wide 2FA change is needed. No automatic provenance statement is claimed: Bun's publishing documentation does not document npm provenance generation.

References: [npm Registry API](https://api-docs.npmjs.com/#tag/OIDC), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [Bun publish](https://bun.sh/docs/pm/cli/publish), [GitHub OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect).
