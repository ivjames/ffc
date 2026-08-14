# -*- coding: utf-8 -*-
"""public/docs/style-guide.html — neutral per-screen WIREFRAMES (element
inventory + schematic layout, no colors/emoji/materials) with numbered badges
anchored ON each element, mapping to a spec table incl. current dimensions. The
current app art is NOT authoritative.

Covers the post-FEC-restructure app: a venue dashboard (Home) launching into
sections — Mini Golf, Arcade, Food & Drink, Me — reached through a global
navigation drawer. Routes are intentionally not printed on the pages.

Output lands in public/docs/ so the built app serves it: Vite copies public/* to
the site root, so these are reachable at /docs/style-guide.html and
/docs/screens.html (and are linked from the in-app 🎨 style picker menu). The
companion PDFs (style-guide.pdf, screens.pdf) are printed from these HTML files
and live alongside them."""

import re
OUT = "/home/user/ffc/public/docs/style-guide.html"
SCREENS = []
def screen(**kw): SCREENS.append(kw)

# ---- wireframe kit; each helper takes an optional callout number `n`,
#      rendered as a badge anchored to that element (so markers can't drift) ----
def cn(n): return f'<span class="cn-badge">{n}</span>' if n is not None else ''
def box(label, cls="", tag="", n=None):
    t = f'<span class="wf-t">{tag}</span>' if tag else ''
    return f'<div class="wf-box {cls}">{cn(n)}{t}<span>{label}</span></div>'
def btn(label, kind="btn", n=None):
    extra = "" if kind=="btn" else " "+kind
    return f'<div class="wf-btn{extra}">{cn(n)}<span>{label}</span></div>'
def img(label, n=None, fill=False):
    return f'<div class="wf-img{" fill" if fill else ""}">{cn(n)}<span>{label}</span></div>'
def icon(label="", n=None):
    return f'<div class="wf-icon">{cn(n)}{label}</div>'
def txt(label, cls="", n=None):   return f'<div class="wf-txt {cls}">{cn(n)}{label}</div>'
def row(*items, cls="", n=None):  return f'<div class="wf-row {cls}">'+cn(n)+"".join(items)+'</div>'
def repeat(label):        return f'<div class="wf-box wide repeat"><span>{label}</span></div>'
def group(inner, n, cls=""):  # a labelled cluster carrying one badge
    return f'<div class="wf-group {cls}">{cn(n)}{inner}</div>'

def topbar(title, back=True, right=""):
    left = icon("‹") if back else '<span class="wf-sp"></span>'
    return f'<div class="wf-top">{left}<span class="wf-ttl">{title}</span><span class="wf-sp"></span>{right}</div>'

# The one control that lives on every screen's top-right now: the hamburger menu
# button that opens the global navigation drawer. (The light/dark + mute
# switches that used to sit here moved into the drawer's Settings block.)
MENU = lambda n=None: group(icon("≡"), n)

# ============================================================ 1. HOME
screen(id="home", name="Home (venue dashboard)", route="/",
 purpose="The FEC venue dashboard — what's happening at this venue plus a launcher into every section. No longer a course picker; mini golf is one tile among many.",
 body="".join([
   f'<div class="wf-top nob"><span class="wf-sp"></span>{MENU(1)}</div>',
   f'<div class="wf-hero">{icon("hero", n=2)}</div>',
   txt("venue name · “What do you want to do?” · open/closed line","center",n=3),
   box("Announcement banner — venue specials (hidden when none)","wide small cond",n=4),
   box("Adoption nudge — install / sign-in (dismissible, self-gating)","wide small cond",n=5),
   box("Resume-round card — course name · player tags (only mid-round)","wide tall cond","card",n=6),
   box("Active-orders card — a live food order (self-gating)","wide small cond",n=7),
   row(box("section tile","tile",n=8),box("section tile","tile"),box("section tile","tile"),box("section tile","tile"),cls="ftiles"),
   box("Food & Drink card — menu / order deep links (non-POS venues)","wide cond",n=9),
   btn("👤 Sign in / register — or your name when signed in","ghost",n=10),
 ]),
 specs=[
  (1,"Menu button","Top-right of every screen — opens the nav drawer","40×40 hamburger","opens the global drawer (its own page here)","—","the menu glyph"),
  (2,"Hero mark","Brand identity, top of Home","glyph ~40px","wiggle on arrival","—","the venue/brand hero mark"),
  (3,"Venue heading","Venue name + prompt + open-status line","centered text block","venue name from the active location; live open/closed","—","—"),
  (4,"Announcement banner","Venue specials / updates from Master Control","full-width, radius 16","renders nothing when empty; cached offline","—","banner surface"),
  (5,"Adoption nudge","Install / sign-in prompt","full-width, radius 16","dismissible with escalating back-off; self-gates once installed or signed in","—","nudge surface + a leading icon"),
  (6,"Resume-round card","CTA → resume the in-progress round","full-width, radius 16","only when a round is live; standing glow","--glow = course accent","card surface + the standing-glow treatment"),
  (7,"Active-orders card","Link back to an in-kitchen order this device placed","full-width, radius 16","self-gating; usually renders nothing","—","card surface"),
  (8,"Section tiles","Launcher grid → Mini Golf / Arcade / Photo Booth / Food & Drink","2-col grid, radius 16; 40×40 accent puck + glyph","tappable; pop-in stagger; Mini Golf shown only when the venue has courses, Food only for POS venues","--tile-accent / --puck-accent per section","tile surface + a section icon per tile"),
  (9,"Food & Drink card","Deep links to the venue's menu / ordering (non-POS venues)","full-width, radius 16","two link buttons; offline = disabled with a note; hidden when the venue has no links","--accent (link buttons)","card surface + a food glyph"),
  (10,"Account button","Ghost row → the Me hub","full-width ghost, radius 16","shows the signed-in name/tag/email, or “Sign in / register”","—","ghost surface + a person glyph"),
 ]),

# ============================================================ 2. NAV DRAWER
screen(id="nav", name="Navigation drawer (global)", route="(overlay)",
 purpose="The app's one persistent way between sections. Opened by the menu button on every screen; slides in from the right over the whole route tree.",
 body="".join([
   f'<div class="wf-top nob"><span class="wf-sp"></span>{group(icon("✕"),1)}</div>',
   txt("“You’re at” · venue name","eyebrow",n=2),
   box("Home","wide sel",n=3), box("Mini Golf","wide"), box("Arcade","wide"), box("Food & Drink (POS venues)","wide"), box("Me","wide"),
   txt("— divider —","center"),
   box("Photo Booth","wide small",n=4), box("Rewards card (loyalty venues)","wide small"), box("Change location","wide small"), box("Install app (when not installed)","wide small"),
   txt("— divider —","center"),
   row(box("Sound","grow",n=5), box("toggle","trail"), cls="lrow"),
   row(box("Dark mode","grow"), box("toggle","trail"), cls="lrow"),
   txt("Privacy","center",n=6),
 ]),
 specs=[
  (1,"Panel + close","Right-anchored panel over a scrim","82% width, max ~20rem; 36×36 close key","opens from the menu button; closes on backdrop tap / Escape / route change","surface + border","panel surface"),
  (2,"Venue header","“You’re at” + venue name","text block","reflects the active location","—","—"),
  (3,"Primary section rows","Home / Mini Golf / Arcade / Food / Me","full-width rows, radius 16, ~48 tall","active section is accent-filled + “Here”; Food only for POS venues","--accent (active row)","row surface + a section icon each"),
  (4,"Secondary rows","Photo Booth / Rewards / Change location / Install","full-width rows, radius 12","Rewards gated on loyalty; Install hidden once installed","—","row surface + a leading icon each"),
  (5,"Settings toggles","Sound + Dark mode","two rows with trailing switches","the light/dark + mute controls, moved here from the header","—","the two switch treatments"),
  (6,"Privacy link","Footer link → the privacy disclosure","text link","—","—","—"),
 ]),

# ============================================================ 3. LOCATIONS
screen(id="loc", name="Location Picker", route="/locations",
 purpose="Choose the venue (manual or GPS); scopes which courses and content show.",
 body="".join([
   topbar("Choose a location", right=MENU()),
   btn("Use my location (GPS)","wbtn",n=1),
   txt("status message (detecting / error)","muted",n=2),
   row(box("marker","chip",n=3), box("venue name · course count · open-status line","grow",n=4), box("Current / ›","trail",n=5), cls="lrow sel"),
   box("weekly-hours card — collapsible ▸","wide small",n=6),
   row(box("marker","chip"), box("venue name · course count · open-status line","grow"), box("›","trail"), cls="lrow"),
   box("weekly-hours card — collapsible ▸","wide small"),
   txt("footer note — placeholder sites","muted"),
 ]),
 specs=[
  (1,"“Use my location”","GPS-detect button (only if geolocation is available)","full-width, radius 12, ~44 tall","disabled + “Locating…” while detecting","—","a GPS/location icon (🧭 placeholder) + button surface"),
  (2,"Status message","Detect feedback","text","appears on progress / error (amber)","(error emphasis)","—"),
  (3,"Location row","One per venue → selects it","full-width row, radius 16; marker chip ~48×48","selected vs unselected","per-location accent tints the marker chip","a location marker + row surface"),
  (4,"Open-status line","Live open/closed under the venue name","small text","open / closed / opens-at, from the venue hours+tz","—","—"),
  (5,"Trailing marker","Row right edge","“Current” label when selected, else a › chevron","“Current” (selected) or forward chevron","per-location accent","a chevron icon"),
  (6,"Weekly-hours card","Collapsible full-week hours under each venue","full-width, radius 12","a <details> disclosure, collapsed by default","—","the disclosure surface"),
 ]),

