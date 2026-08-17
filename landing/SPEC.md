# Infinicade landing page — design spec

Spec for the layout and design system of the landing page as of the
aurora/saturation pass. This is the reference for extending the page, reusing
the visual language elsewhere (pitch decks, socials, future app theming), or
rebuilding a section without reverse-engineering the CSS.

> **Variants.** The dark build this spec's token values describe is preserved
> as `aurora-dark.html`. `index.html` is the light "corporate" re-skin: same
> structure, sections, mocks, motion, and putt game, with these deltas —
> ground `#f6f7fd`, ink `#10143c`, dim `#5a6296`, white cards with soft ink
> shadows; accents recalibrated for white (`--lime #b6f000`, `--cyan #00c4ea`,
> `--violet #6d35ff`, `--coral #ff2e73`, plus `--cyan-deep #0089ab` /
> `--lime-deep #7aa300` for small text) with duties deliberately spread —
> coral leads CTAs/blink, cyan runs kickers/toggles/game lines, deep-lime
> marks leaders/verification, violet stays ambient — no single color leads;
> h2s drop Unbounded/uppercase for Space Grotesk 700 sentence case (h1
> wordmark and PRESS START keep Unbounded); wordmark gradient runs
> coral→cyan→violet; aurora keeps the same drift with normal (not screen)
> blending at pastel alphas; device mocks are light and colorful like the
> rest of the page (white devices, tinted rows, per-venue `deep` text
> colors + `on` fill-text colors in the JS venue data).
> Everything in §4–§6 (structure, game, motion) applies to both.

Ground rules that shaped everything below:

- **Dark mode, lights on.** Never near-black; the base is a lit deep indigo
  and color comes from big soft light sources, not flat fills.
- **Don't explain the name.** No "infinite arcade" wordplay in headlines,
  titles, or taglines (operator decision, 2026-08-17). The brand is just
  INFINICADE; the sub-copy pitches the product.
- **Self-contained file.** Zero external requests: fonts, icons, textures are
  all embedded. Must preview from `file://`.
- **Show, don't tell.** Features are demoed by live mocks and playable
  interactions, not screenshots or stock art.

## 1. Tokens

```css
--bg:     #141a3e;   /* page ground — lit deep indigo, NOT near-black */
--panel:  #20264e;   /* raised surface base */
--ink:    #eef0ff;   /* primary text */
--dim:    #b8bfe6;   /* secondary text */
--line:   rgba(170, 178, 226, 0.30);   /* hairline borders */

--lime:   #ccff00;   /* primary accent: CTAs, score, sunk-putt burst */
--cyan:   #21e6ff;   /* secondary accent: kickers, scan/aim lines */
--violet: #8646ff;   /* ambient accent: aurora, glows */
--coral:  #ff3d7f;   /* hot accent: flag, arcade cell, venue #2 */

--r-lg: 26px;  --r-md: 18px;          /* radii; pills use 999px */
```

Accent usage hierarchy: lime = action/reward, cyan = information/live,
violet = atmosphere, coral = heat/game-feel. On-lime text is `#101400`.
Selection is lime with `#101400` text.

## 2. Typography

Both faces are embedded variable woff2 (SIL OFL), declared with weight ranges:

| Role | Face | Notes |
| --- | --- | --- |
| Display (`--display`) | **Unbounded** 200–900 | ALL-CAPS, used for h1/h2/h3, buttons, chips, tags, marquees, big numbers. Never use `-webkit-text-stroke` with it — its variable contours self-overlap and render scribbled outlines. |
| Body (`--body`) | **Space Grotesk** 300–700 | Everything else; base 17px / 1.6. |

Scale:

- **h1 (wordmark):** `clamp(36px, 9vw, 118px)` w800, lh 0.98, uppercase.
  Content is exactly `INFINICADE` in the accent gradient + a lime `.`
- **h2:** `clamp(30px, 5vw, 54px)` w800, uppercase; one word per heading may
  take the lime→cyan gradient via `<em>`.
- **Cell h3:** 16px w700. **Kicker:** 12px, 0.28em tracking, cyan, `▶ `
  prefix in lime. **Tags:** 10.5px, 0.2em tracking, uppercase, dim.
