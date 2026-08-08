// The bake-off page, shared by the standalone server
// (scripts/compare-vision-ui.mjs) and the temporary Master Control mount
// (server/routes/admin/visionBakeoff.js). One HTML string, no build step;
// `renderPage(apiBase, authMode)` points its two API calls at whichever
// backend serves it. Client JS deliberately avoids template literals so this
// server-side template literal stays escape-free.
//
// authMode:
//   "bearer" (standalone) — ?token= from the URL, sent as a Bearer header.
//   "admin"  (Master Control) — reuses the SPA's login: the admin session
//     cookie flows on same-origin fetches automatically, and a token login
//     (APP_TOKEN kept in localStorage under 'ffc_admin_token', same key as
//     admin/api.ts) is re-sent as the x-app-token header.

import { HUNT_PROMPT_TEMPLATE } from "./vision-compare-core.mjs";

export function renderPage(apiBase, authMode = "bearer") {
  return PAGE.replaceAll("__API_BASE__", apiBase)
    .replaceAll("__AUTH_MODE__", authMode)
    .replaceAll('"__HUNT_TEMPLATE_JSON__"', JSON.stringify(HUNT_PROMPT_TEMPLATE));
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vision bake-off</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --ink: #1a202c; --muted: #64748b;
    --line: #e2e8f0; --accent: #2563eb; --err: #b91c1c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .panel {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px; margin-bottom: 16px;
  }
  .panel h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); margin: 0 0 10px; }
  .drop {
    border: 2px dashed var(--line); border-radius: 10px; padding: 28px;
    text-align: center; color: var(--muted); cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .drop.over { border-color: var(--accent); background: #eff6ff; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .thumb { position: relative; }
  .thumb img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px;
    border: 1px solid var(--line); display: block; }
  .thumb button {
    position: absolute; top: -6px; right: -6px; width: 22px; height: 22px;
    border-radius: 50%; border: none; background: var(--ink); color: #fff;
    cursor: pointer; font-size: 12px; line-height: 1;
  }
  .thumb .nm { font-size: 11px; color: var(--muted); max-width: 96px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thumb .subj { width: 96px; margin-top: 4px; border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 6px; font: inherit; font-size: 12px; }
  .modes { display: flex; gap: 16px; margin-bottom: 10px; }
  #storedWrap { margin-top: 12px; }
  #storedList { margin: 8px 0; max-height: 240px; overflow-y: auto; }
  .stored-item { display: flex; align-items: center; gap: 8px; padding: 3px 0;
    font-size: 14px; cursor: pointer; }
  .stored-item .meta { font-size: 12px; }
  .verdict { font-weight: 600; }
  .verdict.yes { color: #15803d; }
  .verdict.no { color: var(--err); }
  .flag { display: inline-block; background: #fef3c7; color: #92400e;
    border-radius: 6px; padding: 0 6px; font-size: 12px; margin-left: 6px; }
  .provs { display: flex; flex-wrap: wrap; gap: 8px; }
  .prov {
    display: flex; align-items: center; gap: 8px; border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 12px; cursor: pointer; background: #fff;
  }
  .prov.off { opacity: .45; cursor: not-allowed; }
  .prov .price { color: var(--muted); font-size: 12px; }
  textarea {
    width: 100%; min-height: 70px; border: 1px solid var(--line);
    border-radius: 8px; padding: 10px; font: inherit; resize: vertical;
  }
  .runrow { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .btn {
    background: var(--accent); color: #fff; border: none; border-radius: 8px;
    padding: 10px 22px; font: inherit; font-weight: 600; cursor: pointer;
  }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); }
  label.chk { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .imgsec { margin: 26px 0 10px; display: flex; align-items: center; gap: 12px; }
  .imgsec img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px;
    border: 1px solid var(--line); }
  .imgsec h3 { margin: 0; font-size: 16px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .cell { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .cell .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .cell .hd b { font-size: 14px; }
  .cell .meta { color: var(--muted); font-size: 12px; }
  .cell .txt { white-space: pre-wrap; }
  .cell.err .txt { color: var(--err); }
  .cell.pending .txt { color: var(--muted); font-style: italic; }
  table { border-collapse: collapse; width: 100%; background: var(--card);
    border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-top: 1px solid var(--line);
    font-size: 14px; }
  th { background: #f1f5f9; border-top: none; font-size: 12px;
    text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .charts { display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    margin: 10px 0 16px; }
  .chartcard { background: #fcfcfb; border: 1px solid var(--line);
    border-radius: 10px; padding: 12px 14px; }
  .chartcard h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600;
    color: #52514e; text-transform: uppercase; letter-spacing: .04em; }
  .chartcard svg { display: block; width: 100%; height: auto; }
  #burn {
    position: fixed; right: 14px; bottom: 14px; z-index: 10;
    background: var(--ink); color: #fff; border-radius: 999px;
    padding: 8px 16px; font-size: 13px; font-variant-numeric: tabular-nums;
    box-shadow: 0 2px 10px rgba(0,0,0,.25);
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Vision provider bake-off</h1>
  <p class="sub">Side-by-side descriptions with exact billed tokens and cost.
    Decision rule: <code>IMAGE-DESCRIPTION-PRICING.md</code>.</p>

  <div class="panel">
    <h2>1 · Images (~5 real workload photos)</h2>
    <div class="drop" id="drop">Drop images here or click to choose
      (jpg / png / webp / gif)</div>
    <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/gif"
      multiple hidden>
    <div id="storedWrap" hidden>
      <button class="btn ghost" id="loadStored" type="button">Browse stored hunt
        photos</button>
      <span class="meta" id="storedStatus"></span>
      <div id="storedList"></div>
      <button class="btn" id="addStored" type="button" hidden>Add selected</button>
    </div>
    <div class="thumbs" id="thumbs"></div>
    <p class="meta">The image set is saved on the server and reloads next
      visit. <button class="btn ghost" id="clearDataset" type="button">Clear
      image set</button></p>
  </div>

  <div class="panel">
    <h2>2 · Providers</h2>
    <div class="provs" id="provs"></div>
  </div>

  <div class="panel">
    <h2>3 · Prompt</h2>
    <div class="modes">
      <label class="chk"><input type="radio" name="mode" id="modeDescribe" checked>
        Describe (open description)</label>
      <label class="chk"><input type="radio" name="mode" id="modeHunt">
        Hunt verify (per-image subject, Haiku pre-scan)</label>
    </div>
    <textarea id="prompt"></textarea>
    <p class="meta" id="promptHint" hidden>__SUBJECT__ is replaced with each
      image's subject (auto-filled by the pre-scan; edit under the thumbnails).</p>
  </div>

  <div class="panel runrow">
    <button class="btn" id="run" disabled>Run comparison</button>
    <label class="chk"><input type="checkbox" id="blind">
      Blind judging (hide who wrote what until reveal)</label>
    <button class="btn ghost" id="reveal" hidden>Reveal providers</button>
    <span class="meta" id="status"></span>
  </div>

  <div id="results"></div>
  <div id="summary"></div>
  <div id="alltime"></div>
</div>
<div id="burn" hidden></div>

<script>
"use strict";
var API_BASE = "__API_BASE__";
var AUTH_MODE = "__AUTH_MODE__";
var HUNT_TEMPLATE = "__HUNT_TEMPLATE_JSON__";
var state = {
  providers: [], images: [], results: [], blindMap: null,
  describePrompt: "", huntPrompt: HUNT_TEMPLATE,
};

function huntMode() { return document.getElementById("modeHunt").checked; }

// Session-wide burn ticker: every model call this page makes (pre-scans AND
// comparison runs, all providers) rolls into one always-visible pill.
// Aggregated across providers, so it leaks nothing in blind mode.
var burn = { calls: 0, inTok: 0, outTok: 0, cost: 0 };
function addBurn(j) {
  if (!j || j.inputTokens == null) return;
  burn.calls += 1;
  burn.inTok += j.inputTokens || 0;
  burn.outTok += j.outputTokens || 0;
  burn.cost += j.cost || 0;
  var elp = document.getElementById("burn");
  elp.hidden = false;
  elp.textContent = burn.calls + " calls \\u00b7 " +
    burn.inTok.toLocaleString() + " in / " +
    burn.outTok.toLocaleString() + " out \\u00b7 $" + burn.cost.toFixed(4);
}
var TOKEN = new URLSearchParams(location.search).get("token") || "";
if (!TOKEN && AUTH_MODE === "admin") {
  // Same-origin with the Master Control SPA: reuse its stored APP_TOKEN
  // (token-mode login; admin/api.ts keeps it in sessionStorage — which is
  // per-tab, so this only works when this page is opened in the tab that
  // logged in; the 401 fallback below covers fresh tabs). Session-cookie
  // logins need nothing — the cookie rides same-origin fetches on its own.
  try {
    TOKEN = sessionStorage.getItem("ffc_admin_token") ||
      localStorage.getItem("ffc_admin_token") || "";
  } catch (e) {}
}

function apiHeaders(extra) {
  var h = extra || {};
  if (TOKEN) {
    if (AUTH_MODE === "admin") h["x-app-token"] = TOKEN;
    else h["authorization"] = "Bearer " + TOKEN;
  }
  return h;
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

fetch(API_BASE + "/providers", { headers: apiHeaders() }).then(function (r) {
  if (r.status === 401) {
    var sub = document.querySelector(".sub");
    if (AUTH_MODE === "admin") {
      sub.textContent = "401: open this page from the tab where Master " +
        "Control is signed in, or enter the admin token: ";
      var btn = el("button", "btn ghost", "Enter admin token");
      btn.addEventListener("click", function () {
        var t = window.prompt("APP_TOKEN (stored for this tab only):");
        if (!t) return;
        try { sessionStorage.setItem("ffc_admin_token", t); } catch (e) {}
        location.reload();
      });
      sub.appendChild(btn);
    } else {
      sub.textContent = "401: open this page with ?token=<BAKEOFF_TOKEN> in the URL.";
    }
  }
  if (r.status === 403) {
    document.querySelector(".sub").textContent =
      "403: this page is super_admin only (it spends real money on provider keys).";
  }
  return r.json();
}).then(function (d) {
  if (!d.providers) return;
  state.providers = d.providers;
  state.describePrompt = d.defaultPrompt;
  if (!huntMode()) document.getElementById("prompt").value = d.defaultPrompt;
  var box = document.getElementById("provs");
  d.providers.forEach(function (p) {
    var lab = el("label", "prov" + (p.configured ? "" : " off"));
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p.name;
    cb.checked = p.configured;
    cb.disabled = !p.configured;
    lab.appendChild(cb);
    var txt = el("span", null, p.name);
    lab.appendChild(txt);
    var price = el("span", "price", p.configured
      ? "$" + p.priceIn + " / $" + p.priceOut + " per MTok"
      : p.keyEnv + " not set");
    lab.appendChild(price);
    box.appendChild(lab);
  });
  updateRunButton();
});

// --- persistent dataset + run history ------------------------------------
// The server keeps the image set and every model call's result on disk;
// the page loads both on open and clears either on demand.
function persistImage(img) {
  fetch(API_BASE + "/dataset", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      name: img.name,
      subject: img.subject,
      mediaType: img.mediaType,
      imageBase64: img.base64,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j.id) img.id = j.id; })
    .catch(function () {});
}

function persistSubject(img) {
  if (!img.id) return;
  fetch(API_BASE + "/dataset/" + img.id + "/subject", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ subject: img.subject }),
  }).catch(function () {});
}

function logRun(row) {
  fetch(API_BASE + "/runs", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(row),
  }).catch(function () {});
}