# ============================================================ 4. GOLF HUB
screen(id="golf", name="Mini Golf hub", route="/golf",
 purpose="The mini-golf section home — pick a course, resume, and reach the golf-only features (join a game, leaderboard, hunt, rules).",
 body="".join([
   topbar("Mini Golf", right=MENU()),
   txt("“N courses · eighteen holes each”","center muted"),
   box("Resume-round card — course name · player tags (only mid-round)","wide tall cond","card",n=1),
   row(box("course tile","tile",n=2),box("course tile","tile"),box("course tile","tile"),box("course tile","tile"),cls="ftiles"),
   btn("📲 Join a friend’s game","ghost",n=3), btn("🏆 Leaderboard","ghost"), btn("🔍 Scavenger hunt","ghost"), btn("📖 Rules","ghost"),
 ]),
 specs=[
  (1,"Resume-round card","CTA → resume the in-progress round","full-width, radius 16","only when a round is live; standing glow","--glow = course accent","card surface + the standing-glow treatment"),
  (2,"Course tiles","Grid → each course's map screen","2-col grid, scales to the location's count (2–4), radius 16; 48px puck + theme glyph","tappable; pop-in stagger; empty state “No courses at this location yet.”","--tile-accent / --puck-accent per course","tile surface + a course marker/crest per course (the puck)"),
  (3,"Section menu","Ghost stack → Join game / Leaderboard / Scavenger hunt / Rules","full-width rows, ~48 tall, radius 16","—","—","ghost surface + a leading icon per row"),
 ]),

# ============================================================ 5. COURSE PICKER
screen(id="pick", name="Course Picker", route="/golf/new",
 purpose="Pick which course at the current location to score.",
 body="".join([
   topbar("Pick a course", right=MENU()),
   box("Location switcher — pin · venue · open-status · Change","wide",n=1),
   row(box("mkr","chip",n=2), box("course row — name · “holes · par”","grow",n=3), box("›","trail",n=4), cls="lrow"),
   row(box("mkr","chip"), box("name · “holes · par”","grow"), box("›","trail"), cls="lrow"),
   row(box("mkr","chip"), box("name · “holes · par”","grow"), box("›","trail"), cls="lrow"),
   box("empty state — “No courses at this location yet.”","wide small",n=5),
 ]),
 specs=[
  (1,"Location switcher","Row → Location Picker (returns here)","full-width, radius 16","tappable; carries a live open-status line + a “Change” affordance","row surface","a pin marker + row surface"),
  (2,"Course marker","Left of each course row","~48×48 rounded square, radius 12","—","tinted from the course accent","the course marker icon (currently the theme emoji)"),
  (3,"Course row","Tap → Player Setup","full-width row, radius 16; subtitle “N holes · par N”","tappable; scales to the location's course count","—","row surface"),
  (4,"Chevron","Row right edge","~20px","—","muted","a forward chevron"),
  (5,"Empty state","When the venue has no courses","text","replaces the list","—","—"),
 ]),

# ============================================================ 6. PLAYER SETUP
screen(id="setup", name="Player Setup", route="/golf/new/setup",
 purpose="Choose player count (1–4), enter arcade tags, optionally a team tag, then start — solo on this phone or a shared game everyone joins.",
 body="".join([
   topbar("Course name", right=MENU()),
   txt("label: Players"),
   row(box("1","seg",n=1),box("2","seg on"),box("3","seg"),box("4","seg"),cls="segs"),
   txt("label: Tags (3 letters/numbers, arcade style)"),
   row(icon("1"), box("tag well","inp",n=2), cls="tagrow"),
   row(icon("2"), box("tag well — error","inp err",n=3), cls="tagrow"),
   txt("inline error message","muted"),
   row(icon("3"), box("tag well","inp"), cls="tagrow"),
   row(icon("4"), box("tag well","inp"), cls="tagrow"),
   txt("label: Team tag (optional — play as a team)"),
   row(icon("🏅"), box("team tag well","inp",n=4), cls="tagrow"),
   btn("Start round","primary",n=5),
   btn("📲 Play together (everyone on their own phone)","ghost",n=6),
   txt("caption — hosting needs a (free) account","muted"),
 ]), scales=True,
 specs=[
  (1,"Player-count selector","1–4 buttons","4-col grid, radius 12, ~44px tall","selected = accent key, unselected = neutral (default 2)","--accent (selected key)","the selected/unselected key states"),
  (2,"Tag input","Arcade text field — one row per player (1–4)","recessed well, ~128px × ~44 tall, radius 12; centered 24px uppercase","empty (placeholder “ABC”) / filled / invalid; row count = selected players","recessed-well surface; arcade type face","the carved-well surface; the arcade type face"),
  (3,"Invalid-tag state","On a bad tag","—","red border + inline error once 3 chars are entered","(error emphasis)","error treatment"),
  (4,"Team tag","Optional single team tag (🏅)","one recessed well, radius 12","empty is valid; a partial/blocked value errors; feeds the leaderboard's Teams tab","--accent","the well surface + a team glyph"),
  (5,"Start round","Primary CTA → play on this phone","full-width, ~52 tall, radius 16","disabled until roster valid; “Starting…” while starting","--accent","the primary button surface"),
  (6,"Play together","Host a shared game (friends join from their phones)","full-width ghost","needs a free account (caption when signed-out); uses player 1's tag as host","—","ghost surface + a share glyph"),
 ]),

# ============================================================ 7. COURSE MAP (fills screen)
screen(id="map", name="Course Map", route="/golf/courses/:id/map", fill=True,
 purpose="Opening course screen — the map fills the screen below the bar; tapping anywhere starts the round.",
 body="".join([
   topbar("Course name", right=MENU()),
   img("Full-bleed tap target → setup (a tap anywhere begins the round). Renders the course's map image when present, else a themed-emoji placeholder on an accent-tinted fill. Bottom scrim + pulsing “TAP ANYWHERE TO BEGIN” + “N holes · course”.", n=1, fill=True),
 ]),
 specs=[
  (1,"Course map","Full-bleed panel; the whole panel starts the round","fills the screen barring the top bar","tappable; renders course.mapAsset edge-to-edge, or the themed-emoji placeholder when unset; a pulsing “tap to begin” prompt sits over a bottom scrim","the screen washes toward the course color","a top-down hole map per course; keep center/edges calm so the overlay prompt stays legible, in both light and dark"),
 ]),

# ============================================================ 8. SCORECARD
screen(id="play", name="Scorecard (play screen)", route="/golf/play/:clientId",
 purpose="The core loop — a horizontally-scrolling scorecard; score every player on the current hole, each edit persists instantly. Swipe to change holes.",
 body="".join([
   (lambda cluster: f'<div class="wf-top">{icon("‹")}<span class="wf-ttl">Course</span><span class="wf-sp"></span>{cluster}{MENU()}</div>')(
       group('<span class="wf-mini">Live</span>'+icon()+icon(), 1)),
   row(txt("HOLE n · hole name","inline"), box("par","med",n=2), cls="hud"),
   txt("scorecard grid — pinned tag &amp; ± rails; the hole columns scroll ↔ (current tinted)","muted",n=3),
   row(box("","tagb ghost"), box("","key ghost"), box("holes  2  3  4  5  6  →","well hgrid"), box("","key ghost"), cls="prow"),
   row(box("tag","tagb",n=4), box("−","key",n=6), box("2  3  4  ·  →","well",n=5), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("2  3  4  ·  →","well"), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("2  3  4  ·  →","well"), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("2  3  4  ·  →","well"), box("+","key"), cls="prow"),
   btn("Next › / Finish","primary",n=7),
   txt("helper — “Score every player to continue” · stroke-cap footer","muted"),
 ]), scales=True,
 specs=[
  (1,"TopBar cluster","Live pill (shared rounds) · Scavenger hunt · Challenge spinner","glyphs ~18px; live pill; back key 40×40","🔍 → hunt, 🎡 → spinner; the LivePill shows live / reconnecting / offline on shared games only","—","a hunt icon + a spinner icon + the live-pill states"),
  (2,"Par medallion","Par read-out disc, right of the hole title","48×48 circle","—","par numeral in the course ink (accentInk)","the disc surface"),
  (3,"Hole tablist","Row of hole tabs inside the scroll sheet (replaces the old “Holes” toggle)","one tab per hole; current bold + tinted","current / done / unplayed states; swipe or tap to move","--accent marks the current hole","the three tab states"),
  (4,"Player tag rail","Pinned tag chip per player (left rail)","radius 8 pill; text ~18px","one row per player","--tag-accent","the tag surface (contrast-checked on any accent)"),
  (5,"Score cell","Recessed score read-out per player in the current column","flex cell, ~36 tall","punches on each stroke edit; ghost dot when unscored","--score column tint","the recessed-well surface"),
  (6,"± stepper rails","Pinned add / remove keys either side of the sheet","36×36, radius 8","− disabled at 1, + disabled at the stroke cap","—","the key surface + the + / − marks"),
  (7,"Advance button","Next › (or Finish on the last hole)","full-width, ~52 tall","disabled until the hole/round is complete; go back by swiping","--accent on Finish","the button surface"),
 ]),

