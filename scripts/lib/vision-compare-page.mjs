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

export function renderPage(apiBase, authMode = "bearer") {
  return PAGE.replaceAll("__API_BASE__", apiBase).replaceAll(
    "__AUTH_MODE__",
    authMode,
  );
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
    <div class="thumbs" id="thumbs"></div>
  </div>

  <div class="panel">
    <h2>2 · Providers</h2>
    <div class="provs" id="provs"></div>
  </div>

  <div class="panel">
    <h2>3 · Prompt</h2>
    <textarea id="prompt"></textarea>
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
</div>

<script>
"use strict";
var API_BASE = "__API_BASE__";
var AUTH_MODE = "__AUTH_MODE__";
var state = { providers: [], images: [], results: [], blindMap: null };
var TOKEN = new URLSearchParams(location.search).get("token") || "";
if (!TOKEN && AUTH_MODE === "admin") {
  // Same-origin with the Master Control SPA: reuse its stored APP_TOKEN
  // (token-mode login). Session-cookie logins need nothing — the cookie
  // rides same-origin fetches on its own.
  try { TOKEN = localStorage.getItem("ffc_admin_token") || ""; } catch (e) {}
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
    document.querySelector(".sub").textContent = AUTH_MODE === "admin"
      ? "401: log in to Master Control in this browser first, then reload this page."
      : "401: open this page with ?token=<BAKEOFF_TOKEN> in the URL.";
  }
  if (r.status === 403) {
    document.querySelector(".sub").textContent =
      "403: this page is super_admin only (it spends real money on provider keys).";
  }
  return r.json();
}).then(function (d) {
  if (!d.providers) return;
  state.providers = d.providers;
  document.getElementById("prompt").value = d.defaultPrompt;
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
      state.images.push({
        name: f.name,
        mediaType: f.type,
        dataUrl: dataUrl,
        base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      });
      renderThumbs();
      updateRunButton();
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
      state.images.splice(i, 1);
      renderThumbs();
      updateRunButton();
    });
    t.appendChild(x);
    t.appendChild(el("div", "nm", img.name));
    box.appendChild(t);
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
  document.getElementById("run").disabled =
    state.images.length === 0 || selectedProviders().length === 0;
}
document.getElementById("provs").addEventListener("change", updateRunButton);

// --- run ---
var blindLabels = "ABCDEFGHIJ";

document.getElementById("run").addEventListener("click", function () {
  var provs = selectedProviders();
  var prompt = document.getElementById("prompt").value;
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
    var sec = el("div", "imgsec");
    var im = document.createElement("img");
    im.src = img.dataUrl;
    sec.appendChild(im);
    sec.appendChild(el("h3", null, blind ? "Image " + (imgIdx + 1) : img.name));
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
          } else {
            txt.textContent = r.j.text.trim();
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
          }
        });
    });
  });
});

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
      (agg[r.provider] = { n: 0, err: 0, inTok: 0, cost: 0, ms: 0 });
    a.n += 1;
    if (r.error) { a.err += 1; return; }
    a.inTok += r.inputTokens || 0;
    a.cost += r.cost || 0;
    a.ms += r.ms || 0;
  });
  var box = document.getElementById("summary");
  box.textContent = "";
  box.appendChild(el("h2", null, "Summary"));
  var table = document.createElement("table");
  var thead = el("tr");
  ["Provider", "Avg in-tok/img", "Total cost", "Est / visit (20 img)", "Avg latency", "Errors"]
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
    tr.appendChild(el("td", "num", ok ? Math.round(a.ms / ok) + "ms" : "\\u2014"));
    tr.appendChild(el("td", "num", a.err ? String(a.err) : "0"));
    table.appendChild(tr);
  });
  box.appendChild(table);
}
</script>
</body>
</html>`;
