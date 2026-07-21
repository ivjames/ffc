# -*- coding: utf-8 -*-
"""Builds docs/style-guide.html — NEUTRAL WIREFRAMES of every screen (element
inventory + schematic layout only, no colors/emoji/materials) with numbered
callouts mapping to a per-element spec table (role, interaction/states,
theming hooks, art needed). The current app art is NOT treated as authoritative."""

OUT = "/home/user/ffc/docs/style-guide.html"

SCREENS = []
def screen(**kw): SCREENS.append(kw)

# ---- wireframe element helpers (schematic, monochrome) ----
def box(label, cls="", tag=""):
    t = f'<span class="wf-t">{tag}</span>' if tag else ''
    return f'<div class="wf-box {cls}">{t}<span>{label}</span></div>'
def btn(label, kind="btn"):
    extra = "" if kind == "btn" else " " + kind
    return f'<div class="wf-btn{extra}"><span>{label}</span></div>'
def img(label):               return f'<div class="wf-img"><span>{label}</span></div>'
def icon(label="icon"):       return f'<div class="wf-icon">{label}</div>'
def txt(label, cls=""):       return f'<div class="wf-txt {cls}">{label}</div>'
def row(*items, cls=""):      return f'<div class="wf-row {cls}">' + "".join(items) + '</div>'
def bar():                    return '<div class="wf-bar"></div>'

def topbar(title, back=True, right_icons=0, right_txt=None):
    left = icon("‹") if back else '<span class="wf-sp"></span>'
    if not back: left = '<span class="wf-sp"></span>'
    r = ''
    if right_txt: r += f'<span class="wf-mini">{right_txt}</span>'
    r += "".join(icon() for _ in range(right_icons))
    r += icon() + icon()   # global control pills (mode + mute) — appear on most bars
    mid = f'<span class="wf-ttl">{title}</span><span class="wf-sp"></span>'
    return f'<div class="wf-top">{left}{mid}{r}</div>'

# ============================================================ 1. HOME
screen(id="home", name="Home", route="/",
 purpose="Landing hub — pick a course, resume a round, reach maps / rules / leaderboard / install.",
 body="".join([
   f'<div class="wf-top nob"><span class="wf-sp"></span>{icon()}{icon()}</div>',
   f'<div class="wf-hero">{icon("hero")}</div>',
   box("Location bar — pin · “LOCATION” · venue name · Change", "wide", "row"),
   box("Resume-round card — course name · player tags", "wide tall", "card"),
   row(box("tile","tile"),box("tile","tile"),box("tile","tile"),box("tile","tile"), cls="grid2"),
   btn("Scavenger hunt","ghost"), btn("While You Wait","ghost"), btn("Rules","ghost"),
   btn("See the leaderboard","ghost"), btn("Install app","ghost"),
 ]),
 callouts=[(1,4,86),(2,11,50),(3,20,50),(4,31,50),(5,47,50),(6,63,50)],
 specs=[
  (1,"Header control pills","Global, top of most screens — light/dark + mute toggles","two independent toggles; each shows the state it switches TO","own pill surface; glyph","pill background + a mode icon pair + a sound icon pair"),
  (2,"Hero mark","Brand identity, top of Home","animates on arrival (a small flourish)","—","the brand hero mark"),
  (3,"Location bar","Row → Location Picker","tappable; shows current venue","row surface","a location/pin marker + the row surface"),
  (4,"Resume-round card","CTA → resume the in-progress round","only present when a round is live; draws a standing glow","--glow = course accent","card surface + the standing-glow treatment"),
  (5,"Course tiles","Grid → each course's map/start","tappable; enters with a staggered motion","--tile-accent / --puck-accent per course","tile surface + a course marker/crest per course (the puck)"),
  (6,"Secondary menu","Ghost-button stack → hunt / fun / rules / leaderboard / install","tappable rows; Install hidden when already installed","—","ghost surface + a leading icon per row"),
 ]),