# ============================================================ 9. SUMMARY
screen(id="sum", name="Summary (final scorecard)", route="/golf/play/:clientId/summary",
 purpose="Celebrates the winner, shows standings, the (toggled) hole-by-hole grid, any tickets earned, and syncs to the leaderboard.",
 body="".join([
   topbar("Final scorecard", right=MENU()),
   txt("course name · “Par N”","center muted"),
   box("Winner hero — trophy · “Winner / Tied for the win” · winner tag(s) · total / over-under","wide tall","card",n=1),
   box("Standings row — rank · tag · total (one per non-winner)","wide","row",n=2),
   btn("📋 View scorecard — reveals the front/back nine grids","ghost",n=3),
   txt("sync status line","muted",n=4),
   box("Rewards-ticket card — earned tickets + “Link rewards card” (conditional)","wide tall cond","card",n=5),
   btn("📸 Share this round","ghost"),
   btn("🏆 View leaderboard","ghost"),
   btn("Done","primary",n=6),
 ]), scales=True,
 specs=[
  (1,"Winner hero","Celebration card","full-width card, radius 24; trophy + accent spotlight","pop-in + looping glow; a “Tied for the win” variant","--glow accent; winner tag(s) in course ink (accentInk)","a trophy/celebration mark + the hero surface"),
  (2,"Standings row","One per non-winner (up to 3)","full-width, radius 16; rank column","staggered rise-in","mono rank + arcade tag in course ink","the row surface"),
  (3,"View-scorecard toggle","Ghost button revealing two Nine-grids — Front (1–9) & Back (10–18)","full-width ghost; then two tables radius 16","hidden by default; cells signal under / over / at par, “·” for a blank","--score-under / --score-over","the table surface + the score-signal colors"),
  (4,"Sync note","Leaderboard save status (above the rewards card)","text","saved / saving / offline / retry","(failure emphasis)","a confirmation tick"),
  (5,"Rewards card","Tickets earned this round (loyalty venues)","full-width card, radius 16","per-reward rows (+N 🎟️ / Adding… / Claimed ✓); “Link rewards card” when no card; hidden when none","--accent","the card surface + a ticket glyph"),
  (6,"Action buttons","A stacked column — Share this round · View leaderboard · Done","full-width, stacked","Share prepares an image; Done → Home","--accent (Done)","ghost + primary surfaces + a share glyph"),
 ]),

# ============================================================ 10. HUNT
screen(id="hunt", name="Scavenger Hunt", route="/golf/hunt",
 purpose="Snap-a-photo hunt; a vision model verifies each find. Reached from the in-round bar. Gated on an active round.",
 body="".join([
   topbar("Scavenger hunt", right=MENU()),
   txt("intro — “Things to find on &lt;course&gt;. Snap a photo of each.”","muted"),
   box("privacy note — photos are AI-checked & stored · “How photos are handled”","wide small",n=6),
   row(txt("Playing as","inline"), box("tag","tagb sel",n=1), box("tag","tagb dim"), box("tag","tagb dim"), box("tag","tagb dim"), cls="playas"),
   box("load-error banner (only if the list fails to load)","wide small cond"),
   f'<div class="wf-row itemrow"><div class="wf-box item card" style="display:block">{cn(2)}'
   f'<div>item — title · ×N/✓ · 💡hint · Found-by chips · 📤 share</div>'
   f'<div class="wf-box small cond" style="margin:6px 0 0">{cn(4)}<span>in-card result — verified / flagged photo-of-screen / rejected</span></div>'
   f'</div><div class="wf-btn snap">{cn(3)}<span>Snap</span></div></div>',
   row(box("item","item",n=5), btn("Snap","snap"), cls="itemrow"),
   box("gated empty state — “Start a round to play” + Start-round button","wide small cond",n=7),
 ]), scales=True,
 specs=[
  (1,"“Playing as” selector","Player chips — one per player (1–4)","radius 8 pills","selected (ring-2) vs dimmed (opacity 60%)","--tag-accent (house green default here)","tag surface + selected-state treatment"),
  (2,"Item hint / count / check","On each item","small","hint show/hide toggle; ×N count or a found check","—","hint, count, and check icons"),
  (3,"Snap button","Photo capture (opens the camera)","compact button","label cycles Snap / Snap another / Checking / Found (locked)","—","a camera icon + button surface"),
  (4,"In-card result","Verify outcome — rendered inside the item's card, below the title/snap row (not a standalone banner)","full-width of the card, radius 8","verified / flagged (photo-of-screen) / rejected; a separate load-error banner sits above the list","(flag/error emphasis)","the in-card result treatments"),
  (5,"Item card","Per find","full-width, radius 16","found vs not-found; adds Found-by tag chips + per-player 📤 share chips for approved photos","—","the card surface"),
  (6,"Privacy note","AI/photo-storage disclosure + link","small text + link","links to the privacy screen","—","—"),
  (7,"Gated empty state","Shown when no round is active","full-height block","🔍 + “Start a round to play” + a Start-new-round button","—","the empty-state illustration"),
 ]),

# ============================================================ 11. RULES
screen(id="rules", name="Rules", route="/golf/rules",
 purpose="Static, offline general rules + optional per-course notes. Read-only.",
 body="".join([
   topbar("Rules", right=MENU()),
   txt("heading: GENERAL","eyebrow",n=1),
   row(icon("1"), box("rule text","line",n=2), cls="rule"),
   row(icon("2"), box("rule text","line"), cls="rule"),
   row(icon("3"), box("rule text — “Max N strokes per hole”","line"), cls="rule"),
   box("…6 general rules total","wide repeat"),
   txt("heading: COURSE NOTES","eyebrow"),
   box("Course-note card — marker · course name · bulleted notes","wide tall cond","card",n=3),
 ]),
 specs=[
  (1,"Section heading","“General” / “Course notes”","text eyebrow","—","muted","—"),
  (2,"Numbered rule list","General rules — 6 items","list; mono “N.” prefix","the stroke cap is interpolated into rule 3","—","list-number treatment"),
  (3,"Course-note card","One tinted card per course with notes (section hidden when none)","full-width, radius 16","conditional on per-course notes","washes toward the course accent; name + marker + bullets in course ink","the card surface + the course marker"),
 ]),

# ============================================================ 12. LEADERBOARD
screen(id="tv", name="Leaderboard", route="/golf/leaderboard · /tv",
 purpose="Live high-score board (polls every 5s); highlights the just-played round on arrival. Doubles as the phone-friendly /tv board.",
 body="".join([
   topbar("Leaderboard", right=MENU()),
   row(box("Players","seg on",n=1),box("🏅 Teams","seg"),cls="segs two"),
   row(box("Day","seg on",n=2),box("Week","seg"),box("Month","seg"),box("All","seg"),cls="segs"),
   box("announcement banner (hidden when none)","wide small cond",n=6),
   txt("“Your last round” — pinned highlighted rows","eyebrow",n=3),
   row(box("rank","chip"), box("standings row — tag · course","grow",n=5), box("You","trail",n=4), box("total","tot"), cls="lb hl"),
   row(box("rank","chip"), box("tag · course","grow"), box("total","tot"), cls="lb"),
   row(box("rank","chip"), box("tag · course","grow"), box("total","tot"), cls="lb"),
   box("empty / error / loading states","wide small",n=7),
 ]),
 specs=[
  (1,"Board toggle","Players vs 🏅 Teams","2-col, radius 8","team board ranks by avg strokes/player; distinct empty copy","--accent (active)","tab states"),
  (2,"Period tabs","Day / Week / Month / All (Day default)","4-col grid, radius 8","active (filled) vs inactive (outline)","--accent (active)","tab states"),
  (3,"“Your last round”","Pinned block of the just-played rows above the standings","own scroll, capped ~38vh","present only on the player board with a highlight; keeps real rank numbers","a highlight/ring accent","—"),
  (4,"“You” pill + highlight","Marks your rows","pill (rounded-full)","only on your rows; polls every 5s","a highlight/ring accent","the pill + row-highlight treatment"),
  (5,"Standings row","One per score","full-width, radius 16","entrance stagger","neutral ramp","the row surface + the arcade type face"),
  (6,"Announcement banner","Venue message above the board","full-width, radius 16","renders nothing when empty","—","banner surface"),
  (7,"Board states","Empty / API-down error / loading","text / amber banner","team vs player empty copy; amber “needs the backend API” banner; confetti on first populated load","(error emphasis)","—"),
 ]),

