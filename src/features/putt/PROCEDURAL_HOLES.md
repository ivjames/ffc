# Building holes for Arcade Putt (and generating them procedurally)

This is the playbook for authoring holes by hand and for generating them at
runtime. Everything here is enforced by the offline validator
(`scripts/putt-sim.ts`, `npm run putt:sim`) — treat that script as the
definition of "a valid hole." If the sim passes, the hole plays; if it fails,
the hole is broken regardless of how good it looks.

The physics and geometry live in `world.ts` and are shared verbatim by the game,
the validator, and the map renderer (`scripts/putt-render.ts`). There is one
source of truth — never fork the rules.

---

## 1. The only primitive is a capsule

A hole is built entirely from **capsules**: a segment `(ax,ay)→(bx,by)` inflated
by radius `r` (a rounded "stadium"). A `disc` is the degenerate zero-length
capsule.

```ts
cap(ax, ay, bx, by, r)   // a rounded lane / channel / curved wall
disc(x, y, r)            // a circular green, bumper, sand/water blob
```

Collision is **signed-distance based** (`sdUnion` = `min` over capsules), so a
union of overlapping same-radius capsules is smooth by construction — no sharp
corners, no internal seams, nothing for the ball to snag on. This is the whole
reason the game feels clean. **Do not introduce any other primitive.** Curves
are a *chain* of overlapping capsules along an arc; blobs are overlapping discs.

**Hazards and rough use a smooth union, `sdBlob`.** A plain `min` union of discs
still leaves a sharp concave *waist* at every crossing, so a chain of differently
sized discs reads as a bunch of grapes. `sdBlob` is `sdUnion` with each junction
filleted (blend width `BLOB_K`), turning a cluster into one continuous blob. It is
used for both the collision (`water` splash, `pits`/`rough` friction) and the
rendering, so what you see is still exactly what the ball rolls on. The fillet
grows a blob by at most `~BLOB_K/4` px at a junction — inside the
`HAZARD_MARGIN` the validator already demands, so containment still holds.

