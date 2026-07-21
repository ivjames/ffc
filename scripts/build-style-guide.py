# -*- coding: utf-8 -*-
"""Builds docs/style-guide.html — faithful unstyled screen mockups (light+dark)
with numbered callouts and a per-element spec table for each screen."""

OUT = "/home/user/ffc/docs/style-guide.html"

# ---------------------------------------------------------------- screen model
# Each screen: id, name, route, purpose, tint(bool course-tinted),
#   body(html for phone content), callouts [(n, top%, left%)], specs [rows]
# A spec row: (n, element, role, size, states, hooks, art)

def phone_body(*rows):
    return "\n".join(rows)

SCREENS = []
def screen(**kw): SCREENS.append(kw)

# helper snippets ------------------------------------------------------------
def topbar(title, back=True, right="ctl"):
    b = '<span class="m-back">‹</span>' if back else ''
    r = ''
    if right == "ctl":
        r = '<span class="m-pill">☀️</span><span class="m-pill">🔊</span>'
    return f'<div class="m-top">{b}<span class="m-title">{title}</span><span class="m-sp"></span>{r}</div>'

# ============================================================ 1. HOME
screen(
 id="home", name="Home", route="/", purpose="Landing hub — pick a course, resume a round, reach maps / rules / leaderboard / install.",
 body=phone_body(
  '<div class="m-topflush"><span class="m-sp"></span><span class="m-pill">☀️</span><span class="m-pill">🔊</span></div>',
  '<div class="m-hero">⛳️</div>',
  '<div class="m-locbar"><span>📍 <b>LOCATION</b><br>Upland</span><span class="m-chg">Change</span></div>',
  '<div class="m-resume"><div class="m-eyebrow">RESUME ROUND</div><div class="m-row2"><b>Green Course</b><span class="m-tags"><span class="m-tag" style="--ga:#22c55e">AVA</span><span class="m-tag" style="--ga:#22c55e">JZ</span></span></div></div>',
  '<div class="m-tiles">'
    '<div class="m-tile" style="--ta:#3b82f6"><div class="m-puck" style="--pa:#3b82f6">🔵</div>Blue</div>'
    '<div class="m-tile" style="--ta:#22c55e"><div class="m-puck" style="--pa:#22c55e">🟢</div>Green</div>'
    '<div class="m-tile" style="--ta:#ea580c"><div class="m-puck" style="--pa:#ea580c">🐉</div>Dragon</div>'
    '<div class="m-tile" style="--ta:#b45309"><div class="m-puck" style="--pa:#b45309">🤠</div>Western</div>'
  '</div>',
  '<div class="m-menu"><div class="m-ghost">Scavenger hunt</div><div class="m-ghost">🎡 While You Wait</div><div class="m-ghost">Rules</div><div class="m-ghost">See the leaderboard</div><div class="m-ghost">📲 Install app</div></div>',
 ),
 callouts=[(1,3,86),(2,11,50),(3,25,18),(4,36,50),(5,55,30),(6,78,50)],
 specs=[
  (1,"Header control pills","Global, top-right — light/dark + mute","36×36 circle each","☀️/🌙 · 🔊/🔇 toggle","translucent pill bg; glyph","pill bg + the two glyph pairs (icons)"),
  (2,"Hero glyph","Brand mark, top of Home","48px, wiggles on mount","one-shot wiggle","—","brand hero mark (animatable, origin bottom)"),
  (3,"Location bar",".surface-1 row → /locations","full-width, radius 16","press dip","📍 pin marker","pin icon; row material"),
  (4,"Resume-round card",".surface CTA → resume play","full-width, radius 16","only when a round is live; glow-pulse","--glow = course accent","card material + pulsing halo"),
  (5,"Course tiles",".tile grid → course map","~1:1, radius 24","pop-in stagger; press onto lip","--tile-accent, --puck-accent","tile face + colored lip + puck cap + marker"),
  (6,"Menu (ghost buttons)","Secondary nav","full-width rows","press dip","—","ghost material; leading icon per row"),
 ],
)

# ============================================================ 2. LOCATIONS
screen(
 id="loc", name="Location Picker", route="/locations", purpose="Choose the venue (manual or GPS); scopes which courses show.",
 body=phone_body(
  topbar("Choose a location"),
  '<div class="m-gps">🧭 Use my location</div>',
  '<div class="m-note">Locating…</div>',
  '<div class="m-lrow m-sel"><span class="m-lico" style="--a:#38bdf8">📍</span><span><b>Upland</b><br><small>4 courses</small></span><span class="m-cur">Current</span></div>',
  '<div class="m-lrow"><span class="m-lico" style="--a:#f472b6">📍</span><span><b>Tukwila</b><br><small>3 courses</small></span><span class="m-chev">›</span></div>',
  '<div class="m-lrow"><span class="m-lico" style="--a:#facc15">📍</span><span><b>Wilsonville</b><br><small>2 courses</small></span><span class="m-chev">›</span></div>',
  '<div class="m-foot">Placeholder sites — the client\'s real locations swap in here.</div>',
 ),
 callouts=[(1,17,50),(2,27,26),(3,40,50),(4,55,84)],
 specs=[
  (1,"“Use my location”","GPS detect button","full-width, radius 12","disabled + “Locating…” while working; only if geolocation supported","🧭 compass","compass icon; button material"),
  (2,"Detect status message","Feedback line","text","amber on error/progress","amber text","—"),
  (3,"Location row","One per venue","full-width, radius 16","selected vs unselected","📍 chip tinted to location accent (--a)","pin chip icon; row material"),
  (4,"Trailing marker","Row right edge","—","“Current” label (selected) / › chevron","location accent","chevron icon"),
 ],
)