# ============================================================ 13. PLAY TOGETHER (join + lobby)
screen(id="together", name="Play together (join + lobby)", route="/join · /games/:gameId/lobby",
 purpose="Shared multi-device games: join by 6-char code from your own phone, or host a lobby others scan into. Everyone marks the same scorecard.",
 body="".join([
   topbar("Join a game · Play together", right=MENU()),
   txt("JOIN — enter the host's code","eyebrow"),
   row(icon("#"), box("join-code field — 6 chars, arcade","inp",n=1), cls="tagrow"),
   row(icon("A"), box("your-tag field — 3 chars","inp",n=2), cls="tagrow"),
   btn("Join game","primary",n=3),
   txt("HOST — the lobby others join","eyebrow"),
   box("Join-code card — big code · QR · “Copy join link”","wide tall","card",n=4),
   row(txt("Players","inline"), box("live","med",n=6), cls="hud"),
   box("player roster — one TagChip per joiner · “(this phone)”","wide",n=5),
   btn("Start playing","primary",n=7),
 ]),
 specs=[
  (1,"Join-code field","6-character game code","arcade field, uppercase","sanitized A–Z0–9; prefilled from a ?code deep link; 404 → “No open game with that code”","—","the arcade field surface"),
  (2,"Your-tag field","The joiner's 3-char tag","arcade field","prefilled from a saved default tag; invalid → red + error","--tag-accent","the field surface"),
  (3,"Join button","Enter the shared round","full-width primary","disabled until code+tag valid; “Joining…”; offline note","--accent","the primary surface"),
  (4,"Join-code card (host)","Big code + QR + copy link","full-width card, radius 16","“Copy join link” → “Link copied ✓”","--accent","the card surface + a QR treatment"),
  (5,"Player roster (host)","One row per joiner","full-width; TagChip per player","live-updating; marks “(this phone)”; “Waiting for friends… up to N more”","--tag-accent","the roster surface"),
  (6,"Live pill (host)","Connection state","pill","live / reconnecting / offline","—","the pill states"),
  (7,"Start playing (host)","Begin the shared round","full-width primary","friends can still join after start","--accent","the primary surface"),
 ]),

# ============================================================ 14. ARCADE HUB
screen(id="arcade", name="Arcade hub", route="/arcade",
 purpose="Grid landing routing to every attraction mini-game plus Fun Facts and Trivia. One flat 2-col grid, ~22 tiles.",
 body="".join([
   topbar("Arcade", right=MENU()),
   txt("intro — “Every game in the house — plus facts and trivia. / Pass the time between attractions.”","center muted"),
   row(
     f'<div class="wf-box ftile">{cn(1)}{icon(n=2)}<span>game tile — icon · title</span><span class="tk">{cn(3)}🎟️</span></div>',
     *[box("game tile — icon · title","ftile") for _ in range(5)], cls="ftiles"),
   repeat("…~22 tiles total (20 games + Fun Facts + Trivia)"),
 ]),
 specs=[
  (1,"Activity tile","One per game → its route (~22 tiles)","2-col grid, radius 12","rise-in stagger; press-shrink feedback","accent-tinted per tile (bg/border/icon)","the tile surface"),
  (2,"Activity icon","Leading mark on each tile","~36×36 chip, radius 8, glyph ~20px","—","tinted to the tile accent","one designed icon per activity"),
  (3,"“Earns tickets” badge","Trailing badge on ticket-awarding games","small 🎟️ badge","shown only when the venue's game-rewards add-on is on and the tile earns","--accent","the badge treatment"),
 ]),

# ============================================================ 15. ARCADE PUTT (fills screen)
screen(id="putt", name="Arcade Putt", route="/arcade/putt", fill=True,
 purpose="Playable canvas mini-golf. A mode picker precedes play; the playfield then fills the screen between the HUD and buttons. Offline.",
 body="".join([
   topbar("Arcade Putt", right=MENU()),
   box("MODE PICKER (entry) — “Choose your game” · 🏁 9-Hole Course · ♾️ Endless","wide tall","before play",n=1),
   row(txt("Hole n / 9","inline"), txt("Par · Strokes","inline r"), cls="hud", n=2),
   img("Canvas playfield — FILLS the screen between HUD and buttons. Drag-to-aim slingshot; aim/power markers, ball, cup+flag, bumpers, greens, hazards, splash.", n=3, fill=True),
   txt("hint line","center muted"),
   row(btn("Next hole → / See scorecard →","primary sm"), btn("Reset hole / End run","ghost sm",n=4), cls="nav"),
 ]),
 specs=[
  (1,"Mode picker","Entry screen before play","full-width buttons + note","“🏁 9-Hole Course” (primary) / “♾️ Endless (procedural)”; endless is fairness-checked","—","the entry surface + two mode glyphs"),
  (2,"Status header","Hole / par / strokes","text row","course (“/ 9”) vs endless (“· Endless”)","—","—"),
  (3,"Canvas playfield","The game (aim by dragging)","fills the screen barring HUD + buttons","aim / rolling / splash / sunk phases","aim-power color ramp","playfield background + all sprites (ball, cup+flag, bumpers, greens, hazards, splash) and the aim/power markers — drawn into the canvas"),
  (4,"Play buttons","Next / See scorecard (primary) · Reset / End run (secondary)","full-width","mode-dependent; a round-complete screen (🏆 + per-hole scorecard + Play again / New run / Change mode) follows the last hole","--accent","primary + ghost surfaces + the round-complete card"),
 ]),

# ============================================================ 16. MINIGAME SHELL (fills screen)
screen(id="game", name="Minigame shell (covers ~20 canvas games)", route="/arcade/*",
 purpose="Shared shell for every canvas game — the playfield fills the screen between the HUD and any footer; a results screen follows game-over.",
 body="".join([
   topbar("Game name", right=MENU()),
   row(txt("count (ball / frame / pitch)","inline"), txt("score / timer","inline r"), cls="hud", n=1),
   img("Canvas playfield — FILLS the screen between HUD and hint. Per-game sprites & interaction.", n=2, fill=True),
   txt("hint line","center muted"),
   box("GAME-OVER results — big emoji · final score · remark · 🎟️ ticket award · Play again","wide tall","after game",n=3),
 ]),
 specs=[
  (1,"HUD counter row","Per-game counters / score / timer","text row","labels vary by game (Bowling adds a 10-frame strip); a timer can signal time pressure","—","—"),
  (2,"Canvas playfield","The game itself","fills the screen barring HUD + hint","aim / play / result; impact + shake feedback","--accent on the results Play-again","per-game background + sprites (ball, puck, kart, target, pins, axe, bumper, gopher, …) as sprite sheets / SVGs; a result mark per game"),
  (3,"Game-over results","Post-game card (a separate screen, not on the canvas)","full-width block","big emoji + score + tiered remark; a ticket award (POS game-rewards); Play again","--accent","the results surface + a ticket glyph"),
 ]),

# ============================================================ 17. WHILE YOU WAIT (facts + trivia)
screen(id="wait", name="While You Wait (Fun Facts & Trivia)", route="/arcade/facts · /arcade/trivia",
 purpose="Two offline, bundled time-fillers: a tappable Fun-Facts card deck, and a 10-question Trivia round that can earn tickets.",
 body="".join([
   topbar("Fun Facts · Trivia", right=MENU()),
   box("FUN FACTS — big tappable card: emoji + fact text","wide xtall","card",n=1),
   btn("Next fact →","primary"),
   txt("TRIVIA","eyebrow"),
   row(txt("Question k of 10","inline"), txt("Score","inline r"), cls="hud",n=2),
   txt("question text","center"),
   btn("choice","ghost",n=3), btn("choice","ghost"), btn("choice","ghost"),
   box("results — 🧠 · score / 10 · remark · 🎟️ ticket award · Play again","wide tall","card",n=4),
 ]),
 specs=[
  (1,"Fun-facts card","Tappable card advancing the shuffled deck","full-width, ~16rem tall","tap the card or “Next fact →” to advance; wraps","—","the card surface"),
  (2,"Trivia progress","“Question k of 10” + running score","text row","10-question round","—","—"),
  (3,"Trivia choices","Answer buttons","full-width stack","after answering: correct = green ✓, wrong pick = red ✗, others dimmed; ding / buzz feedback","--score-under / --score-over","the choice states"),
  (4,"Trivia results","End-of-round card","full-width block","🧠 + score/10 + tiered remark; 5 tickets per correct (POS game-rewards); Play again","--accent","the results surface + a ticket glyph"),
 ]),

