// Go-Karts — the last game, and the only one where the bot has to know a ROUTE
// rather than chase a target.
//
// The control is the bumper games' lure again (drag to lead; throttle scales
// with lead distance, capping at LEAD = 80), but there is nothing to chase: the
// score is a 3-lap time on a procedural circuit. The centreline lives inside
// the component as a 90-sample polyline, and GoKarts.tsx is JSX — Node's type
// stripping does not parse that — so the track cannot be imported the way
// trivia's bank or pinball's table can.
//
// So the bot drives by RABBIT: the pointer is an independent point that walks
// the road on its own, and the kart chases it. Steering the rabbit needs no
// knowledge of the circuit at all — each step it fans candidate headings, asks
// which land on asphalt (one probePoints call for the whole fan), and takes the
// straightest one that stays on the road. That turns "follow this track" into
// "keep the point on the grey", which pixels answer directly.
//
// Two details make it work, and the second is the whole game:
//   * The fan is scored on a LONG lookahead, not just the next step. A short
//     probe happily turns into a hairpin's outside wall, because the wall is
//     still asphalt one step ahead.
//   * The rabbit is LEASHED to the kart. The kart steers straight at the
//     finger, so a rabbit that runs free around a bend points it across the
//     infield and into a barrier — measured, that stuck the kart on a wall and
//     the race sat at lap 0 forever while the rabbit did tidy laps on its own.
//     Holding the rabbit within LEASH px of the kart keeps the straight line
//     between them ON the road, which is exactly what "lead it round" means.
// WHAT THIS POLICY DOES NOT HAVE YET: a verified skill gradient. Measured
// totals were expert 78s against a beginner's 55s and 86s — wide, and not
// ordered. Lap time here is dominated by two things the skill knob does not
// touch: how long the opening wrong-way stall lasts (up to LAP_STALL_MS), and
// how much barrier the kart scrapes, since "straightest road wins" rides the
// inside kerb. A best lap of ~6.5s is achievable and the bot turns ~25s, so
// there is a 4x of line quality left on the table.
//
// The fix is a centred racing line, not more noise on the rabbit. One attempt
// at lane-centring (nudge away from whichever shoulder runs out of road)
// stopped the bot lapping entirely and was reverted — it wants doing properly,
// against the measured lap time, rather than bolted on.
import { clamp, gauss, lerp } from '../skill.mjs';

const W = 340;
const H = 560;
const LAPS = 3;

// Asphalt vs grass is a RELATIONAL test, not an RGB box, and the difference is
// the whole game. Measured off the canvas, asphalt reads ~(64,64,80)-(64,80,80)
// and grass ~(32,80,48)-(16,64,32): their ranges OVERLAP on every channel
// independently, so a box wide enough to hold the asphalt also swallows grass,
// and the rabbit cheerfully drove across the infield. What separates them is
// that asphalt is blue-leaning (b >= g) while grass is green (g >> b).
const onRoad = (px) =>
  px[3] > 60 && px[2] >= px[1] - 3 && px[2] >= px[0] && px[2] >= 52 && px[2] <= 128 && px[1] <= 104;

const LEASH = 74; // max rabbit-to-kart distance; just under the game's LEAD=80
const KART = { rMin: 0, rMax: 90, gMin: 130, gMax: 225, bMin: 175, bMax: 245 }; // cyan body
const STEP = 16; // rabbit advance per tick, logical px
const LOOK = 46; // lookahead used to score a candidate heading
const FAN = [0, 12, -12, 24, -24, 36, -36, 48, -48, 56, -56];
const TICK_MS = 55;

// Which way round to set off. This is only a GUESS, and deliberately so: the
// catalogue holds several procedural circuits and nothing says they are all
// oriented alike, so a hardcoded direction is a per-track coin flip. The bot
// checks the lap counter instead and turns around if it is not making progress
// (see LAP_STALL_MS), which is correct on any track and self-correcting if a
// new one is added.
const DIRECTION = 1;
// No lap gained in this long means we are going the wrong way (or stuck), so
// reverse. A clean lap is ~6.5s, so this waits out a bad one without thrashing.
const LAP_STALL_MS = 13_000;