# ============================================================ 3. COURSE PICKER
screen(
 id="pick", name="Course Picker", route="/new", purpose="Pick which course at the current location to score.",
 body=phone_body(
  topbar("Pick a course"),
  '<div class="m-locbar sm"><span>📍 Upland</span><span class="m-chg">Change</span></div>',
  '<div class="m-crow"><span class="m-badge" style="--a:#3b82f6">🔵</span><span><b>Blue Course</b><br><small>18 holes · par 47</small></span><span class="m-chev">›</span></div>',
  '<div class="m-crow"><span class="m-badge" style="--a:#22c55e">🟢</span><span><b>Green Course</b><br><small>18 holes · par 48</small></span><span class="m-chev">›</span></div>',
  '<div class="m-crow"><span class="m-badge" style="--a:#ea580c">🐉</span><span><b>Dragon\'s Hollow</b><br><small>18 holes · par 52</small></span><span class="m-chev">›</span></div>',
  '<div class="m-crow"><span class="m-badge" style="--a:#b45309">🤠</span><span><b>Western</b><br><small>18 holes · par 50</small></span><span class="m-chev">›</span></div>',
 ),
 callouts=[(1,15,50),(2,30,16),(3,30,50),(4,30,86)],
 specs=[
  (1,"Location switcher","Row → /locations?next=/new","full-width, radius 12","press dip","📍 pin","pin icon; row material"),
  (2,"Course marker badge","Left of each course","12×12 rounded square","—","tinted from course accent (--a)","the course marker icon"),
  (3,"Course row","Tap → player setup","full-width, radius 16","press dip; empty state “No courses…”","—","row material"),
  (4,"Chevron","Row right edge","—","—","muted","forward chevron icon"),
 ],
)

# ============================================================ 4. PLAYER SETUP
screen(
 id="setup", name="Player Setup", route="/new/setup", purpose="Choose player count (1–4) and enter three-character arcade tags, then start.",
 body=phone_body(
  topbar("Green Course"),
  '<div class="m-lbl">Players</div>',
  '<div class="m-count"><span>1</span><span class="on">2</span><span>3</span><span>4</span></div>',
  '<div class="m-lbl">Tags (3 letters/numbers, arcade style)</div>',
  '<div class="m-tagin"><span class="m-idx">1</span><span class="m-inp">AVA</span></div>',
  '<div class="m-tagin"><span class="m-idx">2</span><span class="m-inp err">J@</span></div>',
  '<div class="m-errln">Use letters or numbers only.</div>',
  '<div class="m-primary">Start round</div>',
 ),
 callouts=[(1,17,50),(2,34,26),(3,45,72),(4,66,50)],
 specs=[
  (1,"Player-count selector","1–4 buttons","4-col grid","selected vs unselected","—","selected/unselected states"),
  (2,"Tag input","Arcade text field, one per player","maxLength 3","empty (ABC placeholder) / filled / invalid","arcade/mono face","field material; the arcade face"),
  (3,"Invalid-tag state","On a bad 3-char tag","—","red border + inline error","red","error color"),
  (4,"Start round","Primary CTA → play","full-width, ~52 tall","disabled until roster valid; “Starting…”","--accent","primary button material"),
 ],
)

# ============================================================ 5. COURSE MAP
screen(
 id="map", name="Course Map", route="/courses/:id/map", tint=True, purpose="Opening course screen — the map, and a giant “tap to begin” target that starts the round.",
 body=phone_body(
  topbar("Dragon's Hollow"),
  '<div class="m-mapframe"><div class="m-mapfallback" style="--a:#ea580c">🐉</div></div>',
  '<div class="m-tapbegin"><b>TAP ANYWHERE TO BEGIN</b><br><small>18 holes · Dragon\'s Hollow</small></div>',
 ),
 callouts=[(1,34,50),(2,74,50)],
 specs=[
  (1,"Map illustration","Full-bleed course map (whole panel is one tap target → setup)","framed container","real map art, OR emoji fallback panel (accent-tinted) when no map","--course-accent tint on the screen","top-down hole map per course; keep center/edges calm for the overlay"),
  (2,"“Tap to begin” prompt","Overlay call-to-action","—","pulsing","—","legible over the map art in both modes"),
 ],
)

# ============================================================ 6. SCORECARD
screen(
 id="play", name="Scorecard (play screen)", route="/play/:clientId", tint=True, purpose="The core loop — score one hole at a time for every player; each edit persists instantly.",
 body=phone_body(
  '<div class="m-top"><span class="m-back">‹</span><span class="m-title">Green Course</span><span class="m-sp"></span><span class="m-mini">🔍</span><span class="m-mini">🎡</span><span class="m-mini txt">Holes</span></div>',
  '<div class="m-holehdr"><div class="m-eyebrow">HOLE 3</div><div class="m-holename">The Windmill</div></div>',
  '<div class="m-parmed">3</div>',
  '<div class="m-prow"><span class="m-tag" style="--ga:#22c55e">AVA</span><span class="m-key">−</span><span class="m-well">2</span><span class="m-key">+</span></div>',
  '<div class="m-prow"><span class="m-tag" style="--ga:#22c55e">JZ</span><span class="m-key">−</span><span class="m-well">–</span><span class="m-key">+</span></div>',
  '<div class="m-nav"><span class="m-ghost sm">‹ Prev</span><span class="m-ghost sm">Next ›</span></div>',
  '<div class="m-foot">Max 8 strokes per hole</div>',
 ),
 callouts=[(1,7,80),(2,20,50),(3,33,50),(4,47,17),(5,47,50),(6,47,83),(7,68,50)],
 specs=[
  (1,"TopBar right cluster","Play-screen shortcuts","glyph buttons","toggle “Holes” grid","🔍 hunt · 🎡 spinner","the two icons"),
  (2,"Hole header / hole-jump grid","Hole title; toggled 6-col grid of keys","32–36px cells","current=.btn-accent · done=.surface-1 · unplayed=outline","--accent","key states"),
  (3,"Par medallion",".surface-1 disc","56×56 circle","—","par numeral in course ink","disc material"),
  (4,"Player tag","TagChip on each row","radius 8 pill","empty = ···","--tag-accent","pill material (contrast-checked)"),
  (5,"Score well",".surface-sunk readout",".surface-sunk, radius 14","punches on each edit (score-punch); “–” unscored","—","carved-well material"),
  (6,"± stepper keys",".key +/−","56×56, radius 16","press dip; disabled at floor / stroke-cap (flat, 30%)","—","key face + the +/− marks"),
  (7,"Hole navigation","‹ Prev / Next › (ghost) — or Finish (primary) on last hole","full-width","disabled until hole/round complete; Finish plays cup sound","—","ghost + primary materials"),
 ],
)

