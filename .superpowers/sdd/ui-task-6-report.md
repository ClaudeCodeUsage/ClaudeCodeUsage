# Product UI Task 6 report: root-scoped Codex controller

Status: **implemented and verified in the automated test environment**

## RED evidence

Tests were written before `src/codexViewClient.ts` existed. The first bundled
TypeScript compile failed only on the intended missing production module:

```text
src/test/codexViewClient.test.ts(5,38): error TS2307: Cannot find module '../codexViewClient'
```

The initial fixture type error was corrected on the test side and the compile
was rerun before production implementation, leaving the missing module as the
sole RED cause. Two later focused RED cycles caught narrower contracts:

- Recommendation scope controls lacked complete tab/tabpanel ARIA linkage.
- A settings control could post on `click` as well as its intended `change`
  event, which would duplicate a checkbox update in a browser.

Both focused tests were observed failing for those exact causes before the
minimal production changes.

## Controller and state contract

- Added `getCodexClientScript(): string`, returning one non-global IIFE. It
  returns immediately without `[data-codex-root]` and installs only delegated
  `click`, `input`, `change`, and `keydown` listeners on that root.
- Every handled action comes from
  `event.target.closest('[data-codex-action]')`; handled actions prevent default
  and stop propagation, while unknown, disabled, malformed, or wrong-event
  actions fail closed.
- The sole persistent payload is `vscode.getState().codexUi`. Initialization
  sanitizes, prunes against the current DOM, applies once, then persists while
  preserving host siblings such as `openDetails`.
- Restored state includes page/return page, Overview and Recommendation scopes,
  Explore view/scope, chart metric, bounded search, filters, both sorts,
  expanded projects, and recursively collapsed task keys. Missing/disabled DOM
  values and stale safe view keys fall back or are removed.
- Codex settings accept only the current Codex/shared setting key catalog, the
  exact expected type/source, bounded or enum/select-valid values, and a strict
  JSON array of allowlisted reset keys. No evaluation or dynamic function
  construction is used.

## Production action matrix

| Action | Behavior |
| --- | --- |
| `select-page`, `open-settings`, `close-settings` | Page/return-page state, panel visibility, selected/roving tab state |
| `set-overview-scope`, `set-recommendation-scope` | Truthful independent scope panel selection |
| `set-model-effort-scope`, `select-behavior-scope` | Shared restored scope for the corresponding nested panels |
| `set-chart-metric`, `select-chart-metric` | Bars, height, metric class, value, title, y-axis and pressed state |
| `select-explore-view` | Projects/Sessions/Models & effort tab and panel state |
| `view-task` | Explore → Sessions, project filter, exact rooted task focus/scroll |
| `drilldown-date` | Select/focus/scroll the exact row in the clicked Overview scope; no invented hourly data |
| `filter-sessions`, `remove-filter`, `clear-filters` | Query/role/project/model/effort/verified-period filters, chips, count and flat/tree layout |
| `toggle-thread-children` | Persisted recursive descendant collapse |
| `project-sessions` | Persisted project detail expansion |
| `sort-projects`, `sort-sessions` | Persisted direction and `aria-sort`; project detail and session lineage units travel together |
| `set-setting`, `reset-settings` | Exact `updateSetting` / `resetAllSettings` host messages after strict validation |

The renderer test derives all production `data-codex-action` values and proves
that every one has a controller branch. The dormant legacy Behavior component
action is also accepted without exposing a global handler.

## Renderer and Claude isolation

- Overview now has one trend module containing independent `recent`, `7d`,
  `30d`, and `all` datasets/panels: the recent task aggregate, verified 7/30-day
  daily rows, and all-time monthly rows. Inactive panels are hidden.
- Added safe date/month row attributes, session period membership, rooted task
  view keys, explicit Explore panel keys, actionable filter chips, controller
  sort actions, and full Overview/Recommendation tab linkage.
- Removed the old Codex restore/filter/toggle/show functions, Codex
  `localStorage` keys, and Codex window globals from `webview.ts`.
- The Claude document-level sort/chart/bar delegation returns immediately for
  a Codex-root target and only accepts `.chart-tab[data-metric]`. The delayed
  all-`.daily-breakdown` rebinding was removed; dynamic Claude drilldowns retain
  their scoped binder with the same guards.

## Automated verification

Bundled Node was used because `npm` is unavailable and `pnpm` is forbidden.

Focused command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/typescript/bin/tsc -p ./ && \
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/codexViewClient.test.js out/test/providerSelection.test.js \
  out/test/codexView.test.js out/test/codexUiState.test.js
