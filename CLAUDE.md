# CLAUDE.md

Compatibility entry point for Claude Code. `AGENTS.md` is the canonical repository policy;
read and follow it before changing this repository. The
faithful maintainer review copy is `AGENTS.zh-CN.md`.
For PR integration, follow its [Git and release discipline](AGENTS.md#git-and-release-discipline):
default to Squash and merge, one commit per PR on `main`, while retaining local
stage commits until merge for verification and rollback. Normal or rebase merges
require an explicit maintainer exception; preserve original PRs and truthful credit.
Use its task-scoped documentation routes rather than loading every historical
plan. Verify the actual checkout/branch and current local handoff before a
version-specific task; a source manifest version is not proof of publication.

The current 2.5.0 test candidate combines local achievements and Codex compressed-log
compatibility; it is unreleased and integration validation is ongoing. Follow the
expanded `.jsonl` / `.jsonl.zst` usage allowlist in `AGENTS.md`; source logs remain read-only.

Claude-specific compatibility notes:

- From v2.3.0 the product monitors more than one provider: Claude is the
  primary provider; Codex ships as a beta provider using local logs and clearly
  labelled API-equivalent cost estimates, never a bill or subscription charge.
  Codex is also a development tool for this repository — do not conflate the
  two roles.
- Claude conversation JSONL is read-only. OAuth credential refresh is a
  separate, existing security-sensitive behavior; do not broaden it casually.
  The existing opt-in, exactly confirmed single-log move to OS trash is separate
  from read-only usage ingestion and derived-data clearing, not an agent permission.
- Claude runtime usage refreshes go through `claudeIncrementalIndex.ts`; do not
  restore the old full-corpus read and full-record aggregation path after each
  watcher event.
- JSONL activity may tune the quota-cache TTL, but polling always follows
  `refreshInterval`; do not restore a hidden active polling override.
- Do not create a second policy source here. Update `AGENTS.md` and its Chinese
  review copy when repository rules change.
- F5 and installed-VSIX smoke tests use fully isolated writable state. A separate
  window is insufficient; follow `tests/native/README.md` without replacing daily Code.
