---
description: Sweep all open PRs for unresolved Codex review findings and act on each — the fleet version of /ship
---

Run the **codex-sweep** skill. Load `.claude/skills/codex-sweep/SKILL.md` and follow its steps exactly — this command is just the discoverable entry point for that skill (the sibling to `/ship`).

In short, the skill sweeps every open PR in `ivjames/ffc`, collects the still-unresolved Codex (`chatgpt-codex-connector`) review threads, and works through them:

- **Verify before acting** — for each unresolved finding, read the current code on the PR's branch first. GitHub never auto-resolves a Codex thread when the code is fixed, so a thread can be `is_resolved: false` yet already addressed. If it's already handled, just resolve the thread; don't rewrite good code.
- **Fix the contained ones** — check out the branch, edit, `npm run typecheck && npm run build`, commit, push, then resolve the thread.
- **Ask on the ambiguous ones** — use `AskUserQuestion` for architectural or judgment-call findings instead of guessing.
- **Dismiss false positives** — reply once explaining why, leave the thread unresolved for review.
- **Report** — a compact per-PR summary of what was fixed, asked, already-addressed, and dismissed.

Preconditions and full details (tool calls, thread/comment ID shapes, the re-review pass) live in the skill file — defer to it.

Invoking `/codex-sweep` IS the go-ahead to run the sweep; only pause via `AskUserQuestion` when a specific finding is genuinely ambiguous.
