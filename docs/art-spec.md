# Mini Golf — Art Asset Specification

A catalogue of every visual element in the app, with the specs an artist (or
another session) needs to design themed art around them. Pair this with the
**live style guide at `/style`** (source: `src/features/style/StyleGuide.tsx`),
which renders every element below and re-skins in real time.

> Everything today is drawn with CSS "materials." The goal is to replace those
> with real art. Read **§0 the theming contract** first — it defines the hooks
> art must respect so it drops into the existing system.
>
> **Emoji are placeholders, not a standard interface option.** The glyphs you see
> today (course markers, controls, activity icons) are stand-ins. Every real
> theme ships its own **image icon set — PNG / SVG / WEBP** (SVG preferred). A
> dedicated "Emoji" theme could keep using system emoji, but it's the exception;
> for every other theme, treat each emoji below as a slot that needs a designed
> image asset.
>
> **Read the specifics as the current default, not a mandate.** The fonts,
> colors, radii, and material looks below describe what the app ships *today* —
> examples to match or deliberately diverge from. A theme is free to bring its own
> typefaces, palette, corner radii, and materials. What's actually **fixed** is
> the *structure*: the theming hooks (§0), the element slots (§2), and the
> functional constraints — tap-target sizes, safe areas, and contrast minimums.
> Everywhere below, treat concrete values as "e.g." unless they're called out as
> a constraint.

---

## 0. The theming contract (read first)

The app composes three independent visual axes on `<html>`. Art must survive all
combinations, or ship one variant per relevant axis.

| Axis | Attribute / var | Values | What it controls |
|---|---|---|---|
| **Skin** | `data-template` | `unstyled` (default), `candy`, `blocky`, `uv`, `glass`, `chrome` | The *material* every surface is painted with (defined in `src/index.css`). |
| **Mode** | `data-theme` | `light`, `dark` | The neutral ramp + inks invert. |
| **Course tint** | `.course-tinted` + `--course-accent` | any hex | Play/scorecard screens wash toward the course color. |

**Per-instance CSS variables art can key to** (set inline at each element):

| Var | Set on | Meaning |
|---|---|---|
| `--accent` | root / `.course-tinted` | Interactive accent — house green, or the course color on themed screens. |
| `--tile-accent` | each course tile | That course's hex. |
| `--puck-accent` | each course puck | That course's hex. |
| `--tag-accent` | each player tag | Course hex, or `#166534` default. |
| `--glow` | resume card, winner hero | Accent for the looping halo. |
| `--i` | list items / tiles | Zero-based index, drives stagger delay. |

**Neutral ramp:** `--color-fairway-50 … --color-fairway-950` (mode-aware; see
§1). Text uses `50` (near-white on dark / near-black on light) through `400`
(muted); `500–950` are surfaces/borders.

**How art plugs in.** Most elements are pure CSS today. To theme with art, either
(a) replace a material with an SVG/PNG background, or (b) supply per-skin and/or
per-mode variants. **Prefer inline SVG** that inherits `currentColor` and reads
`--accent`/`--tile-accent` where a color must track the course. Provide a
light+dark treatment unless a single asset clears contrast on both grounds.

**Validate every asset** by dropping it into `/style` and cycling all six skins ×
light/dark (skin picker → each skin; theme toggle in the header).

---

## 1. Global systems (current defaults — themeable)

The tokens, type, and metrics here describe the app as it ships today. Treat them
as a reference for matching the default look and as a starting palette to
override — not as required values. The exceptions, which a theme should honor,
are flagged **[constraint]**: tap-target sizes, safe areas, and contrast minimums.

### 1.1 Color — neutral fairway ramp (mode-aware)

_Current default palette; a theme may retint the whole ramp (keep enough
light↔dark separation for text contrast)._

