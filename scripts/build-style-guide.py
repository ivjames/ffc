# -*- coding: utf-8 -*-
"""docs/style-guide.html — neutral per-screen WIREFRAMES (element inventory +
schematic layout, no colors/emoji/materials) with numbered badges anchored
ON each element, mapping to a spec table incl. current dimensions. The current
app art is NOT authoritative."""

import re
OUT = "/home/user/ffc/docs/style-guide.html"
OUT2 = "/home/user/ffc/docs/screens.html"
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

CTRL = lambda n=None: group(icon()+icon(), n)   # the light/dark + mute pills cluster

# ============================================================ 1. HOME
screen(id="home", name="Home", route="/",
 purpose="Landing hub — pick a course, resume a round, reach maps / rules / leaderboard / install.",
 body="".join([
   f'<div class="wf-top nob"><span class="wf-sp"></span>{CTRL(1)}</div>',
   f'<div class="wf-hero">{icon("hero", n=2)}</div>',
   box("Location bar — pin · “LOCATION” · venue name · Change","wide",n=3),
   box("Resume-round card — course name · player tags","wide tall","card",n=4),
   row(box("tile",cls="tile",n=5),box("tile","tile"),box("tile","tile"),box("tile","tile"),cls="grid2"),
   btn("While You Wait","ghost",n=6), btn("Rules","ghost"), btn("See the leaderboard","ghost"), btn("Install app","ghost"),
 ]),
 specs=[
  (1,"Header control pills","Global, top of most screens — light/dark + mute","two 36×36 circle pills","two independent toggles; each shows the state it switches to","own pill surface; glyph","pill background + a mode icon pair + a sound icon pair"),
  (2,"Hero mark","Brand identity, top of Home","~48px","animates on arrival","—","the brand hero mark"),
  (3,"Location bar","Row → Location Picker","full-width row, radius 16","tappable; shows current venue","row surface","a location/pin marker + the row surface"),
  (4,"Resume-round card","CTA → resume the in-progress round","full-width, radius 16","only present when a round is live; standing glow","--glow = course accent","card surface + the standing-glow treatment"),
  (5,"Course tiles","Grid → each course's map/start","2-col, ~1:1 (~208px sq in the 448px column), radius 24; puck 56×56, marker 24–28px","tappable; staggered entrance","--tile-accent / --puck-accent per course","tile surface + a course marker/crest per course (the puck)"),
  (6,"Secondary menu","Ghost-button stack → While You Wait / Rules / Leaderboard / Install","full-width rows, ~48 tall, radius 16","Install hidden when already installed. (Scavenger hunt is NOT here — it lives on the in-round bar)","—","ghost surface + a leading icon per row"),
 ]),

# ============================================================ 2. LOCATIONS
screen(id="loc", name="Location Picker", route="/locations",
 purpose="Choose the venue (manual or GPS); scopes which courses show.",
 body="".join([
   topbar("Choose a location", right=CTRL()),
   btn("Use my location (GPS)","wbtn",n=1),
   txt("status message (detecting / error)","muted",n=2),
   row(box("marker","chip",n=3), box("venue name · course count","grow"), box("Current / ›","trail",n=4), cls="lrow sel"),
   row(box("marker","chip"), box("venue name · course count","grow"), box("›","trail"), cls="lrow"),
   row(box("marker","chip"), box("venue name · course count","grow"), box("›","trail"), cls="lrow"),
   txt("footer note","muted"),
 ]),
 specs=[
  (1,"“Use my location”","GPS-detect button (only if geolocation is available)","full-width, radius 12","disabled + progress label while locating","—","a GPS/location icon + button surface"),
  (2,"Status message","Detect feedback","text","appears on progress / error","(error emphasis)","—"),
  (3,"Location row","One per venue → selects it","full-width row, radius 16; marker chip ~48×48","selected vs unselected","per-location accent tints the marker chip","a location marker + row surface"),
  (4,"Trailing marker","Row right edge","chevron ~14px","“Current” (selected) or forward chevron","per-location accent","a chevron icon"),
 ]),

