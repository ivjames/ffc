---
description: Open a PR from the current branch, wait for review, address feedback, then squash-merge into main
---

Ship the current branch: open a PR into `main`, give automated review a chance to weigh in, address anything it finds, then squash-merge.

Do exactly this, and skip anything not listed:

1. Ensure the working tree is clean and the branch is pushed (`git push -u origin HEAD` if there are unpushed commits). If there is nothing to ship (branch equals `main`, or no diff vs `origin/main`), say so and stop.

2. Create the PR with base `main`, head = current branch. Do NOT check for an existing open PR first, and do NOT look for a PR template — there isn't one. Write a short body straight from the commits.

3. Give reviewers ~5 minutes. Codex auto-reviews a new PR — it posts as `chatgpt-codex-connector[bot]`, usually within a few minutes, and reacts 👍 instead of commenting when it has nothing to add. Poll the PR's reviews and review comments about once a minute until a Codex review has posted or ~5 minutes have elapsed since you created the PR. Do NOT busy-wait with a foreground `sleep` (it's blocked) — pause between checks with a backgrounded wait, the Monitor tool, or a scheduled re-check.

4. Address anything that came up — Codex findings and any human review comments:
   - Clear, correct, contained fix: make it, commit, and push to the branch. After pushing, give Codex a short moment (~1–2 min) to re-review the new commit, and handle any new findings the same way.
   - Ambiguous, architectural, or anything you'd be guessing at: use AskUserQuestion to check before acting — don't merge over it and don't guess.
   - A finding you judge to be a false positive or out of scope: note briefly why and move on.
   - Also confirm any CI checks that exist are passing; don't merge over a red required check.

5. Squash-merge with `merge_method: "squash"` once feedback is handled and checks are green.

6. Report in a couple of lines: the PR number, the merge SHA, and a one-line summary of any review findings you addressed (or "no review findings"). Invoking `/ship` IS the confirmation — don't ask before creating, waiting, or merging; only pause via AskUserQuestion when a specific finding is genuinely ambiguous.

Assumptions to avoid extra round-trips: the default branch is `main` and the repo is `ivjames/ffc`. Only look these up if a call fails because the assumption was wrong.