| Step | Dark | Light | Typical use |
|---|---|---|---|
| 50 | `#f5f5f5` | `#1a1a1a` | Primary text |
| 100 | `#e8e8e8` | `#2c2c2c` | Secondary text |
| 200 | `#cfcfcf` | `#444444` | |
| 300 | `#ababab` | `#5e5e5e` | |
| 400 | `#b0b0b0` | `#585858` | Muted labels / eyebrows |
| 500 | `#6f6f6f` | `#8a8a8a` | Borders (accented) |
| 600 | `#5b5b5b` | `#a3a3a3` | |
| 700 | `#4f4f4f` | `#c2c2c2` | Ghost borders |
| 800 | `#464646` | `#cccccc` | Card borders |
| 900 | `#3a3a3a` | `#fbfbfb` | Raised surface top |
| 950 | `#2f2f2f` | `#eaeaea` | Page / recessed floor |

### 1.2 Color — accent, inks, score signals

- **Interactive accent** `--accent`: dark `#22c55e`, light `#1f9d55` (house green); replaced by the course accent on themed screens.
- **Per-course accents:** Blue `#3b82f6` · Green `#22c55e` · Dragon's Hollow `#ea580c` · Western `#b45309` · Red `#ef4444`.
- **Per-location accents:** Upland `#38bdf8` · Tukwila `#f472b6` · Wilsonville `#facc15`.
- **Text inks** (`--ink-*`, dark / light): default `#86efac`/`#157a3c` · green `#85e0a5`/`#157a3c` · blue `#b1c3d8`/`#3f5c7a` · red `#d7a49e`/`#9b4a42` · western `#dcc396`/`#7a5a2e` · dragon `#fdba74`/`#a34a08`.
- **Score signals:** under-par `--score-under` `#34d399`/`#0a7a40` (green) · over-par `--score-over` `#fbbf24`/`#a34a08` (amber) · par = neutral fairway-100.
- **Confetti palette:** `#22c55e #f0fdf4 #fbbf24 #38bdf8 #f472b6 #a78bfa #fb923c`.

### 1.3 Typography (current — a theme may substitute its own)

The app currently ships **system font stacks**, chosen for zero-download
performance — but typography is one of the biggest levers a theme has, and a
theme is expected to bring its own typefaces (a chunky display face, a playful
arcade/numeric face, etc.). The values below are a reference for the *roles* and
the current default, not a required stack. Keep the size hierarchy legible and
the numeric/tag face monospaced enough to align in columns.

- **Roles in use** — a *UI/body* face, and a *mono/"arcade"* face for player tags, winner names, the scorecard tag column, and rank numerals. Any theme should fill both roles; the specific families are open.
- **Current defaults (example, swappable):** UI → `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto`; mono/arcade → `ui-monospace, 'SF Mono', 'Cascadia Code', Menlo` (with `.font-arcade` adding `letter-spacing: 0.15em`).
- **Scale (px), current:** 48 · 36 · 30 · 24 · 20 · 18 · 16 (body) · 14 · 12 (eyebrow) · 11 / 10 / 9.5 (micro). A theme may re-scale; preserve the relative hierarchy.
- **Weights, current:** display `font-black` (900), body `font-bold` (700); eyebrows `uppercase` + wide tracking. Swap freely if the face carries hierarchy differently.
- **Note:** custom fonts must be self-hosted/bundled (the app avoids external font CDNs); ship the files with the theme.

### 1.4 Elevation tokens (match these if art casts shadows)

`--elev-1/2/3` (layered ambient shadows), `--bevel` / `--bevel-strong` (top
inner highlight), `--sink` (recessed inner shadow), `--surface-hi`/`--surface-lo`
(raised-card gradient endpoints). Dark leans on cast black shadows; light on soft
blue-grey. Full values in `src/index.css` `:root` (dark) and `:root[data-theme='light']`.

### 1.5 Motion catalogue (art should hold up mid-animation)

| Class | Trigger | Duration / easing | Reduced-motion |
|---|---|---|---|
| `animate-page-in` | route mount | 0.42s (0.22,1,0.36,1) | fade |
| `animate-rise-in` | list rows | 0.5s + `--i`×55ms | fade |
| `animate-pop-in` | hero tiles/cards | 0.52s (0.22,1.4,0.36,1) + `--i`×60ms | fade |
| `animate-score-punch` | stroke ± | 0.34s squash-pop | none |
| `animate-trophy-pop` | winner / result | 0.6s overshoot | none |
| `animate-result-swell` | spinner landing | 0.5s | fade |
| `animate-glow-pulse` | resume/winner CTA | 2.4s loop, `--glow` | dropped |
| `animate-wiggle` | Home ⛳️ | 0.7s | none |
| `btn-sheen` | primary btn mount | 2.6s one-shot sweep | dropped |