- Text gradient recipe (h1): `linear-gradient(95deg, lime 5%, cyan 55%, violet 100%)`
  + `background-clip: text`.

## 3. Ambient layer stack (back → front)

| z | Layer | What it is |
| --- | --- | --- |
| -3 | `.mesh` | Fixed; five radial glows (violet/cyan/coral/lime corners + indigo center wash) over `--bg`. |
| -3 | `.aurora` | Fixed, `inset: -20%`; four blurred-gradient circles, `mix-blend-mode: screen`, drifting on 44/56/68/80s `ease-in-out alternate` loops (translate ±~20vw, scale 0.9–1.3). Colors: violet .52, cyan .44, magenta .40, lime .30. |
| -2 | `.dots` | 26px dot grid, alpha .34, radial-masked to fade at edges. |
| -1 | `.glow-cursor` | 520px violet radial following the pointer, lerp 0.08, fine-pointer devices only. |
| 60 | `.grain` | feTurbulence SVG data-URI noise at opacity .05, above everything. |

Additionally each section owns an in-flow color wash (so glow doesn't depend
on the fixed layers): hero = violet+cyan; `#platform` = cyan/violet/lime;
`#white-label` = coral/violet; `.cta-final` = lime+violet center burst.

## 4. Page structure

```
nav (fixed pill)
hero (compact, playable putt canvas)
marquee ×2 (opposite directions)
#platform (bento grid)
#white-label (copy + venue switcher phone)
#contact / .cta-final (PRESS START)
footer
```

- **Content column:** `.wrap` max-width 1180px, 24px side padding.
- **Nav:** fixed pill, top 18px, `min(1132px, 100vw − 32px)`; glass
  (`rgba(42,48,96,.68)` + 14px blur); logo tile + links (hidden <680px) +
  lime CTA chip.
- **Section rhythm:** `padding: 64px 0`; kicker → h2 → intro (max 600px). Deliberately compact — no full-height hero, no oversized gaps.
- **Reveals:** `.reveal` fades/slides in via IntersectionObserver (threshold
  0.18, stagger 60ms). No-JS and reduced-motion show everything immediately.

### Bento grid (`#platform .bento`)

3 columns, 16px gap, named areas:

```
"phone board board"      (≤940px: 2-col)      (≤620px: 1-col)
"phone hunt  tickets"    phone|board          stacked in
"games games control"    phone|hunt           source order
                         tickets|control
                         games|games
```

Cells: glass gradient `rgba(62,69,130,.92) → rgba(38,44,88,.92)`, `--line`
border, `--r-lg` radius, inset top highlight `rgba(255,255,255,.09)`, and a
**per-cell colored under-glow** `0 24px 90px -28px <accent>`: phone/hunt =
cyan, board/tickets = lime, games = coral, control = violet. Hover: lift 3px,
lime-tinted border. Min-heights: phone 560px, board 350px, others 250px.

Each cell = corner tag (`01 · SCORECARD` …) + live mock + h3 + ≤40ch copy.
The mocks are pure HTML/CSS (phone scorecard, reshuffling board rows, camera
viewfinder, ticket counter, game-icon row, admin toggles) — no images.

### Marquees

Two full-bleed strips between hero and platform; Unbounded 800
`clamp(20px, 3vw, 32px)`, `✦` separators (lime top / violet bottom), 36s
linear loops, second strip reversed with `rgba(238,240,255,.55)` text.
Backgrounds are gradient "lit signage" tints (lime→cyan→violet top,
violet→coral→cyan bottom). Content duplicated once; loop = `translateX(-50%)`.

### White-label section

Two columns (1fr / 0.9fr, stacks <860px): copy + four venue chip buttons,
and a 3D-tilted phone (`rotateY(-8deg)`, flattens on hover). Picking a venue
sets `--wl` + name + `<slug>.infinicade.com` on the mock; brand bar, rows,
install button, and the phone's outer halo all derive from `--wl` via
`color-mix`. Auto-cycles every 4s until first manual pick. Venues:
Moose Mountain (lime), Boardwalk Fun Co. (coral), Putter's Cove (cyan),
Neon Jungle (violet).

