# server/seed

## open-trivia-pack.ndjson.gz

48,264 multiple-choice trivia questions for the live-trivia question bank,
built from the **OpenTriviaQA** corpus.

| | |
|---|---|
| Upstream | <https://github.com/uberspot/OpenTriviaQA> |
| License | **Creative Commons Attribution-ShareAlike 4.0 International** (CC BY-SA 4.0) |
| License text | <https://creativecommons.org/licenses/by-sa/4.0/> |
| Built by | `scripts/build-trivia-pack.mjs` |
| Loaded by | `server/importTriviaPack.js` (`npm run import:trivia`) |

### Attribution

CC BY-SA 4.0 requires that the source be credited wherever these questions are
used, and that adaptations of the collection carry the same license. The pack's
header line records the source, license and the exact upstream commit it was
built from, and every imported row carries `source = 'opentriviaqa'` — so the
credit survives in the database, not just in this file. **Any player- or
host-facing surface that deals from the platform pack should carry a visible
credit line**, e.g.:

> Trivia questions from OpenTriviaQA, CC BY-SA 4.0.

Note that ShareAlike attaches to the *collection*, not to the facts in it, and
that questions written in Master Control are the operator's own work — the
`source` column is what keeps the two apart.

### Format

Gzipped NDJSON. The first line is a header:

```json
{"pack":"opentriviaqa","source":"…","license":"CC BY-SA 4.0","upstreamCommit":"…","count":48264}
```

Every line after it is one question, in exactly the shape the admin API
accepts:

```json
{"prompt":"…","choices":["…","…","…","…"],"answer":0,"category":"Animals","difficulty":2,"active":true}
```

### Rebuilding

```sh
git clone --depth 1 https://github.com/uberspot/OpenTriviaQA /tmp/otqa
node scripts/build-trivia-pack.mjs --src /tmp/otqa
```

The build is deterministic — no timestamps, and the option shuffle is seeded on
each prompt — so rebuilding from an unchanged upstream produces a byte-identical
file and an empty diff.

### What the build drops, and why

Of 49,716 source questions, 48,264 survive. The build prints the tally; the
reasons are:

| Dropped | Reason |
|---:|---|
| 653 | Rejected by `normalizeQuestion` — the same validator the admin write path uses. Mostly prompts over 300 characters, plus 89 over-long options and 24 with duplicate choices. |
| 460 | Duplicate prompts. The corpus repeats questions across category files. |
| 339 | Not family-safe. This is a family fun center; the filter is tuned to over-block. |

The build also repairs the corpus rather than passing it through: mixed
UTF-8/CP1252 bytes are decoded per-sequence (so "Café" is not "Caf?"),
apostrophes are restored to contractions the corpus had stripped them from
(`dont` → `don't`), and options are shuffled to flatten a mild bias toward
A and B in the source (28/28/22/22 → ~25 each), pinning "None of these" and
friends to the last slot.

Known limitation: possessive apostrophes are **not** restored (`a dogs ears`
stays as it is). Unlike contractions, there is no way to tell a missing
possessive from a plural without understanding the sentence, and a wrong guess
is worse than the gap.