# ============================================================ 2. LOCATIONS
screen(id="loc", name="Location Picker", route="/locations",
 purpose="Choose the venue (manual or GPS); scopes which courses show.",
 body="".join([
   topbar("Choose a location"),
   btn("Use my location (GPS)","wbtn"),
   txt("status message (detecting / error)","muted"),
   box("Location row — marker · venue name · course count · “Current” / chevron","wide sel","row"),
   box("Location row — marker · venue name · course count · chevron","wide","row"),
   box("Location row","wide","row"),
   txt("footer note","muted"),
 ]),
 callouts=[(1,16,50),(2,25,30),(3,37,50),(4,37,86)],
 specs=[
  (1,"“Use my location”","GPS-detect button (only if geolocation is available)","disabled + progress label while locating","—","a location/GPS icon + button surface"),
  (2,"Status message","Detect feedback","appears on progress / error","(error emphasis)","—"),
  (3,"Location row","One per venue → selects it","selected vs unselected","per-location accent tints the marker chip","a location marker + row surface"),
  (4,"Trailing marker","Row right edge","“Current” label (selected) or forward chevron","per-location accent","a chevron icon"),
 ]),

# ============================================================ 3. COURSE PICKER
screen(id="pick", name="Course Picker", route="/new",
 purpose="Pick which course at the current location to score.",
 body="".join([
   topbar("Pick a course"),
   box("Location switcher — pin · venue · Change","wide","row"),
   box("Course row — marker · name · “holes · par” · chevron","wide","row"),
   box("Course row","wide","row"), box("Course row","wide","row"), box("Course row","wide","row"),
 ]),
 callouts=[(1,15,50),(2,27,20),(3,27,50),(4,27,86)],
 specs=[
  (1,"Location switcher","Row → Location Picker (returns here)","tappable","row surface","a pin marker + row surface"),
  (2,"Course marker","Left of each course","—","tinted from the course accent","the course marker icon"),
  (3,"Course row","Tap → Player Setup","tappable; empty state when no courses","—","row surface"),
  (4,"Chevron","Row right edge","—","muted","a forward chevron"),
 ]),

# ============================================================ 4. PLAYER SETUP
screen(id="setup", name="Player Setup", route="/new/setup",
 purpose="Choose player count (1–4) and enter three-character arcade tags, then start.",
 body="".join([
   topbar("Course name"),
   txt("label: Players"),
   row(box("1","seg"),box("2","seg on"),box("3","seg"),box("4","seg"), cls="segs"),
   txt("label: Tags (3 chars, arcade style)"),
   row(icon("1"), box("tag input","inp wide")),
   row(icon("2"), box("tag input — error","inp wide err")),
   txt("inline error message","muted"),
   btn("Start round","primary"),
 ]),
 callouts=[(1,20,50),(2,37,60),(3,49,72),(4,64,50)],
 specs=[
  (1,"Player-count selector","1–4 buttons","selected vs unselected","—","selected/unselected states"),
  (2,"Tag input","Arcade text field, one per player","empty (placeholder) / filled / invalid","an arcade/mono type role","field surface; the arcade type face"),
  (3,"Invalid-tag state","On a bad tag","red border + inline error","(error emphasis)","error treatment"),
  (4,"Start round","Primary CTA → play","disabled until the roster is valid; busy label while starting","--accent","the primary button surface"),
 ]),

# ============================================================ 5. COURSE MAP
screen(id="map", name="Course Map", route="/courses/:id/map", tint=True,
 purpose="Opening course screen — the map, and a large “tap to begin” target that starts the round.",
 body="".join([
   topbar("Course name"),
   img("Course map illustration  (whole panel is one tap target → setup)"),
   txt("“TAP ANYWHERE TO BEGIN”  ·  holes · course name","center"),
 ]),
 callouts=[(1,38,50),(2,80,50)],
 specs=[
  (1,"Course map","Full-bleed map; the whole panel starts the round","tappable","the screen washes toward the course color","a top-down hole map per course (or a fallback panel with the course marker); keep center/edges calm for the overlay"),
  (2,"“Tap to begin” prompt","Overlay call-to-action","pulses","—","must stay legible over the map art in both light and dark"),
 ]),