```

Result: **57 passed, 0 failed**.

Fresh full-suite command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: **386 passed, 0 failed, 1 skipped** out of 387. The skip is the
pre-existing exact-inode-mtime filesystem capability case.

The executable lightweight DOM fixture runs the emitted IIFE and invokes the
fixture-mode delegated callbacks. It verifies sibling-preserving/pruned
restoration, page/scope/metric/filter/collapse/expand/sort/settings/keyboard
behavior and unknown/malformed fail-closed paths; the Task does not rely only
on regular expression assertions.

## Review-hardening follow-up

The review follow-up first extended only the lightweight fixture semantics
needed to express the reported boundaries: enabled/disabled `select` options,
`valueAsNumber` and `validity`, number constraints, moving `appendChild`, and
chip removal. The pre-existing five controller tests still passed before the
new assertions were added, separating fixture errors from production RED
evidence.

The expanded controller run then produced the intended RED result: **9 passed,
25 failed** out of 34. The failures independently exercised stale/disabled
period restoration, invalid number inputs, wrong filter controls/events,
missing project details, malformed sort inventory, disabled or incomplete
scope payloads, hidden date panels, and invalid/rooted task navigation. After
the minimal controller hardening, the controller result was **34 passed, 0
failed**.

The hardened controller now additionally:

- accepts a restored or changed session-filter value only when the real
  allowlisted `select` contains an enabled option and at least one session row
  belongs to it; `disabled` and `aria-disabled="true"` period options fail
  closed and restore to the empty/tree state;
- rejects blank/whitespace, browser-invalid, non-finite, input-constraint, and
  schema-invalid number settings, preferring a finite `valueAsNumber` and
  otherwise parsing only non-empty text;
- validates the control kind and exact event type before mutating filter state,
  and validates project-detail, sort-header/table/row, visible date-panel, and
  same-project root-task inventories before consuming an action;
- resolves `view-task` to the actual root row object (including a same-project
  `data-codex-root-task-view-key` fallback), so child, unknown, and mismatched
  targets cannot change page or filter state and sorting cannot redirect focus;
- keeps Recommendation and Models & effort scope changes bound to enabled
  controls with matching rendered panels.

Fresh review-focused command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/typescript/bin/tsc -p ./ && \
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/codexViewClient.test.js out/test/providerSelection.test.js \
  out/test/codexView.test.js out/test/codexUiState.test.js
```

Result: **86 passed, 0 failed**.

Fresh review full-suite command:

```sh
/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test out/test/*.test.js .github/scripts/*.test.mjs
```

Result: **415 passed, 0 failed, 1 skipped** out of 416. The skip remains the
pre-existing exact-inode-mtime filesystem capability case. `git diff --check`
also passed.

This fixture is intentionally not represented as browser-equivalent. It does
not implement native event bubbling/default control behavior, the browser's
form constraint-validation engine, layout, rendered focus/scroll behavior, or
the accessibility tree. Those interactions remain for the Playwright and F5
Extension Development Host quality gates.

`git diff --check` passed, tracked source/test modes remain `100644`, and the
forbidden old Codex global/local-storage patterns are absent.

## Final-review correction: rejected filter changes

The preceding statement that a restored **or changed** disabled period would
return to the empty/tree state was too broad at commit `40a6582`. Restore-time
pruning did canonicalize the state and DOM, but a live `change` to a disabled,
`aria-disabled`, or otherwise inventory-invalid option returned before the DOM
was reapplied. State was not mutated or persisted, yet the browser-mutated
control value could remain visibly stale.

The final review regression adds a `setState` call counter and asserts the full
canonical DOM result after the rejected change: empty period selection, tree
layout, all three fixture rows visible, no active filter chips, and the clear
button hidden. It also proves there is no additional `setState` call. The RED
controller run was **31 passed, 3 failed** out of 34, with all three failures
showing the attempted option value still present. The controller now reapplies
filters only after a correctly shaped allowlisted `select`/`change` reaches an
invalid value; it still returns without consuming the event or persisting.
Wrong events, wrong element types, and unknown filter keys neither consume nor
resynchronize and retain their attempted fixture value.

After that single production fix, the controller run was **34 passed, 0
failed**. The fresh compile plus four-file focused command above was **86
passed, 0 failed**, and the fresh full-suite command was **415 passed, 0
failed, 1 skipped** out of 416. The skip remains the pre-existing
exact-inode-mtime filesystem capability case.

## Final-review correction: canonical filters and keyboard ownership

The last review cycle added executable emitted-IIFE regressions before changing
production. Its RED controller run was **41 passed, 4 failed** out of 45. Three
failures showed that duplicate filter controls could mutate/persist state or be
resynchronized; the fourth showed that the generic route still explicitly
allowed `keydown`. The eight new keyboard behavior/count assertions already
passed at RED, documenting the existing runtime behavior separately from the
structural ownership defect.

Filter collection and synchronization now resolve one canonical search input
and one canonical `select` for each allowlisted filter key. A duplicate control
is ignored even when its key and value are otherwise legal: it is not consumed,
resynchronized, persisted, or allowed to mutate state. An invalid value on the
canonical `select` alone receives the intentional no-persist DOM resync. After
this identity fix, the intermediate controller run was **44 passed, 1 failed**,
leaving only the generic-keyboard contract RED.

The generic delegated route now accepts non-filter/settings actions only on
`click`. The dedicated tab-keydown path owns keyboard activation: Enter and
Space perform and persist at most once and prevent the native default, while
ArrowLeft, ArrowRight, Home, and End move roving focus without action or
persistence. Enter/Space on a non-tab action do nothing; a later click still
performs and persists exactly once. The GREEN controller run was **45 passed, 0
failed**.

The fresh four-file focused run was **97 passed, 0 failed**. The fresh full
suite was **426 passed, 0 failed, 1 skipped** out of 427; the skip remains the
pre-existing exact-inode-mtime filesystem capability case. `git diff --check`
also passed.

The lightweight fixture does not generate the browser's native button default
click after a keydown, so it cannot itself prove absence of that synthesized
event. It does prove the single-action/persistence counts and the
`preventDefault` contract. Native Enter/Space event sequencing remains a
Playwright/browser or F5 Extension Development Host quality-gate boundary.

## ⚠️ Quality-gate concerns

- F5 Extension Development Host smoke testing and the full Playwright
  interaction/accessibility pass require a GUI-capable VS Code environment and
  remain for the Product UI quality gate. They were not represented as having
  run here.
- Task 7 owns provider-shell visual/accessibility unification. Task 6 adds only
  the minimum semantic DOM contracts required for truthful controller behavior
  and does not redesign the Claude or Codex visual system.

---
🤖 Generated with [OpenAI Codex](https://developers.openai.com/codex/)
