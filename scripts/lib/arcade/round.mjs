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
/**
 * ...and offers this button, which is the reliable "round is over" signal.
 * Go-Karts says "Race again" instead, so a game can name its own; everything
 * else shares the default.
 */
const AGAIN = /^(Play|Race) again$/;

export class RoundError extends Error {}

/**
 * The award banner's own ticket count, or null when it isn't rendered.
 * GameTicketAward shows the figure whether or not a card is linked, so this
 * works on a plain dev venue with the add-on enabled.
 */
async function readShownTickets(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  const m = /earn\s+([\d,]+)\s+tickets|([\d,]+)\s+tickets\b/i.exec(text);
  if (!m) return null;
  const n = Number((m[1] ?? m[2]).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Play one round of `game` on `page`.
 * @returns {Promise<{ score: number, tickets: number, ms: number, skill: number }>}
 */
export async function playRound(page, game, { rng, skill, baseUrl, timeoutMs = 180_000 }) {
  const t0 = Date.now();
  await page.goto(`${baseUrl}${game.route}`, { waitUntil: 'domcontentloaded' });

  const d = new ArcadeDriver(page, game.field);
  // Some games open on a menu with no playfield canvas yet (Go-Karts shows a
  // circuit catalogue), so they get to advance past it before we look for one.
  if (game.beforeAttach) await game.beforeAttach(page);
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
  const again = page.getByRole('button', { name: game.againLabel ?? AGAIN });
  await again.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {
    throw new RoundError(`${game.key}: round did not finish (no again button)`);
  });

  // Most end cards put the headline number in `.text-5xl`; a game whose card
  // differs (Water Gun's is a "2 – 1" heat tally) supplies its own reader.
  const raw = game.readScore
    ? await game.readScore(page)
    : ((await page.locator(SCORE_SEL).first().textContent()) ?? '');
  // Take the FIRST number as it appears, without stripping separators first:
  // some cards render a fraction ("10 / 10" on Trivia) and flattening that to
  // digits yields 1010. Decimals are kept — Go-Karts reports a finish time to
  // hundredths ("62.47s"), and an integer-only match would silently truncate
  // every measured time in its profile.
  const score = Number(String(raw).match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(score)) {
    throw new RoundError(`${game.key}: unreadable score ${JSON.stringify(raw)}`);
  }

  // TICKETS COME FROM THE GAME WHEN IT WILL SAY. Every end card renders its
  // own award ("...earn 68 tickets..."), which is the number the server will
  // actually be asked for. Reading it beats mirroring each game's formula here:
  // a mirror silently drifts from the game, and Go-Karts proved it — its award
  // is track-relative (pace against the selected circuit's `idealMs`), so the
  // fixed time tiers a policy can write down are wrong on every track, and
  // arcade-traffic.mjs posts the profile's ticket value directly.
  //
  // ticketsFor() stays as the fallback for when the banner is absent, which is
  // the norm in development: GameTicketAward self-gates on the venue's
  // gameRewards add-on, so a plain dev server renders no award at all and every
  // capture takes this path. Policies must therefore keep a ticket formula that
  // is safe on its own — see gokarts.mjs, whose award cannot be derived from
  // the clock and so reports the floor tier rather than risk inflating it.
  const shown = await readShownTickets(page);
  const tickets = shown ?? game.ticketsFor(score);

  return { score, tickets, ms: Date.now() - t0, skill };
}