# ============================================================ 3. COURSE PICKER
screen(id="pick", name="Course Picker", route="/new",
 purpose="Pick which course at the current location to score.",
 body="".join([
   topbar("Pick a course", right=CTRL()),
   box("Location switcher — pin · venue · Change","wide",n=1),
   row(box("mkr","chip",n=2), box("course row — name · “holes · par”","grow",n=3), box("›","trail",n=4), cls="lrow"),
   row(box("mkr","chip"), box("name · “holes · par”","grow"), box("›","trail"), cls="lrow"),
   row(box("mkr","chip"), box("name · “holes · par”","grow"), box("›","trail"), cls="lrow"),
   row(box("mkr","chip"), box("name · “holes · par”","grow"), box("›","trail"), cls="lrow"),
 ]),
 specs=[
  (1,"Location switcher","Row → Location Picker (returns here)","full-width, radius 12","tappable","row surface","a pin marker + row surface"),
  (2,"Course marker","Left of each course row","~48×48 rounded square, radius 12","—","tinted from the course accent","the course marker icon"),
  (3,"Course row","Tap → Player Setup","full-width row, radius 16","tappable; empty state when no courses","—","row surface"),
  (4,"Chevron","Row right edge","~16px","—","muted","a forward chevron"),
 ]),

# ============================================================ 4. PLAYER SETUP
screen(id="setup", name="Player Setup", route="/new/setup",
 purpose="Choose player count (1–4) and enter three-character arcade tags, then start.",
 body="".join([
   topbar("Course name", right=CTRL()),
   txt("label: Players"),
   row(box("1","seg",n=1),box("2","seg"),box("3","seg"),box("4","seg on"),cls="segs"),
   txt("label: Tags (3 chars, arcade style)"),
   row(icon("1"), box("tag input","inp grow",n=2), cls="tagrow"),
   row(icon("2"), box("tag input — error","inp grow err",n=3), cls="tagrow"),
   txt("inline error message","muted"),
   row(icon("3"), box("tag input","inp grow"), cls="tagrow"),
   row(icon("4"), box("tag input","inp grow"), cls="tagrow"),
   btn("Start round","primary",n=4),
 ]), scales=True,
 specs=[
  (1,"Player-count selector","1–4 buttons","4-col grid; each ≥44px tall","selected vs unselected","—","selected/unselected states"),
  (2,"Tag input","Arcade text field — one row per player (1–4)","full-width row, ~44 tall","empty (placeholder) / filled / invalid; row count = selected players","an arcade/mono type role","field surface; the arcade type face"),
  (3,"Invalid-tag state","On a bad tag","—","red border + inline error","(error emphasis)","error treatment"),
  (4,"Start round","Primary CTA → play","full-width, ~52 tall, radius 16","disabled until roster valid; busy label while starting","--accent","the primary button surface"),
 ]),

# ============================================================ 5. COURSE MAP (fills screen)
screen(id="map", name="Course Map", route="/courses/:id/map", tint=True, fill=True,
 purpose="Opening course screen — the map fills the screen below the bar; tapping it starts the round.",
 body="".join([
   topbar("Course name", right=CTRL()),
   img("Course map illustration — FILLS the screen below the bar; the whole panel is one tap target → setup. “TAP ANYWHERE TO BEGIN” prompt overlays it.", n=1, fill=True),
 ]),
 specs=[
  (1,"Course map","Full-bleed map; the whole panel starts the round","fills the screen barring the top bar (≈448px wide × remaining height)","tappable; a pulsing “tap to begin” prompt overlays it","the screen washes toward the course color","a top-down hole map per course (or a fallback panel with the course marker); keep center/edges calm so the overlay prompt stays legible, in both light and dark"),
 ]),

# ============================================================ 6. SCORECARD
screen(id="play", name="Scorecard (play screen)", route="/play/:clientId", tint=True,
 purpose="The core loop — score one hole at a time for every player; each edit persists instantly.",
 body="".join([
   (lambda cluster: f'<div class="wf-top">{icon("‹")}<span class="wf-ttl">Course</span><span class="wf-sp"></span>{cluster}{CTRL()}</div>')(
       group(icon()+icon()+'<span class="wf-mini">Holes</span>', 1)),
   row(txt("HOLE n · hole name","inline"), box("par","med",n=3), cls="hud"),
   box("hole-jump grid — 6-col keys","wide small","toggled",n=2),
   row(box("tag","tagb",n=4), box("−","key"), box("score well","well",n=5), box("+","key",n=6), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("score well","well"), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("score well","well"), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("score well","well"), box("+","key"), cls="prow"),
   row(btn("‹ Prev","ghost sm"), btn("Next › / Finish","ghost sm",n=7), cls="nav"),
   txt("stroke-cap footer","muted"),
 ]),
 specs=[
  (1,"TopBar shortcuts","Scavenger hunt · Challenge spinner · “Holes” toggle","glyphs ~24px; back key 40×40","the Holes toggle reveals a hole-jump grid","—","a hunt icon + a spinner icon"),
  (2,"Hole-jump grid","Toggled grid of hole keys","6-col; cells 32–36px","current / done / unplayed key states","--accent marks the current hole","the three key states"),
  (3,"Par medallion","Par read-out disc","56×56 circle","—","par numeral in the course ink","the disc surface"),
  (4,"Player tag","Player identity chip on each row","radius 8 pill; text ~18px","empty shows a placeholder","--tag-accent","the tag surface (contrast-checked on any accent)"),
  (5,"Score well","Recessed score read-out","full-width flex, ~56 tall","reacts to each stroke edit; empty when unscored","—","the recessed-well surface"),
  (6,"± stepper keys","Add / remove a stroke","56×56, radius 16","press feedback; disabled at floor & at the stroke cap","—","the key surface + the + / − marks"),
  (7,"Hole navigation","Prev / Next — or Finish on the last hole","full-width, ~52 tall","disabled until the hole/round is complete","--accent on Finish","ghost + primary surfaces"),
 ]),