# ============================================================ 7. SUMMARY
screen(
 id="sum", name="Summary (final scorecard)", route="/play/:clientId/summary", tint=True, purpose="Celebrates the winner, shows standings + hole-by-hole grid, syncs to the leaderboard.",
 body=phone_body(
  topbar("Final scorecard", right=None),
  '<div class="m-winner"><span class="m-trophy">🏆</span><div><div class="m-eyebrow">WINNER</div><div class="m-wname">AVA</div></div><span class="m-wscore">41 <small>−4</small></span></div>',
  '<div class="m-stand"><span class="m-rank">2</span><span class="m-sname">JZ</span><span>45 <small>E</small></span></div>',
  '<div class="m-grid"><div class="m-gh">Front</div><div class="m-gc u">2</div><div class="m-gc">2</div><div class="m-gc o">6</div><div class="m-gc">3</div><div class="m-gc u">2</div></div>',
  '<div class="m-sync">Saved to leaderboard ✓</div>',
  '<div class="m-nav"><span class="m-ghost sm">🏆 View leaderboard</span><span class="m-primary sm">Done</span></div>',
 ),
 callouts=[(1,16,50),(2,36,50),(3,52,50),(4,66,50),(5,78,50)],
 specs=[
  (1,"Winner hero",".surface card + glow","full-width, radius 24","trophy-pop; “Tied for the win” variant","--glow accent; winner tag in ink","trophy/celebration mark; card + halo"),
  (2,"Standings row",".surface-1 per non-winner","full-width, radius 16","rise-in stagger","mono rank; arcade tag in course ink","row material"),
  (3,"Nine-grid table","Front (1–9) & Back (10–18)",".surface-1 table","cells: under=green · over=amber · par=neutral · empty=·","--score-under / --score-over","table material; the score-signal colors"),
  (4,"Sync note","Leaderboard status","text","synced ✓ / amber fail / saving / offline","amber on fail","the ✓ tick"),
  (5,"Action buttons","🏆 View leaderboard (ghost) · Done (primary)","full-width","—","--accent","ghost + primary materials"),
 ],
)

# ============================================================ 8. RULES
screen(
 id="rules", name="Rules", route="/rules", purpose="Static, offline general rules + optional per-course notes. Read-only.",
 body=phone_body(
  topbar("Rules"),
  '<div class="m-eyebrow2">GENERAL</div>',
  '<div class="m-rule"><span class="m-num">1.</span> One player putts at a time; honors to the lowest last score.</div>',
  '<div class="m-rule"><span class="m-num">2.</span> Max 8 strokes per hole, then pick up and record the cap.</div>',
  '<div class="m-eyebrow2">COURSE NOTES</div>',
  '<div class="m-notecard" style="--a:#ea580c"><div class="m-nch">🐉 <b>Dragon\'s Hollow</b></div><div class="m-nb">• Putt through while the jaws are open.<br>• Give downhill putts extra room.</div></div>',
 ),
 callouts=[(1,20,30),(2,32,50),(3,58,50)],
 specs=[
  (1,"Section heading","“General” / “Course notes” eyebrow","uppercase, tracked","—","muted","—"),
  (2,"Numbered rule list","General rules","mono numerals","—","—","—"),
  (3,"Course-note card",".course-tinted card per course","radius 16","—","--course-accent corner glow; name + marker in ink; • bullets in ink","tinted card material; the course marker"),
 ],
)

# ============================================================ 9. INSTALL
screen(
 id="install", name="Install", route="/install", purpose="PWA install landing (QR-code target); shows the right path per platform.",
 body=phone_body(
  topbar("Install the app"),
  '<div class="m-hero2">⛳️</div>',
  '<div class="m-ct">Add Mini Golf to your phone</div>',
  '<div class="m-card"><div class="m-cardh">On iPhone &amp; iPad (Safari)</div>'
    '<div class="m-step"><span class="m-badge2">1</span> Tap the Share button ↑︎</div>'
    '<div class="m-step"><span class="m-badge2">2</span> Choose “Add to Home Screen” ➕</div>'
    '<div class="m-step"><span class="m-badge2">3</span> Open Mini Golf ⛳️ from your home screen</div>'
  '</div>',
  '<div class="m-warnbox">Install works from Safari only.</div>',
 ),
 callouts=[(1,15,50),(2,33,50),(3,44,20),(4,72,50)],
 specs=[
  (1,"Hero","⛳️ + heading","48px glyph","—","—","brand mark"),
  (2,"Branch card","One of: Installed (✅ + Open button) / iOS steps / Can-prompt (Install button) / Generic (⋮ ⋯ steps)","radius 16","platform-dependent branch; dismissed-retry hint","—","card material"),
  (3,"Numbered step badge","Instruction steps","circular badge","—","—","badge; step glyphs ↑︎ ➕ ⋮ ⋯"),
  (4,"Warning box","Inset caveat","radius 8","—","—","inset material"),
 ],
)