# ============================================================ 18. FOOD MENU
screen(id="food", name="Food & Drink menu", route="/food",
 purpose="Native menu browser for POS-integrated venues — browse categories, build a cart, head to checkout. Redirects home when the venue has no ordering add-on.",
 body="".join([
   topbar("Food & Drink", right=MENU()),
   box("Active-orders card — an in-kitchen order (self-gating)","wide small cond",n=1),
   txt("CATEGORY NAME","eyebrow",n=2),
   row(box("item — name · description","grow",n=3), box("price","trail"), cls="lrow"),
   row(box("item — name · description","grow"), box("price","trail"), cls="lrow"),
   txt("…more categories","muted"),
   box("Sticky cart bar — “🛒 View cart · N items · $subtotal”","wide","sticky",n=4),
 ]),
 specs=[
  (1,"Active-orders card","Link back to an in-progress order","full-width, radius 16","self-gating; usually nothing","—","card surface"),
  (2,"Category heading","One per menu category (sorted)","text eyebrow","—","—","—"),
  (3,"Menu item row","Tap → item sheet (mods + qty)","full-width row","disabled + “Sold out today” when unavailable; price on the right","—","row surface"),
  (4,"Sticky cart bar","Bottom bar → checkout","sticky bottom, full-width","shown only when the cart has items; shows count + subtotal","--accent","the bar surface + a cart glyph"),
 ]),

# ============================================================ 19. CHECKOUT
screen(id="checkout", name="Food checkout", route="/food/checkout",
 purpose="Review the cart, adjust quantities, name the order, and pay. POS-gated; empty-cart and price-load states handled.",
 body="".join([
   topbar("Your order", right=MENU()),
   row(box("cart line — name · mods","grow",n=1), box("− n +","trail",n=2), cls="lrow"),
   row(box("cart line — name · mods","grow"), box("− n +","trail"), cls="lrow"),
   txt("label: Name for the order (optional)"),
   box("name field — “Who’s picking it up?”","wide",n=3),
   box("totals — Subtotal · Tax · Total","wide tall","sunk",n=4),
   txt("error — “Card declined…” (conditional)","muted"),
   btn("Pay $total","primary",n=5),
   box("empty-cart state — “Your cart is empty” + Browse the menu","wide small",n=6),
 ]),
 specs=[
  (1,"Cart line","One per cart item","full-width row","shows chosen modifiers under the name","—","row surface"),
  (2,"Quantity stepper","− / qty / + per line","stepper","+ capped at 20; − removes at 0","—","the stepper keys"),
  (3,"Name field","Optional pickup name","full-width input","maxlength 100","—","the field surface"),
  (4,"Totals box","Subtotal / Tax / Total","full-width sunk, radius 16","live from the cart","—","the totals surface"),
  (5,"Pay button","Place the order","full-width primary","“Placing order…”; 402 → “Card declined…”; success → order status","--accent","the primary surface"),
  (6,"Empty / load states","Empty cart · price-load · retry","text + ghost button","empty → Browse the menu; error → Retry","(error emphasis)","—"),
 ]),

# ============================================================ 20. ORDER STATUS
screen(id="order", name="Order status", route="/food/order/:orderId",
 purpose="Live pickup tracker — order number, ETA, a ready-state pickup code, notifications, and a step checklist. Polls every 4s.",
 body="".join([
   topbar("Order status", right=MENU()),
   txt("“Order number” · #NNN · “Estimated ready in …”","center",n=1),
   box("Ready card — “Show this at the counter” · pickup code · “I’ve picked it up” (ready only)","wide tall cond","card",n=2),
   box("Notify-me — 🔔 button / on / blocked (pre-ready)","wide small",n=3),
   row(icon("✓"), box("Order received","line",n=4), cls="rule"),
   row(icon("•"), box("Sent to the kitchen · Being prepared · Ready · Picked up","line"), cls="rule"),
   box("items summary + Total","wide tall","sunk",n=5),
   btn("Order something else","ghost"),
 ]),
 specs=[
  (1,"Order header","Order number + ETA","centered block","ETA “under a minute” / “~N min” when known","—","—"),
  (2,"Ready card","Pickup code (glowing) when ready","full-width card, radius 16","only at status=ready; “I’ve picked it up” → “Confirming…”","--glow accent","the card surface"),
  (3,"Notify-me","Push-permission control (pre-ready)","full-width","default → 🔔 button; granted → on note; denied → blocked note","—","a bell glyph"),
  (4,"Step checklist","5 fixed steps","list of rows","current glows, future dimmed, done = ✅","--accent (current)","step glyphs"),
  (5,"Items summary","Order lines + total","full-width sunk, radius 16","qty × name + line totals; modifiers beneath","—","the summary surface"),
 ]),

# ============================================================ 21. ME HUB
screen(id="me", name="Me hub", route="/me",
 purpose="Personal hub — an identity card into the account, over a stack into achievements, teams, rewards, install, privacy.",
 body="".join([
   topbar("Me", right=MENU()),
   row(box("avatar","chip",n=1), box("name / “Sign in / register” · subline","grow"), box("›","trail"), cls="lrow"),
   btn("🏅 Achievements","ghost",n=2), btn("👥 My teams","ghost"), btn("🎟️ Rewards card","ghost"), btn("⬇️ Install app","ghost"), btn("🔒 Privacy","ghost"),
 ]),
 specs=[
  (1,"Identity card","Row → the Account screen","full-width, radius 16; avatar circle","signed-in: 👤 + name + “View your profile”; signed-out: ✨ + “Sign in / register” + save-your-scores subline","—","the card surface + an avatar treatment"),
  (2,"Section menu","Ghost stack → Achievements / Teams / Rewards / Install / Privacy","full-width rows, ~48 tall","Rewards gated on loyalty; Install hidden once installed","—","ghost surface + a leading icon per row"),
 ]),

# ============================================================ 22. ACCOUNT
screen(id="account", name="Account (sign in / profile)", route="/me/account",
 purpose="Passwordless email sign-in (email → 6-digit code → signed in) with a profile editor. Registration is the same flow.",
 body="".join([
   topbar("Account", right=MENU()),
   box("notice banners — bonus / rounds-claimed (conditional)","wide small",n=1),
   txt("STAGE 1 — EMAIL","eyebrow"),
   txt("intro — “We’ll email you a 6-digit code — no password.”","muted"),
   box("Email field","wide",n=2), box("Name (optional)","wide"), box("Arcade tag (optional)","wide"),
   btn("Email me a code","primary",n=3),
   txt("STAGE 2 — CODE","eyebrow"),
   box("6-digit code field","wide",n=4),
   row(btn("Sign in","primary sm"), btn("Use a different email","ghost sm"), cls="nav"),
   txt("STAGE 3 — SIGNED IN","eyebrow"),
   box("“Signed in as” · email · Name · Arcade tag · Save / My teams / Sign out","wide tall","card",n=5),
 ]),
 specs=[
  (1,"Notice banners","Bonus / rounds-claimed messages","full-width, radius 16","role=status; appear above every stage when set","--accent","banner surface"),
  (2,"Email stage fields","Email + optional name + optional arcade tag","full-width inputs","inline email/tag errors; expired-link amber notice","--tag-accent (tag)","the field surfaces + the arcade type face"),
  (3,"Send-code button","Request the code","full-width primary","“Sending…”; disabled on empty/invalid email or tag error","--accent","the primary surface"),
  (4,"Code stage","6-digit code entry","wide arcade input","“Checking…”; Use-a-different-email / Resend; expires in 10 min","—","the code field"),
  (5,"Signed-in card","Profile editor + actions","full-width card, radius 16","Save (“Saving…” / “Saved.”), My teams, Sign out; a bypass path can skip the code stage","--accent","the card surface"),
 ]),

# ============================================================ 23. TEAMS
screen(id="teams", name="Teams", route="/me/teams",
 purpose="Signed-in persistent teams — list your teams and create new ones; signed-out visitors get an explainer.",
 body="".join([
   topbar("Teams", right=MENU()),
   box("signed-out — explainer + “Sign in / register”","wide small",n=1),
   box("empty — “No teams yet — name one below and invite your regulars.”","wide small"),
   row(box("team name · “N members · yours”","grow",n=2), box("›","trail"), cls="lrow"),
   row(box("team name · “N members”","grow"), box("›","trail"), cls="lrow"),
   txt("label: New team"),
   box("new-team field — “The Putters”","wide",n=3),
   btn("Create team","primary",n=4),
 ]),
 specs=[
  (1,"Signed-out state","Explainer + sign-in CTA","full-width","no auto-redirect; button → Account","—","—"),
  (2,"Team row","One per team → team detail","full-width, radius 16","subline “N members”, “· yours” for owner; › chevron","—","row surface"),
  (3,"New-team field","Name a new team","full-width input","maxlength 40; empty state above the field when no teams","—","the field surface"),
  (4,"Create button","Create the team","full-width primary","“Creating…”; disabled while creating / name empty; success → team detail","--accent","the primary surface"),
 ]),

# ============================================================ 24. ACHIEVEMENTS
screen(id="achv", name="Achievements", route="/me/achievements",
 purpose="Badges wall of three round achievements, earned/locked from locally-stored completed rounds.",
 body="".join([
   topbar("Achievements", right=MENU()),
   txt("“k of 3 unlocked · earn tickets at the counter”","center muted",n=1),
   row(box("emoji","chip",n=2), box("badge label · “Earned” · how-to","grow"), cls="lrow"),
   row(box("emoji","chip"), box("badge label · how-to","grow"), cls="lrow"),
   row(box("emoji","chip"), box("badge label · how-to","grow"), cls="lrow"),
   txt("footer — tracked on this device; sign in to keep them","muted"),
 ]),
 specs=[
  (1,"Status caption","“k of 3 unlocked”","centered text","“Checking your rounds…” while loading","—","—"),
  (2,"Badge row","3 fixed badges (Hole-in-One / Under Par / Hunt Master)","full-width, radius 16; emoji circle","earned = bright + “Earned” pill; locked = dimmed/grayscaled","--accent (earned)","the badge emoji + earned/locked treatment"),
 ]),

