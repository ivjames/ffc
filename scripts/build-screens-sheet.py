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

Covers the post-FEC-restructure app: a venue dashboard (Home) that launches five
sections through a global navigation drawer. Companion to the full Screen &
Element Guide (style-guide.html/pdf — schematic wireframes + numbered spec
tables), built by build-style-guide.py. Output lands in public/docs/ so the built
app serves it at /docs/screens.html; the companion screens.pdf is printed from it.
"""

import os
import re
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT2 = os.path.join(_ROOT, "public", "docs", "screens.html")
SCREENS = []
def screen(**kw): SCREENS.append(kw)

# ————————————————————————————————————————————————————————————————————————————
# To-scale artboard kit. Every helper emits real app pixels. A callout number
# `n` renders a badge anchored ON the element. Reference device = 390px wide;
# content padding 16px ⇒ inner width 358px.
# ————————————————————————————————————————————————————————————————————————————
INNER = 358

# Cards that appear only when populated (a live round, a pending order, venue
# specials) get a DASHED outline so they read as conditional, vs. the solid
# outline of an always-present card.
DASH = "1px dashed var(--ln)"

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
    # The header now holds one control: the hamburger menu button (opens the
    # global nav drawer). Light/dark + mute moved into that drawer.
    left = '<div class="key40">‹</div>' if back else '<div style="width:2px"></div>'
    menu = '<div class="ctrls"><div class="pill"></div></div>'
    return f'<div class="bar">{left}<div class="title">{title}</div>{right}{menu}</div>'

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

def chip(glyph="◇", size=48, r=12, gl=18, n=None):
    return el(lab(glyph, gl), cls="chip", n=n, w=size, h=size, r=r)

def listrow(glyph, title, sub, trail="›", n=None, chip_n=None, first=False, bd=None):
    border = bd or "1px solid var(--ln2)"
    return el(chip(glyph, n=chip_n) +
              el(sp(title,18,700) + (f'<div>{lab(sub,14)}</div>' if sub else ''),
                 cls="col ai-start", grow=True, border="none", background="none", margin_left="16px") +
              f'<span style="margin-left:8px">{sp(trail,20,400,"var(--mut)")}</span>',
              cls="s1 rowc", n=n, r=16, pad="16px", border=border, mt=(0 if first else 12))

def dev(inner, fill=False, tint=False):
    cls = "dv" + (" tint" if tint else "")
    return f'<div class="{cls}">{inner}</div>'

# ════════════════════════════════════════════════════════════ 1. HOME (dashboard)
def _sectiontile(n=None):
    return el(el("", cls="chip", w=40, h=40, r=999) +
              f'<span style="margin-left:10px">{sp("Section",14,900)}</span>',
              cls="tile rowc", n=n, r=16, pad="12px")
screen(id="home", name="Home (venue dashboard)",
 body=dev(content(
   el('<div class="pill"></div>', cls="rowend", n=1) +
   el(sp("🎡",40) + f'<div style="margin-top:6px">{sp("Family Fun Center",24,900)}</div>' +
      f'<div style="margin-top:2px">{lab("What do you want to do? · open ‘til 9",13)}</div>',
      cls="col", n=2, mt=6, border="none", background="none") +
   el(lab("Announcement banner — venue specials (hidden when none)",12), cls="s1", n=3, mt=12, r=16, pad="12px 14px", border=DASH) +
   el(lab("Adoption nudge — install / sign-in (dismissible)",12), cls="s1", n=4, mt=10, r=16, pad="12px 14px", border=DASH) +
   el(f'{lab("RESUME ROUND",11)}<div style="margin-top:6px;display:flex;align-items:center">{sp("Course name",18,700)}<span style="margin-left:auto;display:flex;gap:4px">{tag("AVA",size=14,h=26)}{tag("JZ",size=14,h=26)}</span></div>',
      cls="s1", n=5, mt=10, r=16, pad="14px", border=DASH) +
   el(lab("Active-orders card — an in-kitchen order (self-gating)",12), cls="s1", n=6, mt=10, r=16, pad="12px 14px", border=DASH) +
   el(_sectiontile(n=7)+_sectiontile()+_sectiontile()+_sectiontile(), cls="grid2", mt=12) +
   el(f'{lab("🌭  Food & Drink",13)}<div style="margin-top:8px;display:flex;gap:8px">{el(sp("See the menu",13,700),cls="ctr",grow=True,h=36,r=12,background="var(--f2)",border="1px solid var(--ln)")}{el(sp("🛒 Order food",13,700),cls="ctr",grow=True,h=36,r=12,background="var(--f2)",border="1px solid var(--ln)")}</div>',
      cls="s1", n=8, mt=12, r=16, pad="14px", border=DASH) +
   btn("👤  Sign in / register", n=9, mt=12)
 ))),

# ════════════════════════════════════════════════════════════ 2. NAV DRAWER (overlay)
def _drawrow(label, on=False, secondary=False, n=None):
    bg = "var(--f2)" if on else "var(--f1)"
    bd = "1px solid var(--ln)" if on else "1px solid var(--ln2)"
    h = 40 if secondary else 48
    trail = f'<span style="margin-left:auto">{lab("Here",10)}</span>' if on else ''
    return el(f'<div class="chip" style="width:24px;height:24px;border-radius:8px"></div>'
              f'<span style="margin-left:12px">{sp(label,15 if not secondary else 13,700 if not secondary else 600)}</span>{trail}',
              cls="rowc", n=n, mt=(0 if n in (2,) else (6 if secondary else 8)), h=h, r=(16 if not secondary else 12),
              background=bg, border=bd, pad="0 14px")
screen(id="nav", name="Navigation drawer (global)",
 body=dev(content(
   el('<div class="pill"></div>', cls="rowend", n=1) +
   el(f'{lab("YOU’RE AT",11)}<div>{sp("Family Fun Center",18,900)}</div>', cls="", n=2, mt=6, border="none") +
   el(_drawrow("Home", on=True, n=3) + _drawrow("Mini Golf") + _drawrow("Arcade") + _drawrow("Food & Drink") + _drawrow("Me"),
      cls="", mt=14, border="none") +
   el('', cls="", mt=14, h=1, background="var(--ln2)", border="none") +
   el(_drawrow("Photo Booth", secondary=True, n=4) + _drawrow("Rewards card", secondary=True) + _drawrow("Change location", secondary=True) + _drawrow("Install app", secondary=True),
      cls="", mt=12, border="none") +
   el('', cls="", mt=12, h=1, background="var(--ln2)", border="none") +
   el(el(sp("🔊  Sound",14,600), grow=True, border="none", background="none") + el('', cls="chip", w=40, h=24, r=999), cls="rowc", n=5, mt=12, border="none") +
   el(el(sp("🌙  Dark mode",14,600), grow=True, border="none", background="none") + el('', cls="chip", w=40, h=24, r=999), cls="rowc", mt=10, border="none") +
   el(f'<div style="text-align:center">{lab("Privacy",12)}</div>', n=6, mt=16, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 3. LOCATIONS
def _locrow(sel=False, n=None):
    trail = sp("Current",14,600,"var(--mut)") if sel else sp("›",20,400,"var(--mut)")
    bd = "1px solid var(--ln)" if sel else "1px solid var(--ln2)"
    return el(chip("📍", n=n) +
              el(sp("Venue name",18,700) + f'<div>{lab("N courses · open ‘til 9",14)}</div>', cls="col ai-start", grow=True, border="none", background="none", margin_left="16px") +
              f'<span style="margin-left:8px">{trail}</span>',
              cls="s1 rowc", r=16, pad="16px", border=bd)
screen(id="loc", name="Location Picker",
 body=dev(bar("Choose a location") + content(
   el(sp("🧭  Use my location",14,600), cls="ctr", n=1, h=44, r=12, pad="0 16px", background="var(--f1)", border="1px solid var(--ln2)") +
   el(lab("status message (detecting / error)",14), cls="", n=2, mt=16, border="none") +
   el(_locrow(sel=True, n=3), mt=16, border="none") +
   el(lab("weekly-hours card — collapsible ▸",12), cls="s1", n=6, mt=8, r=12, pad="10px 12px", background="var(--f0)") +
   el(_locrow(n=4), mt=12, border="none") +
   el(lab("weekly-hours card — collapsible ▸",12), cls="s1", mt=8, r=12, pad="10px 12px", background="var(--f0)") +
   el(lab("Placeholder sites — the client's real locations swap in here.",12), mt=16, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 4. MINI GOLF HUB
def _tile(n=None):
    return el(el("", cls="puck", w=56, h=56, r=999, background="var(--f2)", border="1px solid var(--ln)") +
              f'<div style="margin-top:10px">{lab("Course", 12)}</div>',
              cls="tile col", n=n, r=16, pad="16px 12px")
screen(id="golf", name="Mini Golf hub",
 body=dev(bar("Mini Golf") + content(
   el(f'<div style="text-align:center">{lab("4 courses · eighteen holes each",13)}</div>', border="none") +
   el(f'{lab("RESUME ROUND",11)}<div style="margin-top:6px;display:flex;align-items:center">{sp("Course name",18,700)}<span style="margin-left:auto;display:flex;gap:4px">{tag("AVA",size=14,h=26)}{tag("JZ",size=14,h=26)}</span></div>',
      cls="s1", n=1, mt=12, r=16, pad="14px", border=DASH) +
   el(_tile(n=2)+_tile()+_tile()+_tile(), cls="grid2", mt=12) +
   btn("📲  Join a friend’s game", n=3, mt=16) + btn("🏆  Leaderboard") + btn("🔍  Scavenger hunt") + btn("📖  Rules")
 ))),

# ════════════════════════════════════════════════════════════ 5. COURSE PICKER
def _courserow(n=None, first=False):
    return el(chip("◇", gl=20, n=(2 if first else None)) +
              el(sp("Course name",18,700) + f'<div>{lab("18 holes · par 50",14)}</div>', cls="col ai-start", grow=True, border="none", background="none", margin_left="16px", n=(3 if first else None)) +
              f'<span style="margin-left:8px">{sp("›",20,400,"var(--mut)")}</span>',
              cls="s1 rowc", r=16, pad="16px", mt=(0 if first else 12))
screen(id="pick", name="Course Picker",
 body=dev(bar("Pick a course") + content(
   el(lab("📍  venue name · open ‘til 9",14) + f'<span style="margin-left:auto">{lab("Change",14)}</span>', cls="s1 rowc", n=1, h=52, r=16, pad="0 16px") +
   el(_courserow(first=True) + _courserow() + _courserow() + _courserow(), cls="", mt=12, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 6. PLAYER SETUP
def _seg(nn, on=False, n=None):
    return el(sp(nn,18,700), cls="ctr", n=n, h=44, r=12, grow=True,
              background=("var(--f2)" if on else "var(--f1)"), border="1px solid var(--ln)")
def _tagrow(i, err=False, n=None, glyph=None, ph="ABC"):
    bd = "1px solid #c98" if err else "1px solid var(--ln2)"
    lead = (f'<span style="width:24px;text-align:right;font-family:monospace;font-size:14px;color:var(--mut)">{glyph if glyph else i}</span>')
    return el(lead +
              el(sp(ph,24,700,"var(--mut)",ls=".12em"), cls="ctr", n=n, w=128, h=44, r=12, background="var(--f2)", border=bd, margin_left="12px", box_shadow="inset 0 2px 3px rgba(0,0,0,.07)"),
              cls="rowc", mt=(0 if i==1 else 12), border="none")
screen(id="setup", name="Player Setup",
 body=dev(bar("Course name") + content(
   el(lab("Players",14), border="none") +
   el(_seg("1",n=1)+_seg("2",on=True)+_seg("3")+_seg("4"), cls="rowc", mt=8, gap="8px", border="none") +
   el(lab("Tags (3 letters/numbers, arcade)",14), mt=20, border="none") +
   el(_tagrow(1,n=2)+_tagrow(2,err=True,n=3)+
      el(lab("inline error message",13), mt=6, border="none")+
      _tagrow(3)+_tagrow(4), cls="", mt=8, border="none") +
   el(lab("Team tag (optional)",14), mt=20, border="none") +
   el(_tagrow(1,glyph="🏅",ph="TEA",n=4), mt=8, border="none") +
   btn("Start round", primary=True, n=5, mt=20) +
   btn("📲 Play together (own phones)", n=6, mt=8) +
   el(lab("Hosting needs a (free) account.",12), mt=6, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 7. COURSE MAP (fills)
screen(id="map", name="Course Map",
 body=dev(bar("Course name") +
   el(el(lab("Full-bleed tap target → setup. Course map image when set, else a themed-emoji placeholder on an accent-tinted fill.",12), cls="ctr", grow=True, border="none", background="none", pad="0 24px") +
      el(f'<div style="text-align:center">{sp("TAP ANYWHERE TO BEGIN",16,900)}<div style="margin-top:4px">{lab("18 holes · course",13)}</div></div>', cls="scrim", pad="0 16px 28px"),
      cls="fill", n=1, grow=True),
   fill=True)),

# ════════════════════════════════════════════════════════════ 8. SCORECARD (scrolling matrix)
# The play screen is a paper-style scorecard: pinned tag + − rails on the left, a
# horizontally-scrolling grid of hole columns (current column tinted) in the
# middle, and a pinned + rail on the right. One row per player.
def _scorecard():
    tabs = "".join(
        el(sp(str(v),13,700,"var(--mut)"), cls="ctr", grow=True, h=30, r=8,
           background=("var(--f2)" if k==2 else "var(--f1)" if k<2 else "#fff"),
           border=("1px solid var(--ln)" if k<=2 else "1px dashed var(--ln2)"),
           margin_left=("0" if k==0 else "6px"))
        for k, v in enumerate([2,3,4,5,6]))
    def cellrow(vals):
        cells = "".join(
            el(sp(str(v),18,900,("var(--ink)" if v!="·" else "var(--mut)")),
               cls=("sunk ctr" if k==2 else "ctr"), grow=True, h=36, r=8,
               background=("var(--f2)" if k==2 else "#fff"),
               border=("1px solid var(--ln)" if k==2 else "1px solid var(--ln2)"),
               margin_left=("0" if k==0 else "6px"))
            for k, v in enumerate(vals))
        return el(cells, cls="rowc", mt=8, border="none")
    scroll = el(el(tabs, cls="rowc", border="none") +
                cellrow(["2","3","3","·","·"]) + cellrow(["2","2","4","·","·"]) +
                cellrow(["3","2","2","·","·"]) + cellrow(["2","4","3","·","·"]),
                cls="", grow=True, border="none", background="none", overflow="hidden")
    spacer = '<div style="height:30px"></div>'
    tags = el(spacer + "".join(el(tag("AVA",size=15,h=36), mt=8, border="none", background="none") for _ in range(4)),
              cls="col ai-start", border="none", background="none")
    def keycol(g):
        return el(spacer + "".join(el(sp(g,22,700,"var(--mut)"), cls="keycap ctr", mt=8, w=34, h=36, r=8) for _ in range(4)),
                  cls="col", border="none", background="none")
    return el(tags +
              el(keycol("−"), margin_left="8px", border="none", background="none") +
              el(scroll, grow=True, margin_left="8px", border="none", background="none") +
              el(keycol("+"), margin_left="8px", border="none", background="none"),
              cls="rowc ai-start", mt=14, border="none")
screen(id="play", name="Scorecard (play screen)",
 body=dev(
   f'<div class="bar"><div class="key40">‹</div><div class="title">Course</div>'
   f'<div class="ctrls" style="position:relative">'
   f'<div style="height:24px;padding:0 8px;border:1px solid var(--ln2);border-radius:999px;display:flex;align-items:center;font-size:11px;color:var(--mut)">● Live</div>'
   f'<div class="pill" style="border-radius:8px"></div><div class="pill" style="border-radius:8px"></div>'
   f'<div class="pill"></div></div></div>' +
   content(
   el(el(f'{lab("HOLE 4",11)}<div>{sp("hole name",24,900)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
      el(f'<div style="text-align:center">{lab("Par",11)}</div>' + el(sp("3",24,900,"var(--mut)"), cls="s1 ctr", w=48, h=48, r=999), cls="col", border="none", background="none"),
      cls="rowc ai-end", border="none") +
   _scorecard() +
   btn("Next › / Finish", primary=True, mt=24) +
   el(lab("Score every player to continue · Max 6 strokes per hole",12), mt=16, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 9. SUMMARY
def _standing(n=None, mt=8):
    return el(f'<span style="width:56px;text-align:center;font-family:monospace;font-size:24px;font-weight:900;color:var(--mut)">2</span>' +
              el(tag("JZ",size=20,h=28), cls="ctr", grow=True, border="none", background="none") +
              f'<span style="text-align:right">{sp("45",20,900)} {lab("E",13)}</span>',
              cls="s1 rowc", n=n, r=16, pad="12px 20px", mt=mt)
screen(id="sum", name="Summary (final scorecard)",
 body=dev(bar("Final scorecard") + content(
   el(f'<div style="text-align:center">{lab("course name · “Par N”",13)}</div>', border="none") +
   el(el(sp("🏆",44), cls="ctr", w=56, border="none", background="none") +
      el(f'<div style="text-align:center">{lab("WINNER / TIED",11)}<div style="margin-top:2px">{sp("AVA",30,900,"var(--mut)")}</div></div>', cls="ctr", grow=True, border="none", background="none") +
      f'<span style="text-align:right">{sp("41",24,900)} {lab("−4",13)}</span>',
      cls="s1 rowc", n=1, mt=8, r=24, pad="20px") +
   el(_standing(n=2, mt=0) + _standing(mt=8), cls="", mt=16, border="none") +
   btn("📋 View scorecard", n=3, mt=16) +
   el(lab("Saved to leaderboard ✓",12), n=4, mt=16, border="none") +
   el(f'{lab("🎟️  REWARDS EARNED",11)}<div style="margin-top:8px">{lab("• reward · player tag         +N 🎟️",13)}</div><div style="margin-top:6px">{lab("🎟️ Link rewards card",13)}</div>',
      cls="s1", n=5, mt=12, r=16, pad="14px", border=DASH) +
   btn("📸 Share this round", mt=16) +
   btn("🏆 View leaderboard", mt=8) +
   btn("Done", primary=True, n=6, mt=8)
 ))),

# ════════════════════════════════════════════════════════════ 10. HUNT
def _itemcard(n=None, snap_n=None, result=False, mt=12):
    # Identity column left, snap button top-right; the verify result renders
    # IN-CARD as the card's last, full-width element — there is no standalone
    # result banner below the list.
    toprow = el(
        el(f'{sp("item name",16,700)}  {lab("×N / ✓",12)}'
           f'<div style="margin-top:4px">{lab("💡 Hint",12)}</div>'
           f'<div style="margin-top:6px;display:flex;gap:6px;align-items:center">{lab("FOUND BY",10)}{tag("AVA",size=12,h=22)}</div>'
           f'<div style="margin-top:6px">{lab("📤 AVA’s photo",11)}</div>',
           cls="col ai-start", grow=True, border="none", background="none") +
        el(sp("📷 Snap",14,600,"var(--mut)"), cls="ctr", n=snap_n, w=96, h=40, r=12, background="var(--f2)", border="1px solid var(--ln)"),
        cls="rowc ai-start", border="none")
    res = (el(lab("in-card result — verified / flagged / rejected",12),
              cls="ctr jc-start", n=(4 if result else None), mt=12, r=8, pad="8px 12px",
              background="var(--f0)", border=DASH) if result else "")
    return el(toprow + res, cls="s1", n=n, r=16, pad="16px", mt=mt)
screen(id="hunt", name="Scavenger Hunt",
 body=dev(bar("Scavenger hunt") + content(
   el(lab("Things to find on &lt;course&gt;. Snap a photo of each.",14), border="none") +
   el(lab("Photos are AI-checked & stored · How photos are handled",12), cls="s1", n=6, mt=12, r=12, pad="10px 12px", background="var(--f0)") +
   el(f'{lab("PLAYING AS",11)}<div style="margin-top:8px;display:flex;gap:8px">{tag("AVA",sel=True)}{tag("JZ",dim=True)}{tag("KO",dim=True)}</div>',
      n=1, mt=16, border="none") +
   el(lab("load-error banner (only if the list fails to load)",12), cls="s1", mt=12, r=12, pad="10px 12px", background="var(--f0)", border=DASH) +
   el(_itemcard(n=2, snap_n=3, result=True, mt=0) + _itemcard(n=5), cls="", mt=12, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 11. RULES
def _rule(i, txt="rule text", n=None, mt=12):
    return el(f'<span style="width:20px;font-family:monospace;font-size:14px;color:var(--mut)">{i}.</span>' +
              el(lab(txt,14), cls="s1", grow=True, h=30, r=8, pad="0 10px", margin_left="12px", n=n),
              cls="rowc", mt=mt, border="none")
screen(id="rules", name="Rules",
 body=dev(bar("Rules") + content(
   el(f'<span style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">General</span>', n=1, border="none") +
   el(_rule(1,mt=8)+_rule(2,n=2)+_rule(3,"“Max 6 strokes per hole”")+_rule(4)+
      el(lab("…6 general rules total",12), mt=8, border="none", pad="0 0 0 32px"), cls="", border="none") +
   el(f'<span style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">Course notes</span>', mt=24, border="none") +
   el(f'{lab("◇  Course name",18)}'
      f'<div style="margin-top:8px">{lab("•  course note",14)}</div>'
      f'<div style="margin-top:4px">{lab("•  course note",14)}</div>',
      cls="s1 tint", n=3, mt=12, r=16, pad="16px", border=DASH)
 ))),

# ════════════════════════════════════════════════════════════ 12. LEADERBOARD
def _lbrow(you=False, n=None, mt=8):
    bd = "1px solid var(--ln)" if you else "1px solid var(--ln2)"
    youp = f'<span style="margin-left:8px;padding:2px 8px;border-radius:999px;background:var(--f2);font-size:10px;font-weight:700;color:var(--mut)">YOU</span>' if you else ""
    return el(f'<span style="width:24px;text-align:center;font-family:monospace;font-size:14px;color:var(--mut)">1</span>'
              f'<span style="margin-left:12px;font-family:ui-monospace,monospace;font-size:24px;font-weight:700">AVA</span>'
              f'<span style="margin-left:10px">{lab("course",12)}</span>{youp}'
              f'<span style="margin-left:auto">{sp("41",24,900)}</span>',
              cls="s1 rowc", n=n, r=16, pad="12px 16px", border=bd, mt=mt)
screen(id="tv", name="Leaderboard",
 body=dev(bar("Leaderboard") + content(
   el(_seg("Players",on=True,n=1)+_seg("🏅 Teams"), cls="rowc", gap="8px", border="none") +
   el(_seg("Day",on=True,n=2)+_seg("Week")+_seg("Month")+_seg("All"), cls="rowc", mt=8, gap="8px", border="none") +
   el(lab("announcement banner (hidden when none)",12), cls="s1", n=6, mt=12, r=12, pad="10px 12px", background="var(--f0)", border=DASH) +
   el(f'{lab("YOUR LAST ROUND",11)}', n=3, mt=14, border="none") +
   el(_lbrow(you=True, n=4, mt=8), cls="", border="none") +
   el(_lbrow(n=5) + _lbrow(), cls="", mt=12, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 13. PLAY TOGETHER (join + lobby)
screen(id="together", name="Play together (join + lobby)",
 body=dev(bar("Play together") + content(
   el(f'{lab("JOIN CODE",11)}<div style="margin-top:6px">{sp("AB12CD",30,900,"var(--ink)")}</div>', cls="s1 col", n=1, mt=0, r=16, pad="16px") +
   el(el("", cls="fill", w=120, h=120, r=12) + f'<div style="margin-top:8px">{lab("Scan, or open /join and type the code.",12)}</div>',
      cls="col", n=4, mt=12, border="none", background="none") +
   el(sp("Copy join link",14,700,"var(--ink)"), cls="ctr", h=44, r=12, mt=12, background="var(--f2)", border="1px solid var(--ln)") +
   el(sp("Players",14,700) + f'<span style="margin-left:auto"><span style="height:24px;padding:0 8px;border:1px solid var(--ln2);border-radius:999px;display:inline-flex;align-items:center;font-size:11px;color:var(--mut)">● Live</span></span>',
      cls="rowc", n=6, mt=16, border="none") +
   el(f'<div style="display:flex;gap:8px;align-items:center">{tag("AVA")}{lab("(this phone)",11)}</div>'
      f'<div style="margin-top:8px;display:flex;gap:8px">{tag("JZ")}{tag("KO")}</div>',
      cls="s1", n=5, mt=8, r=16, pad="14px") +
   btn("Start playing", primary=True, n=7, mt=12)
 ))),

# ════════════════════════════════════════════════════════════ 14. ARCADE HUB
def _atile(first=False):
    tk = f'<span style="margin-left:auto">{lab("🎟️",12)}</span>' if first else ''
    return el((chip("◇", size=36, r=8, gl=20, n=(2 if first else None))) +
              f'<span style="margin-left:10px">{lab("game — title",12)}</span>{tk}',
              cls="tile rowc", n=(1 if first else None), r=12, pad="10px 12px")
screen(id="arcade", name="Arcade hub",
 body=dev(bar("Arcade") + content(
   el(f'<div style="text-align:center">{lab("Every game in the house — plus facts and trivia.",13)}<div>{lab("Pass the time between attractions.",12)}</div></div>', border="none") +
   el("".join(_atile(first=(i==0)) for i in range(8)), cls="grid2", mt=12) +
   el(lab("…~22 tiles total (20 games + Fun Facts + Trivia)",12), mt=8, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 15. ARCADE PUTT (fills)
screen(id="putt", name="Arcade Putt",
 body=dev(bar("Arcade Putt") +
   el(lab("Mode picker precedes play — “Choose your game” · 🏁 9-Hole · ♾️ Endless",12), cls="s1", n=1, mt=0, r=16, pad="12px 14px", margin_left="16px", margin_right="16px") +
   el(sp("Hole n / 9",14,700) + f'<span style="margin-left:auto">{lab("Par · Strokes",14)}</span>', cls="rowc", n=2, pad="12px 16px 8px", border="none", flexnone=True) +
   el(lab("Canvas playfield — drag-to-aim slingshot; ball, cup+flag, bumpers, greens, hazards, splash.",12), cls="fill", n=3, grow=True, margin="0 16px", r=16) +
   el(lab("hint line",13), cls="ctr", h=40, border="none", flexnone=True) +
   el(btn("Next hole →", primary=True, mt=0) + '<span style="width:12px"></span>' + btn("Reset / End run", n=4, mt=0), cls="rowc", pad="4px 16px 16px", border="none", flexnone=True),
   fill=True)),

# ════════════════════════════════════════════════════════════ 16. MINIGAME SHELL (fills)
screen(id="game", name="Minigame shell",
 body=dev(bar("Game name") +
   el(sp("count (ball / frame)",14,700) + f'<span style="margin-left:auto">{lab("score / timer",14)}</span>', cls="rowc", n=1, pad="16px 16px 8px", border="none", flexnone=True) +
   el(lab("Canvas playfield — per-game sprites & interaction. On game-over → results screen (emoji + score + 🎟️ ticket award + Play again).",12), cls="fill", n=2, grow=True, margin="0 16px", r=16) +
   el(lab("hint line",13), cls="ctr", h=40, border="none", flexnone=True),
   fill=True)),

# ════════════════════════════════════════════════════════════ 17. WHILE YOU WAIT (facts + trivia)
screen(id="wait", name="While You Wait (facts + trivia)",
 body=dev(bar("Fun Facts · Trivia") + content(
   el(sp("💡",44) + f'<div style="margin-top:8px">{lab("fact text — tap the card to advance",13)}</div>', cls="s1 col", n=1, r=16, pad="28px 20px") +
   btn("Next fact →", primary=True, mt=12) +
   el(sp("Question 1 of 10",14,700) + f'<span style="margin-left:auto">{lab("Score 0",14)}</span>', cls="rowc", n=2, mt=20, border="none") +
   el(f'<div style="text-align:center">{sp("question text",15,600)}</div>', mt=8, border="none") +
   btn("choice", n=3, mt=10, h=44) + btn("choice", mt=8, h=44) + btn("choice", mt=8, h=44)
 ))),

# ════════════════════════════════════════════════════════════ 18. FOOD MENU
def _fooditem(n=None, mt=12):
    return el(el(f'{sp("Item name",16,700)}<div>{lab("short description",13)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
              f'<span style="margin-left:8px">{sp("$0.00",15,700)}</span>',
              cls="s1 rowc", n=n, r=16, pad="14px 16px", mt=mt)
screen(id="food", name="Food & Drink menu",
 body=dev(bar("Food & Drink") + content(
   el(lab("Active-orders card — an in-kitchen order (self-gating)",12), cls="s1", n=1, r=16, pad="12px 14px", border=DASH) +
   el(f'<span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">Category name</span>', n=2, mt=16, border="none") +
   el(_fooditem(n=3, mt=8) + _fooditem(), cls="", border="none") +
   el(lab("…more categories",12), mt=14, border="none") +
   el(sp("🛒  View cart · 2 items · $0.00",15,800,"var(--ink)"), cls="ctr", n=4, mt=16, h=52, r=16, background="var(--f2)", border="1px solid var(--ln)")
 ))),

# ════════════════════════════════════════════════════════════ 19. CHECKOUT
def _cartline(n=None, mt=12):
    return el(el(f'{sp("Item name",15,700)}<div>{lab("modifiers",12)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
              f'<div style="display:flex;align-items:center;gap:8px">{el(sp("−",18,700,"var(--mut)"),cls="keycap ctr",w=32,h=32,r=8)}{sp("1",15,700)}{el(sp("+",18,700,"var(--mut)"),cls="keycap ctr",w=32,h=32,r=8,n=(2 if n else None))}</div>',
              cls="s1 rowc", n=n, r=16, pad="12px 16px", mt=mt)
screen(id="checkout", name="Food checkout",
 body=dev(bar("Your order") + content(
   el(_cartline(n=1, mt=0) + _cartline(), cls="", border="none") +
   el(lab("Name for the order (optional)",14), mt=16, border="none") +
   el(lab("Who’s picking it up?",14), cls="s1", n=3, mt=8, h=44, r=12, pad="0 12px") +
   el(f'{el(lab("Subtotal",13)+"<span style=margin-left:auto>"+sp("$0.00",13)+"</span>",cls="rowc",border="none")}'
      f'{el(lab("Tax",13)+"<span style=margin-left:auto>"+sp("$0.00",13)+"</span>",cls="rowc",border="none",mt=6)}'
      f'{el(sp("Total",14,700)+"<span style=margin-left:auto>"+sp("$0.00",14,700)+"</span>",cls="rowc",border="none",mt=6)}',
      cls="sunk", n=4, mt=16, r=16, pad="14px 16px") +
   btn("Pay $0.00", primary=True, n=5, mt=16)
 ))),

# ════════════════════════════════════════════════════════════ 20. ORDER STATUS
def _stepr(glyph, label, mt=12):
    return el(el(sp(glyph,14), cls="ctr", w=24, h=24, r=999, background="var(--f2)", flexnone=True) +
              f'<span style="margin-left:12px">{lab(label,14)}</span>', cls="rowc", mt=mt, border="none")
screen(id="order", name="Order status",
 body=dev(bar("Order status") + content(
   el(f'<div style="text-align:center">{lab("ORDER NUMBER",11)}<div style="margin-top:2px">{sp("#123",30,900)}</div><div style="margin-top:4px">{lab("Estimated ready in ~8 min",13)}</div></div>', n=1, border="none") +
   el(f'<div style="text-align:center">{lab("SHOW THIS AT THE COUNTER",11)}<div style="margin-top:6px">{sp("PICKUP",30,900)}</div><div style="margin-top:6px">{lab("Your order is ready — grab it at the counter.",13)}</div></div>' + btn("I’ve picked it up", primary=True, mt=12),
      cls="s1", n=2, mt=16, r=16, pad="16px", border=DASH) +
   el(sp("🔔  Notify me when it’s ready",14,600,"var(--ink)"), cls="ctr", n=3, mt=12, h=44, r=12, background="var(--f1)", border="1px solid var(--ln2)") +
   el(_stepr("✓","Order received",mt=0)+_stepr("•","Sent to the kitchen")+_stepr("•","Being prepared")+_stepr("•","Ready for pickup!"),
      n=4, mt=16, border="none") +
   el(f'{lab("2× Item name",13)}<span style="margin-left:auto">{sp("$0.00",13)}</span>', cls="sunk rowc", n=5, mt=16, r=16, pad="14px 16px")
 ))),

# ════════════════════════════════════════════════════════════ 21. ME HUB
screen(id="me", name="Me hub",
 body=dev(bar("Me") + content(
   listrow("👤", "Player name", "View your profile", n=1, first=True) +
   btn("🏅  Achievements", n=2, mt=16) + btn("👥  My teams") + btn("🎟️  Rewards card") + btn("⬇️  Install app") + btn("🔒  Privacy")
 ))),

# ════════════════════════════════════════════════════════════ 22. ACCOUNT
def _field(label, ph, n=None, mt=8):
    return (el(lab(label,14), mt=mt, border="none") +
            el(lab(ph,14), cls="s1", n=n, mt=8, h=44, r=12, pad="0 12px"))
screen(id="account", name="Account (sign in / profile)",
 body=dev(bar("Account") + content(
   el(lab("bonus / rounds-claimed notice (conditional)",12), cls="s1", n=1, r=16, pad="10px 12px", background="var(--f0)") +
   el(lab("We’ll email you a 6-digit code — no password to remember.",13), mt=16, border="none") +
   _field("Email", "you@email.com", n=2, mt=16) +
   _field("Name (optional)", "Sam") +
   _field("Arcade tag (optional)", "ABC") +
   btn("Email me a code", primary=True, n=3, mt=16) +
   el(f'<div style="text-align:center">{lab("How we handle your info",12)}</div>', mt=12, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 23. TEAMS
def _teamrow(sub, n=None, first=False):
    return el(el(sp("Team name",18,700) + f'<div>{lab(sub,14)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
              f'<span style="margin-left:8px">{sp("›",20,400,"var(--mut)")}</span>',
              cls="s1 rowc", n=n, r=16, pad="16px", mt=(0 if first else 12))
screen(id="teams", name="Teams",
 body=dev(bar("Teams") + content(
   el(lab("No teams yet — name one below and invite your regulars.",13), border="none") +
   el(_teamrow("3 members · yours", n=1, first=True) + _teamrow("2 members"), mt=16, border="none") +
   el(lab("New team",14), mt=20, border="none") +
   el(lab("The Putters",14), cls="s1", n=2, mt=8, h=44, r=12, pad="0 12px") +
   btn("Create team", primary=True, n=3, mt=16)
 ))),

# ════════════════════════════════════════════════════════════ 24. ACHIEVEMENTS
def _badge(glyph, title, how, earned=False, n=None, first=False):
    bd = "1px solid var(--ln)" if earned else "1px solid var(--ln2)"
    st = {} if earned else {"opacity": ".6"}
    pill = f'<span style="margin-left:8px;padding:1px 7px;border-radius:999px;background:var(--f2);font-size:10px;font-weight:700;color:var(--mut)">Earned</span>' if earned else ''
    return el(el(sp(glyph,22), cls="chip", w=44, h=44, r=999) +
              el(f'<div style="display:flex;align-items:center">{sp(title,16,700)}{pill}</div><div>{lab(how,13)}</div>',
                 cls="col ai-start", grow=True, border="none", background="none", margin_left="14px"),
              cls="s1 rowc", n=n, r=16, pad="14px", border=bd, mt=(0 if first else 12), **st)
screen(id="achv", name="Achievements",
 body=dev(bar("Achievements") + content(
   el(f'<div style="text-align:center">{lab("1 of 3 unlocked · earn tickets at the counter",13)}</div>', n=1, border="none") +
   el(_badge("🎯","Hole-in-One","Sink any hole in a single stroke.",earned=True,n=2,first=True) +
      _badge("⛳","Under Par","Finish a round below the course par.") +
      _badge("🕵️","Hunt Master","Complete a course's scavenger hunt."),
      mt=16, border="none") +
   el(f'<div style="text-align:center">{lab("Tracked on this device. Sign in to keep them.",12)}</div>', mt=16, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 25. REWARDS
def _baltile(glyph, label, n=None):
    return el(sp(glyph,28) + f'<div style="margin-top:6px">{sp("0",22,900)}</div><div>{lab(label,12)}</div>',
              cls="tile col", n=n, r=16, pad="16px 12px")
screen(id="rewards", name="Rewards card",
 body=dev(bar("Rewards card") + content(
   el(el(sp("Player name",18,700) + f'<div>{lab("Card •••1234 · gold",14)}</div>', cls="col ai-start", grow=True, border="none", background="none") +
      f'<span style="margin-left:8px">{lab("Unlink",13)}</span>',
      cls="s1 rowc", n=1, r=16, pad="16px") +
   el(_baltile("🎟️","Tickets",n=2) + _baltile("🕹️","Credits"), cls="grid2", mt=12) +
   el(f'<span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">Activity</span>', mt=20, border="none") +
   el(f'{lab("🎟️ Tickets · source",13)}<span style="margin-left:auto">{sp("+N",15,700)}</span>', cls="sunk rowc", n=3, mt=8, r=12, pad="10px 14px") +
   el(lab("Nothing yet — game tickets will show up here.",12), mt=12, border="none")
 ))),

# ════════════════════════════════════════════════════════════ 26. PHOTO BOOTH
screen(id="photos", name="Photo Booth",
 body=dev(bar("Photo Booth") + content(
   el(lab("Snap a photo, pile on stickers, share it. Saved photos stay on this phone until you share.",13), border="none") +
   btn("📸  Take a photo", primary=True, n=1, mt=16) +
   el(f'<span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)">Camera roll</span>', mt=20, border="none") +
   el(el("", cls="fill", grow=True, h=104, r=12) + el("", cls="fill", grow=True, h=104, r=12) + el("", cls="fill", grow=True, h=104, r=12),
      cls="rowc", n=2, mt=8, gap="8px", border="none") +
   el(lab("EDITOR: base photo + draggable stickers + frame + forced venue watermark",12), cls="fill", n=3, mt=16, h=120, r=12) +
   el("".join(el(sp(g,18,700,"var(--mut)"), cls="keycap ctr", w=44, h=40, r=10, margin_left=("0" if i==0 else "8px")) for i,g in enumerate(["−","+","↺","↻","🗑️"])),
      cls="rowc", n=4, mt=12, border="none") +
   el(lab("frames strip · sticker sheet (venue SVGs + emoji)",12), cls="s1", mt=12, r=12, pad="10px 12px")
 ))),

# ════════════════════════════════════════════════════════════ 27. INSTALL
def _step(i, t):
    return el(el(sp(str(i),12,700,"var(--mut)"), cls="ctr", w=24, h=24, r=999, background="var(--f2)", flexnone=True) +
              f'<span style="margin-left:12px">{lab(t,14)}</span>', cls="rowc", mt=(0 if i==1 else 16), border="none")
screen(id="install", name="Install",
 body=dev(bar("Install the app") + content(
   el(sp("⛳",48) + f'<div style="margin-top:8px">{sp("Add Mini Golf to your phone",22,900)}</div>' +
      f'<div style="margin-top:4px">{lab("Installs like a normal app — full screen, offline.",13)}</div>',
      cls="col", n=1, mt=4, border="none", background="none") +
   el(f'{lab("Branch card — 1 of 4: Installed / iOS steps / Native prompt / Generic",12)}'
      + el(_step(1,"step instruction") + _step(2,"step instruction") + _step(3,"step instruction"),
           cls="", mt=12, border="none"),
      cls="s1", n=2, mt=24, r=16, pad="20px") +
   el(lab("platform warning box",12), cls="s1", n=3, mt=12, r=8, pad="12px", background="var(--f0)")
 ))),

# ════════════════════════════════════════════════════════════ 28. TV WALL (landscape)
def _wallcol(n=None):
    rows = "".join(
      f'<div style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--ln2)">'
      f'<span style="width:20px;font-family:monospace;font-size:13px;color:var(--mut)">{i}</span>'
      f'<span style="flex:1;font-family:ui-monospace,monospace;font-size:16px;font-weight:700">AVA</span>'
      f'<span style="font-size:15px;font-weight:900">41</span></div>' for i in range(1,4))
    return el(f'<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--f2);border-bottom:2px solid var(--ln)">{lab("◇",16)}{sp("Course",14,800)}</div>{rows}',
              cls="s1", n=n, grow=True, r=10, pad="0", overflow="hidden", align_self="stretch")
screen(id="wall", name="TV Wall (venue display)",
 body=f'<div class="dv" style="width:390px;min-height:220px">'
      f'<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--ln2)">'
      f'{sp("⛳ Venue Leaderboard",16,900)}<span style="margin-left:auto">{lab("Today · announcement",12)}</span></div>'
      f'{el(_wallcol(n=1)+_wallcol()+_wallcol(), cls="rowc", pad="10px", gap="8px", border="none", align_items="stretch")}'
      f'</div>'),

# ════════════════════════════════════════════════════════════ 29. CHALLENGE SPINNER
screen(id="spinner", name="Challenge Spinner",
 body=dev(bar("Challenge Spinner") + content(
   el(lab("COURSE NAME CHALLENGES (only when opened from a round)",12), cls="ctr", n=1, r=12, pad="8px 12px", background="var(--f0)", border=DASH) +
   el(f'<div style="text-align:center;font-size:20px;line-height:1">🔻</div>' +
      el(lab("wheel — one wedge per challenge; emoji upright at 66% radius; hub cap",12),
         cls="fill ctr", w=280, h=280, r=999, margin="4px auto 0", pad="0 32px"),
      cls="", n=2, mt=16, border="none") +
   el(f'<div style="text-align:center"><span style="display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;background:var(--f2);border:1px solid var(--ln);font-size:11px;font-weight:700;color:var(--mut)">⛳️ Next-shot twist / 🎉 Just for fun</span></div>'
      f'<div style="margin-top:10px;text-align:center">{sp("🎲",34)}</div>'
      f'<div style="margin-top:6px;text-align:center">{sp("challenge text",16,600)}</div>',
      cls="s1", n=3, mt=16, r=16, pad="16px", border=DASH) +
   el(f'<div style="text-align:center">{lab("hint line — “Tap spin for a challenge…” (only when no result)",12)}</div>', n=4, mt=10, border="none") +
   btn("Spin the wheel", primary=True, n=5, mt=12)
 ))),

# ════════════════════════════════════════════════════════════ 30. TEAM DETAIL
def _memberrow(action, you=False, first=False):
    who = "Player name (you)" if you else "Player name"
    cap = "Owner" if you else "Member"
    act = f'<span style="margin-left:8px;font-size:13px;font-weight:600;color:#b55">{action}</span>' if action else ''
    return el(tag("AVA",size=13,h=24) +
              el(sp(who,15,700) + f'<div>{lab(cap,12)}</div>', cls="col ai-start", grow=True, border="none", background="none", margin_left="12px") + act,
              cls="s1 rowc", r=16, pad="10px 16px", mt=(0 if first else 8))
screen(id="teamdetail", name="Team detail",
 body=dev(bar("Team name") + content(
   el(lab("Members",14), border="none") +
   el(_memberrow(None, you=True, first=True) + _memberrow("Remove") + _memberrow("Remove"), n=1, mt=8, border="none") +
   el(lab("OWNER ONLY ↓",11), n=3, mt=16, border="none") +
   el(lab("Invited (pending) — friend@example.com",12), cls="s1", n=4, mt=8, r=12, pad="8px 12px", background="var(--f0)", border=DASH) +
   el(lab("Invite by email",14), mt=14, border="none") +
   el(lab("friend@example.com",14), cls="s1", n=5, mt=8, h=44, r=12, pad="0 12px") +
   btn("Send invite", primary=True, mt=10, h=44) +
   el(lab("Team name",14), mt=16, border="none") +
   el(lab("The Putters",14), cls="s1", n=6, mt=8, h=44, r=12, pad="0 12px") +
   btn("Rename", mt=10, h=44) +
   el(sp("Archive team",16,700,"#b55"), cls="ctr", n=7, mt=8, h=44, r=16, background="var(--f1)", border="1px solid #c98") +
   el(lab("footer error / notice lines — bottom of the page",12), cls="ctr jc-start", n=8, mt=12, r=12, pad="8px 12px", background="var(--f0)", border=DASH)
 ))),

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
.puck{background:var(--f2);border:1px solid var(--ln)}
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
/* On screen the sheet artboards stay TRUE 390px (the overlay/trace layer) — no
   zoom, so an artist can lay one over a 390px app screenshot 1:1. Print alone
   scales them down to fit the page grid. */
@media print { .sheet .dv{zoom:.42} }
"""