function loadDataset() {
  fetch(API_BASE + "/dataset", { headers: apiHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.images || !d.images.length) return;
      d.images.forEach(function (metaRow) {
        fetch(API_BASE + "/dataset/" + metaRow.id + "/image", { headers: apiHeaders() })
          .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
          .then(function (blob) {
            var reader = new FileReader();
            reader.onload = function () {
              var dataUrl = String(reader.result);
              state.images.push({
                id: metaRow.id,
                name: metaRow.name,
                subject: metaRow.subject || "",
                mediaType: metaRow.mediaType,
                dataUrl: dataUrl,
                base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
                scanning: false,
              });
              renderThumbs();
              updateRunButton();
            };
            reader.readAsDataURL(blob);
          })
          .catch(function () {});
      });
    })
    .catch(function () {});
}

// --- charts (inline SVG, no libraries) ------------------------------------
// Small multiples over the all-time per-provider stats: one measure per
// chart, providers as rows in a fixed order shared by every chart. Single
// hue per chart (magnitude lives in bar length; identity lives in the row
// labels); the reserved status red marks the error chart. Exact values live
// in the all-time table below — the charts are for comparison at a glance.
var VIZ = {
  bar: "#2a78d6",      // series blue
  band: "#9ec5f4",     // blue step-200 for latency min-max range
  err: "#d03b3b",      // status critical
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  ink: "#52514e",
  muted: "#898781",
};