### 1.6 Layout & metrics

- **Column:** `max-w-md` = **448px** portrait, centered; content padding 16px. _(current layout; art should compose to a ~448px column.)_
- **Safe areas [constraint]:** body pads `env(safe-area-inset-*)`; TopBar pins to `env(safe-area-inset-top)`. Keep art clear of notch/home-indicator zones.
- **Tap targets [constraint]:** interactive elements ≥ ~44px hit area — current keys 56×56, back 40×40, pills 36×36, buttons ~52 tall. Sizes can shift stylistically but not below a comfortable touch target.
- **Radii scale (current example):** 8 (`lg`) · 12 (`xl`) · 16 (`2xl`) · 24 (`3xl`) · full. A theme may pick its own corner language (sharp, pill, etc.).

---

## 2. Element catalogue

Format per item — **Where · Size · Shape · States · Color hooks · Art needed.**
The sizes and shapes are the *current* implementation, given as reference. The
parts a theme should preserve are each element's **role**, its **states**, and
its **color hooks** (§0); the look is open.

### 2.1 App identity (real raster assets — highest priority)

- **App icon set** — `public/icons/`. `icon-512.png` (512², also **maskable**: keep the mark within the safe circle ⌀≈410), `icon-192.png` (192²), `apple-touch-icon.png` (180², no transparency, no rounding — iOS masks), `favicon-32.png` (32²). **Art needed:** the brand mark, legible at 32px, safe for maskable cropping.
- **Course map illustrations** — `public/maps/*.svg` (currently `haunted-manor`, `jungle-run`, `pirates-cove`, `space-odyssey`), shown full-bleed on `/courses/:id/map` (CourseMap). **Art needed:** a top-down hole map per course, "Tap anywhere to begin" overlay-safe (center/edges kept calm).

### 2.2 Core controls & chrome

- **Primary button** (`Button` primary → `.btn-accent`) — Where: main CTAs. Size: full-width, ~52 tall, radius 16. States: rest / `:active` (drops 3px onto lip) / `disabled` (flat, 40% opacity). Color: `--accent` (course-aware). Art: the button "face" material + optional pressed state; label is `fairway-50` text (keep ≥4.5:1).
- **Ghost button** (`.surface-1` + border) — secondary menu actions; same box, subtler raise, dips 1px on press.
- **Danger button** (`.btn-danger`) — destructive; red material (`#b91c1c` flat in unstyled; candy gradient otherwise), white label.
- **Stepper key** (`.key`) — ± on the play screen; 56×56, radius 16, short lip, depresses on press; glyphs `+` / `−` (36px). Art: neutral key face + the ± marks (icon-replaceable).
- **Back key** (`.key`) — 40×40, radius 12, glyph `‹` (24px).
- **Toggle pills** — `HeaderControls` (light/dark ☀️/🌙 + mute 🔊/🔇) live at each screen's header-right and Home top-right; **SkinPicker** 🎨 is dev-only (bottom-left, `DEV_MODE`). Each pill 36×36 circle, `border-fairway-800/70 bg-fairway-950/80 backdrop-blur`. Art: pill background + the three glyph pairs; the SkinPicker menu rows carry a color-dot swatch (16×16 circle) per skin.
- **BuildStamp** (dev) — tiny status pill, bottom-right; text only.

### 2.3 Surfaces (materials, not shapes)

- **`.surface`** raised card · **`.surface-1`** flatter tile/panel · **`.surface-sunk`** recessed well (score readouts). Art: three material treatments (raised, semi-raised, carved) that read in light+dark. These back most cards, so they're the highest-leverage material to theme.

### 2.4 Home

