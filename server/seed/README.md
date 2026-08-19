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
  itself, so a row's provenance survives outside the UI. **Master Control →
  Trivia** shows that column per row ("from opentriviaqa") and carries the
  licence credit in a banner, so an operator curating the bank can see which
  questions are donated and which are the venue's own.

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

### Apostrophe repairs

The upstream corpus stripped apostrophes wholesale. Two layers put them back:

1. **Rule repairs** (`repairApostrophes` in `scripts/lib/trivia-pack.mjs`):
   strings that are only ever a mangled contraction ("dont", "youre") are fixed
   during the build. The list is deliberately incomplete — "ill", "lets", "its"
   and friends are real words.
2. **Judgment repairs** (`scripts/lib/trivia-pack-repairs.ndjson`): possessives
   ("dogs ears" → "dog's ears") and ambiguous contractions ("Ill" → "I'll"),
   where only the sentence decides. These were found by a model sweep of every
   row, each accepted fix independently verified in context, and committed as
   data. The build applies them last (after sort and shuffle, both seeded on
   the unrepaired prompt), and `applyPackRepairs` re-checks every entry at
   apply time: pure apostrophe insertion, unique whole-word match, no dedupe
   collision, and the repaired row must still pass the admin validator.

### Typo and grammar repairs

`scripts/lib/trivia-pack-typos.ndjson` is a second overlay, same file format,
applied straight after the apostrophe one — so its entries key rows by the
*apostrophe-repaired* prompt. It carries three kinds of fix:

- **Misspellings** found by treating the corpus as its own dictionary: a token
  appearing once or twice that is one edit from a token appearing 25+ times is
  a candidate, which a model then judged in context. `Flinstones`,
  `Antartica`, `Hermoine`, `Titantic`, `Vespuci`.
- **Grammar and wrong-word errors** that only show up on reading: `can weight
  up to`, `Nuremberg trails`, `does not includes`, `2th to 3th century`,
  `badly effected their equipment`, plus duplicated words.
- **Stray double spaces**, collapsed mechanically.

These cannot be insertion-only, so `applyPackTypos` re-checks each entry
against `isMinorTextEdit`: word count may move by one, character distance
stays inside a quarter of the span (floor four, ceiling twenty), and a doubled
word may be dropped. That bounds *blast radius, not meaning* — no string
metric separates `was`→`were` from `cat`→`dog`, so correctness came from
independent verification of every entry, and the gate only guarantees an entry
cannot swap out a question's content.

Two guards hold whole rows back, because the trap is the row rather than the
string. `looksLikeSpellingQuestion` catches questions that say so. The
structural one catches the rest: **a choice fix whose result equals another
choice is refused**, which is what saves `Commercial or mercantile activity.
(noun)` over four manglings of *business*, and near-miss distractors like
`Tigon`/`Tigen` and `joie de vivre`/`joie de livre`. Correcting those would
leave two identical options and no question.

### The missing ampersands, restored

The corpus arrived with **no `&` at all** — 47,710 questions, zero — while
every other symbol appeared in the hundreds. Each one had been stripped before
the data reached us (a fresh upstream clone shows the same gaps), leaving a
double space behind: `Gateman, Goodbury  Graves Funeral Home`, `Mr.  Mrs.
Smith`, `Paul McCartney  Wings`.

Because *only* `&` went missing — `and` survives tens of thousands of times
over — every remaining gap is one of two things, and shape cannot tell them
apart: `Sonny  Cher` is two people, `John  Lithgow` is one. So all 855 gaps
were judged individually, in context and with the sibling options as evidence,
and each ampersand call was then confirmed by a second pass:

- **334 restored** into `scripts/lib/trivia-pack-ampersands.ndjson` — Hall &
  Oates, Earth Wind & Fire, Simon & Garfunkel, Abbott & Costello, Law & Order,
  Abercrombie & Fitch, Pratt & Whitney, Rowan & Martin's Laugh-In.
- **370 were only stray spaces** and became whitespace fixes in the typo
  overlay: `Henny  Youngman`, `Jane  Seymour`, `Thoroughbred  Horse racing`.
- **151 left exactly as they are**, because the judgment was not clear enough
  to act on. A gap left alone costs nothing; a wrong `&` splits a person's
  name in half.

Restoration is faithful to what the contributor typed, not to the canonical
title: `Green Eggs  Ham` has no `and` in it to have been the original wording,
so `Green Eggs & Ham` is what was there to restore, whatever the cover of the
book says.

`isAmpersandRestoration` keeps this honest by permitting exactly one thing —
one run of blanks replaced by ` & ` — so an entry can never move text, change
a word, or put an ampersand anywhere upstream did not leave a gap.

`node scripts/repair-trivia-pack.mjs` applies all three committed overlays to
the pack in place — the no-upstream-checkout path, byte-identical to a full
rebuild and a no-op when re-run. Each overlay keys rows by the prompt as it
stands when that overlay runs — apostrophe entries by the unrepaired prompt,
typo entries by the apostrophe-repaired one, ampersand entries by the
typo-repaired one — so a rebuild from upstream hits every entry again in the
same order. A handful of rows remain unrepairable:
two prompts sit at the validator's 300-character cap (an inserted apostrophe
would break the length rule), and same-field text like "The dogs saw the dogs
bone" is skipped as ambiguous by design.

### Getting corrections into a bank that already has the pack

`npm run import:trivia` matches existing rows on the **prompt**. That is the
right key for "have I seen this question before" and the wrong one for "has
this question changed", so a corrected pack splits in two on the way in:

| | |
|---|---|
| A repair that changed the **prompt** | arrives as a fresh insert; the superseded row is retired by `--prune` |
| A repair that only changed the **options** | leaves the prompt identical, so the row reads as already present — `--refresh` is what updates it |

Both halves are real: between the original pack and the repaired one, 2,565
prompts changed and 1,804 rows changed only below the prompt. On a bank that
already holds the old pack, the whole remediation is:

```sh
cd server
npm run import:trivia -- --dry-run              # see the three numbers first
npm run import:trivia -- --refresh --prune
```

which inserts 2,565, updates 1,804 and retires 2,565, leaving 47,710 live rows
that match the pack exactly. Running it again does nothing. A plain run
reports both outstanding counts rather than silently leaving them, and
`--refresh` never touches a client's own questions, never resurrects a
question an operator archived, and treats the pack as the source of truth only
for rows carrying its `source`.

On an empty bank none of this applies — the first import loads the corrected
pack and there is nothing to reconcile.

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
