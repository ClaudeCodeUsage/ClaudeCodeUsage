# UI Task 3 — Codex usage overview

## RED / GREEN evidence

- RED: added focused limit, formatter, usage-view, and Overview renderer tests
  before the production modules. The required compile/test command failed with
  the expected missing `codexLimits` / `codexFormat` module errors and absent
  classified-limit and safe task-identity fields.
- GREEN: the focused suite passed after adding the pure limit and formatter
  modules, exposing classified view data from `buildCodexUsageView`, and
  rebuilding only the Overview interior as limits → recent task → trend.

## Interfaces and decisions

- `codexLimits.ts` classifies each locally observed window as `current`,
  `expired`, `missing`, or `unlimited`. A 0% window with a future reset stays
  current; an observation without a reset is stale/expired rather than being
  presented as indefinitely current.
- `codexFormat.ts` owns side-effect-free locale-aware duration, relative-time,
  and byte formatting. 300-minute and 10080-minute labels remain product copy
  (5-hour/weekly); other windows use the duration formatter.
- `CodexUsageView.limits` is renderer-ready. The legacy `limit` field remains
  only for the status bar, whose existing current-window behavior is unchanged.
- Recent-task DOM values use deterministic synthetic `task-*` and `project-*`
  keys. No raw session or project ID is rendered. Duration now truthfully says
  “Observed session duration total (proxy)” (and localized equivalents).
- The Overview contains exactly one trend module with declarative scope,
  metric, and date-drilldown actions. It deliberately adds no controller;
  interaction wiring remains UI Task 6.
- Token composition remains three additive segments (fresh input, cached input,
  output). Reasoning is shown only as an output subset.

## Verification

Focused command:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/codexLimits.test.js out/test/codexFormat.test.js out/test/codexUsage.test.js out/test/codexView.test.js
```

Result: 36 passed, 0 failed.

Full command:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: 344 total; 343 passed, 0 failed, 1 skipped (the existing filesystem
mtime capability fixture).

`git diff --check` also passed.

## ⚠️ Concerns

- No Extension Development Host smoke test was run: this task intentionally
  emits only declarative Overview actions and leaves the controller for UI Task
  6. The pure renderer, compile, and full Node suite are verified.

## Review follow-up

### RED / GREEN evidence

- RED: production-path formatter and source-copy tests were added before the
  implementation. Compilation failed at the four expected references: the
  missing `createCodexLocalizedFormatters` export in two test modules and the
  missing `accountSnapshotLastObserved` copy key in the locale-completeness
  test and its index expression.
- GREEN: the focused suite now passes 44/44. Its production-shaped
  `de-DE` + `Asia/Hong_Kong` fixture verifies localized date/time, duration,
  relative countdown, and byte rendering together.
- Recent rooted-task identity is now anchored only to the canonical root's
  pseudonymous session key. Appending a child leaves both rendered task and
  project keys unchanged; reordered cycle and parentless-orphan fixtures prove
  deterministic safe fallbacks without exposing raw session or project keys.
- Limit source copy now distinguishes local-log observations from OAuth
  account snapshots. Both sources have renderer coverage, and locale
  completeness covers all eight UI locales.

### Verification

Focused command:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/codexFormat.test.js out/test/codexLimits.test.js out/test/codexUsage.test.js out/test/codexView.test.js out/test/providerSelection.test.js
```

Result: 44 passed, 0 failed.

Full command:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: 348 total; 347 passed, 0 failed, 1 skipped (the existing filesystem
mtime capability fixture).

`git diff --check` passed after the review changes.

### ⚠️ Concerns

- The Extension Development Host smoke test remains deferred to the controller
  integration task; the production formatter wiring, pure renderer, compile,
  focused suite, and full Node suite are verified here.
