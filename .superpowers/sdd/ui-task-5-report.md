# UI Task 5 report: evidence-driven Codex recommendations

Status: **DONE**

## RED evidence

Tests were written before the recommendation implementation in:

- `src/test/codexInsights.test.ts`
- `src/test/codexView.test.ts`

Bundled Node was used because `npm` is unavailable in this environment:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/typescript/bin/tsc -p ./
```

The first RED compile failed as intended: the old implementation accepted only
one `buildCodexInsights` argument, exposed the old
`post-patch-tool-call-intensity` kind, and lacked `scope` on `CodexInsight`.
No production change preceded that failure.

## GREEN implementation

- Replaced the advice contract with the five approved neutral kinds and the
  allowlisted numeric/aggregate evidence keys. Every insight has `proxy: true`.
- Empty evidence produces `[]`; `pasteReadyConstraint([])` is empty and
  non-empty constraints are only the sentences for the actual triggered kinds.
- Effort insight only proposes a representative-task A/B comparison. Cache and
  structural signals are explicitly proxies, not file, command, test, or review
  counts; no conversation body, tool arguments, path, cost, or other content is
  read by the recommendation code.
- Recommendations render role/model/effort composition and proxy KPIs, then
  cards in the fixed scope → observation → readable evidence → proxy note →
  conditional-action order. Internal evidence keys are never rendered.
- The declarative `set-recommendation-scope` selector disables partial 7d/30d
  ranges with an adjacent migration note. Recent and aggregate all-time remain
  available. Complete scopes with no insight show an accurate empty state.
- Added Codex copy fields plus an eight-locale completeness test; existing
  locale override titles use the new kinds.

## Verification

Focused GREEN command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/typescript/bin/tsc -p ./ && \
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/codexInsights.test.js out/test/codexUsage.test.js \
  out/test/providerSelection.test.js out/test/codexView.test.js
```

Initial Task 5 result: **66 passed, 0 failed**.

Full-suite command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/typescript/bin/tsc -p ./ && \
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/*.test.js .github/scripts/*.test.mjs
```

Initial Task 5 result: **371 passed, 0 failed, 1 skipped**. The skip is the pre-existing
filesystem capability case that cannot preserve an exact inode mtime.

`git diff --check` passed.

## Threshold semantics

- Multi-agent: at least 3 child threads and ≥40% fresh share.
- Approval reviewer: ≥20% approval-reviewer fresh share.
- Effort comparison: observed high effort in a 1–2 patch structural proxy
  scope, except where the multi-agent shape already explains the scope.
- Post-patch proxy: ≥5 post-patch tool calls or ≥3 tool calls per patch.
- Cache/context: processed-to-fresh ratio ≥2.5.

These are neutral evidence thresholds, not causal, cost, efficiency, file,
command, test, or review claims.

## Review follow-up

Review tests were added before the follow-up implementation. The first focused
RED compile failed because `buildScopedCodexInsights` did not yet exist. A later
locale RED failed when `de-DE.recommendations` still fell back to English, and
the copy-policy RED failed while the legacy generic constraint keys remained in
the merged user-facing object.
A final empty-state RED caught stale scoped insights surviving a refresh error
and a null webview view before both boundaries were normalized.

- Added one shared `CodexScopedInsights` host/render contract and the pure
  `buildScopedCodexInsights(view)` helper. The production fixture returns
  `recent=1`, `7d=1`, `30d=2`, and `all=1`; every item carries its explicit
  scope. Extension/webview initial, disabled, unavailable, refresh-error, and
  empty states use a four-empty-scope object.
- The deprecated one-argument builder now fails closed for every object with
  `periodCoverage`, including complete coverage. Production rolling callers
  pass `7d` or `30d` explicitly.
- Every complete recommendation panel renders its own scoped constraint; a
  partial rolling panel renders neither cards nor a constraint.
- Composition now gives comparable numeric fresh totals and shares for root,
  child, approval-reviewer, model, and effort dimensions, without cost claims.
- All seven non-English locales provide localized values for the 13 relevant
  scalar fields, five observations, five tips, and 15 evidence labels (their
  existing five titles remain localized). Deep merge preserves complete maps,
  and legacy generic test/stop constraints are stripped from the user-facing
  copy object.

Review focused result: **71 passed, 0 failed**.

Review full-suite result: **376 passed, 0 failed, 1 skipped**. The skip remains
the pre-existing exact-inode-mtime filesystem capability case.

## Concerns

No blocking concern. Task 6 client-controller behavior was intentionally left
untouched.