# ============================================================ 7. SUMMARY
screen(id="sum", name="Summary (final scorecard)", route="/play/:clientId/summary", tint=True,
 purpose="Celebrates the winner, shows standings + hole-by-hole grid, syncs to the leaderboard.",
 body="".join([
   topbar("Final scorecard", right=CTRL()),
   box("Winner hero — trophy · “Winner” · winner tag · total / over-under","wide tall","card",n=1),
   box("Standings row — rank · tag · total","wide","row",n=2),
   box("Standings row — rank · tag · total","wide","row"),
   box("Standings row — rank · tag · total","wide","row"),
   box("Nine-grid table — Front/Back · par row · one score row per player","wide","tbl",n=3),
   txt("sync status line","muted",n=4),
   row(btn("View leaderboard","ghost sm"), btn("Done","primary sm",n=5), cls="nav"),
 ]),
 specs=[
  (1,"Winner hero","Celebration card","full-width card, radius 24; trophy ~48px","celebratory entrance; a “tied” variant","--glow accent; winner tag in course ink","a trophy/celebration mark + the hero surface"),
  (2,"Standings row","One per non-winner (up to 4 players total)","full-width, radius 16","staggered entrance","rank + arcade tag in course ink","the row surface"),
  (3,"Nine-grid table","Hole-by-hole scores, Front & Back","full-width table","cells signal under / over / at par; empty cell","--score-under / --score-over","the table surface + the score-signal colors"),
  (4,"Sync note","Leaderboard save status","text","synced / failed / saving / offline","(failure emphasis)","a confirmation tick"),
  (5,"Action buttons","View leaderboard (secondary) · Done (primary)","full-width","—","--accent","ghost + primary surfaces"),
 ]),

# ============================================================ 8. RULES
screen(id="rules", name="Rules", route="/rules",
 purpose="Static, offline general rules + optional per-course notes. Read-only.",
 body="".join([
   topbar("Rules", right=CTRL()),
   txt("heading: GENERAL","eyebrow",n=1),
   row(icon("1"), box("rule text","line",n=2), cls="rule"),
   row(icon("2"), box("rule text","line"), cls="rule"),
   row(icon("3"), box("rule text","line"), cls="rule"),
   txt("heading: COURSE NOTES","eyebrow"),
   box("Course-note card — marker · course name · bulleted notes","wide tall","card",n=3),
 ]),
 specs=[
  (1,"Section heading","“General” / “Course notes”","text eyebrow","—","muted","—"),
  (2,"Numbered rule list","General rules","list","—","—","list-number treatment"),
  (3,"Course-note card","One tinted card per course","full-width, radius 16","—","washes toward the course accent; name + marker + bullets in course ink","the card surface + the course marker"),
 ]),

# ============================================================ 9. INSTALL
screen(id="install", name="Install", route="/install",
 purpose="PWA install landing (QR-code target); shows the right path per platform.",
 body="".join([
   topbar("Install the app", right=CTRL()),
   f'<div class="wf-hero">{icon("hero", n=1)}</div>',
   txt("“Add Mini Golf to your phone”","center"),
   box("Branch card — Installed / iOS steps / Can-prompt / Generic","wide xtall","card",n=2),
   box("platform warning box","wide small",n=3),
 ]),
 specs=[
  (1,"Hero","Brand mark + heading","~48px","—","—","the brand mark"),
  (2,"Branch card","One of four states: already-installed (+ Open button), iOS steps, native-prompt button, or generic steps","full-width, radius 16","platform-dependent; dismissed-prompt retry hint","—","the card surface"),
  (3,"Numbered step + warning","Instruction steps and a caveat box","step badge ~24px circle; warning box radius 8","—","—","step-number badges + the platform glyphs referenced (Share / add-to-home / browser-menu)"),
 ]),

