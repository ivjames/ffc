---
description: Create a PR from the current branch and squash-merge it into main
---

Ship the current branch: open a PR into `main` and squash-merge it, in as few steps as possible.

Do exactly this, and skip anything not listed:

1. Ensure the working tree is clean and the branch is pushed (`git push -u origin HEAD` if there are unpushed commits). If there is nothing to ship (branch equals `main`, or no diff vs `origin/main`), say so and stop.
2. Create the PR with base `main`, head = current branch. Do NOT check for an existing open PR first — `/ship` merges immediately, so a lingering open PR for this branch won't exist; just create one. Do NOT check for a PR template either — there isn't one. Write a short body straight from the commits; skip the template lookup entirely.
3. Squash-merge it immediately with `merge_method: "squash"`.
4. Report the merge SHA and PR number in one line. Do not ask for confirmation — invoking `/ship` IS the confirmation.

Assumptions to avoid extra round-trips: the default branch is `main` and the repo is `ivjames/ffc`. Only look these up if a call fails because the assumption was wrong.