- **Hero glyph** — Home top, ⛳️ at 48px, `animate-wiggle` on mount. Art: brand hero mark (animatable, transform-origin bottom).
- **Location bar** — `.surface-1` row, radius 16, 📍 marker (18px) + "Location" eyebrow + venue name + "Change". Art: pin marker icon; row material from §2.3.
- **Resume card** — `.surface` CTA, radius 16, `animate-glow-pulse` in `--glow`=course accent; holds course name + player tags. Art: card material + the pulsing halo treatment.
- **Course tile** — `.tile`, radius 24, ~1:1, `--tile-accent`, `animate-pop-in` (stagger via `--i`), press drops onto a colored lip. Contains a **course puck** + name. Art: tile face material (course-tinted) + lip.
- **Secondary menu** — stack of ghost buttons (Scavenger hunt, 🎡 While You Wait, Rules, See the leaderboard, 📲 Install).

### 2.5 Course identity — the puck / marker system

- **Course puck** (`.course-puck`) — 56×56 circle, domed glossy cap in `--puck-accent`; center holds the course's `themeEmoji`. Appears on Home tiles and (as a par medallion sibling) on the scorecard. **This is the primary place a bespoke course-icon set replaces emoji.**
- **Current markers (emoji placeholders → design an image set):** blue 🔵 · green 🟢 · red 🔴 · dragon 🐉 · western 🤠 · california/jungle 🌴 · classic/default ⛳️ (legacy: pirate 🏴‍☠️ · space 🚀 · haunted 👻). Art: one **image icon (PNG/SVG/WEBP)** per course theme, legible at 24–28px inside the 56px disc, works on the course-accent ground; ideally a duotone SVG that can sit on the puck material in any skin. Emoji is only the fallback for an optional "Emoji" theme.
- **Par medallion** — `.surface-1` 56×56 circle, par numeral in `accentInk(theme)`.

### 2.6 Scorecard & summary

- **Hole-jump grid** — `grid-cols-6` of small keys: current = `.btn-accent`, done = `.surface-1`, unplayed = outline. 32–36px cells.
- **Hole header** — "Hole N" (36px black) or hole name (30px).
- **Player row** — `.surface` card holding a **TagChip** and the stepper (− key / `.surface-sunk` well with 36px punch-animated number / + key).
- **TagChip** — arcade pill, radius 8, `px-2.5 py-1`, 18px bold text, `--tag-accent`; empty shows `···`. Art: pill material per skin; text must stay ≥4.5:1 (known tight spot on bright accents — see note below).
- **Winner hero** — `.surface` card, trophy 🏆 (48px, `animate-trophy-pop`), "Winner" eyebrow (tracking 0.25em), winner tag in ink, total + over/under, accent spotlight + `animate-glow-pulse`. Art: trophy/celebration mark; card material.
- **Standings row** — `.surface-1` row: mono rank · arcade name in ink · total.
- **Nine-grid table** — `.surface-1` table, Front/Back nine; header `bg-fairway-900/60`, par row `bg-fairway-950`; cells color by score signal (§1.2), empty = `·`.
- **Sync note / badges** — "Saved to leaderboard ✓", amber failure; TvLeaderboard "You" badge (rounded-full), highlighted row ring.

### 2.7 While-You-Wait (Fun zone)

- **Hub tiles** — `FunZone` list; each an accent-tinted row with a **48×48 rounded-xl emoji chip**: 💡 Fun Facts · 🧠 Trivia · ⛳️ Arcade Putt · 🎳 Skee-Ball · 🏒 Air Hockey · 🚗 Bumper Cars · 🚤 Bumper Boats · 🪓 Axe Throwing · ⚾️ Batting Cages · 🎳 Bowling · 🏁 Go-Karts. Art: an icon per activity (chip-sized).
- **Prize wheel** (`Spinner`) — SVG `viewBox 0 0 200 200`: pie wedges (gameplay blues / dare warms), per-wedge emoji, hub cap circle, fixed 🔻 pointer, peg ticks, CSS rotation. Result card `animate-result-swell` with a kind badge (⛳️ next-shot twist / 🎉 just for fun) + emoji. Art: wheel face, pointer, hub, wedge icons, result card.
- **Trivia** — question (20px bold); choice buttons (radius 12) with answered states green `border-green-500 bg-green-500/20` (✓) / red (✗); results 🧠 (60px) + `score/total`.
- **FunFacts** — tappable flashcard, radius 24, emoji (60px) + fact.
- **Minigame shell** (SkeeBall, AirHockey, Bumper Cars/Boats, AxeThrow, BattingCages, Bowling, GoKarts, PuttGolf) — shared: HUD counter row (score/ball/frame/timer), a **`<canvas>` playfield** (radius 16, `border-fairway-800`, drag input), a hint line, and a result screen (`animate-trophy-pop`, 60px emoji, big score, "Play again"). Game-specific primitives: GoKarts SVG **track minimap** + kart-select cards; PuttGolf aim line (power green→red) + hazards + hole-result emoji (🏌️/⛳️). **Art:** per-game playfield backgrounds + sprites (ball, puck, kart, target, pins, cage, axe, bumper) drawn into canvas — supply as sprite sheets / SVGs the canvas can raster.