Because rendering fills the same capsules that collision uses, what you see is
exactly what the ball rolls on. Keep overlaps generous (each capsule should
overlap its neighbour by more than the ball's diameter, `2·BALL_R`) or a thin
waist can pinch the ball off the surface.

---

## 2. A hole has these kinds of geometry

| Field | Role | Rough collar? |
|---|---|---|
| `fairway` | approach lanes/channels from the tee | no |
| `green` | putting surface around the cup | yes (a slow collar at its exposed edge) |
| `walls` | solid obstacles — bounce off (incl. curved chains, bumpers) | — |
| `pits` | sand bunkers — heavy drag, but passable | — |
| `water` | ponds — the ball sinks, re-drops at entry, +1 stroke | — |
| `rough` | patches of longer grass on the surface — slow, like the collar | — |

The **playable surface is `fairway ∪ green`**. The ball may travel anywhere the
union is negative (inside). Everything else is off-surface and acts as a rail.

`rough` patches are cosmetic-plus-friction: they slow the ball (`FRICTION_ROUGH`,
the same drag as the green's collar) wherever it sits on the surface *and* inside
the patch. Unlike a hazard they don't need to be tucked fully inside — an
edge/corner patch may ride the rail, and both the collision (on-surface only) and
the renderer (clipped to the surface) trim it to the playable area. They're
passable, so they never block the tee→cup path.

Layering intent: draw the green's rough collar first, then the fairway over it,
so the approach lane cuts a clean, rough-free entrance into the green. Author the
fairway so it actually *overlaps* the green — otherwise there is a gap the ball
can't cross.

---

## 3. The authoring contract (what the sim checks)

Every one of these must hold. The constants are in `world.ts`.

**Placement**
- Tee sits safely on the surface: `sdSurface(tee) ≤ −(BALL_R + 2)`.
- Cup sits safely inside the **green** (not just the surface):
  `sdUnion(cup, green) ≤ −(HOLE_R + 2)`. Leave a full hole-radius of collar
  around the cup — see §5, this is now load-bearing for the lip-out feel.
- Tee and cup are clear of every wall, and not sitting in sand or water.

**Hazards render as whole blobs, never crescents**
- Every `pit` and `water` capsule lies **fully inside** the surface with a
  margin: both endpoints satisfy `sdSurface ≤ −(r + HAZARD_MARGIN)`. Hazards are
  drawn with *no clip*, so one that pokes past the rail renders as a chopped
  crescent. Keep them tucked in.
- A water blob may not overlap a wall.

**Field bounds**
- All surface geometry stays ≥ 2px inside the `W × H` field (nothing spills off
  the playfield). The hard field-edge rail in `resolve()` is a safety net, not a
  license to author off-screen.

**Completability**
- A free path exists from tee to cup through the surface, around the walls
  (grid BFS over cells the ball can rest in — surface, clear of walls, not over
  water). If walls seal the cup off, the hole is unplayable.
- Shot-space is sane: sweeping 48 angles × ~18 powers from the tee, **no shot
  NaNs and none fails to come to rest** (no infinite orbit), and at least one
  tee shot either sinks or finishes within 120px of the cup. A hole you can't
  make progress toward from the tee is rejected.

Run it: `npm run putt:sim`. Green means shippable.

---

## 4. Shaping difficulty

Par is a promise about how many strokes the hole should take; back it with
geometry, not luck.

- **Length & par** — a longer approach = higher par. `MAX_SHOT` only carries the
  ball so far before friction, so a long hole *needs* two shots.
- **Doglegs** — chain fairway capsules along a bent path (`cap → cap` sharing an
  endpoint). The BFS still needs a clear route around the bend.
- **Bumpers** — a `disc` wall the ball curls around; place it so the direct line
  is blocked but a banked shot works.
- **Curved rails** — a chain of small-radius wall capsules along an arc.
- **Bunkers** (`pits`) — `FRICTION_SAND` bogs a slow ball; use them to punish the
  lazy line, but keep them passable (they never block the BFS).
- **Water** (`water`) — a hard hazard (+1 and a re-drop). Guard an approach with
  it, but make sure the drop point (the entry edge) lands back on clean surface.
- **Rough** (`rough`) — patches of longer grass down an edge or in a corner. They
  bleed pace off the greedy line without blocking it; use them to make the wide
  side of a fairway cost something, or to pinch the ideal line toward a hazard.

Widen the fairway for a forgiving hole; narrow it to a channel for a precise one.
The rough collar around the green already punishes an approach that drifts wide.

---

## 5. The cup: speed-scaled capture + far-rim lip-out

The cup is **not** a magnet — nothing draws a near-miss in. Two rules govern it
(`resolve()` in `world.ts`):

1. **Speed-scaled capture radius.** The ball drops only when its centre is inside
   a capture radius that shrinks with speed: the full `HOLE_R` at a crawl,
   narrowing to zero at `CAPTURE_SPEED`. So a centred, gentle putt falls, but a
   fast one — or one whose centre only *grazes* the rim — is not captured.
2. **Far-rim lip-out.** A ball that isn't captured catches the far lip: the rim
   reflects its outward motion back inward (restitution `RIM_REST`) while its
   sideways motion carries it around — it **rings the rim and lips out**. Pace
   escapes; a slow rattle drops. The near lip is never reflected, so a soft
   centred putt rolls straight in.

**Design consequence:** give the cup breathing room. Because a centre that grazes
the rim lips out, a cup crammed against the green's edge means most approaches
arrive off-centre and reject. Keep the required `HOLE_R + 2` of green (ideally
more) on every side of the cup so there's a real target to roll a ball dead into.
Approaches that let the ball *slow down* near the cup convert; ones that force a
fast, glancing arrival will mostly lip out — use that on purpose for a hard hole,
avoid it by accident on an easy one.

---

## 6. A procedural recipe (rejection sampling)

> Implemented in `generate.ts` (`generateHole(seed)` / `generateCourse`), which
> shares the exact contract below via `validate.ts` and feeds the game's
> **Endless** mode. The validator is extracted to `validate.ts` so the CLI
> (`putt-sim.ts`) and the generator can't drift on what "valid" means.

The validator is cheap and total, so the robust way to *generate* holes is
generate-then-validate, retrying on failure:

```
repeat up to N times:
  1. Pick a tee near the bottom and a cup in the upper field, well inside W×H.
  2. Build the fairway as a chain of 1–3 capsules from tee toward cup
     (bend it for a dogleg). Radius ~26–82 for narrow-channel → wide.
  3. Drop a green disc on the cup (radius ≥ HOLE_R + collar + margin, per §5),
     overlapping the fairway's end so the surface is connected.
  4. Optionally add hazards/walls — but only inside the surface (§3), and
     re-check the tee/cup clearances after each.
  5. Run the §3 checks (reuse putt-sim's predicates). If all pass, keep it.
     If any fail, discard and resample.
```

Rejection sampling beats trying to place everything perfectly first try:
constraints interact (a wall that makes a nice chicane may also seal the cup),
and it's far simpler to throw a bad hole away than to repair it. Seed the RNG so
a course is reproducible, and log the seed with the hole.

Two things to bake in rather than discover:
- **Connectivity first.** Build the surface so `fairway ∪ green` is one connected
  blob before adding anything. Most "no path to cup" failures are a fairway that
  doesn't quite reach the green.
- **Clearance last.** Add hazards/walls, then re-assert tee, cup, and path
  clearances — an obstacle is the thing most likely to violate them.

---

## 7. Checklist before shipping a hole

- [ ] Built only from `cap`/`disc`; neighbours overlap by > `2·BALL_R`.
- [ ] `fairway ∪ green` is one connected surface, tee end → green.
- [ ] Cup has ≥ `HOLE_R + 2` of green on all sides (more for an easy hole).
- [ ] Tee and cup clear of walls, sand, water.
- [ ] Hazards fully inside the surface (`+ HAZARD_MARGIN`); water clear of walls.
- [ ] Nothing within 2px of the field edge.
- [ ] `npm run putt:sim` prints **ALL HOLES VALID ✓**.