# ============================================================ 10. TV LEADERBOARD
screen(
 id="tv", name="TV Leaderboard", route="/tv", purpose="Live high-score board (polls every 5s); highlights the just-played round on arrival.",
 body=phone_body(
  topbar("Leaderboard", right=None),
  '<div class="m-tabs"><span class="on">Day</span><span>Week</span><span>Month</span><span>All</span></div>',
  '<div class="m-lb m-mine"><span class="m-rank">1</span><span class="m-lbtag">AVA</span><span class="m-lbc">Green · Upland</span><span class="m-you">You</span><b>41</b></div>',
  '<div class="m-lb"><span class="m-rank">2</span><span class="m-lbtag">JZ</span><span class="m-lbc">Green · Upland</span><b>45</b></div>',
  '<div class="m-lb"><span class="m-rank">3</span><span class="m-lbtag">MAX</span><span class="m-lbc">Blue · Tukwila</span><b>49</b></div>',
 ),
 callouts=[(1,17,50),(2,33,16),(3,33,70),(4,46,50)],
 specs=[
  (1,"Period tabs","Day / Week / Month / All","4-col","active vs inactive","—","tab states"),
  (2,"Rank / tag","Row left","mono rank + arcade tag","—","tag in ink","the arcade face"),
  (3,"“You” pill + highlight","Your rows","rounded-full pill + ring","only on your rows","ring accent","pill + ring treatment"),
  (4,"Standings row","One per score","full-width, radius 16","rise-in; error/empty/loading states","—","row material"),
 ],
)

# ============================================================ 11. HUNT
screen(
 id="hunt", name="Scavenger Hunt", route="/hunt", purpose="Snap-a-photo hunt; a vision model verifies each find. Gated on an in-progress round.",
 body=phone_body(
  topbar("Scavenger hunt"),
  '<div class="m-playas"><small>Playing as</small> <span class="m-tag sel" style="--ga:#22c55e">AVA</span> <span class="m-tag dim" style="--ga:#22c55e">JZ</span></div>',
  '<div class="m-item found"><span>Find the windmill <span class="m-hint">💡 Hint</span></span><span class="m-check">✓</span><span class="m-snap">📷 Snap another</span></div>',
  '<div class="m-item"><span>Spot a red flag <span class="m-badgeN">×0</span></span><span class="m-snap">📷 Snap</span></div>',
  '<div class="m-banner ok">Nice — AVA found it!</div>',
  '<div class="m-banner warn">That looks like a photo of a screen — take a real one.</div>',
 ),
 callouts=[(1,15,40),(2,30,20),(3,30,86),(4,44,72),(5,63,50)],
 specs=[
  (1,"“Playing as” selector","TagChip buttons","pills","selected = ring; others dimmed","--tag-accent","pill + selected ring"),
  (2,"Hint toggle / count / check","On each item","small","“💡 Hint” ↔ “Hide hint”; ×N badge (countable) or ✓ (one-off found)","muted","hint, count, check icons"),
  (3,"📷 Snap button","Capture trigger (hidden file input; rear camera in prod)","radius 12","“Snap” / “Snap another” / “Checking…” / “Found”","—","camera icon; button material"),
  (4,"Result banner","After verify","radius 12","verified / flagged (amber) / rejected","amber on flag","banner materials"),
  (5,"Item card","Per find","radius 16","found vs not-found; load-error box (red); gate state (🔍 + Start round)","—","card material"),
 ],
)

# ============================================================ 12. ARCADE PUTT
screen(
 id="putt", name="Arcade Putt", route="/putt", purpose="Playable canvas mini-golf — drag-to-aim slingshot; 9-hole or endless. Offline.",
 body=phone_body(
  topbar("Arcade Putt"),
  '<div class="m-hudrow"><span>Hole 3 / 9</span><span>Par 3 · Strokes 2</span></div>',
  '<div class="m-canvas">'
    '<div class="m-cv-green"></div>'
    '<div class="m-cv-ball"></div><div class="m-cv-aim"></div>'
    '<div class="m-cv-cup">⛳</div><div class="m-cv-pow">POWER 60%</div>'
  '</div>',
  '<div class="m-hintline">Drag back from the ball to aim.</div>',
  '<div class="m-nav"><span class="m-primary sm">Next hole →</span><span class="m-ghost sm">Reset hole</span></div>',
 ),
 callouts=[(1,15,50),(2,40,50),(3,40,20),(4,66,50)],
 specs=[
  (1,"Status header","Hole / par / strokes","text row","course vs endless","—","—"),
  (2,"Canvas playfield","Drag-to-aim slingshot","aspect-locked, radius 16","aim / rolling / splash / sunk","—","playfield bg + sprites (ball, cup+flag, bumpers, greens, hazards, splash) drawn into canvas"),
  (3,"Canvas markers","Rendered, not DOM","—","aim arrow green→amber→red; POWER% meter; idle grab-ring","aim color ramp","aim arrow, power meter, flag"),
  (4,"Play buttons","Next/See scorecard (primary) · Reset/End run (ghost)","full-width","mode-dependent","--accent","primary + ghost materials"),
 ],
)

# ============================================================ 13. FUN ZONE HUB
screen(
 id="fun", name="Fun Zone hub", route="/fun", purpose="Grid landing routing to every mini-game. Each tile = a rounded emoji chip + title.",
 body=phone_body(
  topbar("While You Wait"),
  '<div class="m-funtiles">'
    + "".join(f'<div class="m-funtile" style="--a:{c}"><span class="m-funico">{e}</span>{n}</div>' for e,n,c in [
        ("💡","Fun Facts","#f59e0b"),("🧠","Trivia","#3b82f6"),("⛳️","Arcade Putt","#16a34a"),("🎳","Skee-Ball","#22c55e"),
        ("🏒","Air Hockey","#38bdf8"),("🚗","Bumper Cars","#f97316"),("🚤","Bumper Boats","#0ea5e9"),("🪓","Axe Throw","#eab308"),
        ("⚾️","Batting","#ef4444"),("🎳","Bowling","#a855f7"),("🏁","Go-Karts","#06b6d4")])
  + '</div>',
 ),
 callouts=[(1,18,25),(2,18,75)],
 specs=[
  (1,"Activity tile","One per game → its route","2-col, radius 16","rise-in stagger; press scale","accent-tinted per tile (--a)","tile material"),
  (2,"Activity icon chip","Leading glyph on each tile","48×48 rounded chip","—","tinted to the tile accent","1 designed icon per activity (11 total)"),
 ],
)