function svgNode(tag, attrs) {
  var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (var k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Horizontal bar anchored at x0, rounded 4px on the data end only.
function barPath(x0, y, w, h, rightRounded) {
  var r = Math.min(4, w, h / 2);
  if (!rightRounded || w <= r) return null;
  return "M" + x0 + " " + y +
    " h" + (w - r) + " a" + r + " " + r + " 0 0 1 " + r + " " + r +
    " v" + (h - 2 * r) + " a" + r + " " + r + " 0 0 1 -" + r + " " + r +
    " h-" + (w - r) + " z";
}

function svgText(x, y, str, fill, anchor, size) {
  var t = svgNode("text", {
    x: x, y: y, fill: fill, "text-anchor": anchor || "start",
    "font-size": size || 11,
    "font-family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  });
  t.textContent = str;
  return t;
}

// rows: [{label, value, display, hover, min?, max?}] — when min/max are set
// the mark is a range band with an avg tick instead of a bar.
function chartCard(title, rows, opts) {
  var W = 330, LABEL = 108, VALW = 74, PAD = 6;
  var ROWH = 24, TOP = 4, BOT = 16;
  var plotW = W - LABEL - VALW - PAD * 2;
  var H = TOP + rows.length * ROWH + BOT;
  var max = opts.max;
  if (max == null) {
    max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.max != null ? r.max : r.value); });
  }
  if (max <= 0) max = 1;
  var x = function (v) { return LABEL + PAD + (v / max) * plotW; };

  var card = el("div", "chartcard");
  card.appendChild(el("h3", null, title));
  var svg = svgNode("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

  // hairline grid at 0 / half / max, with tick labels
  [0, max / 2, max].forEach(function (v) {
    svg.appendChild(svgNode("line", {
      x1: x(v), y1: TOP, x2: x(v), y2: TOP + rows.length * ROWH,
      stroke: v === 0 ? VIZ.axis : VIZ.grid, "stroke-width": 1,
    }));
    svg.appendChild(svgText(x(v), H - 4, opts.tick(v), VIZ.muted,
      v === 0 ? "start" : v === max ? "end" : "middle", 9));
  });

  rows.forEach(function (r, i) {
    var yMid = TOP + i * ROWH + ROWH / 2;
    var g = svgNode("g", {});
    var t = svgNode("title", {});
    t.textContent = r.hover || (r.label + ": " + r.display);
    g.appendChild(t);
    g.appendChild(svgText(LABEL, yMid + 4,
      r.label.length > 17 ? r.label.slice(0, 16) + "\\u2026" : r.label,
      VIZ.ink, "end"));
    if (r.min != null && r.max != null) {
      // latency: range band min→max + avg tick
      var bx = x(r.min), bw = Math.max(2, x(r.max) - x(r.min));
      var band = svgNode("rect", {
        x: bx, y: yMid - 3, width: bw, height: 6, rx: 3, fill: VIZ.band,
      });
      g.appendChild(band);
      g.appendChild(svgNode("rect", {
        x: Math.max(LABEL + PAD, x(r.value) - 1.5), y: yMid - 6,
        width: 3, height: 12, rx: 1.5, fill: opts.color,
      }));
    } else {
      var w = Math.max(0, x(r.value) - x(0));
      var p = barPath(x(0), yMid - 5, w, 10, true);
      if (p) g.appendChild(svgNode("path", { d: p, fill: opts.color }));
      else g.appendChild(svgNode("rect", {
        x: x(0), y: yMid - 5, width: Math.max(w, 1), height: 10, fill: opts.color,
      }));
    }
    g.appendChild(svgText(W - 2, yMid + 4, r.display, VIZ.ink, "end"));
    svg.appendChild(g);
  });

  card.appendChild(svg);
  return card;
}

// Fixed row order across every chart: the provider lineup order, then
// anything else (e.g. the prescan pseudo-provider) after it.
function orderedProviders(list) {
  var known = state.providers.map(function (p) { return p.name; });
  return list.slice().sort(function (a, b) {
    var ia = known.indexOf(a.name), ib = known.indexOf(b.name);
    if (ia === -1) ia = 999;
    if (ib === -1) ib = 999;
    return ia - ib || (a.name < b.name ? -1 : 1);
  });
}

function drawCharts(container, s) {
  var provs = orderedProviders(s.providers);
  var box = el("div", "charts");
  var pct = function (v) { return Math.round(v) + "%"; };

  var latRows = provs.filter(function (p) { return p.latAvg != null; })
    .map(function (p) {
      return {
        label: p.name, value: p.latAvg, min: p.latMin, max: p.latMax,
        display: p.latAvg + "ms",
        hover: p.name + ": " + p.latMin + " / " + p.latAvg + " / " + p.latMax + " ms (min/avg/max)",
      };
    });
  if (latRows.length) {
    box.appendChild(chartCard("Latency \\u2014 min\\u2013max band, avg tick", latRows,
      { color: VIZ.bar, tick: function (v) { return Math.round(v) + "ms"; } }));
  }

  var costRows = provs.filter(function (p) { return p.calls - p.errors > 0; })
    .map(function (p) {
      var avg = p.cost / (p.calls - p.errors);
      return {
        label: p.name, value: avg, display: "$" + avg.toFixed(5),
        hover: p.name + ": $" + avg.toFixed(6) + " avg per call, $" + p.cost.toFixed(4) + " total",
      };
    });
  if (costRows.length) {
    box.appendChild(chartCard("Avg cost per call", costRows,
      { color: VIZ.bar, tick: function (v) { return "$" + v.toFixed(4); } }));
  }

  var tokRows = provs.filter(function (p) { return p.avgInTok > 0; })
    .map(function (p) {
      return {
        label: p.name, value: p.avgInTok, display: p.avgInTok.toLocaleString(),
        hover: p.name + ": " + p.avgInTok.toLocaleString() + " avg billed input tokens per image",
      };
    });
  if (tokRows.length) {
    box.appendChild(chartCard("Avg input tokens per image", tokRows,
      { color: VIZ.bar, tick: function (v) { return Math.round(v).toLocaleString(); } }));
  }

  var errRows = provs.map(function (p) {
    var rate = p.calls ? (p.errors / p.calls) * 100 : 0;
    return {
      label: p.name, value: rate, display: p.errors + "/" + p.calls,
      hover: p.name + ": " + p.errors + " errors in " + p.calls + " calls (" + Math.round(rate) + "%)",
    };
  });
  box.appendChild(chartCard("Error rate", errRows,
    { color: VIZ.err, max: 100, tick: pct }));

  var huntProvs = provs.filter(function (p) { return p.huntN > 0; });
  if (huntProvs.length) {
    box.appendChild(chartCard("Valid JSON verdicts (hunt)", huntProvs.map(function (p) {
      var rate = (p.jsonOk / p.huntN) * 100;
      return {
        label: p.name, value: rate, display: p.jsonOk + "/" + p.huntN,
        hover: p.name + ": " + p.jsonOk + " of " + p.huntN + " hunt replies were valid JSON",
      };
    }), { color: VIZ.bar, max: 100, tick: pct }));

    box.appendChild(chartCard("\\u201cPresent\\u201d verdict rate (hunt)", huntProvs.map(function (p) {
      var rate = p.jsonOk ? (p.presentN / p.jsonOk) * 100 : 0;
      return {
        label: p.name, value: rate, display: p.presentN + "/" + p.jsonOk,
        hover: p.name + ": judged present in " + p.presentN + " of " + p.jsonOk + " valid verdicts",
      };
    }), { color: VIZ.bar, max: 100, tick: pct }));

    var confRows = huntProvs.filter(function (p) { return p.confAvg != null; })
      .map(function (p) {
        return {
          label: p.name, value: p.confAvg * 100,
          display: Math.round(p.confAvg * 100) + "%",
          hover: p.name + ": average self-reported confidence " + Math.round(p.confAvg * 100) + "%",
        };
      });
    if (confRows.length) {
      box.appendChild(chartCard("Avg self-reported confidence (hunt)", confRows,
        { color: VIZ.bar, max: 100, tick: pct }));
    }
  }

  container.appendChild(box);
}

function refreshAllTime() {
  fetch(API_BASE + "/runs/summary", { headers: apiHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var box = document.getElementById("alltime");
      box.textContent = "";
      if (!s.providers || !s.providers.length) return;
      var h = el("h2", null, "All-time (since last clear)");
      box.appendChild(h);
      var head = el("p", "meta",
        s.totals.calls + " calls \\u00b7 " + s.totals.inTok.toLocaleString() +
        " in / " + s.totals.outTok.toLocaleString() + " out \\u00b7 $" +
        s.totals.cost.toFixed(4) + " ");
      var clr = el("button", "btn ghost", "Clear results");
      clr.addEventListener("click", function () {
        if (!window.confirm("Clear ALL stored run results?")) return;
        fetch(API_BASE + "/runs", { method: "DELETE", headers: apiHeaders() })
          .then(function () { refreshAllTime(); });
      });
      head.appendChild(clr);
      box.appendChild(head);
      drawCharts(box, s);
      var table = document.createElement("table");
      var thead = el("tr");
      ["Provider", "Calls", "Avg in-tok", "Total cost", "Latency min / avg / max", "Errors"]
        .forEach(function (x, i) { thead.appendChild(el("th", i > 0 ? "num" : null, x)); });
      table.appendChild(thead);
      s.providers.forEach(function (p) {
        var tr = el("tr");
        tr.appendChild(el("td", null, p.name));
        tr.appendChild(el("td", "num", String(p.calls)));
        tr.appendChild(el("td", "num", p.avgInTok ? p.avgInTok.toLocaleString() : "\\u2014"));
        tr.appendChild(el("td", "num", "$" + p.cost.toFixed(4)));
        tr.appendChild(el("td", "num", p.latMin != null
          ? p.latMin + " / " + p.latAvg + " / " + p.latMax + " ms" : "\\u2014"));
        tr.appendChild(el("td", "num", String(p.errors)));
        table.appendChild(tr);
      });
      box.appendChild(table);
    })
    .catch(function () {});
}

document.getElementById("clearDataset").addEventListener("click", function () {
  if (!window.confirm("Clear the whole stored image set?")) return;
  fetch(API_BASE + "/dataset", { method: "DELETE", headers: apiHeaders() })
    .then(function () {
      state.images = [];
      renderThumbs();
      updateRunButton();
    });
});

loadDataset();
refreshAllTime();

// --- stored hunt photos (admin mount only) ------------------------------
// GET /api/admin/photos already lists stored photos with the hunt item each
// was submitted for; /:id/image serves the bytes. Selected photos join the
// bake-off with subject pre-filled from that itemName — real production
// pairings, no upload and no pre-scan needed. Note these are all verified
// finds (ground truth present=true); for negative cases upload a photo or
// edit a subject to something not in frame.
var ADMIN_PHOTOS = API_BASE.replace(/\\/vision-bakeoff$/, "") + "/photos";
if (AUTH_MODE === "admin") {
  document.getElementById("storedWrap").hidden = false;
}

document.getElementById("loadStored").addEventListener("click", function () {
  var status = document.getElementById("storedStatus");
  status.textContent = "loading\\u2026";
  fetch(ADMIN_PHOTOS + "?limit=50", { headers: apiHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (allRows) {
      var list = document.getElementById("storedList");
      list.textContent = "";
      if (!Array.isArray(allRows)) {
        status.textContent = (allRows && allRows.error) || "failed to list photos";
        return;
      }
      // Test-data policy: no guests in bake-off images — these photos get
      // sent to every enabled third-party provider, so photos the verifier
      // flagged as containing people are excluded outright.
      var rows = allRows.filter(function (p) { return !p.peoplePresent; });
      var hidden = allRows.length - rows.length;
      status.textContent = (rows.length
        ? rows.length + " people-free photos (newest first)"
        : "no people-free stored photos") +
        (hidden ? " \\u00b7 " + hidden + " with people excluded" : "");
      rows.forEach(function (p) {
        var lab = el("label", "stored-item");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = p.id;
        cb.dataset.item = p.itemName || "";
        lab.appendChild(cb);
        lab.appendChild(el("span", null, p.itemName || "(unknown item)"));
        lab.appendChild(el("span", "meta",
          (p.courseName || "") + " \\u00b7 " +
          new Date(p.createdAt).toLocaleDateString()));
        list.appendChild(lab);
      });
      document.getElementById("addStored").hidden = rows.length === 0;
    })
    .catch(function (e) { status.textContent = "failed: " + e; });
});

document.getElementById("addStored").addEventListener("click", function () {
  var checks = document.querySelectorAll("#storedList input:checked");
  var status = document.getElementById("storedStatus");
  var remaining = checks.length;
  if (!remaining) return;
  status.textContent = "fetching " + remaining + " photos\\u2026";
  Array.prototype.forEach.call(checks, function (cb) {
    fetch(ADMIN_PHOTOS + "/" + cb.value + "/image", { headers: apiHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }).then(function (dataUrl) {
          var img = {
            name: cb.dataset.item || "stored photo",
            mediaType: blob.type,
            dataUrl: dataUrl,
            base64: String(dataUrl).slice(String(dataUrl).indexOf(",") + 1),
            subject: cb.dataset.item || "",
            scanning: false,
          };
          state.images.push(img);
          persistImage(img);
          cb.checked = false;
          renderThumbs();
          updateRunButton();
        });
      })
      .catch(function () {})
      .then(function () {
        remaining -= 1;
        if (remaining === 0) status.textContent = "added";
      });
  });
});

// --- image intake ---
var drop = document.getElementById("drop");
var fileInput = document.getElementById("file");
drop.addEventListener("click", function () { fileInput.click(); });
drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
drop.addEventListener("drop", function (e) {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });

function addFiles(files) {
  Array.prototype.forEach.call(files, function (f) {
    if (!/^image\\/(jpeg|png|webp|gif)$/.test(f.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      var img = {
        name: f.name,
        mediaType: f.type,
        dataUrl: dataUrl,
        base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        subject: "",
        scanning: false,
      };
      state.images.push(img);
      renderThumbs();
      updateRunButton();
      persistImage(img);
      // Label every upload up front (one cheap Haiku call) — the subject
      // shows beside the file name in every mode, and hunt mode uses it.
      prescan(img);
    };
    reader.readAsDataURL(f);
  });
}

function renderThumbs() {
  var box = document.getElementById("thumbs");
  box.textContent = "";
  state.images.forEach(function (img, i) {
    var t = el("div", "thumb");
    var im = document.createElement("img");
    im.src = img.dataUrl;
    t.appendChild(im);
    var x = el("button", null, "\\u00d7");
    x.addEventListener("click", function () {
      if (img.id) {
        fetch(API_BASE + "/dataset/" + img.id, {
          method: "DELETE", headers: apiHeaders(),
        }).catch(function () {});
      }
      state.images.splice(i, 1);
      renderThumbs();
      updateRunButton();
    });
    t.appendChild(x);
    t.appendChild(el("div", "nm", img.name));
    var subj = document.createElement("input");
    subj.className = "subj";
    subj.placeholder = img.scanning ? "scanning\\u2026" : "subject";
    subj.value = img.subject;
    subj.addEventListener("input", function () { img.subject = subj.value; });
    subj.addEventListener("change", function () { persistSubject(img); });
    t.appendChild(subj);
    if (img.prescanMs) {
      t.appendChild(el("div", "nm", "scan " + img.prescanMs + "ms"));
    }
    box.appendChild(t);
  });
}

// Haiku pre-scan: name the likely hunt target and pre-fill the subject
// field. Never overwrites something the user already typed.
function prescan(img) {
  img.scanning = true;
  renderThumbs();
  fetch(API_BASE + "/prescan", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ imageBase64: img.base64, mediaType: img.mediaType }),
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      addBurn(j);
      if (j.ms) img.prescanMs = j.ms;
      if (!img.subject && j.subject) {
        img.subject = j.subject;
        persistSubject(img);
      }
      logRun({
        kind: "prescan", provider: "prescan (haiku-4.5)", image: img.name,
        error: j.error || null, inputTokens: j.inputTokens,
        outputTokens: j.outputTokens, cost: j.cost, ms: j.ms,
        text: j.subject || null,
      });
    })
    .catch(function () {})
    .then(function () {
      img.scanning = false;
      renderThumbs();
    });
}