# ============================================================ 10. TV LEADERBOARD
screen(id="tv", name="TV Leaderboard", route="/tv",
 purpose="Live high-score board (polls periodically); highlights the just-played round on arrival.",
 body="".join([
   topbar("Leaderboard", right=CTRL()),
   row(box("Day","seg on",n=1),box("Week","seg"),box("Month","seg"),box("All","seg"),cls="segs"),
   row(box("rank","chip",n=2), box("standings row — tag · course","grow",n=4), box("You","trail",n=3), box("total","tot"), cls="lb hl"),
   row(box("rank","chip"), box("tag · course","grow"), box("total","tot"), cls="lb"),
   row(box("rank","chip"), box("tag · course","grow"), box("total","tot"), cls="lb"),
 ]),
 specs=[
  (1,"Period tabs","Day / Week / Month / All","4-col","active vs inactive","—","tab states"),
  (2,"Rank / tag","Row identity","tag ~24px","—","tag in course ink","the arcade type face"),
  (3,"“You” pill + row highlight","Marks your rows","pill (rounded-full)","only on your rows","a highlight/ring accent","the pill + row-highlight treatment"),
  (4,"Standings row","One per score","full-width, radius 16","entrance stagger; error / empty / loading states","—","the row surface"),
 ]),

# ============================================================ 11. HUNT
screen(id="hunt", name="Scavenger Hunt", route="/hunt",
 purpose="Snap-a-photo hunt; a vision model verifies each find. Reached from the in-round bar (not Home). Gated on an active round.",
 body="".join([
   topbar("Scavenger hunt", right=CTRL()),
   row(txt("Playing as","inline"), box("tag","tagb sel",n=1), box("tag","tagb dim"), box("tag","tagb dim"), box("tag","tagb dim"), cls="playas"),
   row(box("item — title · hint · count/✓","item",n=2), btn("Snap","snap",n=3), cls="itemrow"),
   row(box("item","item",n=5), btn("Snap","snap"), cls="itemrow"),
   box("result banner (verified / flagged / rejected)","wide small",n=4),
 ]),
 specs=[
  (1,"“Playing as” selector","Player chips — one per player (1–4)","radius 8 pills","selected (ring) vs dimmed","--tag-accent","tag surface + selected-state treatment"),
  (2,"Item hint / count / check","On each item","small","hint show/hide toggle; ×N count or a found check","—","hint, count, and check icons"),
  (3,"Snap button","Photo capture (opens the camera)","compact button","label cycles Snap / Snap another / Checking / Found (locked)","—","a camera icon + button surface"),
  (4,"Result banner","Verify outcome","full-width, radius 12","verified / flagged (photo-of-screen) / rejected; plus a load-error box","(flag/error emphasis)","banner treatments"),
  (5,"Item card","Per find","full-width, radius 16","found vs not-found; a gated empty state when no round is active","—","the card surface"),
 ]),

# ============================================================ 12. ARCADE PUTT (fills screen)
screen(id="putt", name="Arcade Putt", route="/putt", fill=True,
 purpose="Playable canvas mini-golf — the playfield fills the screen between the HUD and buttons. Offline.",
 body="".join([
   topbar("Arcade Putt", right=CTRL()),
   row(txt("Hole n / 9","inline"), txt("Par · Strokes","inline r"), cls="hud", n=1),
   img("Canvas playfield — FILLS the screen between HUD and buttons. Drag-to-aim slingshot; aim/power markers, ball, cup+flag, bumpers, greens, hazards, splash.", n=2, fill=True),
   txt("hint line","center muted"),
   row(btn("Next hole →","primary sm"), btn("Reset / End run","ghost sm",n=3), cls="nav"),
 ]),
 specs=[
  (1,"Status header","Hole / par / strokes","text row","course vs endless; a mode-picker precedes play","—","—"),
  (2,"Canvas playfield","The game (aim by dragging)","fills the screen barring HUD + buttons (≈448px wide × remaining height)","aim / rolling / splash / sunk phases","aim-power color ramp","playfield background + all sprites (ball, cup+flag, bumpers, greens, hazards, splash) and the aim/power markers — drawn into the canvas"),
  (3,"Play buttons","Next / See scorecard (primary) · Reset / End run (secondary)","full-width","mode-dependent","--accent","primary + ghost surfaces; a per-hole result set on the summary"),
 ]),