# ============================================================ 6. SCORECARD
screen(id="play", name="Scorecard (play screen)", route="/play/:clientId", tint=True,
 purpose="The core loop — score one hole at a time for every player; each edit persists instantly.",
 body="".join([
   f'<div class="wf-top"><span class="wf-ttl2">Course</span><span class="wf-sp"></span>{icon()}{icon()}<span class="wf-mini">Holes</span>{icon()}{icon()}</div>',
   txt("HOLE n  ·  hole name","center"),
   f'<div class="wf-centered">{box("par","med")}</div>',
   row(box("tag","tagb"), box("−","key"), box("score well","well"), box("+","key"), cls="prow"),
   row(box("tag","tagb"), box("−","key"), box("score well","well"), box("+","key"), cls="prow"),
   row(btn("‹ Prev","ghost sm"), btn("Next › / Finish","ghost sm"), cls="nav"),
   txt("stroke-cap footer","muted"),
 ]),
 callouts=[(1,6,78),(2,16,50),(3,25,50),(4,34,14),(5,34,45),(6,34,64),(7,46,50)],
 specs=[
  (1,"TopBar shortcuts","Scavenger hunt · Challenge spinner · “Holes” toggle","the Holes toggle reveals a hole-jump grid","—","a hunt icon + a spinner icon"),
  (2,"Hole header / hole-jump grid","Hole title; toggled grid of hole keys","current / done / unplayed key states","--accent marks the current hole","the three key states"),
  (3,"Par medallion","Par read-out disc","—","par numeral in the course ink","the disc surface"),
  (4,"Player tag","Player identity chip on each row","empty shows a placeholder","--tag-accent","the tag surface (contrast-checked on any accent)"),
  (5,"Score well","Recessed score read-out","reacts to each stroke edit; empty when unscored","—","the recessed-well surface"),
  (6,"± stepper keys","Add / remove a stroke","press feedback; disabled at floor and at the stroke cap","—","the key surface + the + / − marks"),
  (7,"Hole navigation","Prev / Next — or Finish on the last hole","disabled until the hole/round is complete; Finish is the completion action","--accent on Finish","ghost + primary surfaces"),
 ]),

# ============================================================ 7. SUMMARY
screen(id="sum", name="Summary (final scorecard)", route="/play/:clientId/summary", tint=True,
 purpose="Celebrates the winner, shows standings + hole-by-hole grid, syncs to the leaderboard.",
 body="".join([
   topbar("Final scorecard", right_icons=0),
   box("Winner hero — trophy · “Winner” · winner tag · total / over-under","wide tall","card"),
   box("Standings row — rank · tag · total","wide","row"),
   box("Nine-grid table — Front/Back · par row · per-player score cells","wide","tbl"),
   txt("sync status line","muted"),
   row(btn("View leaderboard","ghost sm"), btn("Done","primary sm"), cls="nav"),
 ]),
 callouts=[(1,20,50),(2,37,50),(3,50,50),(4,63,50),(5,72,50)],
 specs=[
  (1,"Winner hero","Celebration card","enters with a celebratory motion; a “tied” variant","--glow accent; winner tag in course ink","a trophy/celebration mark + the hero surface"),
  (2,"Standings row","One per non-winner","staggered entrance","rank + arcade tag in course ink","the row surface"),
  (3,"Nine-grid table","Hole-by-hole scores, Front & Back","cells signal under / over / at par; empty cell","--score-under / --score-over","the table surface + the score-signal colors"),
  (4,"Sync note","Leaderboard save status","synced / failed / saving / offline","(failure emphasis)","a confirmation tick"),
  (5,"Action buttons","View leaderboard (secondary) · Done (primary)","—","--accent","ghost + primary surfaces"),
 ]),

# ============================================================ 8. RULES
screen(id="rules", name="Rules", route="/rules",
 purpose="Static, offline general rules + optional per-course notes. Read-only.",
 body="".join([
   topbar("Rules"),
   txt("heading: GENERAL","eyebrow"),
   row(icon("1"), box("rule text","line")), row(icon("2"), box("rule text","line")),
   row(icon("3"), box("rule text","line")),
   txt("heading: COURSE NOTES","eyebrow"),
   box("Course-note card — marker · course name · bulleted notes","wide tall","card"),
 ]),
 callouts=[(1,17,26),(2,28,55),(3,60,50)],
 specs=[
  (1,"Section heading","“General” / “Course notes”","—","muted","—"),
  (2,"Numbered rule list","General rules","—","—","list-number treatment"),
  (3,"Course-note card","One tinted card per course","—","washes toward the course accent; name + marker + bullets in course ink","the card surface + the course marker"),
 ]),

