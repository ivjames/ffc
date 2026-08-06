# -*- coding: utf-8 -*-
"""public/docs/screens.html — the TO-SCALE contact sheet (the overlay/trace layer).

Every screen is drawn as a real 390px-wide phone artboard where each element is
rendered at its TRUE measured size, radius, padding, spacing, and grid — so the
picture IS the measurement. On screen the boards are true 390px: open the app at
a 390px width (or a phone screenshot scaled to 390px), lay it over the matching
board, and design the art directly on top — the fixed dimensions register 1:1.
Text strings are placeholders (real names/tags/counts vary at runtime) and a few
genuinely dynamic widths can't be pixel-pinned, but every fixed dimension is exact.

Reference device: 390 x 844 CSS px. Fixed element dimensions are absolute (they
don't change with device width); full-width elements span the 390px device.

This owns ONLY screens.html/screens.pdf. The full Screen & Element Guide
(style-guide.html/pdf — schematic wireframes + numbered spec tables) is built
separately by build-style-guide.py and is intentionally left as-is. Output lands
in public/docs/ so the built app serves it at /docs/screens.html; the companion
screens.pdf is printed from this HTML.
"""

import os
import re
# Resolve output relative to this script (repo_root/public/docs), so it works in
# any checkout — not just the author's workspace.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT2 = os.path.join(_ROOT, "public", "docs", "screens.html")
SCREENS = []
def screen(**kw): SCREENS.append(kw)

# ————————————————————————————————————————————————————————————————————————————
# To-scale artboard kit. Every helper emits real app pixels. A callout number
# `n` renders a badge anchored ON the element (so the spec table's numbers point
# at the actual drawn box). Reference device = 390px wide; content padding 16px
# ⇒ inner width 358px.
# ————————————————————————————————————————————————————————————————————————————
INNER = 358

def cn(n): return f'<i class="cn">{n}</i>' if n is not None else ''

def _s(d):  # dict → inline style
    return ";".join(f"{k}:{v}" for k, v in d.items())

def el(inner="", *, cls="", n=None, mt=0, **st):
    """A positioned box. Pass real px via keywords (w,h,r,pad,…) → inline style."""
    m = {}
    if "w" in st: m["width"] = f'{st.pop("w")}px'
    if "h" in st: m["height"] = f'{st.pop("h")}px'
    if "r" in st: m["border-radius"] = f'{st.pop("r")}px'
    if "pad" in st: m["padding"] = st.pop("pad")
    if "grow" in st and st.pop("grow"): m["flex"] = "1"
    if "flexnone" in st and st.pop("flexnone"): m["flex"] = "none"
    if mt: m["margin-top"] = f"{mt}px"
    m["position"] = "relative"
    for k, v in st.items():  # any extra raw css (dashed keys as k_v)
        m[k.replace("_", "-")] = v
    return f'<div class="{cls}" style="{_s(m)}">{cn(n)}{inner}</div>'

def sp(t, size=14, w=600, color="var(--ink)", ls=""):
    extra = f";letter-spacing:{ls}" if ls else ""
    return f'<span style="font-size:{size}px;font-weight:{w};color:{color}{extra}">{t}</span>'

def lab(t, size=11):  # muted micro-label used inside boxes
    return f'<span style="font-size:{size}px;color:var(--mut)">{t}</span>'

def bar(title, back=True, right=""):
    left = '<div class="key40">‹</div>' if back else '<div style="width:2px"></div>'
    ctrls = '<div class="ctrls"><div class="pill"></div><div class="pill"></div></div>'
    return f'<div class="bar">{left}<div class="title">{title}</div>{right}{ctrls}</div>'

def content(inner):
    return f'<div class="pad">{inner}</div>'

def btn(label, primary=False, n=None, mt=8, h=52):
    fill = "var(--f2)" if primary else "var(--f1)"
    bd = "1px solid var(--ln)" if primary else "1px solid var(--ln2)"
    return el(sp(label, 16, 700), cls="ctr", n=n, mt=mt, h=h, r=16,
              background=fill, border=bd)

def tag(label="ABC", sel=False, dim=False, size=18, h=30):
    bd = "2px solid var(--ln)" if sel else "1px solid var(--ln)"
    op = "opacity:.5;" if dim else ""
    return (f'<span style="position:relative;display:inline-flex;align-items:center;'
            f'height:{h}px;padding:0 10px;border-radius:8px;border:{bd};'
            f'background:var(--f2);font-family:ui-monospace,monospace;font-weight:700;'
            f'letter-spacing:.1em;font-size:{size}px;color:var(--ink);{op}">{label}</span>')

def dev(inner, fill=False, tint=False):
    cls = "dv" + (" tint" if tint else "")
    return f'<div class="{cls}">{inner}</div>'

# ════════════════════════════════════════════════════════════ 1. HOME
_home_tiles = "".join(
    el(el("", cls="puck", w=56, h=56) +
       f'<div style="margin-top:10px">{lab("Course", 12)}</div>',
       cls="tile col", n=(5 if i == 0 else None), r=24, pad="16px 12px")
    for i in range(4))
