# Contributing

Thanks for your interest in Claude Code Usage — issues, PRs and ideas are
genuinely welcome. This is a small, focused project and contributions are how
it grows.

## Project scope

Before proposing a feature, it helps to know the positioning: this extension is
intentionally **Claude-only and lightweight**, prioritising **token-precision**
(seeing where tokens go) over cost-precision, and using AI to help people use
Claude Code better. Multi-provider monitoring and full billing reconciliation
are explicitly out of scope. Features that sharpen token attribution or the
advice experience are the best fit.

## Development setup

```bash
npm install
npm run compile          # tsc -> out/
npm run watch            # recompile on change
```

- Press **F5** in VS Code to launch the Extension Development Host and test
  your changes manually.
- Package a `.vsix` with `npx @vscode/vsce package`.

The extension reads `~/.claude/projects/**/*.jsonl` **read-only** — it never
writes to your Claude data.

## Pull requests

- Keep each PR focused on one logical change.
- Run `npm run compile` and make sure it's clean before opening the PR.
- Describe the problem and the fix; screenshots help for UI changes.
- If your change affects user-facing behaviour, update `CHANGELOG.md` and the
  relevant parts of `README.md`.

## Tests

Tests use **Node's built-in runner** (`node:test` + `node:assert`) — no extra
dependencies. They run against the *compiled* output:

```bash
npm test          # compiles, then runs node --test over out/test/*.test.js
```

CI runs the same command on every PR (`.github/workflows/test.yml`).

**Where tests live.** Put test files **directly** in `src/test/`, named
`*.test.ts`. Because `tsc` is configured with `rootDir: src`, they compile to
`out/test/` where the runner picks them up, and they're excluded from the
packaged `.vsix`. Keep the directory flat — the `test` script globs
`out/test/*.test.js` (a single level, so it stays portable across Node
versions), which means files in nested subfolders would be silently skipped.

**What to test.** This harness is for **pure, dependency-free logic** — modules
that don't import the `vscode` API:

- pricing & cost calculation (`pricing.ts`)
- aggregation: daily / weekly / monthly / all-time (`dataLoader.ts`)
- quota-window handling (`statusBar.ts`)
- i18n formatting (`i18n.ts`)

If you add or change logic in these, please add a test. `src/test/pricing.test.ts`
is a worked example to copy from. Prefer asserting on **observable behaviour**
(a computed cost, a resolved pricing tier) over implementation details, and add
a case for the tricky edge you just fixed so it can't regress.

**What doesn't belong here.** Anything that touches the live `vscode` API
(status-bar wiring, webview, commands) needs the heavier
[`@vscode/test-electron`](https://github.com/microsoft/vscode-test) harness,
which isn't set up yet. If you need it, raise it on
[#25](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/25) first so we keep the
two harnesses cleanly separated.

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

## Automated first-pass replies (@ccu-bot)

New issues and pull requests may get an **automated first-pass reply** from
`@ccu-bot` — an assistant run via [Claude Code](https://github.com/anthropics/claude-code-action)
that reads the project's architecture docs to help triage faster.

What to expect and its limits:

- Every automated comment is clearly labelled **"🤖 Automated first-pass reply
  (via Claude Code)"** and ends with a note that it is model-generated and a
  **maintainer reviews everything** — it is not a decision.
- It reads `ARCHITECTURE.md`, `CLAUDE.md`, `CONTRIBUTING.md` and, when those
  aren't enough, the relevant repository files. It should **ask rather than
  guess** when unsure — if it ever states something wrong, just correct it; a
  maintainer will confirm.
- It only **comments**. It does not label, close, merge, approve, or push. For
  PRs it reads the diff via the API and **never runs your code**.
- You can summon it in a comment with `@ccu-bot ...` (maintainer-gated).
- The whole thing is **off unless the maintainer enables it** (a repo variable
  kill switch), and the model may be a third-party Anthropic-compatible one, so
  "Claude Code" refers to the tooling, not necessarily Anthropic's Claude.

Treat its replies as a helpful starting point, not authority.

## Code of conduct

Be kind and constructive. We're all here to make a useful tool.
