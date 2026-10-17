<!--
Thanks for contributing. Follow CONTRIBUTING.md; keep this PR focused.
Fill applicable sections and mark others N/A. Do not include credentials,
raw conversation logs, personal paths or unredacted screenshots/profiles.
Describe changes directly; omit private request and approval narratives.
Summaries, checklists and review comments describe the change, tests and
limitations, not private conversations or agent execution instructions.
-->

## Summary

<!-- What does this PR do, in 2–4 sentences? What problem does it solve? -->

## Linked issues

<!-- e.g. "Closes #42" / "Relates to #17". Write "None" if standalone. -->

## Type of change

<!-- Select the relevant type. Maintainers own release labels: ordinary
     feature/fix/docs labels resolve to patch; add `minor` for a minor release,
     or `breaking` / `major` for major. Do not bump package.json or create tags.
     Internal-only changes use `skip-changelog`; do not hide user-facing changes.
     Integration defaults to Squash and merge through the original PR,
     preserving the author and applicable coauthors. See CONTRIBUTING.md. -->
- [ ] Bug fix / performance improvement
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation / CI / maintenance

## Visual design (if applicable)

<!-- New visual systems or substantial redesigns: link imagegen's 2–3 distinct
     directions, the selected design and maintainer approval before production
     UI implementation. Then turn the design into acceptance criteria and TDD.
     Small copy/spacing fixes within an approved design may be N/A.
     Mockups do not replace real rendered or native acceptance evidence. -->

## User-facing release note (if applicable)

<!-- One or two sentences describing the user-visible outcome, relevant
     compatibility/action and limitations. Internal workflow requests, merge
     strategy, test counts and routine rank/threshold requests are not release
     highlights. For internal-only changes write N/A; retain contributor credit. -->

## How was this tested?

<!-- Give commands/steps and observed results. For anything not run, give the
     reason; compilation, prepared launch settings or CLI installation are not
     proof of F5/native acceptance.
     - Automated: focused and full tests relevant to this change.
     - UI, if changed: real-render screenshots, keyboard/accessibility,
       narrow/light/dark/localized views and state after update/reload.
     - Native, if applicable: actual F5/installed-VSIX platform/version/results.
       Use isolated writable state; never replace the daily installation.
     Documentation-only changes need affected facts/links and policy checks,
     not a fabricated claim that every native test was run. -->

## Checklist

- [ ] Relevant checks and any unrun layers are reported accurately above.
- [ ] The diff and evidence contain no private provider data or credentials.
- [ ] If user-visible strings changed, `I18n` covers **all eight UI locales**.
- [ ] If behavior/settings documentation changed, **all nine README files** are updated together; user-visible changes also update `CHANGELOG.md`.
- [ ] Existing defaults and read-only ingestion are preserved, or any exception is explained with maintainer approval.
- [ ] No new runtime dependencies, unless explicit maintainer approval is linked.