function selectedProviders() {
  var out = [];
  document.querySelectorAll("#provs input:checked").forEach(function (cb) {
    out.push(cb.value);
  });
  return out;
}

function updateRunButton() {
  var provs = selectedProviders();
  document.getElementById("run").disabled =
    state.images.length === 0 || provs.length === 0;
  // Pre-flight estimate: calls and rough cost (assumes ~1,400 in / 300 out
  // tokens per call — the ticker shows exact billed numbers as they land).
  var status = document.getElementById("status");
  if (state.images.length && provs.length) {
    var est = 0;
    provs.forEach(function (name) {
      var p = state.providers.find(function (x) { return x.name === name; });
      if (p) est += state.images.length * (1400 * p.priceIn + 300 * p.priceOut) / 1e6;
    });
    status.textContent = "next run: " + state.images.length + " \\u00d7 " +
      provs.length + " = " + state.images.length * provs.length +
      " calls, est ~$" + est.toFixed(4);
  } else {
    status.textContent = "";
  }
}
document.getElementById("provs").addEventListener("change", updateRunButton);

// --- mode toggle ---
function onModeChange() {
  var ta = document.getElementById("prompt");
  if (huntMode()) {
    state.describePrompt = ta.value || state.describePrompt;
    ta.value = state.huntPrompt;
    state.images.forEach(function (img) {
      if (!img.subject && !img.scanning) prescan(img);
    });
  } else {
    state.huntPrompt = ta.value || state.huntPrompt;
    ta.value = state.describePrompt;
  }
  document.getElementById("promptHint").hidden = !huntMode();
  renderThumbs();
}
document.getElementById("modeDescribe").addEventListener("change", onModeChange);
document.getElementById("modeHunt").addEventListener("change", onModeChange);