### CTA finale

Centered `PRESS START` (`clamp(38px, 7.4vw, 92px)`; "START" in lime blinking
via `steps(2)` 1.4s), short pitch, lime mailto button
(`hello@infinicade.com`), small-print `no credit card · no app store · just play`.

## 5. Hero putt game

Full-bleed `<canvas>` under the hero copy; an invisible 60px `#ballHandle`
div (`touch-action: none`) tracks the ball so page scrolling is never
hijacked — only grabbing the ball captures the pointer.

- **Aim:** drag from ball = slingshot; dotted cyan aim line + coral power
  ring; power = drag distance clamped to 260px; launch velocity = 26 × power
  fraction, opposite the drag.
- **Physics:** friction ×0.985/frame, wall bounce ×−0.72, stop below 0.05.
- **Hole:** lime-ringed cup + coral flag. Capture requires dist < r−2 **and**
  speed < 9; faster near-misses roll over the cup ("too hot! ease up").
- **Sink:** 26-particle lime burst, ball shrink, counter chip
  (`PUTTS SUNK · NN`), escalating hint lines, respawn at a random spot ~700ms
  later.
- **Placement (desktop >900px):** hole ≈ (0.81W, 0.54H) — right of the
  wordmark, clear of copy; ball spawns ≈ (0.68W, 0.74H), right of the CTAs.
  **Mobile:** both live in the free strip at the bottom of the hero
  (hole ≈ (0.72W, H−150), ball ≈ (0.26W, H−120)).
- Canvas is DPR-aware (capped ×2) and relayouts on resize.

## 6. Motion inventory

| Animation | Duration | Reduced-motion |
| --- | --- | --- |
| Aurora drift ×4 | 44–80s alternate | off |
| Marquee scroll ×2 | 36s linear | off |
| Scroll reveals | 0.7s, 60ms stagger | shown instantly |
| Leaderboard reshuffle | rows re-rank every 2.2s, 0.6s ease | off (static order) |
| Hunt verify loop | stamp every 3.8s, next target 1.4s later | off |
| Ticket count-up | 0 → 1,250, 1.6s cubic ease-out on first view | jumps to final |
| Rewards toggle flicker | every 3.4s | off |
| Venue auto-cycle | 4s | off |
| Scanline / pulses / blink | 1.4–2.6s loops | off |
| Cursor glow | rAF lerp 0.08 | off |
| Putt game | rAF, user-initiated | kept (interaction, not ambient); idle hole pulse stilled |

Everything ambient dies under `prefers-reduced-motion: reduce`; the page must
still make complete sense as a static document (and with JS off — `<noscript>`
reveals content and hides game affordances).

## 7. Assets & rebuild notes

- **Fonts:** latin-subset variable woff2 from Google Fonts (Unbounded
  ~51KB, Space Grotesk ~22KB), base64-embedded in `@font-face` with OFL
  attribution comments. To refresh: fetch `fonts.googleapis.com/css2` with a
  Chrome UA, take the `/* latin */` block URLs, download, base64, splice.
- **Favicon + logo tile:** inline SVG infinity mark, lime stroke on
  `#1b2044` tile (favicon ground `#10142e`).
- **Icons:** hand-drawn inline SVG, 1.7–1.8 stroke, round caps, accent colors.
- Whole page ≈ 145KB, one file, no build step. Copy changes are plain HTML
  edits; palette changes are token edits — but grep for raw `rgba(...)`
  echoes of the accent colors (glows/canvas/JS use literal values on purpose).

## 8. Copy voice

Confident arcade-operator voice, no exclamation marks, lowercase small-print
mono-style labels (`insert coin`-energy without the cliché). B2B pitch aimed
at venue owners; player benefits stated as venue benefits. Key phrases in
use: "every game, one platform" (footer/h2), "coming soon to a venue near
you" (eyebrow), "no credit card · no app store · just play" (small print).
Contact is `hello@infinicade.com` until real mail exists on the domain.
