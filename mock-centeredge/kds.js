// The fake kitchen's display screen (KDS) — a single self-contained HTML page
// served by the mock at GET /kitchen (deployed: /ce/kitchen behind nginx).
// Staff (or a demo driver) watch tickets arrive, see queue/prep state live,
// and bump each ticket: first tap = food's up (ready), second = handed to the
// guest (picked_up). Vanilla HTML/JS on purpose — the mock has no build step.
//
// The static dev bearer token is embedded in the page. That's fine here and
// only here: it's the mock's documented, non-secret dev token (the player
// bundle ships it too), and this page never runs against a real POS.

/** API prefix for the page's own origin: '' locally (page at /kitchen),
 *  '/ce' deployed (page at /ce/kitchen) — computed client-side from the URL. */
export function kdsPage(staticToken) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FFC Kitchen — mock KDS</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #101418; color: #e8edf2; font: 15px/1.45 system-ui, sans-serif; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #232b33; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: .04em; }
  header .sub { color: #8fa0af; font-size: 13px; }
  header .stations { margin-left: auto; color: #8fa0af; font-size: 13px; }
  #board { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; padding: 16px 18px; }
  .ticket { background: #171d24; border: 1px solid #2a333d; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  .ticket.ready { border-color: #2f9e5f; box-shadow: 0 0 0 1px #2f9e5f66; }
  .ticket.preparing { border-color: #c9922a88; }
  .thead { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; background: #1d242c; }
  .num { font-weight: 800; font-size: 17px; }
  .who { color: #9fb0bf; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .age { margin-left: auto; font-variant-numeric: tabular-nums; color: #8fa0af; font-size: 13px; }
  .items { padding: 8px 12px; flex: 1; }
  .line { padding: 2px 0; }
  .mods, .note { color: #8fa0af; font-size: 12.5px; padding-left: 18px; }
  .note::before { content: "✎ "; }
  .tfoot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #232b33; }
  .pill { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: #26303a; color: #9fb0bf; }
  .pill.preparing { background: #3a2f16; color: #e5b453; }
  .pill.ready { background: #143726; color: #55d58a; animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .55; } }
  .eta { font-size: 12.5px; color: #8fa0af; font-variant-numeric: tabular-nums; }
  .code { font-weight: 800; letter-spacing: .12em; color: #cfe8d8; background: #143726; padding: 2px 9px; border-radius: 6px; font-variant-numeric: tabular-nums; }
  .code b { color: #7fe0a6; }
  button.bump { margin-left: auto; border: 0; border-radius: 8px; padding: 6px 14px; font-weight: 700; cursor: pointer; background: #2b6cb0; color: #fff; }
  .ticket.ready button.bump { background: #2f9e5f; }
  #empty { color: #66788a; padding: 40px 18px; text-align: center; grid-column: 1 / -1; }
  #done { padding: 4px 18px 20px; color: #8fa0af; font-size: 13px; }
  #done b { color: #a9bac7; }
  #err { display: none; margin: 10px 18px 0; padding: 8px 12px; border-radius: 8px; background: #3a1a1a; color: #f2a0a0; }
</style>
</head>
<body>
<header>
  <h1>🍳 Kitchen</h1>
  <span class="sub">mock KDS — tap Bump when food's up, again at hand-off</span>
  <span class="stations" id="stations"></span>
</header>
<div id="err"></div>
<div id="board"></div>
<div id="done"></div>
<script>
  var API = location.pathname.replace(/\\/kitchen\\/?$/, '');
  var HEADERS = { authorization: 'Bearer ${staticToken}' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mmss(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function etaText(o, now) {
    if (o.status === 'ready') return 'waiting for pickup';
    var left = Date.parse(o.estimatedReadyAt) - now;
    return left > 0 ? 'ready in ' + mmss(left) : 'any moment';
  }

  function render(data) {
    var now = Date.now();
    document.getElementById('stations').textContent =
      data.stations.busy + '/' + data.stations.count + ' stations busy · ' + data.orders.length + ' open';
    var board = document.getElementById('board');
    if (!data.orders.length) {
      board.innerHTML = '<div id="empty">No open tickets — orders placed in the app appear here.</div>';
    } else {
      board.innerHTML = data.orders.map(function (o) {
        var items = o.items.map(function (l) {
          return '<div class="line">' + l.quantity + '× ' + esc(l.name) + '</div>' +
            (l.modifierNames && l.modifierNames.length ? '<div class="mods">' + esc(l.modifierNames.join(', ')) + '</div>' : '') +
            (l.notes ? '<div class="note">' + esc(l.notes) + '</div>' : '');
        }).join('');
        return '<div class="ticket ' + o.status + '">' +
          '<div class="thead"><span class="num">#' + o.orderNumber + '</span>' +
          '<span class="who">' + esc(o.guestName || o.playerId || 'guest') + ' · ' + esc(o.station) + '</span>' +
          '<span class="age">' + mmss(now - Date.parse(o.createdAt)) + '</span></div>' +
          '<div class="items">' + items + (o.notes ? '<div class="note">' + esc(o.notes) + '</div>' : '') + '</div>' +
          '<div class="tfoot"><span class="pill ' + o.status + '">' + o.status.replace(/_/g, ' ') + '</span>' +
          (o.status === 'ready' && o.pickupCode
            ? '<span class="code" title="Match this to the guest\\'s screen">🎫 <b>' + esc(o.pickupCode) + '</b></span>'
            : '<span class="eta">' + etaText(o, now) + '</span>') +
          '<button class="bump" data-id="' + esc(o.id) + '">' + (o.status === 'ready' ? 'Hand off' : 'Bump') + '</button></div>' +
          '</div>';
      }).join('');
    }
    var done = data.recentlyCompleted.map(function (o) { return '#' + o.orderNumber; }).join(' · ');
    document.getElementById('done').innerHTML = done ? '<b>Recently completed:</b> ' + done : '';
  }

  function refresh() {
    fetch(API + '/api/v1/kitchen/orders', { headers: HEADERS })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { document.getElementById('err').style.display = 'none'; render(data); })
      .catch(function (e) {
        var el = document.getElementById('err');
        el.textContent = 'Kitchen feed unavailable (' + e.message + ') — retrying…';
        el.style.display = 'block';
      });
  }

  document.getElementById('board').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button.bump');
    if (!btn) return;
    btn.disabled = true;
    fetch(API + '/api/v1/kitchen/orders/' + encodeURIComponent(btn.dataset.id) + '/bump', {
      method: 'POST', headers: HEADERS,
    }).then(refresh, refresh);
  });

  refresh();
  setInterval(refresh, 2500);
</script>
</body>
</html>`;
}