# ============================================================ 14. MINIGAME SHELL
screen(
 id="game", name="Minigame shell (representative)", route="/fun/skeeball · /fun/bowling · /fun/karts · …", purpose="Shared shell for all 8 canvas games — HUD row, canvas playfield, hint line, game-over screen.",
 body=phone_body(
  topbar("Skee-Ball"),
  '<div class="m-hudrow"><span>Ball 4 / 9</span><span>Score 180</span></div>',
  '<div class="m-canvas game">'
    '<div class="m-cv-lane"></div><div class="m-cv-ball2"></div>'
    '<div class="m-cv-plus">+50</div>'
  '</div>',
  '<div class="m-hintline">Swipe up the lane to roll.</div>',
  '<div class="m-gameover"><div class="m-goemoji">🎳</div><div class="m-goscore">430</div><div class="m-primary sm">Play again</div></div>',
 ),
 callouts=[(1,15,50),(2,40,50),(3,72,50)],
 specs=[
  (1,"HUD counter row","Score / ball / frame / timer","text row","per-game labels; timer reddens ≤5s (bumper)","—","—"),
  (2,"Canvas playfield","The game","aspect-locked, radius 16, border","aim / play / result; flash + screen-shake","—","per-game background + sprites (ball, puck, kart, target, pins, axe, bumper) as sprite sheets / SVGs"),
  (3,"Game-over screen","Shared result","—","trophy-pop; 60px emoji; big score","—","result emoji per game; Play-again = primary material"),
 ],
)

