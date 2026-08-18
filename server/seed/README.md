# server/seed

## open-trivia-pack.ndjson.gz

47,710 multiple-choice trivia questions for the live-trivia question bank,
built from the **OpenTriviaQA** corpus.

| | |
|---|---|
| Upstream | <https://github.com/uberspot/OpenTriviaQA> |
| License | **Creative Commons Attribution-ShareAlike 4.0 International** (CC BY-SA 4.0) |
| License text | <https://creativecommons.org/licenses/by-sa/4.0/> |
| Built by | `scripts/build-trivia-pack.mjs` |
| Loaded by | `server/importTriviaPack.js` (`npm run import:trivia`) |

### Attribution

CC BY-SA 4.0 makes credit a condition of **use**, not just of redistribution:
its definition of "Share" covers public display and public performance, so a
venue putting these questions on a screen is inside the license's scope even
though nobody ever hands out the database.

Section 3(a)(2) allows the notice to be carried by a hyperlink, so the app does
not repeat it under every question:

- **`src/features/shared/Credits.tsx`** — the `/credits` page, which carries
  the four required elements: the source, the license named and linked, a link
  back to the material, and the statement that we modified it (§3(a)(1)(B),
  the element people forget).
- **`<QuestionCredit />`**, exported from the same file, is the one-line credit
  linking to it. It renders on `TriviaLive` and `TriviaHost` — every branch of
  both, enforced by `src/features/shared/Credits.test.tsx` — and deliberately
  **not** on the single-player game at `/arcade/trivia`, which deals the
  house's own bundled deck.
- The pack header and the `source` column keep the credit attached to the data
  itself, so a row's provenance survives outside the UI.

ShareAlike attaches to the *collection*, not to the facts in it, and not to
this application's code. Questions written in Master Control are the operator's
own work — the `source` column is what keeps the two apart.

### Format

Gzipped NDJSON. The first line is a header:

```json
{"pack":"opentriviaqa","source":"…","license":"CC BY-SA 4.0","upstreamCommit":"…","count":47710}
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

Of 49,716 source questions, 47,710 survive. The build prints the tally; the
reasons are:

| Dropped | Reason |
|---:|---|
| 934 | Not family-safe. This is a family fun center; the filter is tuned to over-block. |
| 627 | Rejected by `normalizeQuestion` — the same validator the admin write path uses. Mostly prompts over 300 characters, plus over-long options and duplicate choices. |
| 445 | Duplicate prompts. The corpus repeats questions across category files. |

The safety filter is in three parts, because one blunt word list cannot do this
job. Single words (`BLOCKED_WORDS`) catch the obvious. Slurs get their own list
— the corpus contains one, a John Lennon song title, which is real music
history and still unsayable at a children's party. And sexual activity is
matched as *phrases* (`BLOCKED_PHRASES`), because the words it is built from
are ordinary: "sex" alone appears 179 times in the corpus and is nearly always
biology or grammar.

Equally deliberate is what is **not** blocked: breast cancer and the
breaststroke, Louis Prima the King of Swingers, *Mycoplasma genitalium*, sexual
orientation as a biographical fact, and the grim end of history — suicide, the
Holocaust, slavery. A filter that swallowed those would be wrong in the other
direction. `scripts/trivia-pack.test.mjs` asserts both halves.

When this filter is tightened, rebuilding the pack is only half the job — a
bank that already imported keeps the old rows until someone runs
`npm run import:trivia -- --prune`.

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