screen(id="home", name="Home", route="/",
 purpose="Landing hub — pick a course, resume a round, reach maps / rules / leaderboard / install.",
 body=dev(content(
   el('<div class="pill"></div><div class="pill"></div>', cls="rowend", n=1, gap="6px") +
   el(sp("⛳", 48) + f'<div style="margin-top:6px">{sp("Mini Golf",30,900)}</div>' +
      f'<div style="margin-top:2px">{lab("4 courses · eighteen holes each",14)}</div>',
      cls="col", n=2, mt=4, border="none", background="none") +
   el(lab("📍  Location · venue name",13) + f'<span style="margin-left:auto">{lab("Change",13)}</span>',
      cls="s1 rowc", n=3, mt=16, h=52, r=16, pad="0 16px") +
   el(f'{lab("RESUME ROUND",11)}<div style="margin-top:6px;display:flex;align-items:center">'
      f'{sp("Course name",18,700)}<span style="margin-left:auto;display:flex;gap:4px">{tag("AVA",size=14,h=26)}{tag("JZ",size=14,h=26)}</span></div>',
      cls="s1", n=4, mt=12, r=16, pad="14px", border="1px solid var(--ln)") +
   el(_home_tiles, cls="grid2", mt=12) +
   el(sp("🎡  While You Wait",16,700), cls="ctr jc-start", n=6, mt=12, h=52, r=16, pad="0 16px",
      background="var(--f1)", border="1px solid var(--ln2)") +
   btn("Rules") + btn("See the leaderboard") + btn("📲  Install app")
 )),
 specs=[
  (1,"Header control pills","Top-right of Home (no TopBar) — light/dark + mute","two 36×36 circle pills, gap 6","two independent toggles; each shows the state it switches to","own pill surface; glyph","pill background + a mode icon pair + a sound icon pair"),
  (2,"Hero mark","Brand identity, top of Home","glyph ~48px + 30px title","animates on arrival (wiggle)","—","the brand hero mark"),
  (3,"Location bar","Row → Location Picker","full-width row, 52 tall, radius 16","tappable; shows current venue","row surface","a location/pin marker + the row surface"),
  (4,"Resume-round card","CTA → resume the in-progress round","full-width, radius 16, pad 14","only present when a round is live; standing glow","--glow = course accent","card surface + the standing-glow treatment"),
  (5,"Course tiles","Grid → each course's map screen","2-col grid (gap 8), scales to the location's count (2–4); tile radius 24; domed puck 56×56, glyph ~30px","tappable; staggered pop-in entrance","--tile-accent / --puck-accent per course","tile surface + a course marker/crest per course (the puck)"),
  (6,"Secondary menu","Ghost-button stack → While You Wait / Rules / Leaderboard / Install","full-width rows, 52 tall, radius 16","Install hidden when already installed. (Scavenger hunt is NOT here — it lives on the in-round bar)","—","ghost surface + a leading icon per row"),
 ]),

# ════════════════════════════════════════════════════════════ 2. LOCATIONS
def _locrow(sel=False, n=None):
    trail = sp("Current",14,600,"var(--mut)") if sel else sp("›",20,400,"var(--mut)")
    bd = "1px solid var(--ln)" if sel else "1px solid var(--ln2)"
    return el(el(lab("📍",18), cls="chip", w=48, h=48, r=12) +
              el(sp("Venue name",18,700) + f'<div>{lab("N courses",14)}</div>', cls="col ai-start", grow=True, border="none", background="none", margin_left="16px") +
              f'<span style="margin-left:8px">{trail}</span>',
              cls="s1 rowc", n=n, r=16, pad="16px", border=bd, mt=(0 if n==3 else 12))
screen(id="loc", name="Location Picker", route="/locations",
 purpose="Choose the venue (manual or GPS); scopes which courses show.",
 body=dev(bar("Choose a location") + content(
   el(sp("🧭  Use my location",14,600), cls="ctr", n=1, h=44, r=12, pad="0 16px", background="var(--f1)", border="1px solid var(--ln2)") +
   el(lab("status message (detecting / error)",14), cls="", n=2, mt=16, border="none") +
   el(_locrow(sel=True, n=3) + _locrow(n=4) + _locrow(), cls="", mt=16, border="none") +
   el(lab("Placeholder sites — the client's real locations swap in here.",12), mt=16, border="none")
 )),
 specs=[
  (1,"“Use my location”","GPS-detect button (only if geolocation is available)","full-width, radius 12, 44 tall","disabled + progress label while locating","—","a GPS/location icon (currently a 🧭 placeholder) + button surface"),
  (2,"Status message","Detect feedback","text","appears on progress / error","(error emphasis)","—"),
  (3,"Location row","One per venue → selects it (3 venues today)","full-width row, radius 16, pad 16; marker chip 48×48","selected vs unselected","per-location accent tints the marker chip","a location marker + row surface"),
  (4,"Trailing marker","Row right edge","“Current” label (14px) when selected, else a › chevron (~20px)","“Current” (selected) or forward chevron","per-location accent","a chevron icon"),
 ]),

# ════════════════════════════════════════════════════════════ 3. COURSE PICKER
def _courserow(n=None, first=False):
    return el(el(lab("◇",20), cls="chip", w=48, h=48, r=12, n=(2 if first else None)) +
              el(sp("Course name",18,700) + f'<div>{lab("18 holes · par 50",14)}</div>', cls="col ai-start", grow=True, border="none", background="none", margin_left="16px", n=(3 if first else None)) +
              f'<span style="margin-left:8px">{sp("›",20,400,"var(--mut)")}</span>',
              cls="s1 rowc", r=16, pad="16px", mt=(0 if first else 12))
screen(id="pick", name="Course Picker", route="/new",
 purpose="Pick which course at the current location to score.",
 body=dev(bar("Pick a course") + content(
   el(lab("📍  venue name",14) + f'<span style="margin-left:auto">{lab("Change",14)}</span>', cls="s1 rowc", n=1, h=44, r=16, pad="0 16px") +
   el(_courserow(first=True) + _courserow() + _courserow() + _courserow(), cls="", mt=12, border="none")
 )),
 specs=[
  (1,"Location switcher","Row → Location Picker (returns here)","full-width, radius 16","tappable","row surface","a pin marker + row surface"),
  (2,"Course marker","Left of each course row","48×48 rounded square, radius 12","—","tinted from the course accent","the course marker icon (currently the theme emoji)"),
  (3,"Course row","Tap → Player Setup","full-width row, radius 16; subtitle “N holes · par N”","tappable; scales to the location's course count; empty state when no courses","—","row surface"),
  (4,"Chevron","Row right edge","~20px","—","muted","a forward chevron"),
 ]),