# ---------------------------------------------------------------- CSS
CSS = r"""
@page { size: Letter; margin: 12mm 12mm 14mm; }
:root{
 --ink:#141a20; --muted:#5b6470; --line:#e4e7ea; --line2:#eef1f4; --panel:#f6f8fa;
 --brand:#15803d; --brandsoft:#e7f6ec; --paper:#fff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);font-size:10px;line-height:1.45;
 -webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
h1,h2,h3{margin:0;line-height:1.15}
code{font-family:"SF Mono",ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:9px;color:#0b3d1f}
.page{page-break-after:always}
.page:last-child{page-break-after:auto}
small{color:inherit;opacity:.7}

/* cover */
.cover{height:246mm;display:flex;flex-direction:column}
.cover .flag{font-size:60px}
.eyebrow{font:700 11px/1 "SF Mono",monospace;letter-spacing:.28em;text-transform:uppercase;color:var(--brand)}
.cover h1{font-size:38px;font-weight:900;letter-spacing:-.02em;margin:12px 0 6px}
.cover .tag{font-size:14px;color:#333;max-width:150mm}
.chip{display:inline-block;background:var(--brandsoft);color:var(--brand);border:1px solid #bfe3c9;border-radius:999px;padding:3px 11px;font-size:10px;font-weight:700;margin:0 6px 6px 0}
.how{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--panel);margin-top:auto}
.how h3{font-size:12px;margin-bottom:6px}
.how ol{margin:0;padding-left:18px} .how li{margin-bottom:3px}
.legend-inline{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:9.5px}
.legend-inline b{color:#0b3d1f}

/* screen page */
.screenpage h2{font-size:15px;font-weight:800;border-bottom:2.5px solid var(--brand);padding-bottom:5px;margin-bottom:3px;display:flex;align-items:baseline;gap:8px}
.screenpage h2 .rt{font-family:"SF Mono",monospace;font-size:10px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 8px;font-weight:700}
.screenpage h2 .tintbadge{font:700 8px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 6px}
.purpose{color:#333;font-size:10px;margin:2px 0 8px}
.views{display:flex;gap:16px;align-items:flex-start;margin-bottom:9px}
.viewcol{display:flex;flex-direction:column;align-items:center;gap:4px}
.viewcap{font:700 8.5px/1 "SF Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}

/* phone frame */
.phone{position:relative;width:224px;border-radius:20px;padding:5px;background:#c7ccd2;box-shadow:0 2px 8px rgba(0,0,0,.14)}
.phone .screenwrap{border-radius:15px;overflow:hidden}
.co{position:absolute;width:15px;height:15px;border-radius:999px;background:#e0362c;color:#fff;font:800 9px/15px "Segoe UI",sans-serif;text-align:center;
 box-shadow:0 0 0 1.5px #fff,0 1px 2px rgba(0,0,0,.4);transform:translate(-50%,-50%);z-index:5}

/* spec table */
table{width:100%;border-collapse:collapse;font-size:9px}
th,td{text-align:left;padding:3.5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel);font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:.03em;color:#334}
td.cn{text-align:center;font-weight:800;color:#e0362c;width:16px}
td b{color:#0b3d1f}
tr{break-inside:avoid}
.artc{color:#0b3d1f}

/* ============ UNSTYLED MOCK KIT (reproduces src/index.css unstyled skin) ============ */
.mock{
 --f50:#f5f5f5;--f100:#e8e8e8;--f200:#cfcfcf;--f300:#ababab;--f400:#b0b0b0;--f500:#6f6f6f;
 --f600:#5b5b5b;--f700:#4f4f4f;--f800:#464646;--f900:#3a3a3a;--f950:#2f2f2f;--accent:#22c55e;
 background:var(--f950);color:var(--f50);font-family:system-ui,"Segoe UI",sans-serif;
 width:224px;min-height:432px;font-size:9px;line-height:1.3;padding:0 0 8px;
}
.mock.light{
 --f50:#1a1a1a;--f100:#2c2c2c;--f200:#444;--f300:#5e5e5e;--f400:#585858;--f500:#8a8a8a;
 --f600:#a3a3a3;--f700:#c2c2c2;--f800:#cccccc;--f900:#fbfbfb;--f950:#eaeaea;--accent:#1f9d55;
}
.mock.tint{ --accent:var(--ta2,#22c55e); }
.mock *{box-sizing:border-box}
.mock b{font-weight:800}
.mock small{font-size:7.5px;opacity:.75}

.m-top,.m-topflush{display:flex;align-items:center;gap:5px;padding:8px 9px;border-bottom:1px solid color-mix(in srgb,var(--f800),transparent 40%);
 background:color-mix(in srgb,var(--f900),transparent 6%)}
.m-topflush{border-bottom:none;background:none;padding-bottom:2px}
.m-back{font-size:16px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;background:var(--f800);border:1px solid var(--f700);border-radius:7px}
.m-title{font-weight:800;font-size:11px}
.m-sp{flex:1}
.m-pill{width:16px;height:16px;border-radius:999px;border:1px solid color-mix(in srgb,var(--f800),transparent 30%);
 background:color-mix(in srgb,var(--f950),transparent 20%);display:flex;align-items:center;justify-content:center;font-size:8px}
.m-mini{font-size:11px} .m-mini.txt{font-size:9px;color:var(--f300);font-weight:700}

.m-hero{text-align:center;font-size:30px;padding:6px 0 2px}
.m-hero2{text-align:center;font-size:30px;padding:10px 0 2px}
.m-ct{text-align:center;font-weight:800;font-size:11px;padding:0 10px 6px}

.m-locbar,.m-resume,.m-card,.m-crow,.m-lrow,.m-notecard,.m-item,.m-lb{margin:6px 9px}
.m-locbar{display:flex;justify-content:space-between;align-items:center;background:var(--f900);border:1px solid var(--f800);border-radius:11px;padding:7px 10px}
.m-locbar.sm{padding:5px 9px}
.m-locbar b{font-size:7px;letter-spacing:.05em;color:var(--f400)}
.m-chg{color:var(--f400);font-weight:700}
.m-resume{background:var(--f900);border:1px solid color-mix(in srgb,var(--f500),transparent 60%);border-radius:11px;padding:8px 10px}
.m-eyebrow{font-size:7px;letter-spacing:.08em;color:var(--f400);font-weight:700}
.m-row2{display:flex;justify-content:space-between;align-items:center;margin-top:3px}
.m-tags{display:flex;gap:3px}
.m-tag{font-family:"SF Mono",monospace;letter-spacing:.12em;font-weight:800;font-size:10px;color:#f0fdf4;background:var(--ga,#166534);border-radius:6px;padding:2px 6px}
.m-tag.sel{outline:2px solid var(--f400)} .m-tag.dim{opacity:.55}

.m-tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 9px}
.m-tile{background:color-mix(in srgb,var(--f900),var(--ta) 16%);border:1px solid color-mix(in srgb,var(--f700),var(--ta) 30%);
 border-radius:16px;padding:9px;text-align:center;font-weight:800;font-size:9px}
.m-puck{width:34px;height:34px;border-radius:999px;background:var(--pa);margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-size:17px}

.m-menu{display:flex;flex-direction:column;gap:5px;margin:8px 9px 0}
.m-ghost{background:var(--f900);border:1px solid color-mix(in srgb,var(--f700),transparent 30%);border-radius:11px;padding:8px 10px;text-align:center;font-weight:700;font-size:9.5px}
.m-ghost.sm{padding:6px;flex:1}
.m-primary{background:color-mix(in srgb,var(--f700),var(--accent) 18%);color:var(--f50);border-radius:11px;padding:9px 10px;text-align:center;font-weight:800;margin:8px 9px 0;font-size:10px}
.m-primary.sm{padding:6px;flex:1;margin:0}

.m-gps{margin:8px 9px 2px;background:var(--f900);border:1px solid var(--f700);border-radius:10px;padding:7px;text-align:center;font-weight:700}
.m-note{margin:0 9px;color:#d97706;font-size:8px}
.m-lrow{display:flex;align-items:center;gap:7px;background:var(--f900);border:1px solid var(--f800);border-radius:12px;padding:7px 9px}
.m-lrow.m-sel{border-color:color-mix(in srgb,var(--f500),transparent 40%);background:color-mix(in srgb,var(--f900),white 3%)}
.m-lico,.m-badge{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;
 background:color-mix(in srgb,var(--a),transparent 78%);border:1px solid color-mix(in srgb,var(--a),transparent 55%)}
.m-lrow span:nth-child(2),.m-crow span:nth-child(2){flex:1}
.m-cur{color:var(--f400);font-weight:700;font-size:8px}
.m-chev{color:var(--f400);font-size:14px}
.m-foot{color:var(--f400);font-size:7.5px;text-align:center;margin:8px 12px 0}

.m-crow{display:flex;align-items:center;gap:8px;background:var(--f900);border:1px solid var(--f800);border-radius:12px;padding:7px 9px}

.m-lbl{margin:8px 9px 3px;font-weight:700;color:var(--f200);font-size:9px}
.m-count{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:0 9px}
.m-count span{background:var(--f900);border:1px solid var(--f800);border-radius:9px;padding:7px 0;text-align:center;font-weight:800}
.m-count span.on{background:var(--f700);color:var(--f50);border-color:var(--f600)}
.m-tagin{display:flex;align-items:center;gap:8px;margin:5px 9px}
.m-idx{font-family:"SF Mono",monospace;color:var(--f400);width:10px;text-align:right}
.m-inp{flex:1;background:var(--f900);border:1px solid var(--f700);border-radius:9px;padding:6px;text-align:center;font-family:"SF Mono",monospace;letter-spacing:.2em;font-weight:800}
.m-inp.err{border-color:#ef4444}
.m-errln{color:#ef4444;font-size:8px;margin:1px 9px 0 27px}

.m-mapframe{margin:8px 9px;border:1px solid var(--f800);background:var(--f900);border-radius:14px;height:230px;display:flex;align-items:center;justify-content:center}
.m-mapfallback{width:110px;height:110px;border-radius:14px;background:color-mix(in srgb,var(--a),transparent 78%);border:1px solid color-mix(in srgb,var(--a),transparent 45%);display:flex;align-items:center;justify-content:center;font-size:46px}
.m-tapbegin{text-align:center;padding:6px} .m-tapbegin b{font-size:12px;letter-spacing:.03em}

.m-holehdr{text-align:center;padding:6px 0 2px}
.m-holename{font-size:15px;font-weight:900}
.m-parmed{width:38px;height:38px;border-radius:999px;background:var(--f900);border:1px solid var(--f800);margin:2px auto 6px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:var(--f100)}
.m-prow{display:flex;align-items:center;gap:8px;background:var(--f900);border:1px solid var(--f800);border-radius:16px;padding:8px 10px;margin:5px 9px}
.m-prow .m-tag{flex:0 0 auto}
.m-key{width:30px;height:30px;border-radius:9px;background:var(--f800);border:1px solid var(--f700);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800}
.m-well{flex:1;background:var(--f950);border:1px solid var(--f800);border-radius:10px;text-align:center;font-size:19px;font-weight:900;padding:3px}
.m-nav{display:flex;gap:6px;margin:8px 9px 0}

.m-winner{display:flex;align-items:center;gap:8px;background:var(--f900);border:1px solid color-mix(in srgb,var(--f500),transparent 55%);border-radius:16px;padding:9px 10px;margin:8px 9px}
.m-trophy{font-size:26px}
.m-wname{font-family:"SF Mono",monospace;letter-spacing:.1em;font-size:15px;font-weight:900;color:#157a3c}
.mock:not(.light) .m-wname{color:#85e0a5}
.m-wscore{margin-left:auto;font-weight:900;font-size:14px}
.m-stand{display:flex;align-items:center;gap:8px;background:var(--f900);border:1px solid var(--f800);border-radius:12px;padding:6px 10px;margin:0 9px}
.m-rank{font-family:"SF Mono",monospace;font-weight:900;color:var(--f400)}
.m-sname{flex:1;font-family:"SF Mono",monospace;font-weight:800;color:#3f5c7a}
.mock:not(.light) .m-sname{color:#b1c3d8}
.m-grid{display:flex;gap:2px;margin:8px 9px;background:var(--f900);border:1px solid var(--f800);border-radius:10px;padding:6px}
.m-gh{font-size:8px;font-weight:800;flex:0 0 34px;align-self:center}
.m-gc{flex:1;text-align:center;font-weight:700;color:var(--f100)}
.m-gc.u{color:#0a7a40} .mock:not(.light) .m-gc.u{color:#34d399}
.m-gc.o{color:#a34a08} .mock:not(.light) .m-gc.o{color:#fbbf24}
.m-sync{text-align:center;font-size:8px;color:var(--f400);margin:6px 9px 0}

.m-eyebrow2{font-size:8px;letter-spacing:.08em;color:var(--f400);font-weight:800;margin:9px 10px 3px}
.m-rule{display:flex;gap:6px;margin:3px 10px}
.m-num{font-family:"SF Mono",monospace;color:var(--f400)}
.m-notecard{background:color-mix(in srgb,var(--f900),var(--a) 8%);border:1px solid color-mix(in srgb,var(--f700),transparent 30%);border-radius:12px;padding:8px 10px}
.m-nch b{color:#a34a08} .mock:not(.light) .m-nch b{color:#fdba74}
.m-nb{margin-top:3px;color:var(--f100)}

.m-card{background:var(--f900);border:1px solid var(--f800);border-radius:14px;padding:9px 10px}
.m-cardh{font-weight:800;margin-bottom:4px}
.m-step{display:flex;align-items:center;gap:6px;margin:3px 0}
.m-badge2{width:15px;height:15px;border-radius:999px;background:var(--f700);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;flex:none}
.m-warnbox{margin:6px 9px;background:color-mix(in srgb,var(--f950),transparent 20%);border:1px solid var(--f800);border-radius:8px;padding:6px 9px;font-size:8px;color:var(--f300)}

.m-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 9px}
.m-tabs span{border:1px solid var(--f700);border-radius:8px;padding:5px 0;text-align:center;font-weight:700;color:var(--f200)}
.m-tabs span.on{background:var(--f700);color:var(--f50)}
.m-lb{display:flex;align-items:center;gap:6px;background:var(--f900);border:1px solid var(--f800);border-radius:12px;padding:6px 9px}
.m-lb.m-mine{border-color:var(--f400);background:color-mix(in srgb,var(--f500),transparent 82%)}
.m-lbtag{font-family:"SF Mono",monospace;font-weight:800;font-size:12px;color:#3f5c7a}
.mock:not(.light) .m-lbtag{color:#b1c3d8}
.m-lbc{flex:1;font-size:8px;color:var(--f300)}
.m-you{font-size:7px;font-weight:800;background:var(--f700);border-radius:999px;padding:1px 5px}

.m-playas{margin:8px 9px;display:flex;align-items:center;gap:5px}
.m-item{display:flex;align-items:center;gap:6px;background:var(--f950);border:1px solid var(--f800);border-radius:12px;padding:7px 9px}
.m-item.found{background:var(--f900);border-color:color-mix(in srgb,var(--f500),transparent 40%)}
.m-item span:first-child{flex:1}
.m-hint{font-size:7.5px;color:var(--f400);font-weight:700}
.m-check{color:var(--f400);font-weight:800}
.m-badgeN{font-size:7.5px;background:color-mix(in srgb,var(--f500),transparent 80%);border-radius:999px;padding:1px 5px;color:var(--f300)}
.m-snap{flex:0 0 auto;background:var(--f700);border-radius:8px;padding:5px 7px;font-size:8px;font-weight:700}
.m-banner{margin:5px 9px 0;border-radius:9px;padding:5px 9px;font-size:8px}
.m-banner.ok{background:color-mix(in srgb,var(--f500),transparent 84%);color:var(--f100)}
.m-banner.warn{background:#fef3c7;color:#92400e} .mock:not(.light) .m-banner.warn{background:color-mix(in srgb,#f59e0b,transparent 82%);color:#fcd34d}

.m-hudrow{display:flex;justify-content:space-between;margin:7px 10px 4px;font-weight:700;color:var(--f200)}
.m-hintline{text-align:center;font-size:8px;color:var(--f300);margin:5px 9px 0}
.m-canvas{position:relative;margin:0 9px;height:236px;border:1px solid var(--f800);border-radius:14px;overflow:hidden;
 background:radial-gradient(120% 80% at 50% 0%,#0d3a22,#06120c)}
.mock.light .m-canvas{background:radial-gradient(120% 80% at 50% 0%,#bfe6cd,#7cbd97)}
.m-canvas.game{background:radial-gradient(120% 80% at 50% 0%,#12233f,#050b16)}
.mock.light .m-canvas.game{background:radial-gradient(120% 80% at 50% 0%,#cfe0f5,#8faed6)}
.m-cv-green{position:absolute;inset:22% 20% 10%;border-radius:40% 40% 12% 12%;background:#1a8f4a;box-shadow:inset 0 0 0 6px #2b7a43}
.m-cv-ball{position:absolute;left:48%;bottom:18%;width:10px;height:10px;border-radius:999px;background:#f8fafc}
.m-cv-ball2{position:absolute;left:47%;bottom:14%;width:12px;height:12px;border-radius:999px;background:#a855f7}
.m-cv-aim{position:absolute;left:52%;bottom:22%;width:2px;height:44px;background:linear-gradient(#4ade80,#fbbf24,#ef4444);transform:rotate(24deg);transform-origin:bottom}
.m-cv-cup{position:absolute;left:47%;top:26%;font-size:16px}
.m-cv-pow{position:absolute;left:8px;bottom:8px;font:800 8px/1 "SF Mono",monospace;color:#e6faed;background:rgba(0,0,0,.35);padding:2px 4px;border-radius:4px}
.m-cv-lane{position:absolute;inset:8% 30% 0;background:linear-gradient(#caa,transparent);opacity:.25}
.m-cv-plus{position:absolute;left:50%;top:30%;transform:translateX(-50%);font:900 15px/1 sans-serif;color:#34d399}
.m-gameover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(0,0,0,.55)}
.mock.light .m-gameover{background:rgba(255,255,255,.55)}
.m-goemoji{font-size:40px} .m-goscore{font-size:26px;font-weight:900}

.m-funtiles{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:8px 9px}
.m-funtile{display:flex;align-items:center;gap:7px;background:color-mix(in srgb,var(--f900),var(--a) 12%);
 border:1px solid color-mix(in srgb,var(--f700),var(--a) 26%);border-radius:12px;padding:7px;font-weight:800;font-size:8.5px}
.m-funico{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;
 background:color-mix(in srgb,var(--a),transparent 80%);flex:none}
"""

