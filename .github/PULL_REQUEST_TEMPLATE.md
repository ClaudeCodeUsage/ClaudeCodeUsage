<!--
Thanks for contributing! A consistently-structured PR makes review fast —
and lets our (future) automated triage assist with first-pass analysis.
Keep the section headings; fill what applies, delete what doesn't.
-->

## Summary

<!-- What does this PR do, in 2–4 sentences? What problem does it solve? -->

## Linked issues

<!-- e.g. "Closes #42" / "Relates to #17". Write "None" if standalone. -->

## Type of change

<!-- Keep one. A maintainer applies the matching label at merge; that label sets
     the release version bump. -->
- [ ] Bug fix (non-breaking) → `fix` (patch)
- [ ] New feature (non-breaking) → `feature` (minor)
- [ ] Breaking change (existing behaviour differs afterwards) → `breaking` (major)
- [ ] Documentation / CI / chore → `docs` / `ci` / `chore` (patch)

## How was this tested?

<!-- Manual steps in the Extension Development Host (F5), test runs, or
     screenshots for UI changes. "Compiles" alone is not testing. -->

## Checklist

- [ ] `npm run compile` is clean
- [ ] User-facing strings go through `I18n` with **all eight UI locales** filled
- [ ] Behaviour/documentation changes update **all seven README editions** together
- [ ] `CHANGELOG.md` updated (user-visible changes)
- [ ] `README.md` updated if behaviour/settings changed
- [ ] New settings default to existing behaviour (opt-in)
- [ ] No new runtime dependencies