# ============================================================ 9. INSTALL
screen(id="install", name="Install", route="/install",
 purpose="PWA install landing (QR-code target); shows the right path per platform.",
 body="".join([
   topbar("Install the app"),
   f'<div class="wf-hero">{icon("hero")}</div>',
   txt("“Add Mini Golf to your phone”","center"),
   box("Branch card — Installed / iOS steps / Can-prompt / Generic","wide xtall","card"),
   txt("platform warning box","muted"),
 ]),
 callouts=[(1,15,50),(2,28,50),(3,52,50)],
 specs=[
  (1,"Hero","Brand mark + heading","—","—","the brand mark"),
  (2,"Branch card","One of four states: already-installed (with an Open button), iOS steps, native-prompt button, or generic steps","platform-dependent; a dismissed-prompt retry hint","—","the card surface"),
  (3,"Numbered step + warning","Instruction steps and a caveat box","—","—","step-number badges + the small platform glyphs referenced (Share / add-to-home / browser-menu)"),
 ]),

# ============================================================ 10. TV LEADERBOARD
screen(id="tv", name="TV Leaderboard", route="/tv",
 purpose="Live high-score board (polls periodically); highlights the just-played round on arrival.",
 body="".join([
   topbar("Leaderboard", right_icons=0),
   row(box("Day","seg on"),box("Week","seg"),box("Month","seg"),box("All","seg"), cls="segs"),
   box("Standings row (mine) — rank · tag · course · “You” · total","wide hl","row"),
   box("Standings row — rank · tag · course · total","wide","row"),
   box("Standings row","wide","row"),
 ]),
 callouts=[(1,16,50),(2,29,18),(3,29,66),(4,41,50)],
 specs=[
  (1,"Period tabs","Day / Week / Month / All","active vs inactive","—","tab states"),
  (2,"Rank / tag","Row identity","—","tag in course ink","the arcade type face"),
  (3,"“You” pill + row highlight","Marks your rows","only on your rows","a highlight/ring accent","the pill + row-highlight treatment"),
  (4,"Standings row","One per score","entrance stagger; error / empty / loading states","—","the row surface"),
 ]),

# ============================================================ 11. HUNT
screen(id="hunt", name="Scavenger Hunt", route="/hunt",
 purpose="Snap-a-photo hunt; a vision model verifies each find. Gated on an in-progress round.",
 body="".join([
   topbar("Scavenger hunt"),
   row(txt("Playing as","inline"), box("tag","tagb sel"), box("tag","tagb dim"), cls="playas"),
   row(box("item — title · hint · count/✓","item"), btn("Snap","snap"), cls="itemrow"),
   row(box("item","item"), btn("Snap","snap"), cls="itemrow"),
   txt("result banner (verified / flagged / rejected)","muted"),
 ]),
 callouts=[(1,17,44),(2,31,22),(3,31,84),(4,47,50),(5,31,55)],
 specs=[
  (1,"“Playing as” selector","Player chips","selected (ring) vs dimmed","--tag-accent","tag surface + selected-state treatment"),
  (2,"Item hint / count / check","On each item","hint show/hide toggle; ×N count or a found check","—","hint, count, and check icons"),
  (3,"Snap button","Photo capture (opens the camera)","label cycles Snap / Snap another / Checking / Found (locked)","—","a camera icon + button surface"),
  (4,"Result banner","Verify outcome","verified / flagged (photo-of-screen) / rejected; plus a load-error box","(flag/error emphasis)","banner treatments"),
  (5,"Item card","Per find","found vs not-found; a gated empty state when no round is active","—","the card surface"),
 ]),

# ============================================================ 12. ARCADE PUTT
screen(id="putt", name="Arcade Putt", route="/putt",
 purpose="Playable canvas mini-golf — drag-to-aim; 9-hole or endless. Offline.",
 body="".join([
   topbar("Arcade Putt"),
   row(txt("Hole n / 9","inline"), txt("Par · Strokes","inline r"), cls="hud"),
   img("Canvas playfield — drag-to-aim slingshot  (see canvas markers)"),
   txt("hint line","center muted"),
   row(btn("Next hole →","primary sm"), btn("Reset / End run","ghost sm"), cls="nav"),
 ]),
 callouts=[(1,16,50),(2,40,50),(3,72,50)],
 specs=[
  (1,"Status header","Hole / par / strokes","course vs endless mode; a mode-picker precedes play","—","—"),
  (2,"Canvas playfield","The game (aim by dragging)","aim / rolling / splash / sunk phases","aim-power color ramp","playfield background + all sprites (ball, cup + flag, bumpers, greens, hazards, splash) and the aim/power markers — drawn into the canvas"),
  (3,"Play buttons","Next / See scorecard (primary) · Reset / End run (secondary)","mode-dependent","--accent","primary + ghost surfaces; a per-hole result set on the summary"),
 ]),

