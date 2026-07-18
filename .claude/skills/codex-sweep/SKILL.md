---
name: codex-sweep
description: >-
  Sweep the day's open pull requests for unresolved Codex review findings and act on
  each one — fix the contained ones, ask about the ambiguous ones, and resolve the
  threads. Use this whenever the user wants to catch up on Codex reviews across their
  PRs: "check today's PRs for Codex feedback," "are there any open Codex reviews to
  deal with," "sweep the PRs and address Codex," "go through the Codex comments,"
  "clear the review backlog," or any request to review, triage, or clean up Codex
  (chatgpt-codex-connector) findings across more than one PR at once. This is the
  multi-PR sweep; for a single branch you're actively shipping, use /ship instead.
---

# Codex Sweep

Codex (`chatgpt-codex-connector[bot]`) auto-reviews every PR in `ivjames/ffc` and posts
line-level findings as review threads. This skill walks all the open PRs, gathers the
Codex findings that are still unresolved, and works through them: fixing what's clearly
fixable, checking in on what's ambiguous, and marking each thread resolved as it's handled.

Think of it as the fleet version of `/ship`. `/ship` babysits one branch you're pushing
right now; this sweeps everything that's open and cleans up the review backlog.

## The one thing that will bite you: unresolved ≠ unaddressed

GitHub does **not** auto-resolve a Codex thread when the underlying code gets fixed. A
finding stays `is_resolved: false` forever unless someone explicitly resolves it — so you
will regularly find "unresolved" threads whose defect was already fixed in a later commit
(or in a sibling PR on the same branch). If you blindly re-fix everything unresolved,
you'll rewrite code that's already correct and create noise.

So the rule is **verify before you act**: for every unresolved finding, read the current
code on the PR's branch and decide whether the described problem is *still true*. Only
then do you fix, ask, or dismiss. If it's already handled, just resolve the thread.

## Before you start

The sweep checks out each PR's branch to make and verify fixes, so the working tree must
be clean. Check `git status`; if there are uncommitted changes, stop and tell the user —
don't stash their work silently. Record the current branch so you can return to it at the
end:

```
git status --porcelain        # must be empty
git rev-parse --abbrev-ref HEAD   # remember this; restore it when done
```

Assume `owner=ivjames`, `repo=ffc`, default branch `main` unless a call proves otherwise.

## Step 1 — Enumerate the open PRs

List every open PR:

- `list_pull_requests` with `state: "open"`, sorted by `updated`/`desc`.

For each, keep the PR number, `head.ref` (the branch), and `head.sha`. All the current
PRs live in the same repo; if you ever hit a PR from a fork (head repo ≠ `ivjames/ffc`),
you can't push to it — flag it in the report and skip fixing it.

## Step 2 — Collect the unresolved Codex findings

For each open PR, pull its review threads:

- `pull_request_read` with `method: "get_review_comments"` → `review_threads[]`.

Note: this MCP method is GraphQL-backed and returns *threads* — each with `is_resolved`,
`is_outdated`, and a `PRRT_…` node `id` — not the flat per-comment records of the REST
review-comments endpoint. That thread shape is exactly what makes the unresolved-filtering
and the `resolve_review_thread` calls below work.

Codex's line-level findings are what matter here (not its top-level summary review, and
not its 👍 reaction when it has nothing to add). Keep a thread only if **both**:

- `is_resolved == false`, and
- its first comment's `author` is `chatgpt-codex-connector`.

A thread may already carry a non-Codex reply — but a reply is not proof the finding was
handled. A reviewer might have replied to ask a question, or to say "yes, please fix this,"
while leaving the thread open; skipping on the mere presence of a reply would drop a still-real
finding forever (and can produce a bogus "all clear"). So verify a replied-to thread against
the current code like any other (Step 3). Only treat a thread as settled without re-checking
when a reply explicitly records a completed triage — for instance a prior sweep's own reply
marking it a false positive.

From each kept thread, capture:

| Field | Where | Used for |
|---|---|---|
| thread node ID | `id` (looks like `PRRT_…`) | resolving the thread |
| comment number | trailing digits of `comments[0].html_url` (`…#discussion_r3609246646` → `3609246646`) | replying to the thread |
| file + line | `comments[0].path`, `comments[0].line` | locating the code |
| finding text | `comments[0].body` | understanding the ask |
| priority | the `P1`/`P2`/`P3` badge at the top of the body | ordering — do P1 first |
| outdated? | `is_outdated` | a strong hint the code has moved since; verify extra carefully |

If no PR has any unresolved Codex finding, report "all clear" and stop.

## Step 3 — Verify each finding against current code

This is the step that keeps the sweep honest (see the warning above). For each finding,
look at the actual code as it stands on the PR's branch — read the file at `path` around
`line` — and judge which bucket it falls into:

- **Already fixed** — the defect Codex described is no longer present. Don't touch code;
  go resolve the thread (Step 5) and record it as already-addressed.
- **Still real** — the problem is present. Move to Step 4 to act.
- **False positive / out of scope** — the finding misreads the code, or asks for something
  outside this PR's intent. Handle per Step 4's dismiss path.

You can read files without switching branches via `get_file_contents` (pass the PR's
`ref`), or check out the branch first if you're about to fix it anyway. When a finding is
`is_outdated`, lean toward "already fixed" but still confirm — outdated just means the diff
hunk moved, not necessarily that the bug is gone.

## Step 4 — Act on the real findings

Mirror the judgment model from `/ship`:

**Clear, correct, and contained** → fix it. Check out the branch, make the change, verify,
commit, push:

```
git fetch origin <branch>
git checkout <branch>
git pull --ff-only origin <branch>
# ... make the edit ...
npm run typecheck && npm run build   # both must pass before you push
git add <the files the fix touched>  # stage edits AND any new files a fix adds — `-am` skips untracked files
git commit -m "<what you fixed, in one line>"
git push -u origin <branch>
```

Then resolve the thread (Step 5). Keep the commit focused on the finding; if one PR has
several findings, a commit per finding (or one tidy commit covering them) is fine — just
keep the message honest about what changed.

**Ambiguous, architectural, or you'd be guessing** → don't guess and don't merge over it.
Use `AskUserQuestion`, quoting the finding and its `file:line`, with concrete options
(e.g. the fix you'd propose vs. leaving it). Include enough context that the user can
answer without opening the PR. Act on their answer; if they defer, leave the thread and
note it as pending in the report.

**False positive or out of scope** → post one brief reply explaining why
(`add_reply_to_pull_request_comment` with the comment number and `pullNumber`), and leave
the thread unresolved so the user can overrule you. Don't resolve it — an unresolved thread
with your reply is the signal that it was triaged, and Step 2 will skip it next time.

Always verify with `npm run typecheck && npm run build` before pushing. Every PR in this
repo is expected to build clean; pushing a fix that breaks the build is worse than the
original finding.

## Step 5 — Resolve the thread

After a fix is pushed (or when you confirmed the finding was already addressed):

- `resolve_review_thread` with the thread's node `id` (the `PRRT_…` value).

Resolving is what makes the sweep idempotent — a re-run won't re-examine a finding you've
already closed out. Don't post a "done" reply on fixed threads; the resolve + the commit
are the record. Only false positives get a reply (Step 4), and those stay unresolved.

## Step 6 — Give Codex a chance to re-review

When you push a fix, Codex re-reviews the new commit and may post fresh findings, usually
within a minute or two. After pushing to a branch, give it a short pause and re-check that
one PR's threads once (`get_review_comments` again), handling anything genuinely new the
same way. Do **not** busy-wait with a foreground `sleep` (it's blocked) — pause with a
backgrounded wait, the `Monitor` tool, or a scheduled re-check.

Don't loop on this indefinitely — one re-check per branch you pushed to is enough. Anything
that lands later will be caught the next time the sweep runs.

## Step 7 — Restore and report

Return to the branch you started on (`git checkout <original-branch>`), then give the user
a compact summary. Per PR, list each finding and its outcome; end with a one-line total.

```
Codex sweep — 3 open PRs, 5 unresolved findings

#56 Go-Karts
  • P2 GoKarts.tsx:164 hairpin lanes overlap → fixed (a1b2c3d), thread resolved
  • P3 track.ts:88 unused import → already fixed on branch, thread resolved
#57 Leaderboard layout
  • P1 TopBar.tsx:22 safe-area offset dropped on scroll → asked you (ambiguous), pending
#54 Deploy tweaks
  • P2 deploy.sh:40 quoting → false positive, replied, left open for your call

Fixed 2 · asked 1 · already-addressed 1 · dismissed 1. Working tree back on <branch>.
```

Keep it scannable — the user wants to see what changed and what still needs them, not a
transcript of every step.

## Quick tool reference

- List open PRs → `list_pull_requests` (`state: "open"`)
- Get a PR's review threads → `pull_request_read` (`method: "get_review_comments"`)
- Read a file at a ref without checkout → `get_file_contents`
- Reply to a finding → `add_reply_to_pull_request_comment` (numeric comment id + `pullNumber`)
- Resolve a thread → `resolve_review_thread` (`PRRT_…` node id)

Codex identity: author login `chatgpt-codex-connector`. Finding bodies open with a
`![P1/P2/P3 Badge]` and close with "Useful? React with 👍 / 👎." — that footer and badge
are how you know a comment is a Codex finding rather than a human's.