# ---------------------------------------------------------------- emit
def render_phone(sc, mode):
    cls = "mock" + (" light" if mode=="light" else "") + (" tint" if sc.get("tint") else "")
    tintvar = ""
    if sc.get("tint"):
        tintvar = ' style="--ta2:#ea580c"' if sc["id"] in ("map","play") else ""
    return f'<div class="{cls}"{tintvar}>{sc["body"]}</div>'

def render_screen(sc, idx):
    tint = '<span class="tintbadge">course-tinted</span>' if sc.get("tint") else ''
    # dark phone with callouts
    cos = "".join(f'<div class="co" style="top:{t}%;left:{l}%">{n}</div>' for n,t,l in sc["callouts"])
    dark = f'<div class="phone"><div class="screenwrap">{render_phone(sc,"dark")}</div>{cos}</div>'
    light = f'<div class="phone"><div class="screenwrap">{render_phone(sc,"light")}</div></div>'
    rows = "".join(
        f'<tr><td class="cn">{r[0]}</td><td><b>{r[1]}</b></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td class="artc">{r[6]}</td></tr>'
        for r in sc["specs"])
    return f"""<div class="page screenpage">
  <h2><span>{idx}. {sc['name']}</span><span class="rt">{sc['route']}</span>{tint}</h2>
  <p class="purpose">{sc['purpose']}</p>
  <div class="views">
    <div class="viewcol"><div class="phone-wrap">{dark}</div><div class="viewcap">Dark · numbered</div></div>
    <div class="viewcol"><div class="phone-wrap">{light}</div><div class="viewcap">Light</div></div>
  </div>
  <table>
    <tr><th>#</th><th>Element</th><th>Role &amp; where</th><th>Size / shape</th><th>States</th><th>Color hooks</th><th>Art needed</th></tr>
    {rows}
  </table>
</div>"""

