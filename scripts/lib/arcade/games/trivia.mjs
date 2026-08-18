// Trivia policy — the only game in the set with no gesture at all. There is
// nothing to aim, time, or track: the whole skill is KNOWING the answer.
//
// So the bot reads the bundled question bank the game itself renders from
// (src/data/funContent.ts) and looks each question up. Node imports the .ts
// directly under its type stripping, which beats regex-scraping a file whose
// strings carry escaped apostrophes.
//
// Matching is by ANSWER TEXT, never by index: buildRound() shuffles the choices
// per question and re-derives `answer` against the shuffled array, so the index
// in the data file has no relationship to the index on screen. Looking up the
// correct string and then clicking the button carrying it is shuffle-proof.
//
// Skill is a knowledge rate rather than a noise term. A wrong answer is a
// deliberate pick of one of the other choices, which is what a guessing player
// actually does — never a skipped question.
//
// THE BANK WILL GO STALE. It is a copy of the game's content, and content gets
// edited; a question the bot has never seen is a WHEN, not an if. So an unknown
// question degrades to a genuine guess off the screen rather than aborting: the
// round still completes, the score just falls toward the 1-in-4 a blind guess
// pays. Aborting instead is much worse than it sounds — play() returning early
// leaves the runner waiting out its full timeout for an end card that can never
// appear, so one edited question would turn every round into a 3-minute
// failure. If scores here ever collapse toward 2-3 out of 10 at high skill,
// suspect the bank, not the bot.
import { TRIVIA } from '../../../../src/data/funContent.ts';
import { clamp, lerp } from '../skill.mjs';

const ROUND_SIZE = 10;
const TICKETS_PER_CORRECT = 5;

/** question text → { correct, choices } — both as TEXT, never indices. */
const BANK = new Map(
  TRIVIA.map((t) => [t.q.trim(), { correct: t.choices[t.answer], choices: t.choices }]),
);

export default {
  key: 'trivia',
  route: '/arcade/trivia',
  label: 'Trivia',
  field: { W: 340, H: 560 }, // no canvas; kept so the driver's shape is uniform
  ticketsFor: (score) => score * TICKETS_PER_CORRECT,
  estRoundMs: ROUND_SIZE * 2200 + 6000,

  // This game renders no canvas, so the driver's usual attach() would hang
  // waiting for one. It is played entirely through the DOM.
  domOnly: true,

  async play(d, { rng, skill }) {
    const page = d.page;
    // Even a strong player misses the odd one; a weak one is barely above the
    // 1-in-4 a blind guess would score.
    const knowRate = lerp(0.28, 0.97, clamp(skill, 0, 1));

    for (let q = 0; q < ROUND_SIZE; q++) {
      const stem = page.locator('p.text-xl').first();
      if (!(await stem.isVisible().catch(() => false))) break;
      const asked = ((await stem.textContent()) ?? '').trim();

      // Pick the target from the DATA's own choice list, then click the button
      // carrying that exact text. Enumerating buttons off the page instead is a
      // trap: the screen's chrome (back arrow, hamburger, and the whole nav
      // drawer) are buttons too, so a "wrong answer" chosen from a scraped list
      // navigated away from the game and hung the round. Answering from the
      // bank keeps the click inside the question no matter what else is on
      // screen.
      const entry = BANK.get(asked);

      if (!entry) {
        // Unknown question: guess from what is on screen. The choice buttons are
        // read through their own container, never off the page at large — the
        // back arrow, hamburger and nav drawer are buttons too, and clicking one
        // navigates out of the game.
        const onScreen = page.locator('div.space-y-2\\.5 button');
        const count = await onScreen.count();
        if (count === 0) break; // genuinely not on a question any more
        await onScreen.nth(Math.floor(rng() * count)).click();
      } else {
        const wanted =
          rng() < knowRate
            ? entry.correct
            : // Answer wrong on purpose, so a miss looks like a plausible
              // distractor rather than an abstention.
              (() => {
                const wrong = entry.choices.filter((c) => c !== entry.correct);
                return wrong[Math.floor(rng() * wrong.length)];
              })();
        await page.getByRole('button', { name: wanted, exact: true }).first().click();
      }

      // Answering reveals the result behind a "Next question →" / "See results"
      // button; the round only moves on when that is pressed.
      const next = page.getByRole('button', { name: /Next question|See results/ });
      await next.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      // A beat on the reveal — a player reads the right answer before moving on.
      await page.waitForTimeout(Math.round(lerp(900, 260, clamp(skill, 0, 1))));
      await next.click().catch(() => {});
    }
  },
};
