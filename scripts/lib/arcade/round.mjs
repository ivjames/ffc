// One round, start to finish: open the game, let its policy play, then read the
// score off the end card.
//
// Reading the score back from the DOM (rather than trusting what the policy
// thinks it did) is the point — it is the bot's only honest feedback signal,
// and it is what makes a capture run a genuine measurement of the shipped game
// instead of a restatement of the policy's assumptions.
import { ArcadeDriver } from './driver.mjs';

/** Every mini-game's end card renders its headline number in `.text-5xl`. */
const SCORE_SEL = '.text-5xl';
/** ...and offers this button, which is the reliable "round is over" signal. */
const AGAIN = 'Play again';

export class RoundError extends Error {}

/**
 * Play one round of `game` on `page`.
 * @returns {Promise<{ score: number, tickets: number, ms: number, skill: number }>}
 */
export async function playRound(page, game, { rng, skill, baseUrl, timeoutMs = 180_000 }) {
  const t0 = Date.now();
  await page.goto(`${baseUrl}${game.route}`, { waitUntil: 'domcontentloaded' });

  const d = new ArcadeDriver(page, game.field);
  // Trivia is pure DOM — waiting for a canvas that never mounts would hang.
  if (!game.domOnly) await d.attach();

  // Several games open on a "ready" card behind a Start button and then run a
  // "3, 2, 1, GO!" countdown before input is live. Clear both here so every
  // policy begins with the game already accepting input.
  if (game.needsStart) {
    const start = page.getByRole('button', { name: /^Start/ });
    if (await start.isVisible().catch(() => false)) await start.click();
    // COUNT_STEP_MS*3 + GO_MS = 2900ms across the games that use it.
    await page.waitForTimeout(3100);
    await d.refit();
  }

  // Games that steer with a held pointer press once here, before play() takes
  // over moving it.
  if (game.startGesture) await game.startGesture(d);

  await game.play(d, { rng, skill });

  // The policy paces itself, but the last shot still has to resolve.
  const again = page.getByRole('button', { name: AGAIN });
  await again.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {
    throw new RoundError(`${game.key}: round did not finish (no "${AGAIN}")`);
  });

  // Most end cards put the headline number in `.text-5xl`; a game whose card
  // differs (Water Gun's is a "2 – 1" heat tally) supplies its own reader.
  const raw = game.readScore
    ? await game.readScore(page)
    : ((await page.locator(SCORE_SEL).first().textContent()) ?? '');
  // Take the FIRST number as it appears, without stripping separators first:
  // some cards render a fraction ("10 / 10" on Trivia) and flattening that to
  // digits yields 1010.
  const score = Number(String(raw).match(/-?\d+/)?.[0] ?? NaN);
  if (!Number.isFinite(score)) {
    throw new RoundError(`${game.key}: unreadable score ${JSON.stringify(raw)}`);
  }

  return { score, tickets: game.ticketsFor(score), ms: Date.now() - t0, skill };
}