export default {
  key: 'gokarts',
  route: '/arcade/karts',
  label: 'Go-Karts',
  field: { W, H },
  // Go-Karts' award is TRACK-RELATIVE and cannot be derived here: GoKarts.tsx
  // computes `idealMs` from the selected circuit's length and tiers on the
  // ratio (1.5x -> 40, 2x -> 25, 2.75x -> 15, slower -> 8). A policy can only
  // see the clock, and a fixed set of seconds is wrong on every track — for
  // Speedway the real boundaries land near 18.3/24.4/33.5s, so time tiers
  // guessed from the bot's own pace would have recorded 40 where the game pays
  // 8, and arcade-traffic.mjs posts the profile's ticket value straight to the
  // award API.
  //
  // So this returns the FLOOR tier. The bot turns ~78s rounds, which is the
  // slowest tier on every catalogue track, and under-reporting is the safe
  // direction: a replay that pays too little is a dull profile, one that pays
  // too much is inflated traffic. Where the venue has the gameRewards add-on,
  // round.mjs reads the award the game itself renders and this is not used.
  ticketsFor: () => 8,
  // LOWER IS BETTER — the score is a time. The harness needs to know, or the
  // floor check has its comparison backwards.
  lowerIsBetter: true,
  estRoundMs: 180_000,

  /**
   * The circuit catalogue comes BEFORE any race canvas exists, so this has to
   * run before the driver goes looking for one — otherwise attach() waits out
   * its timeout on a screen that is only ever a list of buttons.
   */
  async beforeAttach(page) {
    const pick = page.locator('button:has(div.text-base)').first();
    if (await pick.isVisible().catch(() => false)) {
      await pick.click();
      await page.waitForTimeout(3100); // "3, 2, 1, GO!"
    }
  },

  /** Take the pointer; play() only moves it thereafter. */
  async startGesture(d) {
    const p = d.toClient(W / 2, H / 2);
    await d.page.mouse.move(p.x, p.y);
    await d.page.mouse.down();
  },

  async play(d, { rng, skill }) {
    // A weak driver wanders off the racing line and scrubs speed; sigma is the
    // rabbit's lateral sloppiness, which the kart faithfully follows into walls.
    const sigma = lerp(13, 1.5, clamp(skill, 0, 1));
    const step = lerp(STEP * 0.62, STEP, clamp(skill, 0, 1));

    const probe = async (pts) => {
      try {
        return await d.probePoints(pts);
      } catch {
        return null;
      }
    };

    // SEED ON THE ROAD, not at the canvas centre. The circuits are loops, so
    // their middle is infield grass — seeding there put the rabbit off-track
    // with nothing but grass in every direction, and it just span on the spot.
    // A coarse sweep finds the asphalt ring, and the rabbit starts on the piece
    // nearest the grid at the bottom of the canvas.
    let rx = W / 2;
    let ry = H - 70;
    let heading = 0;
    {
      const grid = [];
      for (let y = 20; y < H - 10; y += 20) for (let x = 12; x < W - 10; x += 12) grid.push({ x, y });
      const scan = await probe(grid);
      if (scan) {
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < grid.length; i++) {
          if (!onRoad(scan.px[i])) continue;
          const dd = Math.hypot(grid[i].x - W / 2, grid[i].y - (H - 70));
          if (dd < bestD) {
            bestD = dd;
            best = grid[i];
          }
        }
        if (best) {
          rx = best.x;
          ry = best.y;
        }
      }
    }
    {
      // Then point along the lane: the road runs two ways from any point on it,
      // and DIRECTION picks which. A wrong pick drives a tidy lap the wrong way
      // and never trips the lap counter.
      const angles = Array.from({ length: 36 }, (_, i) => (i * 10 * Math.PI) / 180);
      const seed = await probe(
        angles.map((a) => ({ x: rx + Math.cos(a) * LOOK, y: ry + Math.sin(a) * LOOK })),
      );
      if (seed) {
        const ok = angles.filter((_, i) => onRoad(seed.px[i]));
        // The road runs both ways from the grid, so DIRECTION picks which.
        if (ok.length) heading = DIRECTION > 0 ? ok[0] : ok[0] + Math.PI;
      }
    }

    const deadline = Date.now() + this.estRoundMs;
    let sinceCheck = 0;
    let lapsSeen = -1;
    let lapAt = Date.now();

    while (Date.now() < deadline) {
      if (++sinceCheck >= 20) {
        sinceCheck = 0;
        if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
          break;
        }
        // Read the lap counter; no progress for a while means wrong way round.
        const hud = await d.page.locator('body').innerText().catch(() => '');
        const m = /Lap\s+(\d+)\s*\//.exec(hud);
        const laps = m ? Number(m[1]) : lapsSeen;
        if (laps !== lapsSeen) {
          lapsSeen = laps;
          lapAt = Date.now();
        } else if (Date.now() - lapAt > LAP_STALL_MS) {
          heading += Math.PI; // about-face and try the other way
          lapAt = Date.now();
        }
      }

      // Fan out candidate headings and ask which lookaheads are on asphalt.
      const cands = FAN.map((deg) => heading + (deg * Math.PI) / 180);
      const pts = cands.map((a) => ({
        x: clamp(rx + Math.cos(a) * LOOK, 1, W - 1),
        y: clamp(ry + Math.sin(a) * LOOK, 1, H - 1),
      }));
      const read = await probe(pts);
      if (!read) break; // canvas unmounted — round over

      // Hold the leash: if the rabbit is already the full lead ahead, stop
      // advancing and let the kart close the gap. Without this the rabbit
      // outruns the kart and the straight line between them leaves the road.
      let kart = null;
      try {
        kart = await d.findBlob({ x0: 0, y0: 0, x1: W, y1: H }, KART, { step: 2, largest: true });
      } catch {
        break;
      }
      const leashed = kart ? Math.hypot(rx - kart.x, ry - kart.y) >= LEASH : false;

      // Straightest road wins: FAN is ordered by |deviation|, so the first hit
      // is already the least turn that stays on the track.
      let chosen = -1;
      for (let i = 0; i < cands.length; i++) {
        if (onRoad(read.px[i])) {
          chosen = i;
          break;
        }
      }
      if (chosen < 0) {
        // Lost the road (clipped the infield, or a corner turned tighter than
        // the fan): re-acquire by sweeping the full circle and taking the road
        // angle CLOSEST TO THE CURRENT HEADING. Rotating blindly instead is
        // what broke the first version — the rabbit could spin right around,
        // and a lap crossed backwards DECREMENTS the counter, so the race
        // ratcheted 0-1-2-2-1 and never finished despite clean 6.5s laps.
        const sweep = Array.from({ length: 36 }, (_, i) => heading + (i * 10 * Math.PI) / 180);
        const around = await probe(
          sweep.map((a) => ({
            x: clamp(rx + Math.cos(a) * LOOK, 1, W - 1),
            y: clamp(ry + Math.sin(a) * LOOK, 1, H - 1),
          })),
        );
        if (!around) break;
        let bestA = null;
        let bestTurn = Infinity;
        for (let i = 0; i < sweep.length; i++) {
          if (!onRoad(around.px[i])) continue;
          // Signed shortest turn from the current heading.
          const turn = Math.abs(((sweep[i] - heading + Math.PI) % (2 * Math.PI)) - Math.PI);
          if (turn < bestTurn) {
            bestTurn = turn;
            bestA = sweep[i];
          }
        }
        if (bestA === null) break; // no road anywhere — the round is over
        heading = bestA;
        rx += Math.cos(heading) * step * 0.5;
        ry += Math.sin(heading) * step * 0.5;
      } else {
        heading = cands[chosen];
        if (!leashed) {
          rx += Math.cos(heading) * step;
          ry += Math.sin(heading) * step;
        }
      }

      rx = clamp(rx, 6, W - 6);
      ry = clamp(ry, 6, H - 6);

      const p = d.toClient(
        clamp(rx + gauss(rng) * sigma, 4, W - 4),
        clamp(ry + gauss(rng) * sigma, 4, H - 4),
      );
      await d.page.mouse.move(p.x, p.y);
      await d.page.waitForTimeout(TICK_MS);
    }
    await d.page.mouse.up().catch(() => {});
  },

  /** End card headline is the total time in seconds ("62.4s"). */
  readScore: async (page) => {
    const raw = (await page.locator('.text-5xl').first().textContent()) ?? '';
    return raw.trim();
  },
};

// CALIBRATION
//   DIRECTION picks which way round the circuit the rabbit sets off, and laps
//   only count when the line is crossed the right way — so a wrong value looks
//   like a kart driving competently and never finishing. If a run times out
//   with laps stuck, flip it and re-measure rather than tuning the fan.