// --- run ---
var blindLabels = "ABCDEFGHIJ";

document.getElementById("run").addEventListener("click", function () {
  var provs = selectedProviders();
  var promptTemplate = document.getElementById("prompt").value;
  var hunt = huntMode();
  var blind = document.getElementById("blind").checked;
  var runBtn = document.getElementById("run");
  runBtn.disabled = true;

  // Blind mode: shuffle a provider -> "Model X" mapping for this run.
  state.blindMap = null;
  if (blind) {
    var shuffled = provs.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    state.blindMap = {};
    shuffled.forEach(function (name, idx) {
      state.blindMap[name] = "Model " + blindLabels[idx];
    });
  }
  document.getElementById("reveal").hidden = !blind;

  state.results = [];
  var resultsBox = document.getElementById("results");
  resultsBox.textContent = "";
  document.getElementById("summary").textContent = "";

  var pending = state.images.length * provs.length;
  var status = document.getElementById("status");
  status.textContent = pending + " calls in flight\\u2026";

  state.images.forEach(function (img, imgIdx) {
    var prompt = hunt
      ? promptTemplate.replace(/__SUBJECT__/g, img.subject || "the target item")
      : promptTemplate;
    var heading = blind ? "Image " + (imgIdx + 1) : img.name;
    if (hunt || img.subject) {
      heading += " \\u2014 \\u201c" + (img.subject || "?") + "\\u201d";
    }
    var sec = el("div", "imgsec");
    var im = document.createElement("img");
    im.src = img.dataUrl;
    sec.appendChild(im);
    sec.appendChild(el("h3", null, heading));
    resultsBox.appendChild(sec);
    var grid = el("div", "grid");
    resultsBox.appendChild(grid);

    // Stable display order in blind mode so column position leaks nothing.
    var ordered = provs.slice();
    if (blind) ordered.sort(function (a, b) {
      return state.blindMap[a] < state.blindMap[b] ? -1 : 1;
    });

    ordered.forEach(function (name) {
      var cell = el("div", "cell pending");
      var hd = el("div", "hd");
      var title = el("b", null, blind ? state.blindMap[name] : name);
      title.dataset.provider = name;
      hd.appendChild(title);
      var meta = el("span", "meta", "");
      hd.appendChild(meta);
      cell.appendChild(hd);
      var txt = el("div", "txt", "waiting\\u2026");
      cell.appendChild(txt);
      grid.appendChild(cell);

      fetch(API_BASE + "/describe", {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          provider: name,
          imageBase64: img.base64,
          mediaType: img.mediaType,
          prompt: prompt,
        }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          cell.classList.remove("pending");
          if (!r.ok || r.j.error) {
            cell.classList.add("err");
            txt.textContent = "ERROR: " + (r.j.error || "request failed");
            state.results.push({ provider: name, error: true });
            logRun({
              kind: hunt ? "hunt" : "describe", provider: name,
              image: img.name, subject: hunt ? img.subject : null,
              error: r.j.error || "request failed",
            });
          } else {
            addBurn(r.j);
            logRun({
              kind: hunt ? "hunt" : "describe", provider: name,
              image: img.name, subject: hunt ? img.subject : null,
              inputTokens: r.j.inputTokens, outputTokens: r.j.outputTokens,
              cost: r.j.cost, ms: r.j.ms, text: r.j.text,
            });
            if (hunt) renderVerdict(txt, r.j.text);
            else txt.textContent = r.j.text.trim();
            var m = r.j.inputTokens + " in / " + r.j.outputTokens + " out \\u00b7 $" +
              (r.j.cost != null ? r.j.cost.toFixed(6) : "?") + " \\u00b7 " + r.j.ms + "ms";
            meta.textContent = blind ? "" : m;
            meta.dataset.full = m;
            state.results.push({
              provider: name,
              inputTokens: r.j.inputTokens,
              outputTokens: r.j.outputTokens,
              cost: r.j.cost,
              ms: r.j.ms,
            });
          }
        })
        .catch(function (e) {
          cell.classList.remove("pending");
          cell.classList.add("err");
          txt.textContent = "ERROR: " + e;
          state.results.push({ provider: name, error: true });
        })
        .then(function () {
          pending -= 1;
          status.textContent = pending > 0 ? pending + " calls in flight\\u2026" : "done";
          if (pending === 0) {
            runBtn.disabled = false;
            if (!blind) renderSummary();
            refreshAllTime();
          }
        });
    });
  });
});