# ============================================================ 25. REWARDS
screen(id="rewards", name="Rewards card", route="/me/rewards",
 purpose="Loyalty-card screen — link a card, then show ticket/credit balances and ticket activity. POS-gated; redirects home without the loyalty add-on.",
 body="".join([
   topbar("Rewards card", right=MENU()),
   box("not-linked — explainer + Card-number field + “Link card”","wide tall","card",n=1),
   box("player card — name · “Card •••NNNN · tier” · Unlink","wide","card",n=2),
   row(box("🎟️ Tickets","tile",n=3), box("🕹️ Credits","tile"), cls="ftiles"),
   txt("heading: ACTIVITY","eyebrow"),
   row(box("🎟️ Tickets · source","grow",n=4), box("+N","trail"), cls="lrow"),
   box("empty — “Nothing yet — game tickets will show up here.”","wide small"),
 ]),
 specs=[
  (1,"Link-card state","Card-number entry when unlinked","full-width card, radius 16","“Looking up…”; 404 → “No card found with that number.”","—","the card surface"),
  (2,"Player card","Linked-card identity + Unlink","full-width, radius 16","name + “Card •••last4 · tier”; inline Unlink","—","the card surface"),
  (3,"Balance tiles","Tickets + Credits","2-col grid, radius 16","big arcade values","--accent","the tile surfaces + ticket/credit glyphs"),
  (4,"Activity list","Ticket-reward history","full-width rows, radius 12","“🎟️ Tickets · source” + “+N”; empty state when none","—","the row surface"),
 ]),

# ============================================================ 26. PHOTO BOOTH
screen(id="photos", name="Photo Booth", route="/photos",
 purpose="AI-free photo booth — snap a photo, decorate with stickers/frames (+ a forced venue watermark), save to a per-device camera roll and/or share.",
 body="".join([
   topbar("Photo Booth · Decorate", right=MENU()),
   txt("intro + privacy note — “only visible to this phone… until you share” · link","muted",n=1),
   btn("📸 Take a photo","primary",n=2),
   txt("eyebrow: CAMERA ROLL","eyebrow"),
   row(box("photo","tile",n=3),box("photo","tile"),box("photo","tile"),cls="ftiles three"),
   txt("EDITOR — decorate a photo","eyebrow"),
   img("Edit canvas — base photo + draggable stickers + frame + forced venue watermark", n=4, fill=False),
   row(box("−","key",n=5),box("+","key"),box("↺","key"),box("↻","key"),box("🗑️","key"),cls="segs"),
   box("frames strip · sticker sheet (venue SVGs + emoji)","wide small",n=6),
   row(btn("✅ Save to camera roll","primary sm"), btn("📤 Share","ghost sm"), cls="nav"),
 ]),
 specs=[
  (1,"Intro + privacy","Blurb + camera-roll privacy note + link","text + link","links to the privacy screen","—","—"),
  (2,"Take-a-photo","Opens the camera / file picker","full-width primary","no capture attr (library allowed)","--accent","a camera glyph + button surface"),
  (3,"Camera-roll grid","Saved photos, 3-col","3-col grid","loading / empty / grid; a ✏️ badge marks editable drafts; tap → viewer (Share / Edit / Delete)","—","the tile surface + a draft badge"),
  (4,"Edit canvas","Photo + stickers + frame + watermark","aspect-ratio box","drag to move; tap a sticker to select (ring + ✕); forced watermark pinned","—","the sticker/frame art"),
  (5,"Adjust keys","Smaller / Bigger / Rotate / Remove","key row","act on the selected sticker","—","the key glyphs"),
  (6,"Frames + stickers","Frame strip + sticker sheet","horizontal strips","venue SVG stickers first, then the emoji sheet; “None” frame option","--accent","venue frames + venue SVG stickers"),
 ]),

# ============================================================ 27. INSTALL
screen(id="install", name="Install", route="/install",
 purpose="PWA install landing (QR-code target); shows the right path per platform.",
 body="".join([
   topbar("Install the app", right=MENU()),
   f'<div class="wf-hero">{icon("hero", n=1)}</div>',
   txt("“Add Mini Golf to your phone”","center"),
   box("Branch card — Installed / iOS steps / native-prompt / Generic","wide xtall","card",n=2),
   box("platform warning box","wide small",n=3),
 ]),
 specs=[
  (1,"Hero","Brand mark + heading","glyph ~48px","—","—","the brand mark"),
  (2,"Branch card","One of four states: already-installed (+ Open button), iOS steps, native-prompt button, or generic steps","full-width, radius 16","platform-dependent; dismissed-prompt retry hint","—","the card surface"),
  (3,"Numbered step + warning","Instruction steps and a caveat box","step badge ~24px circle; warning box radius 8","—","—","step-number badges + the platform glyphs referenced (Share / add-to-home / browser-menu)"),
 ]),

# ============================================================ 28. TV WALL
screen(id="wall", name="TV Wall (venue display)", route="/tv/wall",
 purpose="Landscape, no-chrome venue display — every course's leaderboard side-by-side in live columns. Configured entirely by URL query params; updates over SSE.",
 body="".join([
   f'<div class="wf-top nob"><span class="wf-ttl">⛳ Venue Leaderboard · window</span><span class="wf-sp"></span><span class="wf-mini">announcement</span></div>',
   row(
     f'<div class="wf-box col-wall"><span class="cn-badge">2</span><span class="wf-t">course col</span><span>course header + rows</span></div>',
     f'<div class="wf-box col-wall"><span>course header + rows</span></div>',
     f'<div class="wf-box col-wall"><span>course header + rows</span></div>',
     cls="wallgrid", n=1),
   txt("row — rank · tag · total (accent)","muted",n=3),
 ]),
 specs=[
  (1,"Column grid","One column per course, full height","N-col CSS grid","landscape display; no TopBar/nav; live over SSE + a 60s safety poll","—","the wall background"),
  (2,"Course column","Header (theme emoji + course name) + a rank list","one <section> per course","empty column → “No scores yet — be the first!”","accent header tint + accent bottom border","the column surface"),
  (3,"Leaderboard row","rank · tag · total","3-column row","rise-in animated; totals in the course accent","--accent (total)","the row surface + the arcade type face"),
 ]),

# ============================================================ 29. CHALLENGE SPINNER
screen(id="spinner", name="Challenge Spinner", route="/golf/spinner",
 purpose="Mid-round dare wheel opened from the scorecard — spin for a next-shot twist or a just-for-fun challenge. Offline, bundled content; themed to the round's course when opened mid-round.",
 body="".join([
   topbar("Challenge Spinner", right=MENU()),
   box("course caption — “COURSE NAME CHALLENGES” (only when opened from a round)","wide small cond",n=1),
   img("Wheel — one wedge per challenge (pie sector + upright emoji at 66% radius); 🔻 pointer fixed at top-center over the wheel; hub cap disc. Wedge count scales to the themed challenge set.", n=2),
   box("Result card — kind badge pill IN-CARD (“⛳️ Next-shot twist” / “🎉 Just for fun”) · challenge emoji · challenge text","wide tall cond","card",n=3),
   txt("hint line — “Tap spin for a challenge…” / “Round and round…” (shown only when no result)","center muted",n=4),
   btn("Spin the wheel","primary",n=5),
 ]),
 specs=[
  (1,"Course caption","Uppercase “<course> challenges” line","text eyebrow","only when nav state carries the round's course; absent from direct entry","course ink","—"),
  (2,"Wheel","The spinner — SVG pie of challenge wedges","~max-w-xs disc; emoji at 66% radius, counter-rotated upright","spins on the button only (wheel itself isn't tappable); wedge count = challenge-set size","wedge fills keyed by challenge kind","wedge palette per kind + the pointer + hub-cap treatment"),
  (3,"Result card","Landed challenge — badge, emoji, and text all in one card","full-width card, radius 16","exactly one of result card / hint line renders; swell-in on land; the kind badge renders INSIDE the card as its first child","kind palette (twist vs fun)","the card surface + the two kind-badge treatments"),
  (4,"Hint line","Idle / spinning prompt","bare centered text (no card)","“Round and round…” while spinning, else the tap prompt","muted","—"),
  (5,"Spin button","The only control","full-width, ~52 tall","labels: “Spin the wheel” → “Spinning…” (disabled) → “Spin again”","--accent","the primary surface"),
 ]),