# ============================================================ 13. FUN ZONE HUB
screen(id="fun", name="Fun Zone hub", route="/fun",
 purpose="Grid landing routing to every mini-game. Each tile = an icon + title.",
 body="".join([
   topbar("While You Wait"),
   row(*[box("game tile — icon · title","ftile") for _ in range(6)], cls="ftiles"),
 ]),
 callouts=[(1,22,22),(2,22,50)],
 specs=[
  (1,"Activity tile","One per game → its route (11 games)","entrance stagger; press feedback","accent-tinted per tile","the tile surface"),
  (2,"Activity icon","Leading mark on each tile","—","tinted to the tile accent","one designed icon per activity (11 total)"),
 ]),

# ============================================================ 14. MINIGAME SHELL
screen(id="game", name="Minigame shell (covers the 8 canvas games)",
 route="/fun/skeeball · /fun/bowling · /fun/karts · /fun/airhockey · /fun/bumper · /fun/boats · /fun/axe · /fun/batting",
 purpose="Shared shell for every canvas game — HUD row, canvas playfield, hint line, game-over screen.",
 body="".join([
   topbar("Game name"),
   row(txt("count (ball / frame / pitch)","inline"), txt("score / timer","inline r"), cls="hud"),
   img("Canvas playfield — per-game sprites & interaction"),
   txt("hint line","center muted"),
   box("Game-over overlay — result mark · big score · Play again","wide","card"),
 ]),
 callouts=[(1,16,50),(2,40,50),(3,74,50)],
 specs=[
  (1,"HUD counter row","Per-game counters / score / timer","labels vary by game; a timer can signal time pressure","—","—"),
  (2,"Canvas playfield","The game itself","aim / play / result; impact + shake feedback","—","per-game background + sprites (ball, puck, kart, target, pins, axe, bumper) as sprite sheets / SVGs the canvas rasters"),
  (3,"Game-over overlay","Shared result screen","enters with a celebratory motion","--accent on Play again","a result mark per game + the primary button surface"),
 ]),

