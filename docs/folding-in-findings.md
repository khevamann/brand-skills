# Folding platform findings back into the skill

The admin steps for WordPress, Shopify, Squarespace and other platforms were written
from research, without a logged-in test site. Each project folder therefore carries a
`platform-findings.md`, which the agent fills in as real work reaches each open question.
This page is for Kheva, who maintains the skill (the name lives in
`scripts/core/findings.mjs` as `MAINTAINER`): how to turn those files into a better
skill.

## When a findings file arrives

Ask the person for their project's `platform-findings.md`. Never ask for the whole
folder: `SITE.md` and `admin-guide.md` hold things about their site that the skill does
not need. Then, in a Claude Code session in this repo:

> Fold this platform-findings.md into the skill. [attach the file]

## What folding in means

For each answered question (`WP-4`, `SH-3`, …) in
`plugins/website/skills/website/references/platforms/<platform>.md`:

1. **Rewrite the guide's instructions to match what was seen.** Use exact labels and
   URLs. Remove "(unverified)" from steps that are now confirmed. Where the finding
   contradicts the guide, the finding wins. If two findings disagree (different plans,
   versions or plugins), keep both and say when each applies.
2. **Remove the question from the First-time checklist** once its answer is in the
   guide and generalises. Keep it if the answer may differ by plan or theme, rewording
   it to ask about that difference. Never reuse a removed ID.
3. **Fix the code when a finding says a link or pattern is wrong.** Admin link patterns
   live in `scripts/core/platforminfo.mjs`. Flip `verified: false` to `true` for a
   pattern that has been confirmed.
4. **Add new questions** for surprises recorded under "Other findings" that the next
   site should check.

Once a platform's apply steps have been confirmed end to end, update the banner at the
top of its guide, and the `untested procedures are labelled` test in
`scripts/test/docs.test.mjs`. Do it deliberately, in the same commit.

## Why it works this way

The plugin directory is replaced on every update, so the agent cannot improve the skill
in place. Findings live with the project and travel back by hand. Splitting them from
`admin-guide.md` keeps the platform lessons separate from site specifics, so a findings
file can be shared without exposing anything about the site beyond its address.
