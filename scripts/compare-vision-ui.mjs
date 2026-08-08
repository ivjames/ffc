// Web UI for the vision-provider bake-off (IMAGE-DESCRIPTION-PRICING.md).
//
// Serves a local page where you drop in workload photos, pick providers, and
// judge the descriptions side by side — with optional blind judging (provider
// names, tokens, and cost hidden until you reveal, so the copy is scored on
// its own merits). Same provider core as the CLI; API keys stay server-side
// and never reach the browser.
//
// Usage (same env keys as the CLI; providers without a key show as disabled):
//   node scripts/compare-vision-ui.mjs        # http://127.0.0.1:8787
//   PORT=9000 node scripts/compare-vision-ui.mjs
//
// Binds 127.0.0.1 by default. To judge from another device (phone/iPad)
// without an SSH tunnel, expose it WITH a token — the /api routes proxy paid
// model calls, so they must not sit open on the internet:
//   HOST=0.0.0.0 BAKEOFF_TOKEN=$(openssl rand -hex 16) node scripts/compare-vision-ui.mjs
//   # then open  http://<droplet-ip>:8787/?token=<that token>
// Plain HTTP: fine for a short bake-off session; stop the server when done.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  PROVIDERS,
  MEDIA_TYPES,
  DEFAULT_PROMPT,
  isConfigured,
  describeImage,
} from "./lib/vision-compare-core.mjs";

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = process.env.BAKEOFF_TOKEN || "";
const LOCAL_ONLY = HOST === "127.0.0.1" || HOST === "localhost";

if (!LOCAL_ONLY && !TOKEN) {
  console.error(
    "refusing to bind " + HOST + " without BAKEOFF_TOKEN — the /api routes " +
      "proxy paid model calls.\nRun: HOST=" + HOST +
      " BAKEOFF_TOKEN=$(openssl rand -hex 16) node scripts/compare-vision-ui.mjs",
  );
  process.exit(1);
}

// Constant-time token check; token arrives as a Bearer header (the page pulls
// it from its ?token= query param and attaches it to every API call).
function authorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
// Base64 photos from a phone can hit ~10MB; leave headroom.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    // The page itself carries no secrets, so it's served unauthenticated;
    // everything under /api requires the token when one is configured.
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }

    if (req.url.startsWith("/api/") && !authorized(req)) {
      return json(res, 401, {
        error: "missing or wrong token — open the page as /?token=<BAKEOFF_TOKEN>",
      });
    }

    if (req.method === "GET" && req.url === "/api/providers") {
      json(res, 200, {
        defaultPrompt: DEFAULT_PROMPT,
        providers: PROVIDERS.map((p) => ({
          name: p.name,
          model: p.model,
          keyEnv: p.keyEnv,
          configured: isConfigured(p),
          priceIn: p.price.in,
          priceOut: p.price.out,
        })),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/describe") {
      const body = JSON.parse(await readBody(req));
      const provider = PROVIDERS.find((p) => p.name === body.provider);
      if (!provider) return json(res, 400, { error: "unknown provider" });
      if (!isConfigured(provider))
        return json(res, 400, { error: `${provider.keyEnv} not set` });
      if (!ALLOWED_MEDIA_TYPES.has(body.mediaType))
        return json(res, 400, { error: "unsupported media type" });
      if (typeof body.imageBase64 !== "string" || !body.imageBase64)
        return json(res, 400, { error: "missing image" });

      const prompt =
        typeof body.prompt === "string" && body.prompt.trim()
          ? body.prompt
          : DEFAULT_PROMPT;
      try {
        const result = await describeImage(
          provider,
          { base64: body.imageBase64, mediaType: body.mediaType },
          prompt,
        );
        return json(res, 200, result);
      } catch (err) {
        // Provider-side failure (bad key, rate limit, model gone) — report it
        // in the cell rather than failing the whole run.
        return json(res, 502, { error: String(err.message || err) });
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

// The page is inline so the tool stays a single no-build, no-deps file.
// Client JS deliberately avoids template literals to keep this server-side
// template literal escape-free.
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
var state = { providers: [], images: [], results: [], blindMap: null };
var TOKEN = new URLSearchParams(location.search).get("token") || "";

function apiHeaders(extra) {
  var h = extra || {};
  if (TOKEN) h["authorization"] = "Bearer " + TOKEN;
  return h;
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

fetch("/api/providers", { headers: apiHeaders() }).then(function (r) {
  if (r.status === 401) {
    document.querySelector(".sub").textContent =
      "401: open this page with ?token=<BAKEOFF_TOKEN> in the URL.";
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

      fetch("/api/describe", {
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

const active = PROVIDERS.filter(isConfigured).map((p) => p.name);
server.listen(PORT, HOST, () => {
  console.log(
    TOKEN
      ? `vision bake-off UI: http://<this-machine>:${PORT}/?token=${TOKEN}`
      : `vision bake-off UI: http://${HOST}:${PORT}`,
  );
  console.log(
    active.length
      ? `providers with keys: ${active.join(", ")}`
      : "WARNING: no provider keys set — every provider will show as disabled",
  );
});