# ---------------------------------------------------------------- CSS
CSS = r"""
@page { size: Letter; margin: 12mm 12mm 14mm; }
:root{ --ink:#1b2733; --muted:#6b7682; --line:#d9dee3; --line2:#eef1f4; --panel:#f6f8fa;
 --wire:#8a95a1; --wireln:#aeb7c1; --fill:#f0f2f5; --fill2:#e7eaee; --hatch:#dfe3e8; --co:#334155; --accent:#15803d; --accentsoft:#e7f1ec;}
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);font-size:10px;line-height:1.45;
 -webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
h1,h2,h3{margin:0;line-height:1.15}
code{font-family:"SF Mono",ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:9px;color:#0b3d1f}
.page{page-break-after:always} .page:last-child{page-break-after:auto}

/* cover */
.cover{height:246mm;display:flex;flex-direction:column}
.wfmark{width:120px;height:76px;border:2px solid var(--wire);border-radius:12px;position:relative;background:
 repeating-linear-gradient(135deg,transparent,transparent 8px,var(--hatch) 8px,var(--hatch) 9px)}
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
.sp h2 .rt{font-family:"SF Mono",monospace;font-size:9px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 7px;font-weight:700}
.sp h2 .tb{font:700 8px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 6px}
.purpose{color:#333;font-size:10px;margin:2px 0 8px}
.layout{display:flex;gap:18px;align-items:flex-start}
.framewrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px}
.viewcap{font:700 8px/1 "SF Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.specwrap{flex:1}
table{width:100%;border-collapse:collapse;font-size:9px}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel);font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:.03em;color:#334}
td.cn{text-align:center;font-weight:800;color:#fff;width:14px}
td.cn span{display:inline-block;background:var(--co);border-radius:999px;width:14px;height:14px;line-height:14px;font-size:9px}
td b{color:#0b3d1f} .artc{color:#0b3d1f}
tr{break-inside:avoid}

/* device frame + callouts */
.frame{position:relative;width:270px;border:2px solid var(--wire);border-radius:20px;padding:6px;background:#fbfcfd}
.frame .scr{border:1px dashed var(--wireln);border-radius:14px;overflow:hidden;background:#fff;min-height:496px;padding-bottom:8px}
.co{position:absolute;width:16px;height:16px;border-radius:999px;background:var(--co);color:#fff;font:800 9px/16px "Segoe UI",sans-serif;
 text-align:center;box-shadow:0 0 0 2px #fff;transform:translate(-50%,-50%);z-index:5}

/* ---- wireframe element kit (monochrome, schematic) ---- */
.wf-top,.wf-top.nob{display:flex;align-items:center;gap:5px;padding:8px 9px;border-bottom:1px dashed var(--wireln)}
.wf-top.nob{border-bottom:none;justify-content:flex-end}
.wf-ttl,.wf-ttl2{font-weight:800;font-size:11px;color:#334} .wf-ttl2{font-size:11px}
.wf-sp{flex:1}
.wf-mini{font-size:8px;font-weight:700;color:var(--muted);border:1px solid var(--wireln);border-radius:5px;padding:2px 4px}
.wf-icon{min-width:18px;height:18px;padding:0 3px;border:1px solid var(--wireln);border-radius:6px;background:var(--fill);
 display:inline-flex;align-items:center;justify-content:center;font:700 8px/1 "SF Mono",monospace;color:var(--muted)}
.wf-hero{display:flex;justify-content:center;padding:8px 0 2px}
.wf-hero .wf-icon{width:40px;height:40px;border-radius:10px;font-size:9px}
.wf-box{border:1px solid var(--wireln);border-radius:9px;background:var(--fill);margin:6px 9px;padding:8px 9px;position:relative;
 font-size:9px;color:#3b4653;min-height:30px;display:flex;align-items:center}
.wf-box .wf-t{position:absolute;top:-7px;left:8px;font:700 7px/1 "SF Mono",monospace;color:var(--muted);background:#fff;padding:0 3px;text-transform:uppercase;letter-spacing:.05em}
.wf-box.tall{min-height:48px} .wf-box.xtall{min-height:120px} .wf-box.wide{margin:8px 9px}
.wf-box.card{align-items:flex-start} .wf-box.tbl{min-height:52px}
.wf-box.sel,.wf-box.hl{border-style:solid;border-color:var(--wire);background:var(--fill2)}
.wf-box.err{border-color:#e0a; } /* schematic error tint kept subtle */
.wf-box.err{border-color:#c98; }
.wf-row{display:flex;gap:6px;margin:6px 9px;align-items:center}
.wf-row.grid2{display:grid;grid-template-columns:repeat(4,1fr)} .wf-row.grid2 .wf-box{margin:0;justify-content:center;min-height:46px}
.wf-row.segs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px} .wf-row.segs .wf-box{margin:0;justify-content:center;min-height:26px}
.wf-row.prow{display:flex} .wf-row.prow .wf-box{margin:0}
.wf-row.prow .tagb{flex:0 0 42px;justify-content:center} .wf-row.prow .key{flex:0 0 34px;justify-content:center;min-height:34px}
.wf-row.prow .well{flex:1;justify-content:center}
.wf-row.nav{display:flex} .wf-row.nav .wf-btn{margin:0;flex:1}
.wf-row.playas .wf-box{margin:0} .wf-row.itemrow .wf-box.item{flex:1;margin:0} .wf-row.itemrow{align-items:stretch}
.wf-row.hud{justify-content:space-between} .wf-row.ftiles{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.wf-row.ftiles .wf-box{margin:0;min-height:34px}
.wf-box.seg{margin:0} .wf-box.seg.on{background:var(--fill2);border-color:var(--wire);font-weight:800}
.wf-box.med{width:40px;height:40px;border-radius:999px;margin:2px auto 6px;justify-content:center;min-height:0}
.wf-box.tagb{font-family:"SF Mono",monospace;letter-spacing:.1em;font-weight:800}
.wf-box.tagb.sel{border-color:var(--wire);border-width:2px} .wf-box.tagb.dim{opacity:.5}
.wf-box.inp{font-family:"SF Mono",monospace;letter-spacing:.15em}
.wf-box.line{flex:1;min-height:0;padding:5px 8px} .wf-box.snap,.wf-btn.snap{flex:0 0 auto}
.wf-centered{display:flex;justify-content:center}
.wf-btn{border:1px solid var(--wireln);border-radius:10px;background:var(--fill);margin:6px 9px;padding:9px;text-align:center;
 font-weight:700;font-size:9.5px;color:#3b4653;display:flex;align-items:center;justify-content:center}
.wf-btn.primary{border-color:var(--wire);border-width:2px;background:var(--fill2);font-weight:800}
.wf-btn.ghost{}
.wf-btn.wbtn{}
.wf-btn.sm{margin:0;padding:7px}
.wf-btn.snap{margin:0;padding:0 10px;font-size:8.5px}
.wf-img{border:1px solid var(--wireln);border-radius:11px;margin:8px 9px;min-height:210px;display:flex;align-items:center;justify-content:center;
 text-align:center;padding:12px;font-size:9px;color:var(--muted);font-weight:700;
 background:repeating-linear-gradient(135deg,#fbfcfd,#fbfcfd 9px,var(--hatch) 9px,var(--hatch) 10px)}
.wf-txt{margin:5px 9px;font-size:9px;color:#48525d}
.wf-txt.muted{color:var(--muted);font-style:italic}
.wf-txt.center{text-align:center} .wf-txt.eyebrow{font-weight:800;font-size:8px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
.wf-txt.inline{margin:0;font-weight:700} .wf-txt.inline.r{color:var(--muted)}
"""

