// The bake-off page, as one self-contained document.
//
// Rendered as a string rather than built with the admin SPA because it is a
// bench, not a screen: it wants to be openable straight from a tablet with no
// build step between a code change and hearing the result. Same call as the
// vision bench next door.
//
// Auth: same-origin fetches carry the Master Control session cookie; a
// token-mode login re-sends the APP_TOKEN (`ffc_admin_token`, which
// admin/api.ts keeps in sessionStorage) as x-app-token. Audio is fetched the same way and
// turned into a blob URL, because an <audio src> cannot carry that header.

export function renderPage(base) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice bake-off — live trivia</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; padding: 20px; max-width: 880px; background: #f8fafc; color: #0f172a;
         font: 15px/1.55 system-ui, -apple-system, sans-serif; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b1220; color: #e2e8f0; }
    .card, section { background: #111c2e !important; border-color: #1e293b !important; }
    select, button { background: #16233a; color: #e2e8f0; border-color: #334155; }
    th { color: #94a3b8 !important; }
    .said { background: #0e1830 !important; }
  }
  h1 { font-size: 1.35rem; margin: 0 0 2px; }
  p.lede { margin: 0 0 18px; color: #64748b; }
  .card { border: 1px solid #e2e8f0; background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 16px; }
  label { display: block; font-size: .8rem; font-weight: 600; text-transform: uppercase;
          letter-spacing: .04em; color: #64748b; margin-bottom: 4px; }
  select, input { width: 100%; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 8px;
                  font: inherit; background: #fff; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div { flex: 1 1 220px; }
  button { margin-top: 10px; padding: 10px 16px; border: 1px solid #cbd5e1; border-radius: 8px;
           background: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.go { background: #0f766e; border-color: #0f766e; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .burn { font-variant-numeric: tabular-nums; }
  .burn strong { font-size: 1.15rem; }
  section { border: 1px solid #e2e8f0; background: #fff; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
  section h2 { font-size: .95rem; margin: 0 0 6px; }
  .said { font-size: .85rem; color: #475569; background: #f1f5f9; border-radius: 8px;
          padding: 8px 10px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e2e8f0; font-size: .87rem; }
  th { color: #64748b; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  audio { width: 100%; max-width: 260px; height: 32px; vertical-align: middle; }
  .err { color: #b91c1c; }
  .note { color: #64748b; font-size: .85rem; }
</style></head><body>
<h1>Voice bake-off</h1>
<p class="lede">Amazon Polly neural voices reading this venue's real questions. Play it on the
tablet you host from, through the speaker the room hears — a voice that reads well on a laptop can
vanish over a PA.</p>

<div class="card">
  <div class="row">
    <div>
      <label for="venue">Venue</label>
      <select id="venue"><option>loading…</option></select>
    </div>
    <div>
      <label for="count">Questions</label>
      <select id="count">
        <option value="1">1</option>
        <option value="3" selected>3 (shortest, middle, longest)</option>
        <option value="5">5</option>
      </select>
    </div>
    <div>
      <label for="runs">Or replay a past run</label>
      <select id="runs"><option value="">—</option></select>
    </div>
  </div>
  <button id="plan">Price it</button>
  <button id="run" class="go" disabled>Synthesize</button>
  <div id="status" class="note" style="margin-top:10px"></div>
</div>

<div class="card burn" id="burn" hidden></div>
<div id="out"></div>

<script>
const BASE = ${JSON.stringify(base)};
// admin/api.ts keeps the APP_TOKEN in sessionStorage; the older vision bench
// reads localStorage. Check both, so this works whichever way the operator
// logged in — and fall through to the session cookie when neither is set.
const TOKEN = (() => {
  try { return sessionStorage.getItem("ffc_admin_token") || localStorage.getItem("ffc_admin_token") || ""; }
  catch (e) { return ""; }
})();
function headers(extra) {
  const h = Object.assign({}, extra || {});
  if (TOKEN) h["x-app-token"] = TOKEN;
  return h;
}
const api = (path, opts) =>
  fetch(BASE + path, Object.assign({ credentials: "include" }, opts, {
    headers: headers(Object.assign({ "content-type": "application/json" }, (opts || {}).headers)),
  })).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.ok === false) throw new Error(body.error || ("HTTP " + r.status));
    return body;
  });

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const say = (msg, bad) => { $("status").innerHTML = bad ? '<span class="err">' + esc(msg) + "</span>" : esc(msg); };

let planned = null;

async function loadVenues() {
  try {
    const { venues } = await api("/venues");
    $("venue").innerHTML = venues
      .map((v) => '<option value="' + esc(v.id) + '">' + esc(v.orgName ? v.orgName + " — " + v.name : v.name) + "</option>")
      .join("");
    if (!venues.length) say("No live venues.", true);
  } catch (e) {
    $("venue").innerHTML = "<option>—</option>";
    say("Couldn't load venues: " + e.message + (TOKEN ? "" : " (log in to Master Control first)"), true);
  }
}

async function loadRuns() {
  try {
    const { runs } = await api("/runs");
    $("runs").innerHTML =
      '<option value="">—</option>' +
      runs.map((r) => '<option value="' + esc(r.runId) + '">' + esc(r.venue || r.runId) + " · " +
        esc(new Date(r.createdAt).toLocaleString()) + " · $" + r.usd.toFixed(4) + "</option>").join("");
  } catch (e) { /* no runs yet, or not authorised — the venue error already said so */ }
}

$("plan").onclick = async () => {
  say("Pricing…");
  $("run").disabled = true;
  try {
    // Remember WHAT was priced, not just the price. The run below submits
    // these rather than re-reading the selects, so the operator can only ever
    // spend on the configuration they saw a number for.
    const asked = { locationId: $("venue").value, questions: Number($("count").value) };
    planned = Object.assign(await api("/plan", { method: "POST", body: JSON.stringify(asked) }), { asked });
    $("burn").hidden = false;
    $("burn").innerHTML =
      "<div>Would synthesize <strong>" + planned.clips + " clips</strong> — " +
      planned.chars.toLocaleString() + " billable characters, <strong>$" + planned.usd.toFixed(4) +
      "</strong> at $" + planned.usdPerM + "/M (Polly neural)</div>" +
      '<div class="note">Nothing spent yet. The first 1M neural characters a month are free for the ' +
      "first 12 months, so this may bill nothing at all.</div>";
    $("out").innerHTML = planned.lines
      .map((l) => '<section><h2>' + esc(l.label) + '</h2><p class="said">' + esc(l.text) + "</p></section>")
      .join("");
    $("run").disabled = false;
    say("Priced. Nothing spent.");
  } catch (e) { say(e.message, true); }
};

$("run").onclick = async () => {
  if (!planned) return say("Price it first.", true);
  $("run").disabled = true;
  $("plan").disabled = true;
  say("Synthesizing… (a few seconds)");
  try {
    const { run } = await api("/run", { method: "POST", body: JSON.stringify(planned.asked) });
    await showRun(run);
    await loadRuns();
    // "Done." over 42 failed clips is how a bench lies to you. Say what
    // happened: all-failed is the common first run (bad or missing key), and
    // the reason is in every row below.
    if (run.errors === run.clips.length) say("Every clip failed — see the rows below.", true);
    else if (run.errors) say(run.errors + " of " + run.clips.length + " clips failed.", true);
    else say("Done.");
  } catch (e) { say(e.message, true); }
  $("plan").disabled = false;
  $("run").disabled = false;
};

function invalidatePlan() {
  if (!planned) return;
  planned = null;
  $("run").disabled = true;
  $("burn").hidden = true;
  $("out").innerHTML = "";
  say("Selection changed — price it again.");
}
$("venue").onchange = invalidatePlan;
$("count").onchange = invalidatePlan;

$("runs").onchange = async () => {
  const id = $("runs").value;
  if (!id) return;
  say("Loading run…");
  try {
    const { run } = await api("/runs/" + encodeURIComponent(id));
    await showRun(run);
    say("Loaded (no spend).");
  } catch (e) { say(e.message, true); }
};

async function showRun(run) {
  $("burn").hidden = false;
  $("burn").innerHTML =
    "<div>Billed: <strong>" + run.billed.toLocaleString() + " characters</strong> — <strong>$" +
    run.usd.toFixed(4) + "</strong> (AWS RequestCharacters, not an estimate)</div>" +
    '<div class="note">' + run.clips.length + " clips" +
    (run.errors ? ' · <span class="err">' + run.errors + " failed</span>" : "") +
    " · " + esc(run.venue || "") + "</div>";

  const groups = new Map();
  for (const c of run.clips) {
    if (!groups.has(c.lineLabel)) groups.set(c.lineLabel, []);
    groups.get(c.lineLabel).push(c);
  }
  $("out").innerHTML = [...groups.entries()].map(([label, clips]) =>
    '<section><h2>' + esc(label) + '</h2><p class="said">' + esc(clips[0].text) + "</p>" +
    "<table><tr><th>voice</th><th>style</th><th>listen</th><th>chars</th></tr>" +
    clips.map((c, i) =>
      "<tr><td>" + esc(c.voice) + "</td><td>" + esc(c.styleLabel) + "</td><td>" +
      (c.error ? '<span class="err">' + esc(c.error) + "</span>"
               : '<span data-clip="' + esc(run.runId) + "|" + esc(c.file) + '">loading…</span>') +
      '</td><td class="num">' + (c.billed || 0) + "</td></tr>").join("") +
    "</table></section>").join("");

  // Audio needs the auth header, so fetch each clip and hand the player a blob.
  for (const slot of document.querySelectorAll("[data-clip]")) {
    const [runId, file] = slot.getAttribute("data-clip").split("|");
    try {
      const r = await fetch(BASE + "/audio/" + encodeURIComponent(runId) + "/" + encodeURIComponent(file),
        { credentials: "include", headers: headers() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const url = URL.createObjectURL(await r.blob());
      slot.outerHTML = '<audio controls preload="none" src="' + url + '"></audio>';
    } catch (e) {
      slot.outerHTML = '<span class="err">' + esc(e.message) + "</span>";
    }
  }
}

loadVenues();
loadRuns();
</script>
</body></html>`;
}
