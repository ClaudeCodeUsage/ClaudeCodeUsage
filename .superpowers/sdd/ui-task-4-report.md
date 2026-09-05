# UI Task 4 — Codex Explore

## RED / GREEN evidence

- RED: added focused identity, usage-view, and Explore renderer tests before
  production changes. The required compile command failed at the intended
  missing contracts: `stableCodexViewKey`, thread/project `viewKey` lineage
  fields, the tree/flat Explore state contract, and the renderer filter input.
- GREEN: after the minimal view-model and renderer implementation, the focused
  Codex identity/usage/view suite passed 52/52.

## Interfaces and decisions

- `stableCodexViewKey()` SHA-256 hashes an existing pseudonymous identity key
  and truncates it to 16 hexadecimal characters. Codex Explore DOM attributes,
  declarative actions, and filter state use that `viewKey`, never a session key,
  project key, raw path, or repository URL.
- Thread rows now carry `viewKey`, optional `parentViewKey`,
  `rootTaskViewKey`, and `depth`. The lineage walk supports three or more
  levels; a cycle or missing parent becomes a neutral top-level row without a
  parent identifier/title.
- Projects sort by their last lineage activity. Their expanded summary shows
  the latest 20 sessions and a truthful `shown/total` count.
- Explore has exactly Projects, Sessions, and Models & effort internal views.
  Sessions declares a tree layout by default and a flat layout whenever a
  query/filter is active. The renderer adds labelled controls, live count,
  accessible details content, filter chips, and declarative-only actions; Task
  6 remains responsible for controller/event wiring.
- Models & effort keeps the established section header, composition, scope,
  and model-table design. No provider cost is invented.

## Verification

Focused:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/codexIdentity.test.js out/test/codexUsage.test.js out/test/codexView.test.js
```

Result: 52 passed, 0 failed.

Full:

```sh
env PATH=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --run compile && /Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: 354 total; 353 passed, 0 failed, 1 skipped (existing filesystem mtime
capability fixture). `git diff --check` passed.

## ⚠️ Concerns

- No Extension Development Host smoke test was run. This task intentionally
  emits declarative Explore actions only; controller wiring is reserved for
  Task 6.

## Independent-review hardening

### RED / GREEN evidence

- RED: 12 review-focused tests were added for the runtime identity contract,
  persisted legacy-key sanitization, verified period membership/availability,
  project previews beyond the global 1,000-row cap, ARIA/hidden tabs,
  controlled filters, orphan/cycle status, complete mobile facts, and an empty
  recent Models scope. Before production changes, TypeScript reported the 10
  intentionally missing contracts. After the data-layer changes, 5 tests
  passed and the 7 renderer tests remained RED.
- GREEN: the four focused files (`codexIdentity`, `codexIndex`, `codexUsage`,
  and `codexView`) pass 93/93. The persistence AST-policy regression found by
  the first full run was fixed by making the same lowercase 64-hex validation
  explicit at the index persistence boundary; the policy/index/identity subset
  then passed 61/61.

### Review decisions

- Pseudonymous identity keys now have a branded type plus a runtime parser.
  `stableCodexViewKey()` rejects anything except exactly 64 lowercase
  hexadecimal characters, so a raw ID, path, URL, short key, or uppercase key
  cannot be silently hashed into public state. Invalid persisted session keys
  degrade to a fixed internal pseudonym; invalid parent/project keys are
  omitted. No invalid raw value is re-hashed.
- Session period membership is derived only from the file's verified
  `period.days` in the snapshot timezone. Rolling/all-time filters are disabled
  unless their coverage is complete, and the no-filter option is the empty
  value so the real `all` period occurs exactly once.
- Missing-parent and cycle rows retain distinct neutral status attributes while
  exposing no identifier. Flat results display the localized parent-task label
  with the localized unavailable value.
- Project previews are selected from each project's complete contribution set,
  independently of the global 1,000-session display cap. Mobile details repeat
  every desktop fact through labelled `dt`/`dd` pairs and the injected
  formatters.
- Explore and Models & effort now render complete ARIA tab relationships and
  initially hide every inactive panel. The recent Models panel reports a real
  empty state and never substitutes seven-day totals.

### Final verification

Focused:

```sh
env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' node_modules/typescript/bin/tsc -p ./ && env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' --test out/test/codexIdentity.test.js out/test/codexIndex.test.js out/test/codexUsage.test.js out/test/codexView.test.js
```

Result: 93 passed, 0 failed.

Full:

```sh
env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: 366 total; 365 passed, 0 failed, 1 skipped (the existing filesystem
mtime capability fixture). No Extension Development Host smoke test was run.

## Final-review follow-up

### RED / GREEN evidence

- RED: three focused regressions were added before the fixes. All three failed
  for the intended behavior gaps: a distinct local directory was absent from
  mobile facts, a stale incomplete `7d` request rendered selected/disabled with
  a period chip and flat layout while showing every row, and German still
  inherited English `sessions` copy.
- GREEN: the three new regressions pass 3/3. The affected renderer/localization
  focused suite passes 34/34.

### Final-review decisions

- Mobile session facts conditionally include the same localized local-directory
  label and value as desktop whenever the directory differs from the displayed
  project name. Both surfaces use the shared HTML escaping path; the regression
  uses markup-like input and verifies that only escaped text is emitted.
- A requested period is now canonicalized against both the allowed period set
  and `sessionPeriodAvailability` before result filtering, chips, selected
  options, layout, visible count, and clear-button state are calculated. A stale
  incomplete period therefore becomes the coherent no-period-filter state;
  the unavailable option remains disabled but is not selected.
- `sessions`, `modelsEffort`, `clearFilters`, and `activeFilters` are required
  `CodexViewCopy` fields. Every non-English UI locale supplies natural copy,
  and the locale completeness test rejects English fallback separately for
  each field.

### Follow-up verification

Focused:

```sh
env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' node_modules/typescript/bin/tsc -p ./ && env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' --test out/test/codexView.test.js out/test/providerSelection.test.js
```

Result: 34 passed, 0 failed.

Full:

```sh
env ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/MacOS/Code' --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: 368 total; 367 passed, 0 failed, 1 skipped (the existing filesystem
mtime capability fixture). No Extension Development Host smoke test was run.