# ============================================================ 30. TEAM DETAIL
screen(id="teamdetail", name="Team detail", route="/me/teams/:id",
 purpose="One team's roster and management. Members see the roster; owners also invite by email, rename, and archive. Signed-out visitors are bounced to Teams.",
 body="".join([
   topbar("Team name", right=MENU()),
   txt("label: Members"),
   row(box("tag","tagb",n=1), box("name (you) · Owner — no action on own row","grow"), cls="lrow"),
   row(box("tag","tagb"), box("name · Member","grow"), box("Remove","trail",n=2), cls="lrow"),
   txt("OWNER ONLY ↓","eyebrow",n=3),
   box("Invited (pending) — bare email lines (only when any)","wide small cond",n=4),
   txt("label: Invite by email"),
   box("email field — “friend@example.com” · inline error below","wide",n=5),
   btn("Send invite","primary"),
   txt("label: Team name"),
   box("name field","wide",n=6),
   btn("Rename","ghost"),
   btn("Archive team","ghost",n=7),
   box("footer error / notice lines — bottom of the page, not by the control","wide small cond",n=8),
 ]),
 specs=[
  (1,"Member row","One card per member (unbounded, no 1–4 cap)","full-width, radius 16","leading TagChip only when the member has a tag; name + “ (you)” marker; Owner/Member caption","--tag-accent","the row surface"),
  (2,"Row action","Trailing red text button","text button","“Leave” on your own row, “Remove” on others (owner); an owner's own row has none","(danger emphasis)","—"),
  (3,"Owner gating","Everything below the roster","—","rendered only for role=owner; members see just the roster + footer messages","—","—"),
  (4,"Pending invites","“Invited (pending)” email lines","bare truncated text lines (no cards)","only when invites are outstanding","muted","—"),
  (5,"Invite field + send","Email input → Send invite","full-width input + button","inline validation error directly under the input; button disabled on empty/invalid/busy","(error emphasis)","the field surface"),
  (6,"Rename field","Team-name input","full-width input, maxlength 40","Rename disabled while unchanged/empty/busy","—","the field surface"),
  (7,"Rename / Archive","Stacked column — Rename (ghost) · Archive team (danger)","full-width, stacked","Archive confirms (“Members will lose access.”) then navigates away; one shared busy flag dims all controls","(danger emphasis on Archive)","ghost + danger surfaces"),
  (8,"Footer messages","Error and notice lines at the very bottom of the content","bare text, page footer","conditional; can both show; note they render far from the control that triggered them; separate Loading / “Team not found” states","(error emphasis)","—"),
 ]),

# screens whose layout grows by one row/chip per player (1–4)
for _s in SCREENS:
    if _s["id"] in ("setup","play","sum","hunt"): _s["scales"] = True

# ---------------------------------------------------------------- CSS
CSS = r"""
@page { size: Letter; margin: 12mm 12mm 14mm; }
:root{ --ink:#1b2733; --muted:#6b7682; --line:#d9dee3; --panel:#f6f8fa;
 --wire:#8a95a1; --wireln:#aeb7c1; --fill:#f0f2f5; --fill2:#e7eaee; --hatch:#dfe3e8; --co:#334155; --accent:#15803d; --accentsoft:#e7f1ec;}
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);font-size:10px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
h1,h2,h3{margin:0;line-height:1.15}
code{font-family:"SF Mono",ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:9px;color:#0b3d1f}
.page{page-break-after:always} .page:last-child{page-break-after:auto}
/* cover */
.cover{height:246mm;display:flex;flex-direction:column}
.wfmark{width:120px;height:76px;border:2px solid var(--wire);border-radius:12px;position:relative;background:repeating-linear-gradient(135deg,transparent,transparent 8px,var(--hatch) 8px,var(--hatch) 9px)}
.wfmark:after{content:"⛳ layout, not art";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 9px/1 "SF Mono",monospace;color:var(--muted)}
.eyebrow{font:700 11px/1 "SF Mono",monospace;letter-spacing:.26em;text-transform:uppercase;color:var(--accent);margin-top:14px}
.cover h1{font-size:36px;font-weight:900;letter-spacing:-.02em;margin:12px 0 6px}
.cover .tag{font-size:13.5px;color:#333;max-width:155mm}
.chip{display:inline-block;background:var(--accentsoft);color:var(--accent);border:1px solid #c3e2cf;border-radius:999px;padding:3px 11px;font-size:10px;font-weight:700;margin:0 6px 6px 0}
.how{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--panel);margin-top:auto}
.how h3{font-size:12px;margin-bottom:6px} .how ol{margin:0;padding-left:18px} .how li{margin-bottom:4px}
.note{border-left:3px solid #d97706;background:#fff7ed;border-radius:0 8px 8px 0;padding:9px 12px;font-size:10.5px;margin:14px 0 0}
.note b{color:#9a3412}
/* screen page */
.sp h2{font-size:15px;font-weight:800;border-bottom:2.5px solid var(--accent);padding-bottom:5px;margin-bottom:3px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.purpose{color:#333;font-size:10px;margin:2px 0 8px}
.layout{display:flex;gap:16px;align-items:flex-start}
.framewrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px}
.viewcap{font:700 8px/1 "SF Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.specwrap{flex:1}
table{width:100%;border-collapse:collapse;font-size:8px}
th,td{text-align:left;padding:3px 4px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel);font-weight:800;font-size:7.5px;text-transform:uppercase;letter-spacing:.02em;color:#334}
td.cn{text-align:center;width:13px}
td.cn span{display:inline-block;background:var(--co);color:#fff;border-radius:999px;width:13px;height:13px;line-height:13px;font-size:8px;font-weight:800}
td b{color:#0b3d1f} .artc{color:#0b3d1f}
tr{break-inside:avoid}
/* device frame */
.frame{position:relative;width:250px;border:2px solid var(--wire);border-radius:20px;padding:6px;background:#fbfcfd}
.frame .scr{border:1px dashed var(--wireln);border-radius:14px;overflow:hidden;background:#fff;min-height:496px;padding-bottom:8px}
.frame .scr.fill{display:flex;flex-direction:column;height:496px;padding-bottom:0}
/* callout badge anchored ON an element */
.cn-badge{position:absolute;top:-7px;right:-7px;width:15px;height:15px;border-radius:999px;background:var(--co);color:#fff;
 font:800 9px/15px "Segoe UI",sans-serif;text-align:center;box-shadow:0 0 0 1.5px #fff;z-index:6}
/* ---- wireframe kit ---- */
.wf-top,.wf-top.nob{display:flex;align-items:center;gap:5px;padding:8px 9px;border-bottom:1px dashed var(--wireln)}
.wf-top.nob{border-bottom:none;justify-content:flex-end}
.wf-ttl{font-weight:800;font-size:11px;color:#334}
.wf-sp{flex:1}
.wf-mini{font-size:8px;font-weight:700;color:var(--muted);border:1px solid var(--wireln);border-radius:5px;padding:2px 4px}
.wf-icon{position:relative;min-width:18px;height:18px;padding:0 3px;border:1px solid var(--wireln);border-radius:6px;background:var(--fill);display:inline-flex;align-items:center;justify-content:center;font:700 8px/1 "SF Mono",monospace;color:var(--muted)}
.wf-group{position:relative;display:inline-flex;gap:4px;align-items:center;padding:2px;border-radius:8px}
.wf-hero{display:flex;justify-content:center;padding:8px 0 2px}
.wf-hero .wf-icon{width:40px;height:40px;border-radius:10px;font-size:9px}
.wf-box{position:relative;border:1px solid var(--wireln);border-radius:9px;background:var(--fill);margin:6px 9px;padding:8px 9px;font-size:9px;color:#3b4653;min-height:30px;display:flex;align-items:center}
.wf-box .wf-t{position:absolute;top:-7px;left:8px;font:700 7px/1 "SF Mono",monospace;color:var(--muted);background:#fff;padding:0 3px;text-transform:uppercase;letter-spacing:.05em}
.wf-box.tall{min-height:48px} .wf-box.xtall{min-height:120px}
.wf-box.card{align-items:flex-start} .wf-box.tbl{min-height:52px}
.wf-box.small{min-height:0;padding:5px 9px;font-style:italic;color:var(--muted)}
.wf-box.repeat{min-height:0;padding:6px 9px;border-style:dashed;background:#fbfcfd;color:var(--muted);font-style:italic}
.wf-box.tagb.repeat{border-style:dashed;opacity:1;font-style:italic}
.wf-box.sel,.wf-box.hl{border-style:solid;border-color:var(--wire);background:var(--fill2)}
.wf-box.err{border-color:#c98}
.wf-box.sticky{border-style:solid;border-color:var(--wire)}
.wf-row{display:flex;gap:6px;margin:6px 9px;align-items:center}
.wf-row.grid2{display:grid;grid-template-columns:repeat(4,1fr)} .wf-row.grid2 .wf-box{margin:0;justify-content:center;min-height:46px}
.wf-row.segs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px} .wf-row.segs .wf-box{margin:0;justify-content:center;min-height:26px}
.wf-row.segs.two{grid-template-columns:repeat(2,1fr)}
.wf-row.prow .wf-box{margin:0}
.wf-row.prow .tagb{flex:0 0 40px;justify-content:center} .wf-row.prow .key{flex:0 0 32px;justify-content:center;min-height:32px}
.wf-row.prow .well{flex:1;justify-content:center}
.wf-row.nav .wf-btn{margin:0;flex:1}
.wf-row.tagrow .wf-box{margin:0}
.wf-row.lrow .wf-box{margin:0} .wf-row.lrow{margin:6px 9px}
.wf-row.lrow .chip{flex:0 0 34px;justify-content:center;min-height:34px} .wf-row.lrow .grow{flex:1} .wf-row.lrow .trail{flex:0 0 auto;border:none;background:none;color:var(--muted)}
.wf-row.lb .wf-box{margin:0} .wf-row.lb{margin:6px 9px} .wf-row.lb .chip{flex:0 0 26px;justify-content:center} .wf-row.lb .grow{flex:1} .wf-row.lb .trail,.wf-row.lb .tot{flex:0 0 auto;border:none;background:none}
.wf-row.playas .wf-box{margin:0}
.wf-row.itemrow{align-items:stretch} .wf-row.itemrow .item{flex:1;margin:0}
.wf-row.rule .wf-box{margin:0} .wf-row.rule{margin:4px 9px}
.wf-row.hud{justify-content:space-between;margin:7px 10px 4px}
.wf-row.ftiles{display:grid;grid-template-columns:1fr 1fr;gap:5px} .wf-row.ftiles .wf-box{margin:0;min-height:38px}
.wf-row.ftiles.three{grid-template-columns:repeat(3,1fr)}
.wf-row.wallgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px} .wf-row.wallgrid .wf-box{margin:0;min-height:90px;align-items:flex-start}
.wf-box.seg{margin:0} .wf-box.seg.on{background:var(--fill2);border-color:var(--wire);font-weight:800}
.wf-box.med{width:40px;height:40px;border-radius:999px;margin:2px auto 6px;justify-content:center;min-height:0}
.wf-row.hud .wf-box.med{margin:0}
.wf-box.tagb{font-family:"SF Mono",monospace;letter-spacing:.1em;font-weight:800}
.wf-box.tagb.sel{border-color:var(--wire);border-width:2px} .wf-box.tagb.dim{opacity:.5}
.wf-box.inp{font-family:"SF Mono",monospace;letter-spacing:.15em;flex:0 0 128px;justify-content:center;background:var(--fill2);box-shadow:inset 0 2px 3px rgba(0,0,0,.07)}
.wf-box.line{flex:1;min-height:0;padding:5px 8px}
.wf-box.ghost{border-color:transparent;background:none;box-shadow:none;min-height:0}
.wf-box.cond{border-style:dashed}
.wf-box.hgrid{justify-content:flex-start;letter-spacing:.12em;font-weight:700;color:var(--muted)}
.wf-box.tk{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;min-height:0;padding:0}
.wf-centered{display:flex;justify-content:center}
.wf-btn{position:relative;border:1px solid var(--wireln);border-radius:10px;background:var(--fill);margin:6px 9px;padding:9px;text-align:center;font-weight:700;font-size:9.5px;color:#3b4653;display:flex;align-items:center;justify-content:center}
.wf-btn.primary{border-color:var(--wire);border-width:2px;background:var(--fill2);font-weight:800}
.wf-btn.sm{margin:0;padding:7px}
.wf-btn.snap{margin:0;padding:0 10px;font-size:8.5px;flex:0 0 auto}
.wf-img{position:relative;border:1px solid var(--wireln);border-radius:11px;margin:8px 9px;min-height:150px;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;font-size:9px;color:var(--muted);font-weight:700;background:repeating-linear-gradient(135deg,#fbfcfd,#fbfcfd 9px,var(--hatch) 9px,var(--hatch) 10px)}
.wf-img.fill{flex:1 1 auto;min-height:0}
.wf-txt{position:relative;margin:5px 9px;font-size:9px;color:#48525d}
.wf-row{position:relative}
/* ---- screens-only contact sheet ---- */
.sheethead{margin:0 0 12px} .sheethead h1{font-size:22px;font-weight:900;letter-spacing:-.01em}
.sheethead p{font-size:10.5px;color:#444;margin:4px 0 0;max-width:170mm}
.sheethead .note{border-left:3px solid #d97706;background:#fff7ed;border-radius:0 8px 8px 0;padding:7px 11px;margin-top:8px;font-size:9.5px}
.sheethead .note b{color:#9a3412}
.grid-screens{display:flex;flex-wrap:wrap;gap:16px 18px;justify-content:center;align-items:flex-start}
.grid-screens .frame .scr{height:496px}   /* uniform full device height for every screen */
.cell{break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:6px;width:250px}
.celltitle{font-size:11px;font-weight:800;text-align:center;display:flex;gap:6px;align-items:baseline;justify-content:center;flex-wrap:wrap}
.wf-txt.muted{color:var(--muted);font-style:italic} .wf-txt.center{text-align:center}
.wf-txt.eyebrow{font-weight:800;font-size:8px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
.wf-txt.inline{margin:0;font-weight:700} .wf-txt.inline.r{color:var(--muted)}
"""