# ============================================================ 13. FUN ZONE HUB
screen(id="fun", name="Fun Zone hub", route="/fun",
 purpose="Grid landing routing to every mini-game. Each tile = an icon + title (11 games).",
 body="".join([
   topbar("While You Wait", right=CTRL()),
   row(
     f'<div class="wf-box ftile">{cn(1)}{icon(n=2)}<span>game tile — icon · title</span></div>',
     *[box("game tile — icon · title","ftile") for _ in range(5)], cls="ftiles"),
 ]),
 specs=[
  (1,"Activity tile","One per game → its route (11 games)","2-col, radius 16","entrance stagger; press feedback","accent-tinted per tile","the tile surface"),
  (2,"Activity icon","Leading mark on each tile","~36×36 chip","—","tinted to the tile accent","one designed icon per activity (11 total)"),
 ]),

# ============================================================ 14. MINIGAME SHELL (fills screen)
screen(id="game", name="Minigame shell (covers the 8 canvas games)",
 route="/fun/skeeball · /fun/bowling · /fun/karts · /fun/airhockey · /fun/bumper · /fun/boats · /fun/axe · /fun/batting",
 fill=True,
 purpose="Shared shell for every canvas game — the playfield fills the screen between the HUD and any footer.",
 body="".join([
   topbar("Game name", right=CTRL()),
   row(txt("count (ball / frame / pitch)","inline"), txt("score / timer","inline r"), cls="hud", n=1),
   img("Canvas playfield — FILLS the screen between HUD and footer. Per-game sprites & interaction; game-over overlay draws over it.", n=2, fill=True),
   txt("hint line","center muted"),
 ]),
 specs=[
  (1,"HUD counter row","Per-game counters / score / timer","text row","labels vary by game; a timer can signal time pressure","—","—"),
  (2,"Canvas playfield","The game itself","fills the screen barring HUD + footer (≈448px wide × remaining height)","aim / play / result; impact + shake feedback; a celebratory game-over overlay","--accent on the overlay's Play-again","per-game background + sprites (ball, puck, kart, target, pins, axe, bumper) as sprite sheets / SVGs; a result mark per game"),
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
.sp h2 .rt{font-family:"SF Mono",monospace;font-size:8.5px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 7px;font-weight:700}
.sp h2 .tb{font:700 8px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 6px}
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
.wf-row{display:flex;gap:6px;margin:6px 9px;align-items:center}
.wf-row.grid2{display:grid;grid-template-columns:repeat(4,1fr)} .wf-row.grid2 .wf-box{margin:0;justify-content:center;min-height:46px}
.wf-row.segs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px} .wf-row.segs .wf-box{margin:0;justify-content:center;min-height:26px}
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
.wf-box.seg{margin:0} .wf-box.seg.on{background:var(--fill2);border-color:var(--wire);font-weight:800}
.wf-box.med{width:40px;height:40px;border-radius:999px;margin:2px auto 6px;justify-content:center;min-height:0}
.wf-row.hud .wf-box.med{margin:0}
.wf-box.tagb{font-family:"SF Mono",monospace;letter-spacing:.1em;font-weight:800}
.wf-box.tagb.sel{border-color:var(--wire);border-width:2px} .wf-box.tagb.dim{opacity:.5}
.wf-box.inp{font-family:"SF Mono",monospace;letter-spacing:.15em}
.wf-box.line{flex:1;min-height:0;padding:5px 8px}
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
.celltitle .rt{font-family:"SF Mono",monospace;font-size:8px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 6px;font-weight:700}
.celltitle .tb{font:700 7.5px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 5px}
.wf-txt.muted{color:var(--muted);font-style:italic} .wf-txt.center{text-align:center}
.wf-txt.eyebrow{font-weight:800;font-size:8px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
.wf-txt.inline{margin:0;font-weight:700} .wf-txt.inline.r{color:var(--muted)}
"""

def render_screen(sc, idx):
    tb = '<span class="tb">course-tinted</span>' if sc.get("tint") else ''
    scr_cls = "scr fill" if sc.get("fill") else "scr"
    frame = f'<div class="frame"><div class="{scr_cls}">{sc["body"]}</div></div>'
    rows = "".join(
      f'<tr><td class="cn"><span>{r[0]}</span></td><td><b>{r[1]}</b></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td>{r[5]}</td><td class="artc">{r[6]}</td></tr>'
      for r in sc["specs"])
    return f"""<div class="page sp">
 <h2><span>{idx}. {sc['name']}</span><span class="rt">{sc['route']}</span>{tb}</h2>
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
 <div class="eyebrow">Mini Golf Scorecard PWA</div>
 <h1>Screen &amp; Element Guide</h1>
 <p class="tag">A structural wireframe of every screen — the element inventory and rough arrangement — with each interface element numbered and spec'd (including current dimensions). It tells you <b>what each screen contains and what art each element needs</b>, so nothing is missed when you theme the app.</p>
 <div style="margin-top:16px">
  <span class="chip">14 screens</span><span class="chip">Wireframe layout</span><span class="chip">Numbered on-element markers</span><span class="chip">Dimensions + specs</span>
 </div>
 <div class="note"><b>These wireframes are not the design.</b> They show structure only — no colors, type, icons, or materials are implied, and the current app art is <b>not</b> a reference to match (much of it is placeholder and wrong). Dimensions are the <b>current</b> values for scale, not fixed targets — only tap-target sizes, safe areas, and contrast are constraints. Boxes and positions are schematic. You define the actual look; mark up anything here that's wrong.</div>
 <div class="how">
  <h3>How to read each page</h3>
  <ol>
   <li>The <b>wireframe</b> is a labeled skeleton of one screen — every element as a plain box, with its numbered marker sitting <b>on the element</b>.</li>
   <li>That number maps to the <b>spec table</b>: role, current <b>size</b>, interaction/states, the <b>theming hooks</b> it keys to (accent / course-color variables), and the <b>art it needs</b>.</li>
   <li><b>Light &amp; dark:</b> the app has no fixed default — it follows the device setting. Design every element for <b>both</b>, clearing contrast on each (≥4.5:1 text / ≥3:1 large &amp; UI).</li>
   <li><b>Full-bleed screens:</b> the Course Map and every game playfield <b>fill the screen</b> below the bar (barring the HUD/buttons) — design them edge-to-edge.</li>
   <li><b>Player-scaled screens</b> (Player Setup, Scorecard, Summary, Scavenger Hunt) add <b>one row/chip per player</b>; they're drawn <b>at the 4-player maximum</b> (1–4 supported), so design for the fullest layout.</li>
   <li>Deeper token / motion / skin reference lives in <code>docs/art-spec.md</code>; the live element inventory is the <code>/style</code> route.</li>
  </ol>
 </div>
</div>"""

pages = "".join(render_screen(sc, i+1) for i,sc in enumerate(SCREENS))
html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screen &amp; Element Guide</title><style>{CSS}</style></head>
<body>{cover}{pages}</body></html>"""
open(OUT,"w").write(html)
print("wrote", OUT, "screens:", len(SCREENS))

# ---------------------------------------------------------------- screens-only sheet
def render_cell(sc, idx):
    body = re.sub(r'<span class="cn-badge">\d+</span>', '', sc["body"])   # drop markers
    tb = '<span class="tb">course-tinted</span>' if sc.get("tint") else ''
    scr = "scr fill" if sc.get("fill") else "scr"
    name = sc["name"].split(" (")[0]
    return (f'<div class="cell"><div class="celltitle">{idx}. {name}{tb}</div>'
            f'<div class="frame"><div class="{scr}">{body}</div></div></div>')

sheet_head = """<div class="sheethead">
 <h1>Mini Golf — Screens</h1>
 <p>Every screen's element layout, at a glance — no specs, no markers. Structural wireframes only; the current app art is not authoritative. Companion to the full <b>Screen &amp; Element Guide</b> (which adds dimensions, states, theming hooks, and the art needed per element).</p>
 <div class="note"><b>Not the design.</b> No colors, type, icons, or materials are implied. Player-scaled screens are drawn at 4 players; the Course Map and game playfields fill the screen below the bar.</div>
</div>"""
cells = "".join(render_cell(sc, i+1) for i,sc in enumerate(SCREENS))
html2 = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screens</title><style>{CSS}</style></head>
<body>{sheet_head}<div class="grid-screens">{cells}</div></body></html>"""
open(OUT2,"w").write(html2)
print("wrote", OUT2)
