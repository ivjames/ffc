// Bumper Cars / Bumper Boats — one shared policy, because the games are one
// shared component (BumperArena) with two physics themes, exactly as
// BumperCars.tsx and BumperBoats.tsx are two themes over one arena.
//
// THE CONTROL IS A LURE, NOT A POSITION. Unlike air hockey's mallet, which
// teleports to the pointer, here the pointer is a target the unit CHASES:
// throttle scales with how far ahead the finger is, capping at LEAD = 90, and
// the unit eases to a stop once inside CATCH_R = 30. So the bot must never put
// the pointer on its own vehicle — that is the brake — and never on the target
// either, which would coast into it below the bump threshold. It puts the
// pointer BEYOND the target, on the far side, so the unit is still at full
// throttle when it arrives and the closing speed clears `bumpSpeed`.
//
// That single fact is the whole policy:
//     lure = target + normalise(target − me) · LEAD
//
// Finding the units is per-colour rather than one broad sweep: the player is
// green and each AI has its own hue from the theme, so a find per colour gives
// identity for free and lets the bot chase the NEAREST rival instead of the
// average of all of them (which is usually empty arena in the middle).
import { clamp, gauss, lerp, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const UNIT_R = 26;
const LEAD = 90;
const GAME_MS = 30_000;

/** #rrggbb → a tolerant RGB box for findBlob. */
function box(hex, tol = 46) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    rMin: r - tol, rMax: r + tol,
    gMin: g - tol, gMax: g + tol,
    bMin: b - tol, bMax: b + tol,
  };
}

const PLAYER = box('#22c55e');

/** Build a policy for one bumper theme. */
export function makeBumper({ key, route, label, aiColors }) {
  const AI = aiColors.map((c) => box(c));

  return {
    key,
    route,
    label,
    field: { W, H },
    ticketsFor: (score) => Math.min(score * 2, 100),
    estRoundMs: GAME_MS + 10_000,
    needsStart: true,

    async startGesture(d) {
      // Take the pointer before play starts; play() only moves it thereafter.
      const p = d.toClient(W / 2, H - 90);
      await d.page.mouse.move(p.x, p.y);
      await d.page.mouse.down();
    },

    async play(d, { rng, skill }) {
      // Lure placement error, and how often the bot re-reads the arena.
      const sigma = sigmaFor(skill, 34, 3);
      const cadenceMs = Math.round(lerp(110, 16, clamp(skill, 0, 1)));
      // HOW FAR PAST the target to lure is the real skill knob here, not aim
      // noise. Scatter alone gave no gradient at all (beginner 28 vs expert
      // 25-30): the arena is small and crowded, so even a sloppy chase collides
      // constantly. But a lure placed short lands inside CATCH_R, the unit eases
      // to a stop, and the contact falls under `bumpSpeed` — a nudge that does
      // not score. So a weak player drifts into rivals and a strong one drives
      // through them, which is the actual difference between the two.
      const lead = lerp(8, LEAD, clamp(skill, 0, 1) ** 0.7);
      // ...and how often the player is not chasing anything at all. A passive
      // bot scores exactly 0, so driving is worth everything here — but ANY
      // committed chase saturates: with four rivals in a small arena, lure
      // distance and aim noise both left beginner and expert level at ~29.
      // What actually separates them is time spent not closing on anyone, so a
      // weak player spends a good share of the round luring at open floor.
      const wanderRate = 0.62 * (1 - clamp(skill, 0, 1)) ** 1.1;
      let wanderUntil = 0;
      let wanderPt = null;

      const deadline = Date.now() + GAME_MS + 1500;
      let sinceCheck = 0;

      while (Date.now() < deadline) {
        if (++sinceCheck >= 30) {
          sinceCheck = 0;
          if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
            break;
          }
        }

        let me = null;
        let rivals = [];
        try {
          const field = { x0: 0, y0: 0, x1: W, y1: H };
          me = await d.findBlob(field, PLAYER, { step: 3, largest: true });
          for (const spec of AI) {
            const r = await d.findBlob(field, spec, { step: 3, largest: true });
            // Ignore specks: a real unit is a fat disc, not a stray pixel run.
            if (r && r.n >= 6) rivals.push(r);
          }
        } catch {
          break; // canvas unmounted — round over
        }
        if (!me || rivals.length === 0) {
          await d.page.waitForTimeout(cadenceMs);
          continue;
        }

        // Drift: commit to open floor for a beat instead of anyone in
        // particular. Held for a stretch rather than re-rolled per cycle, so it
        // reads as losing the plot rather than as jitter.
        const now = Date.now();
        if (now > wanderUntil && rng() < wanderRate) {
          wanderUntil = now + 500 + rng() * 900;
          wanderPt = { x: 40 + rng() * (W - 80), y: 40 + rng() * (H - 80) };
        }

        let lure;
        if (now < wanderUntil && wanderPt) {
          lure = { x: wanderPt.x, y: wanderPt.y };
        } else {
          // Chase the nearest rival — the arena is small, so the nearest is
          // almost always reachable before it wanders off.
          rivals.sort(
            (p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y),
          );
          const t = rivals[0];
          // Lure past the target, never onto it: stopping short is what turns a
          // bump into a nudge below `bumpSpeed`.
          const dx = t.x - me.x;
          const dy = t.y - me.y;
          const len = Math.hypot(dx, dy) || 1;
          lure = {
            x: t.x + (dx / len) * lead + gauss(rng) * sigma,
            y: t.y + (dy / len) * lead + gauss(rng) * sigma,
          };
        }

        const p = d.toClient(
          clamp(lure.x, UNIT_R, W - UNIT_R),
          clamp(lure.y, UNIT_R, H - UNIT_R),
        );
        await d.page.mouse.move(p.x, p.y);
        await d.page.waitForTimeout(cadenceMs);
      }
      await d.page.mouse.up().catch(() => {});
    },
  };
}
