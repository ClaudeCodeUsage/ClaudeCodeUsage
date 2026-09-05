# CLAUDE.md

Compatibility entry point for Claude Code. `AGENTS.md` is the canonical repository policy;
read and follow it before changing this repository. The
faithful maintainer review copy is `AGENTS.zh-CN.md`.

Claude-specific compatibility notes:

- From v2.3.0 the product monitors more than one provider: Claude is the
  primary provider; Codex ships as a beta provider using local logs and clearly
  labelled API-equivalent cost estimates, never a bill or subscription charge.
  Codex is also a development tool for this repository — do not conflate the
  two roles.
- Claude conversation JSONL is read-only. OAuth credential refresh is a
  separate, existing security-sensitive behavior; do not broaden it casually.
- Claude runtime usage refreshes go through `claudeIncrementalIndex.ts`; do not
  restore the old full-corpus read and full-record aggregation path after each
  watcher event.
- JSONL activity may tune the quota-cache TTL, but polling always follows
  `refreshInterval`; do not restore a hidden active polling override.
- Do not create a second policy source here. Update `AGENTS.md` and its Chinese
  review copy when repository rules change.