def render_screen(sc, idx):
    scr_cls = "scr fill" if sc.get("fill") else "scr"
    frame = f'<div class="frame"><div class="{scr_cls}">{sc["body"]}</div></div>'
    rows = "".join(
      f'<tr><td class="cn"><span>{r[0]}</span></td><td><b>{r[1]}</b></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td class="artc">{r[6]}</td></tr>'
      for r in sc["specs"])
    return f"""<div class="page sp">
 <h2><span>{idx}. {sc['name']}</span></h2>
 <p class="purpose">{sc['purpose']}</p>
 <div class="layout">
   <div class="framewrap">{frame}<div class="viewcap">wireframe · schematic{" · shown at 4 players (supports 1–4)" if sc.get("scales") else ""}</div></div>
   <div class="specwrap">
     <table><tr><th>#</th><th>Element</th><th>Role &amp; where</th><th>Size (current)</th><th>Interaction / states</th><th>Theming hooks</th><th>Art / assets needed</th></tr>
     {rows}</table>
   </div>
 </div>
</div>"""

cover = """<div class="page cover">
 <div class="wfmark"></div>
 <div class="eyebrow">Mini Golf · Family Fun Center PWA</div>
 <h1>Screen &amp; Element Guide</h1>
 <p class="tag">A structural wireframe of every screen — the element inventory and rough arrangement — with each interface element numbered and spec'd (including current dimensions). It tells you <b>what each screen contains and what art each element needs</b>, so nothing is missed when you theme the app.</p>
 <div style="margin-top:16px">
  <span class="chip">30 screens</span><span class="chip">5 sections</span><span class="chip">Wireframe layout</span><span class="chip">Numbered on-element markers</span><span class="chip">Dimensions + specs</span>
 </div>
 <div class="note"><b>These wireframes are not the design.</b> They show structure only — no colors, type, icons, or materials are implied, and the current app art is <b>not</b> a reference to match (much of it is placeholder and wrong). Dimensions are the <b>current</b> values for scale, not fixed targets — only tap-target sizes, safe areas, and contrast are constraints. Boxes and positions are schematic. You define the actual look; mark up anything here that's wrong.</div>
 <div class="how">
  <h3>How to read each page</h3>
  <ol>
   <li>The <b>wireframe</b> is a labeled skeleton of one screen — every element as a plain box, with its numbered marker sitting <b>on the element</b>.</li>
   <li>That number maps to the <b>spec table</b>: role, current <b>size</b>, interaction/states, the <b>theming hooks</b> it keys to (accent / course-color variables), and the <b>art it needs</b>.</li>
   <li><b>Navigation:</b> Home is a venue dashboard that launches five sections — <b>Mini Golf, Arcade, Food &amp; Drink, Me</b>, and the Photo Booth. Every screen's top-right <b>menu button</b> opens the global <b>navigation drawer</b> (its own page here), which also holds the light/dark + sound switches.</li>
   <li><b>Conditional cards:</b> a box with a <b>dashed</b> outline appears only when populated (a live round, a pending order, venue specials); a <b>solid</b> box is always present.</li>
   <li><b>Light &amp; dark:</b> the app has no fixed default — it follows the device setting. Design every element for <b>both</b>, clearing contrast on each (≥4.5:1 text / ≥3:1 large &amp; UI).</li>
   <li><b>Full-bleed screens:</b> the Course Map and every game playfield <b>fill the screen</b> below the bar (barring the HUD/buttons) — design them edge-to-edge.</li>
   <li><b>Player-scaled screens</b> (Player Setup, Scorecard, Summary, Scavenger Hunt) add <b>one row/chip per player</b>; they're drawn <b>at the 4-player maximum</b> (1–4 supported), so design for the fullest layout.</li>
   <li>The live, re-skinnable element inventory is the in-app style-guide screen; this document measures the current build.</li>
  </ol>
 </div>
</div>"""

pages = "".join(render_screen(sc, i+1) for i,sc in enumerate(SCREENS))
html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screen &amp; Element Guide</title><style>{CSS}</style></head>
<body>{cover}{pages}</body></html>"""
open(OUT,"w").write(html)
print("wrote", OUT, "screens:", len(SCREENS))

# The to-scale contact sheet (public/docs/screens.html + screens.pdf) is built
# separately by scripts/build-screens-sheet.py so it can render real-pixel
# artboards while this guide keeps its schematic wireframes + spec tables.
