# Contributing

Thanks for your interest in Claude Code Usage — issues, PRs and ideas are
genuinely welcome. This is a small, focused project and contributions are how
it grows.

## Project scope

Before proposing a feature, it helps to know the positioning: this extension is
provider-aware and lightweight, supporting Claude Code and **Codex Beta**.
Codex Beta is enabled by default and can be turned off in provider settings.
The emphasis is truthful local usage and token attribution rather than billing
reconciliation. Features that sharpen attribution, privacy, or the advice
experience are the best fit.

Usage ingestion reads only each provider's local metadata and usage logs.
Usage ingestion is read-only, and Codex data is never mutated. Codex does not estimate
dollar cost. Its usage JSONL is streamed and temporarily parsed for allowlisted
metadata; conversation fields are not inspected or used for analysis and are never
retained. Codex limits are last-observed values from local logs, not real-time billing
data.

Claude session actions are separately gated and disabled by default. When enabled,
they can resume or delete a selected session.
Deleting the selected session moves its log to the OS trash.

## Development setup

```bash
npm install
npm run compile          # tsc -> out/
npm run watch            # recompile on change
```

- Press **F5** in VS Code to launch the Extension Development Host and test
  your changes manually.
- Package a `.vsix` with `npx -y @vscode/vsce@3.9.1 package`.

## Pull requests

- Keep each PR focused on one logical change.
- Run `npm test` and the relevant browser/host layers below before opening the
  PR.
- Describe the problem and the fix; screenshots help for UI changes.
- If your change affects user-facing behaviour, update `CHANGELOG.md` and the
  relevant parts of `README.md`.

## Tests

Tests run in three layers:

1. **Node logic and policy — `npm test`.** This runs the TypeScript compile,
   then executes the Node logic and repository-policy tests against compiled
   output with Node's built-in runner (`node:test` + `node:assert`).
2. **Real Webview Chromium — `npm run test:ui`.** This compiles and exercises
   the real, complete Webview in Chromium, covering interaction, reload state,
   Axe accessibility, eight-locale overflow, and visual baselines.
3. **VS Code host smoke.** Press **F5** or install a packaged VSIX. Verify real
   VS Code host activation, real local metadata, and theme smoke behavior. This
   layer does not replace the first two layers.

CI uses separate gates, with packaging after both test jobs pass on every PR
(`.github/workflows/test.yml`). Canonical Linux screenshots may only be updated
with the exact official container
`mcr.microsoft.com/playwright:v1.61.1-noble`, with
`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. A macOS run must not overwrite a
Linux snapshot; reproduce and update it in that exact Linux container.

**Where tests live.** Put test files **directly** in `src/test/`, named
`*.test.ts`. Because `tsc` is configured with `rootDir: src`, they compile to
`out/test/` where the runner picks them up, and they're excluded from the
packaged `.vsix`. Keep the directory flat — the `test` script globs
`out/test/*.test.js` (a single level, so it stays portable across Node
versions), which means files in nested subfolders would be silently skipped.

**What to test in the Node layer.** Keep modules under direct test independent
of the live `vscode` API. Existing examples include:

- pricing & cost calculation (`pricing.ts`)
- aggregation: daily / weekly / monthly / all-time (`dataLoader.ts`)
- quota-window handling (`statusBar.ts`)
- i18n formatting (`i18n.ts`)

If you add or change logic in these, please add a test. `src/test/pricing.test.ts`
is a worked example to copy from. Prefer asserting on **observable behaviour**
(a computed cost, a resolved pricing tier) over implementation details, and add
a case for the tricky edge you just fixed so it can't regress.

Webview behavior belongs in `tests/ui/` and must use the production rendering
harness rather than synthetic HTML. Extension activation, commands, and real
local-provider integration receive the VS Code host smoke layer.

## Releases

Releases are automated and contributor-friendly — you never touch versions or
tags:

1. **Open a PR** (a `fix/…`, `feat/…` or `docs/…` branch name keeps the intent
   clear). A maintainer applies the matching label when merging — that label sets
   the version bump (`feature` → minor, `breaking` → major, otherwise patch;
   unlabeled → patch).
2. **A maintainer merges it.** [Release Drafter](https://github.com/release-drafter/release-drafter)
   then adds your change to a continuously-updated **draft GitHub Release** and
   recomputes the next version.
3. **To ship, a maintainer reviews that draft and clicks Publish.** That creates
   the tag and triggers `publish.yml`, which packages and pushes to the VS Code
   Marketplace + Open VSX and attaches the `.vsix`.

Because changes ship by **merging** your PR — not by re-applying it — your commit
authorship and the PR's *merged* status are preserved.

## Repository assistants and truthful attribution

### Controlled automatic first pass

New issues and external pull requests may receive one controlled, comment-only
first pass when the maintainer enables the kill switch. The current runner uses
an Anthropic Messages-compatible transport and may truthfully identify a tier as
DeepSeek or Claude. Cheap and escalation tiers are configured and attributed
independently; the footer names the provider whose reply became the final body.

The runner checks out only the base repository, never executes contributor code,
reads at most six allowlisted text files within byte budgets, and can only post
one comment. Public input remains untrusted and model output may be wrong. A
missing or empty PR diff stops the workflow without posting a review.

Codex automatic attribution is not enabled in v2.2.1. It requires a separately
implemented and trusted OpenAI/Codex transport; a model name or repository
variable alone cannot enable it. Codex automatic attribution remains disabled in v2.3.0.

### Maintainer-reviewed Codex text

A maintainer-reviewed issue comment or pull-request response drafted with Codex
uses:

```md
---
🤖 Generated with [OpenAI Codex](https://developers.openai.com/codex/)
```

This means the maintainer reviewed the text. It does not add a synthetic
`Co-Authored-By` identity or imply that the automatic runner used Codex.

### Maintainer-only mention agent

`.github/workflows/claude.yml` is a separate, maintainer-gated Claude Code
workflow with repository write permissions. v2.2.1 does not migrate this privileged workflow to Codex.
v2.3.0 still does not migrate this privileged workflow to Codex. Treat every
assistant reply as a starting point, not repository authority; the maintainer
makes the final decision.

## Code of conduct

Be kind and constructive. We're all here to make a useful tool.