# ════════════════════════════════════════════════════════════ 4. PLAYER SETUP
def _seg(nn, on=False, n=None):
    return el(sp(nn,18,700), cls="ctr", n=n, h=44, r=12, grow=True,
              background=("var(--f2)" if on else "var(--f1)"),
              border=("1px solid var(--ln)"))
def _tagrow(i, err=False, n=None):
    bd = "1px solid #c98" if err else "1px solid var(--ln2)"
    return el(f'<span style="width:24px;text-align:right;font-family:monospace;font-size:14px;color:var(--mut)">{i}</span>' +
              el(sp("ABC",24,700,"var(--mut)",ls=".12em"), cls="ctr", n=n, w=128, h=44, r=12, background="var(--f2)", border=bd, margin_left="12px", box_shadow="inset 0 2px 3px rgba(0,0,0,.07)"),
              cls="rowc", mt=(0 if i==1 else 12), border="none")
screen(id="setup", name="Player Setup", route="/new/setup",
 purpose="Choose player count (1–4) and enter three-character arcade tags, then start.",
 body=dev(bar("Course name") + content(
   el(lab("Players",14), border="none") +
   el(_seg("1",n=1)+_seg("2",on=True)+_seg("3")+_seg("4"), cls="rowc", mt=8, gap="8px", border="none") +
   el(lab("Tags (3 letters/numbers, arcade)",14), mt=20, border="none") +
   el(_tagrow(1,n=2)+_tagrow(2,err=True,n=3)+
      el(lab("inline error message",13), mt=6, border="none")+
      _tagrow(3)+_tagrow(4), cls="", mt=8, border="none") +
   btn("Start round", primary=True, n=4, mt=24)
 )),
 scales=True,
 specs=[
  (1,"Player-count selector","1–4 buttons","4-col grid, radius 12, 44 tall","selected = candy accent key, unselected = neutral key (default 2)","--accent (selected key)","the selected/unselected key states"),
  (2,"Tag input","Arcade text field — one row per player (1–4)","recessed well, 128px wide × 44 tall, radius 12; centered 24px uppercase","empty (placeholder “ABC”) / filled / invalid; row count = selected players","the recessed-well (surface-sunk) surface; the arcade type face","the carved-well surface; the arcade type face"),
  (3,"Invalid-tag state","On a bad tag","—","red border + inline error once 3 chars are entered","(error emphasis)","error treatment"),
  (4,"Start round","Primary CTA → play","full-width, 52 tall, radius 16","disabled until roster valid; busy label while starting","--accent","the primary button surface"),
 ]),

# ════════════════════════════════════════════════════════════ 5. COURSE MAP (fills)
screen(id="map", name="Course Map", route="/courses/:id/map", tint=True, fill=True,
 purpose="Opening course screen — the map fills the screen below the bar; tapping it starts the round.",
 body=dev(bar("Course name") +
   el(el(lab("Full-bleed tap target → setup. Today a themed-emoji placeholder (~72px) on an accent-tinted fill — no per-course map art yet.",12), cls="ctr", grow=True, border="none", background="none", pad="0 24px") +
      el(f'<div style="text-align:center">{sp("TAP ANYWHERE TO BEGIN",16,900)}<div style="margin-top:4px">{lab("18 holes · course",13)}</div></div>', cls="scrim", pad="0 16px 28px"),
      cls="fill", n=1, grow=True),
   fill=True),
 specs=[
  (1,"Course map","Full-bleed panel; the whole panel starts the round","fills the device below the bar (390px wide × remaining height)","tappable; today renders the themed-emoji placeholder (map asset not populated); a pulsing “tap to begin” prompt sits over a bottom scrim","the screen washes toward the course color","a top-down hole map per course (replacing the emoji placeholder); keep center/edges calm so the overlay prompt stays legible, in both light and dark"),
 ]),

# ════════════════════════════════════════════════════════════ 6. SCORECARD
def _jumpcell(state, i):
    bg = {"cur":"var(--f2)","done":"var(--f1)","todo":"#fff"}[state]
    bd = "1px solid var(--ln)" if state!="todo" else "1px dashed var(--ln2)"
    return el(sp(str(i),13,700,"var(--mut)"), cls="ctr", h=30, r=12, grow=True, background=bg, border=bd)
def _playerrow(badges=False, mt=12):
    return el(el(tag("AVA",size=16,h=36), cls="", n=(4 if badges else None), border="none", background="none") +
              el(sp("−",22,700,"var(--mut)"), cls="keycap ctr", w=36, h=36, r=8, margin_left="10px") +
              el(sp("–",26,900), cls="sunk ctr", n=(5 if badges else None), grow=True, h=36, r=8, margin_left="10px") +
              el(sp("+",22,700,"var(--mut)"), cls="keycap ctr", n=(6 if badges else None), w=36, h=36, r=8, margin_left="10px"),
              cls="rowc", mt=mt, border="none")