# ———————————————————————————————————————————————— contact sheet (trace layer)
def render_cell(sc, idx):
    body = re.sub(r'<i class="cn">\d+</i>', '', sc["body"])   # drop markers
    name = sc["name"].split(" (")[0]
    return (f'<div class="cell"><div class="celltitle">{idx}. {name}</div>'
            f'<div class="sheet">{body}</div></div>')

sheet_head = """<div class="sheethead">
 <h1>Mini Golf — Screens (to scale)</h1>
 <p>Every screen's element layout drawn to scale on a 390px phone artboard — the overlay/trace layer. On screen these are true size; open a screen at 390px and design your art over the matching board. Companion to the full <b>Screen &amp; Element Guide</b> (dimensions, states, theming hooks, and the art needed per element). 30 screens across five sections; each screen's top-right pill is the menu button that opens the global navigation drawer.</p>
 <div class="note"><b>A template, not the design.</b> Neutral fills so your art reads over them. A <b>dashed</b> card appears only when populated (a live round, a pending order, venue specials); a <b>solid</b> card is always present. Player-scaled screens are drawn at 4 players; the Course Map and game playfields fill the device below the bar.</div>
</div>"""
cells = "".join(render_cell(sc, i+1) for i, sc in enumerate(SCREENS))
html2 = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Mini Golf — Screens</title><style>{CSS}</style></head>
<body>{sheet_head}<div class="grid-screens">{cells}</div></body></html>"""
open(OUT2, "w").write(html2)
print("wrote", OUT2, "screens:", len(SCREENS))