def render_screen(sc, idx):
    tb = '<span class="tb">course-tinted</span>' if sc.get("tint") else ''
    cos = "".join(f'<div class="co" style="top:{t}%;left:{l}%">{n}</div>' for n,t,l in sc["callouts"])
    frame = f'<div class="frame"><div class="scr">{sc["body"]}</div>{cos}</div>'
    rows = "".join(
      f'<tr><td class="cn"><span>{r[0]}</span></td><td><b>{r[1]}</b></td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td class="artc">{r[5]}</td></tr>'
      for r in sc["specs"])
    return f"""<div class="page sp">
 <h2><span>{idx}. {sc['name']}</span><span class="rt">{sc['route']}</span>{tb}</h2>
 <p class="purpose">{sc['purpose']}</p>
 <div class="layout">
   <div class="framewrap">{frame}<div class="viewcap">wireframe · schematic</div></div>
   <div class="specwrap">
     <table><tr><th>#</th><th>Element</th><th>Role &amp; where</th><th>Interaction / states</th><th>Theming hooks</th><th>Art / assets needed</th></tr>
     {rows}</table>
   </div>
 </div>
</div>"""

cover = """<div class="page cover">
 <div class="wfmark"></div>
 <div class="eyebrow">Mini Golf Scorecard PWA</div>
 <h1>Screen &amp; Element Guide</h1>
 <p class="tag">A structural wireframe of every screen — the element inventory and rough arrangement — with each interface element numbered and spec'd. It tells you <b>what each screen contains and what art each element needs</b>, so nothing is missed when you theme the app.</p>
 <div style="margin-top:16px">
  <span class="chip">14 screens</span><span class="chip">Wireframe layout</span><span class="chip">Numbered callouts</span><span class="chip">Per-element specs</span>
 </div>
 <div class="note"><b>These wireframes are not the design.</b> They show structure only — no colors, type, icons, or materials are implied, and the current app art is <b>not</b> a reference to match (much of it is placeholder and wrong). Boxes and positions are schematic and <b>not prescriptive</b>: treat sizes and arrangement as approximate. You define the actual look; mark up anything here that's wrong.</div>
 <div class="how">
  <h3>How to read each page</h3>
  <ol>
   <li>The <b>wireframe</b> is a labeled skeleton of one screen — every element as a plain box saying what it is and roughly where it sits.</li>
   <li>Numbered <b>callouts</b> map to the <b>spec table</b>: each element's role, its interaction/states, the <b>theming hooks</b> it keys to (accent / course-color variables), and the <b>art it needs</b>.</li>
   <li><b>Light &amp; dark:</b> the app has no fixed default — it follows the device's setting. Design every element for <b>both</b>, clearing contrast on each (≥4.5:1 text / ≥3:1 large &amp; UI).</li>
   <li><b>Constraints to honor:</b> comfortable tap targets (≥~44px hit area), device safe areas (notch / home indicator), and those contrast minimums. Everything else — sizes, radii, type, materials, icons — is yours to define.</li>
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