// Hunt mode: try to render the JSON verdict compactly. A provider that
// wraps or mangles the JSON gets shown raw with a flag — that failure is
// itself a comparison result (production needs machine-readable verdicts).
function renderVerdict(node, raw) {
  var text = raw.trim();
  var m = text.match(/\\{[\\s\\S]*\\}/);
  var v = null;
  if (m) { try { v = JSON.parse(m[0]); } catch (e) {} }
  if (!v || typeof v.present !== "boolean") {
    node.textContent = text;
    var bad = el("div", null, "");
    bad.appendChild(el("span", "flag", "not valid JSON"));
    node.appendChild(bad);
    return;
  }
  node.textContent = "";
  var line = el("div");
  var pct = typeof v.confidence === "number"
    ? " (" + Math.round(v.confidence * 100) + "%)" : "";
  line.appendChild(el("span", "verdict " + (v.present ? "yes" : "no"),
    (v.present ? "present" : "not present") + pct));
  if (v.photo_of_photo) line.appendChild(el("span", "flag", "photo-of-photo"));
  if (v.unsafe) line.appendChild(el("span", "flag", "unsafe"));
  if (m[0].length !== text.length) line.appendChild(el("span", "flag", "extra text around JSON"));
  node.appendChild(line);
  if (v.reason) node.appendChild(el("div", "meta", String(v.reason)));
}