cover = """<div class="page cover">
  <div class="flag">⛳️</div>
  <div class="eyebrow">Mini Golf Scorecard PWA</div>
  <h1>Screen &amp; Element Style Guide</h1>
  <p class="tag">Every screen shown in the app's default (<b>unstyled</b>) look — light and dark — with each interface element numbered and spec'd. Walk it to confirm every button and interface is covered before you theme.</p>
  <div style="margin-top:16px">
    <span class="chip">14 screens</span><span class="chip">Light + Dark</span><span class="chip">Numbered callouts</span><span class="chip">Per-element specs</span>
  </div>
  <div class="legend-inline">
    <span><b>Red circles</b> = element callouts, keyed to the spec table on the same page.</span>
    <span><b>course-tinted</b> badge = the screen washes toward the course color (play/summary/map/rules).</span>
  </div>
  <div class="how">
    <h3>How to read each page</h3>
    <ol>
      <li>The two phones are the <b>same screen</b> in the unstyled skin — dark (with numbered callouts) and light. Art must clear contrast on both grounds.</li>
      <li>The <b>spec table</b> lists every element: its role, current size/shape, states, the <b>color hooks</b> it keys to, and the <b>art needed</b>.</li>
      <li>Sizes, radii and the flat unstyled look are the current default — treat them as “e.g.” The <b>fixed</b> parts are the element slots, the color hooks, and the constraints (tap-target ≥44px, safe areas, contrast ≥4.5:1).</li>
      <li>Emoji are placeholders for designed icons. Full token palette, motion catalogue, the 14 skins, and the icon-slot set are in the companion <code>docs/art-spec.md</code>; validate live at <code>/style</code>.</li>
    </ol>
  </div>
</div>"""

pages = "".join(render_screen(sc, i+1) for i,sc in enumerate(SCREENS))
html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screen &amp; Element Style Guide</title><style>{CSS}</style></head>
<body>{cover}{pages}</body></html>"""

open(OUT,"w").write(html)
print("wrote", OUT, "screens:", len(SCREENS))