### 2.8 System overlays

- **UpdateModal** — blocking dialog, `bg-fairway-950/80 backdrop-blur`; card radius 16, glyph 🔄, "Reload".
- **RotateNudge** — landscape overlay, animated phone-rotate glyph (`.rotate-nudge-phone`).
- **Confetti** — full-screen canvas, two corner cannons, three particle shapes (rect / strip / circle), palette in §1.2. Art: optional themed particle shapes.
- **Empty states** — "No courses at this location yet.", Hunt gate 🔍 (48px) "Start a round to play", "No scores yet…".

### 2.9 Icon-marker set (image icons, per theme)

**Emoji is not a standard interface option.** Each theme (except an optional
"Emoji" theme) ships its own image icon set in **PNG / SVG / WEBP** — SVG
preferred for UI markers, WEBP/PNG acceptable for richer/illustrative icons. The
table below is the list of marker *slots* every theme's icon set must fill.
Design each crisp at the listed size; for single-color UI marks, an SVG that
takes `currentColor` + `--accent` lets one asset serve light/dark and course
tinting, while illustrative sets can ship per-mode raster variants.

| Group | Markers | Size |
|---|---|---|
| Course identity | 🟢 🔵 🔴 🐉 🤠 🌴 ⛳️ | 24–28px (in 56px puck) |
| Nav & chrome | ⛳️ 📍 ‹ › • · 🔄 | 16–24px |
| Controls | 🎨 ☀️ 🌙 🔊 🔇 | 18px (36px pill) |
| Play controls | ＋ − 🔍 🎡 ⏸ ▶ ⏭ 🏆 ✓ | 24–36px |
| Fun zone | 💡 🧠 🎳 🏒 🚗 🚤 🪓 ⚾️ 🏁 🔻 🤖 🏌️ | 24–60px |

---

## 3. Deliverables & conventions

- **Format:** every theme provides an **image icon set — SVG / PNG / WEBP** (emoji is not a delivery format for standard themes; it's the fallback for an optional "Emoji" theme only). **SVG preferred** for UI markers — single-color/duotone, `fill="currentColor"` where it should track text, and reading `var(--accent)` / `var(--tile-accent)` where it must track the course. Use **WEBP** (or PNG) for richer illustrative icons and any photographic art; provide raster app icons at **@1×/@2×/@3×**.
- **Variants:** ship **light + dark** whenever one asset can't clear contrast on both grounds. If an asset is skin-specific (e.g., a candy-only gloss), name the skin; otherwise design skin-agnostic so it inherits the skin's material.
- **Contrast [constraint]:** text/icons on their ground ≥ **4.5:1** (normal) / **3:1** (large ≥24px or bold ≥18.66px, and non-text UI). This is a hard requirement regardless of theme aesthetics. Player tags on bright course accents are the known tight spot — verify each.
- **Sizing:** author on the pixel sizes in §1.6 / §2; keep strokes optically consistent at those sizes.
- **Where assets live:** app icons `public/icons/`, maps `public/maps/`, new icon sets under `public/` (or inline in components). Materials/skins are CSS in `src/index.css` under `:root[data-template='…']`.
- **Naming:** `element[-variant][-skin][-mode]@scale.ext`, e.g. `puck-dragon.svg`, `app-icon-512.png`, `wheel-pointer.svg`.
- **Validate:** open `/style`, cycle all six skins × light/dark, confirm the asset reads and holds through its animation.

---

_Living source of truth: the `/style` route (`src/features/style/StyleGuide.tsx`)
renders each element above and re-skins live. Update this doc when elements are
added or the material system changes._