document.getElementById("reveal").addEventListener("click", function () {
  document.querySelectorAll(".cell b[data-provider]").forEach(function (b) {
    b.textContent = b.dataset.provider;
  });
  document.querySelectorAll(".cell .meta").forEach(function (m) {
    if (m.dataset.full) m.textContent = m.dataset.full;
  });
  document.getElementById("reveal").hidden = true;
  renderSummary();
});

function renderSummary() {
  var agg = {};
  state.results.forEach(function (r) {
    var a = agg[r.provider] ||
      (agg[r.provider] = { n: 0, err: 0, inTok: 0, cost: 0, lat: [] });
    a.n += 1;
    if (r.error) { a.err += 1; return; }
    a.inTok += r.inputTokens || 0;
    a.cost += r.cost || 0;
    if (r.ms) a.lat.push(r.ms);
  });
  var box = document.getElementById("summary");
  box.textContent = "";
  box.appendChild(el("h2", null, "Summary"));
  var table = document.createElement("table");
  var thead = el("tr");
  ["Provider", "Avg in-tok/img", "Total cost", "Est / visit (20 img)", "Latency min / avg / max", "Errors"]
    .forEach(function (h, i) { thead.appendChild(el("th", i > 0 ? "num" : null, h)); });
  table.appendChild(thead);
  Object.keys(agg).forEach(function (name) {
    var a = agg[name];
    var ok = a.n - a.err;
    var tr = el("tr");
    tr.appendChild(el("td", null, name));
    tr.appendChild(el("td", "num", ok ? Math.round(a.inTok / ok).toLocaleString() : "\\u2014"));
    tr.appendChild(el("td", "num", "$" + a.cost.toFixed(5)));
    tr.appendChild(el("td", "num", ok ? "$" + ((a.cost / ok) * 20).toFixed(4) : "\\u2014"));
    var latCell = "\\u2014";
    if (a.lat.length) {
      var sum = 0, min = a.lat[0], max = a.lat[0];
      a.lat.forEach(function (v) { sum += v; if (v < min) min = v; if (v > max) max = v; });
      latCell = min + " / " + Math.round(sum / a.lat.length) + " / " + max + " ms";
    }
    tr.appendChild(el("td", "num", latCell));
    tr.appendChild(el("td", "num", a.err ? String(a.err) : "0"));
    table.appendChild(tr);
  });
  box.appendChild(table);
}
</script>
</body>
</html>`;