screen(id="play", name="Scorecard (play screen)", route="/play/:clientId", tint=True,
 purpose="The core loop — score one hole at a time for every player; each edit persists instantly.",
 body=dev(
   f'<div class="bar"><div class="key40">‹</div><div class="title">Course</div>'
   f'<div class="ctrls" style="position:relative">{cn(1)}<div class="pill" style="border-radius:8px"></div><div class="pill" style="border-radius:8px"></div>'
   f'<div style="height:28px;padding:0 8px;border:1px solid var(--ln2);border-radius:8px;display:flex;align-items:center;font-size:12px;color:var(--mut)">Holes</div>'
   f'<div class="pill"></div><div class="pill"></div></div></div>' +
   content(
   el("".join(_jumpcell("done" if i<2 else "cur" if i==2 else "todo", i+1) for i in range(6)), cls="rowc", n=2, gap="8px", border="none") +
   el(el(f'{lab("HOLE 4",11)}<div>{sp("hole name",24,900)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
      el(f'<div style="text-align:center">{lab("Par",11)}</div>' + el(sp("3",24,900,"var(--mut)"), cls="s1 ctr", n=3, w=48, h=48, r=999), cls="col", border="none", background="none"),
      cls="rowc ai-end", mt=14, border="none") +
   el(_playerrow(badges=True, mt=14)+_playerrow(mt=12)+_playerrow(mt=12)+_playerrow(mt=12), cls="", border="none") +
   el(btn("‹ Prev", mt=0) + f'<span style="width:12px"></span>' + btn("Next › / Finish", primary=True, n=7, mt=0), cls="rowc", mt=24, border="none") +
   el(lab("Max 6 strokes per hole",12), mt=16, border="none")
 )),
 specs=[
  (1,"TopBar shortcuts","Scavenger hunt · Challenge spinner · “Holes” toggle","glyphs ~18px; back key 40×40","the Holes toggle reveals a hole-jump grid","—","a hunt icon + a spinner icon"),
  (2,"Hole-jump grid","Toggled grid of hole keys","6-col; cells ~30 tall, radius 12","current / done / unplayed key states","--accent marks the current hole","the three key states"),
  (3,"Par medallion","Par read-out disc, right of the hole title","48×48 circle","—","par numeral in the course ink (accentInk)","the disc surface"),
  (4,"Player tag","Player identity chip on each row","radius 8 pill; text ~18px","empty shows a placeholder","--tag-accent","the tag surface (contrast-checked on any accent)"),
  (5,"Score well","Recessed score read-out (one per player)","flex-1, 36 tall, radius 8","punches on each stroke edit; shows “–” when unscored","—","the recessed-well (surface-sunk) surface"),
  (6,"± stepper keys","Add / remove a stroke","36×36, radius 8","press feedback; − disabled at 1, + disabled at the stroke cap (6)","—","the key surface + the + / − marks"),
  (7,"Hole navigation","Prev / Next — or Finish on the last hole","full-width, 52 tall","disabled until the hole/round is complete","--accent on Finish","ghost + primary surfaces"),
 ]),

# ════════════════════════════════════════════════════════════ 7. SUMMARY
def _standing(n=None, mt=8):
    return el(f'<span style="width:56px;text-align:center;font-family:monospace;font-size:24px;font-weight:900;color:var(--mut)">2</span>' +
              el(tag("JZ",size=20,h=28), cls="ctr", grow=True, border="none", background="none") +
              f'<span style="text-align:right">{sp("45",20,900)} {lab("E",13)}</span>',
              cls="s1 rowc", n=n, r=16, pad="12px 20px", mt=mt)
def _ninegrid(label, n=None, mt=8):
    head = "".join(f'<td>{lab(str(i),10)}</td>' for i in range(1,6))
    par  = "".join(f'<td>{lab(str(p),10)}</td>' for p in [3,2,4,3,3])
    sc   = "".join(f'<td>{sp(str(v),12,600,"var(--mut)")}</td>' for v in [2,2,6,3,"·"])
    return el(f'<table class="ng"><tr><th style="text-align:left">{lab(label,11)}</th>{head}</tr>'
              f'<tr><th style="text-align:left">{lab("Par",10)}</th>{par}</tr>'
              f'<tr><th style="text-align:left">{lab("AVA",11)}</th>{sc}</tr></table>',
              cls="s1", n=n, r=16, mt=mt, pad="0", overflow="hidden")
screen(id="sum", name="Summary (final scorecard)", route="/play/:clientId/summary", tint=True,
 purpose="Celebrates the winner, shows standings + hole-by-hole grid, syncs to the leaderboard.",
 body=dev(bar("Final scorecard") + content(
   el(f'<div style="text-align:center">{lab("course name · “Par N”",13)}</div>', border="none") +
   el(el(sp("🏆",44), cls="ctr", w=56, border="none", background="none") +
      el(f'<div style="text-align:center">{lab("WINNER / TIED",11)}<div style="margin-top:2px">{sp("AVA",30,900,"var(--mut)")}</div></div>', cls="ctr", grow=True, border="none", background="none") +
      f'<span style="text-align:right">{sp("41",24,900)} {lab("−4",13)}</span>',
      cls="s1 rowc", n=1, mt=8, r=24, pad="20px") +
   el(_standing(n=2, mt=0) + _standing(mt=8), cls="", mt=16, border="none") +
   el(_ninegrid("Front (1–9)", n=3, mt=0) + _ninegrid("Back (10–18)", mt=8), cls="", mt=16, border="none") +
   el(lab("sync status line ✓",12), n=4, mt=16, border="none") +
   el(btn("🏆 View leaderboard", mt=0) + '<span style="width:12px"></span>' + btn("Done", primary=True, n=5, mt=0), cls="rowc", mt=12, border="none")
 )),
 specs=[
  (1,"Winner hero","Celebration card","full-width card, radius 24, pad 20; 56px trophy column (48px glyph) + a 192px accent spotlight","pop-in + looping glow; a “Tied for the win” variant","--glow accent; winner tag(s) in course ink (accentInk)","a trophy/celebration mark + the hero surface"),
  (2,"Standings row","One per non-winner (up to 3, for 4 players total)","full-width, radius 16; 56px rank column","staggered rise-in entrance","mono rank + arcade tag in course ink (accentInk)","the row surface"),
  (3,"Nine-grid tables","Hole-by-hole scores — separate Front (1–9) & Back (10–18) tables","two full-width tables, radius 16; 56px label column + 9 hole columns","cells signal under / over / at par; “·” for an unentered hole","--score-under / --score-over","the table surface + the score-signal colors"),
  (4,"Sync note","Leaderboard save status","text","synced / failed / saving / offline","(failure emphasis)","a confirmation tick"),
  (5,"Action buttons","View leaderboard (secondary) · Done (primary)","full-width","—","--accent","ghost + primary surfaces"),
 ]),

# ════════════════════════════════════════════════════════════ 8. RULES
def _rule(i, txt="rule text", n=None, mt=12):
    return el(f'<span style="width:20px;font-family:monospace;font-size:14px;color:var(--mut)">{i}.</span>' +
              el(lab(txt,14), cls="s1", grow=True, h=30, r=8, pad="0 10px", margin_left="12px", n=n),
              cls="rowc", mt=mt, border="none")
screen(id="rules", name="Rules", route="/rules",
 purpose="Static, offline general rules + optional per-course notes. Read-only.",
 body=dev(bar("Rules") + content(
   el(f'<span style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">General</span>', n=1, border="none") +
   el(_rule(1,mt=8)+_rule(2,n=2)+_rule(3,"“Max 6 strokes per hole”")+_rule(4)+
      el(lab("…6 general rules total",12), mt=8, border="none", pad="0 0 0 32px"), cls="", border="none") +
   el(f'<span style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">Course notes</span>', mt=24, border="none") +
   el(f'{lab("◇  Course name",18)}'
      f'<div style="margin-top:8px">{lab("•  course note",14)}</div>'
      f'<div style="margin-top:4px">{lab("•  course note",14)}</div>'
      f'<div style="margin-top:4px">{lab("•  course note",14)}</div>',
      cls="s1 tint", n=3, mt=12, r=16, pad="16px")
 )),
 specs=[
  (1,"Section heading","“General” / “Course notes”","text eyebrow","—","muted","—"),
  (2,"Numbered rule list","General rules — 6 items","list; mono “N.” prefix","—","—","list-number treatment"),
  (3,"Course-note card","One tinted card per course with notes (section hidden when none)","full-width, radius 16","conditional on per-course notes","washes toward the course accent; name + marker + bullets in course ink (accentInk)","the card surface + the course marker"),
 ]),

# ════════════════════════════════════════════════════════════ 9. INSTALL
def _step(i, t):
    return el(el(sp(str(i),12,700,"var(--mut)"), cls="ctr", w=24, h=24, r=999, background="var(--f2)", flexnone=True) +
              f'<span style="margin-left:12px">{lab(t,14)}</span>', cls="rowc", mt=(0 if i==1 else 16), border="none")
screen(id="install", name="Install", route="/install",
 purpose="PWA install landing (QR-code target); shows the right path per platform.",
 body=dev(bar("Install the app") + content(
   el(sp("⛳",48) + f'<div style="margin-top:8px">{sp("Add Mini Golf to your phone",22,900)}</div>' +
      f'<div style="margin-top:4px">{lab("Installs like a normal app — full screen, offline.",13)}</div>',
      cls="col", n=1, mt=4, border="none", background="none") +
   el(f'{lab("Branch card — 1 of 4: Installed / iOS steps / Native prompt / Generic",12)}'
      + el(_step(1,"step instruction") + _step(2,"step instruction") + _step(3,"step instruction"),
           cls="", mt=12, border="none"),
      cls="s1", n=2, mt=24, r=16, pad="20px") +
   el(lab("platform warning box",12), cls="s1", n=3, mt=12, r=8, pad="12px", background="var(--f0)")
 )),
 specs=[
  (1,"Hero","Brand mark + heading","glyph ~48px + 22px heading","—","—","the brand mark"),
  (2,"Branch card","One of four states: already-installed (+ Open button), iOS steps, native-prompt button, or generic steps","full-width, radius 16, pad 20","platform-dependent; dismissed-prompt retry hint","—","the card surface"),
  (3,"Numbered step + warning","Instruction steps and a caveat box","step badge 24×24 circle; warning box radius 8","—","—","step-number badges + the platform glyphs referenced (Share / add-to-home / browser-menu)"),
 ]),

# ════════════════════════════════════════════════════════════ 10. TV LEADERBOARD
def _lbrow(you=False, n=None, mt=8):
    bd = "1px solid var(--ln)" if you else "1px solid var(--ln2)"
    youp = f'<span style="margin-left:8px;padding:2px 8px;border-radius:999px;background:var(--f2);font-size:10px;font-weight:700;color:var(--mut)">YOU</span>' if you else ""
    return el(f'<span style="width:24px;text-align:center;font-family:monospace;font-size:14px;color:var(--mut)">1</span>'
              f'<span style="margin-left:12px;font-family:ui-monospace,monospace;font-size:24px;font-weight:700">AVA</span>'
              f'<span style="margin-left:10px">{lab("course",12)}</span>{youp}'
              f'<span style="margin-left:auto">{sp("41",24,900)}</span>',
              cls="s1 rowc", n=n, r=16, pad="12px 16px", border=bd, mt=mt)
screen(id="tv", name="TV Leaderboard", route="/tv",
 purpose="Live high-score board (polls periodically); highlights the just-played round on arrival.",
 body=dev(bar("Leaderboard") + content(
   el(_seg("Day",on=True,n=1)+_seg("Week")+_seg("Month")+_seg("All"), cls="rowc", gap="8px", border="none") +
   el(_lbrow(you=True, n=2, mt=0) + _lbrow(n=4) + _lbrow(), cls="", mt=16, border="none")
 )),
 specs=[
  (1,"Period tabs","Day / Week / Month / All (Day is the default)","4-col grid, radius 12","active (filled) vs inactive (outline)","—","tab states"),
  (2,"Rank / tag","Row identity","rank 14px mono · tag 24px arcade","—","neutral ramp — the leaderboard is not course-tinted","the arcade type face"),
  (3,"“You” pill + row highlight","Marks your rows","pill (rounded-full)","only on your rows; polls every 5s","a highlight/ring accent","the pill + row-highlight treatment"),
  (4,"Standings row","One per score","full-width, radius 16","entrance stagger; error / empty / loading states","—","the row surface"),
 ]),

# ════════════════════════════════════════════════════════════ 11. HUNT
def _itemcard(n=None, snap_n=None, mt=12):
    return el(el(f'{sp("item name",16,700)}  {lab("💡 Hint  ×N  ✓",12)}', cls="col ai-start", grow=True, border="none", background="none") +
              el(sp("📷 Snap",14,600,"var(--mut)"), cls="ctr", n=snap_n, w=96, h=40, r=12, background="var(--f2)", border="1px solid var(--ln)"),
              cls="s1 rowc ai-start", n=n, r=16, pad="16px", mt=mt)
screen(id="hunt", name="Scavenger Hunt", route="/hunt",
 purpose="Snap-a-photo hunt; a vision model verifies each find. Reached from the in-round bar (not Home). Gated on an active round.",
 body=dev(bar("Scavenger hunt") + content(
   el(lab("Things to find on <course>. Snap a photo of each.",14), border="none") +
   el(f'{lab("PLAYING AS",11)}<div style="margin-top:8px;display:flex;gap:8px">{tag("AVA",sel=True)}{tag("JZ",dim=True)}{tag("KO",dim=True)}</div>',
      n=1, mt=20, border="none") +
   el(_itemcard(n=2, snap_n=3, mt=0) + _itemcard(n=5), cls="", mt=16, border="none") +
   el(lab("result banner (verified / flagged / rejected)",12), cls="s1", n=4, mt=12, r=12, pad="10px 12px", background="var(--f0)")
 )),
 specs=[
  (1,"“Playing as” selector","Player chips — one per player (1–4)","radius 8 pills","selected (ring-2) vs dimmed (opacity 60%)","--tag-accent (house green default here)","tag surface + selected-state treatment"),
  (2,"Item hint / count / check","On each item","small","hint show/hide toggle; ×N count or a found check","—","hint, count, and check icons"),
  (3,"Snap button","Photo capture (opens the camera)","compact button, ~40 tall, radius 12","label cycles Snap / Snap another / Checking / Found (locked)","—","a camera icon + button surface"),
  (4,"Result banner","Verify outcome","full-width, radius 12","verified / flagged (photo-of-screen) / rejected; plus a load-error box","(flag/error emphasis)","banner treatments"),
  (5,"Item card","Per find","full-width, radius 16","found vs not-found; a gated empty state when no round is active","—","the card surface"),
 ]),

# ════════════════════════════════════════════════════════════ 12. ARCADE PUTT (fills)
screen(id="putt", name="Arcade Putt", route="/putt", fill=True,
 purpose="Playable canvas mini-golf — the playfield fills the screen between the HUD and buttons. Offline.",
 body=dev(bar("Arcade Putt") +
   el(sp("Hole n / 9",14,700) + f'<span style="margin-left:auto">{lab("Par · Strokes",14)}</span>', cls="rowc", n=1, pad="16px 16px 8px", border="none", flexnone=True) +
   el(lab("Canvas playfield — drag-to-aim slingshot; ball, cup+flag, bumpers, greens, hazards, splash.",12), cls="fill", n=2, grow=True, margin="0 16px", r=16) +
   el(lab("hint line",13), cls="ctr", h=40, border="none", flexnone=True) +
   el(btn("Next hole →", primary=True, mt=0) + '<span style="width:12px"></span>' + btn("Reset / End run", n=3, mt=0), cls="rowc", pad="4px 16px 16px", border="none", flexnone=True),
   fill=True),
 specs=[
  (1,"Status header","Hole / par / strokes","text row","course vs endless; a mode-picker precedes play","—","—"),
  (2,"Canvas playfield","The game (aim by dragging)","fills the device below the HUD + buttons (390px wide × remaining height), radius 16","aim / rolling / splash / sunk phases","aim-power color ramp","playfield background + all sprites (ball, cup+flag, bumpers, greens, hazards, splash) and the aim/power markers — drawn into the canvas"),
  (3,"Play buttons","Next / See scorecard (primary) · Reset / End run (secondary)","full-width","mode-dependent","--accent","primary + ghost surfaces; a per-hole result set on the summary"),
 ]),

# ════════════════════════════════════════════════════════════ 13. FUN ZONE HUB
def _ftile(first=False):
    return el((el(lab("◇",20), cls="chip", w=36, h=36, r=8, n=(2 if first else None))) +
              f'<span style="margin-left:10px">{lab("game tile — title",12)}</span>',
              cls="tile rowc", n=(1 if first else None), r=12, pad="10px 12px")
screen(id="fun", name="Fun Zone hub", route="/fun",
 purpose="Grid landing routing to every mini-game. Each tile = an icon + title (12 games).",
 body=dev(bar("While You Wait") + content(
   el(f'<div style="text-align:center">{lab("Pass the time.",14)}</div>', border="none") +
   el("".join(_ftile(first=(i==0)) for i in range(6)), cls="grid2", mt=12) +
   el(lab("…12 game tiles total",12), mt=8, border="none")
 )),
 specs=[
  (1,"Activity tile","One per game → its route (12 games)","2-col grid, radius 12, pad 10/12","rise-in stagger; press-shrink feedback","accent-tinted per tile (bg/border/icon from the tile accent)","the tile surface"),
  (2,"Activity icon","Leading mark on each tile","36×36 chip, radius 8, glyph ~20px","—","tinted to the tile accent","one designed icon per activity (12 total)"),
 ]),

# ════════════════════════════════════════════════════════════ 14. MINIGAME SHELL (fills)
screen(id="game", name="Minigame shell (covers the 9 canvas games)",
 route="/fun/skeeball · /fun/bowling · /fun/karts · /fun/airhockey · /fun/bumper · /fun/boats · /fun/axe · /fun/batting · /fun/mole",
 fill=True,
 purpose="Shared shell for every canvas game — the playfield fills the screen between the HUD and any footer.",
 body=dev(bar("Game name") +
   el(sp("count (ball / frame)",14,700) + f'<span style="margin-left:auto">{lab("score / timer",14)}</span>', cls="rowc", n=1, pad="16px 16px 8px", border="none", flexnone=True) +
   el(lab("Canvas playfield — per-game sprites & interaction. On game-over it reverts to a results screen (big emoji + score + Play again).",12), cls="fill", n=2, grow=True, margin="0 16px", r=16) +
   el(lab("hint line",13), cls="ctr", h=40, border="none", flexnone=True),
   fill=True),
 specs=[
  (1,"HUD counter row","Per-game counters / score / timer","text row","labels vary by game (Bowling adds a 10-frame scorecard strip); a timer can signal time pressure","—","—"),
  (2,"Canvas playfield","The game itself","fills the device below the HUD + hint (390px wide × remaining height), radius 16","aim / play / result; impact + shake feedback; a celebratory game-over results screen","--accent on the results Play-again","per-game background + sprites (ball, puck, kart, target, pins, axe, bumper, gopher) as sprite sheets / SVGs; a result mark per game"),
 ]),

# screens whose layout grows by one row/chip per player (1–4)
for _s in SCREENS:
    if _s["id"] in ("setup","play","sum","hunt"): _s["scales"] = True

# ————————————————————————————————————————————————————————————————————————————
# CSS — true-px artboard, scaled only for print/contact-sheet layout via `zoom`.
# ————————————————————————————————————————————————————————————————————————————
CSS = r"""
@page { size: Letter; margin: 12mm 12mm 14mm; }
:root{ --ink:#2b3742; --mut:#7c8792; --ln:#9aa4b0; --ln2:#c7ced5; --f0:#fbfcfd;
 --f1:#eef1f4; --f2:#e2e7ec; --hatch:#e6eaee; --co:#334155; --accent:#15803d; --accentsoft:#e7f1ec; --line:#d9dee3; --panel:#f6f8fa; --muted:#6b7682;}
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);font-size:10px;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
h1,h2,h3{margin:0;line-height:1.15}
code{font-family:"SF Mono",ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:9px;color:#0b3d1f}
.page{page-break-after:always} .page:last-child{page-break-after:auto}

/* ——— to-scale device artboard (real app px) ——— */
.dv{width:390px;min-height:844px;background:#fff;border:1px solid var(--ln);display:flex;flex-direction:column;position:relative;overflow:hidden;font-size:14px}
.dv.tint{background:linear-gradient(180deg,#f4f7f9,#eef2f5)}
.bar{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--ln2);position:relative;background:#f2f5f7}
.key40{width:40px;height:40px;border-radius:12px;border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--mut);flex:none;position:relative}
.title{flex:1;font-size:18px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctrls{display:flex;gap:6px;align-items:center}
.pill{width:36px;height:36px;border-radius:999px;border:1px solid var(--ln);background:#fff;flex:none}
.pad{padding:16px;display:flex;flex-direction:column;flex:1}
/* generic surfaces (fills light so drawn-over art shows; sizes/radii are exact) */
.s1{background:var(--f1);border:1px solid var(--ln2)}
.sunk{background:var(--f2);border:1px solid var(--ln2);box-shadow:inset 0 2px 3px rgba(0,0,0,.07)}
.keycap{background:var(--f1);border:1px solid var(--ln)}
.tile{background:var(--f1);border:1px solid var(--ln2)}
.chip{background:var(--f2);border:1px solid var(--ln);display:flex;align-items:center;justify-content:center;flex:none}
.ctr{display:flex;align-items:center;justify-content:center;text-align:center}
.ctr.jc-start{justify-content:flex-start}
.col{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.col.ai-start{align-items:flex-start;text-align:left}
.rowc{display:flex;align-items:center}
.rowc.ai-start{align-items:flex-start}
.rowc.ai-end{align-items:flex-end}
.rowend{display:flex;justify-content:flex-end;gap:6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fill{border:1px dashed var(--ln2);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--mut);
 background:repeating-linear-gradient(135deg,#fbfcfd,#fbfcfd 9px,var(--hatch) 9px,var(--hatch) 10px)}
.scrim{width:100%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.06));padding-top:40px}
table.ng{width:100%;border-collapse:collapse;table-layout:fixed}
table.ng th,table.ng td{padding:5px 2px;text-align:center;border-bottom:1px solid var(--ln2)}
table.ng th:first-child,table.ng td:first-child{width:56px}
/* callout badge — anchored ON the element */
.cn{position:absolute;top:-8px;right:-8px;width:16px;height:16px;border-radius:999px;background:var(--co);color:#fff;
 font:800 10px/16px "Segoe UI",sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;z-index:6;font-style:normal}

/* ——— cover ——— */
.cover{height:246mm;display:flex;flex-direction:column}
.wfmark{width:120px;height:76px;border:2px solid var(--ln);border-radius:12px;position:relative;background:repeating-linear-gradient(135deg,transparent,transparent 8px,var(--hatch) 8px,var(--hatch) 9px)}
.wfmark:after{content:"⛳ to scale · 390px";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 9px/1 "SF Mono",monospace;color:var(--muted)}
.eyebrow{font:700 11px/1 "SF Mono",monospace;letter-spacing:.26em;text-transform:uppercase;color:var(--accent);margin-top:14px}
.cover h1{font-size:36px;font-weight:900;letter-spacing:-.02em;margin:12px 0 6px}
.cover .tag{font-size:13.5px;color:#333;max-width:158mm}
.chip-c{display:inline-block;background:var(--accentsoft);color:var(--accent);border:1px solid #c3e2cf;border-radius:999px;padding:3px 11px;font-size:10px;font-weight:700;margin:0 6px 6px 0}
.how{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--panel);margin-top:auto}
.how h3{font-size:12px;margin-bottom:6px} .how ol{margin:0;padding-left:18px} .how li{margin-bottom:4px}
.note{border-left:3px solid #d97706;background:#fff7ed;border-radius:0 8px 8px 0;padding:9px 12px;font-size:10.5px;margin:14px 0 0}
.note b{color:#9a3412}

/* ——— per-screen page (style-guide): artboard (zoomed to fit) + spec table ——— */
.sp h2{font-size:15px;font-weight:800;border-bottom:2.5px solid var(--accent);padding-bottom:5px;margin-bottom:3px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sp h2 .rt{font-family:"SF Mono",monospace;font-size:8.5px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 7px;font-weight:700}
.sp h2 .tb{font:700 8px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 6px}
.purpose{color:#333;font-size:10px;margin:2px 0 8px}
.layout{display:flex;gap:16px;align-items:flex-start}
.framewrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px}
.viewcap{font:700 8px/1 "SF Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.specwrap{flex:1}
table.spec{width:100%;border-collapse:collapse;font-size:8px}
table.spec th,table.spec td{text-align:left;padding:3px 4px;border-bottom:1px solid var(--line);vertical-align:top}
table.spec th{background:var(--panel);font-weight:800;font-size:7.5px;text-transform:uppercase;letter-spacing:.02em;color:#334}
table.spec td.cn{text-align:center;width:13px}
table.spec td.cn span{display:inline-block;background:var(--co);color:#fff;border-radius:999px;width:13px;height:13px;line-height:13px;font-size:8px;font-weight:800}
table.spec td b{color:#0b3d1f} .artc{color:#0b3d1f}
table.spec tr{break-inside:avoid}
/* style-guide artboard zoom (keeps true px; zoom reserves layout space in print) */
.sg .dv{zoom:.60}
/* ——— contact sheet ——— */
.sheethead{margin:0 0 12px} .sheethead h1{font-size:22px;font-weight:900;letter-spacing:-.01em}
.sheethead p{font-size:10.5px;color:#444;margin:4px 0 0;max-width:170mm}
.sheethead .note{margin-top:8px}
.grid-screens{display:flex;flex-wrap:wrap;gap:18px 20px;align-items:flex-start}
.cell{break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:6px}
.celltitle{font-size:11px;font-weight:800;text-align:center;display:flex;gap:6px;align-items:baseline;justify-content:center;flex-wrap:wrap}
.celltitle .rt{font-family:"SF Mono",monospace;font-size:8px;color:#fff;background:#0b3d1f;border-radius:5px;padding:1px 6px;font-weight:700}
.celltitle .tb{font:700 7.5px/1.6 "SF Mono",monospace;color:#9a3412;background:#fff2e6;border:1px solid #f6d3ad;border-radius:5px;padding:1px 5px}
/* On screen the sheet artboards stay TRUE 390px (the overlay/trace layer) — no
   zoom, so an artist can lay one over a 390px app screenshot 1:1. Print alone
   scales them down to fit the page grid. */
@media print { .sheet .dv{zoom:.42} }
"""

# ———————————————————————————————————————————————— contact sheet (trace layer)
def render_cell(sc, idx):
    body = re.sub(r'<i class="cn">\d+</i>', '', sc["body"])   # drop markers
    tb = '<span class="tb">course-tinted</span>' if sc.get("tint") else ''
    name = sc["name"].split(" (")[0]
    return (f'<div class="cell"><div class="celltitle">{idx}. {name}'
            f'<span class="rt">{sc["route"].split(" · ")[0]}</span>{tb}</div>'
            f'<div class="sheet">{body}</div></div>')

sheet_head = """<div class="sheethead">
 <h1>Mini Golf — Screens (to scale)</h1>
 <p>Every screen's element layout drawn to scale on a 390px phone artboard — the overlay/trace layer. On screen these are true size; open a screen at 390px and design your art over the matching board. Companion to the full <b>Screen &amp; Element Guide</b> (dimensions, states, theming hooks, and the art needed per element).</p>
 <div class="note"><b>A template, not the design.</b> Neutral fills so your art reads over them. Player-scaled screens are drawn at 4 players; the Course Map and game playfields fill the device below the bar.</div>
</div>"""
cells = "".join(render_cell(sc, i+1) for i, sc in enumerate(SCREENS))
html2 = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screens</title><style>{CSS}</style></head>
<body>{sheet_head}<div class="grid-screens">{cells}</div></body></html>"""
open(OUT2, "w").write(html2)
print("wrote", OUT2)
