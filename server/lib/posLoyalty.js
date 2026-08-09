// Server-side POS loyalty client — how ffc-api credits tickets into a venue's
// card system. This is the trusted half of the game-rewards split: the browser
// asks OUR award endpoint (routes/gameRewards.js), which validates and caps,
// and only this module talks to the vendor. Vendor credentials therefore live
// in server env, never in the client bundle (the client-side centeredge.ts
// adapter keeps read paths + the dev test button against the mock, but the
// game award path no longer writes vendor-side from the browser).
//
// CenterEdge is the only vendor today, and pre-credential it means the local
// mock (mock-centeredge/, loopback — see bin/ffc mock_up). Real credentials
// slot in via CENTEREDGE_API_BASE / CENTEREDGE_API_TOKEN without code changes.

const DEFAULT_TOKEN = "ce-mock-dev-token"; // the mock's static dev token

function centerEdgeBase(apiBase) {
  if (apiBase) return apiBase.replace(/\/$/, "");
  if (process.env.CENTEREDGE_API_BASE) {
    return process.env.CENTEREDGE_API_BASE.replace(/\/$/, "");
  }
  // The deployed mock runs on loopback next to this API (bin/ffc mock_up);
  // same resolution order as bin/ffc: FFC_CE_PORT, else CE_MOCK_PORT, else 8070.
  const port = process.env.FFC_CE_PORT || process.env.CE_MOCK_PORT || "8070";
  return `http://127.0.0.1:${port}`;
}

/**
 * Credit tickets to a player card via the venue's loyalty vendor.
 * `loyaltyConfig` is the venue's normalized pos.loyalty block ({ vendor,
 * apiBase, ... }). Resolves to the vendor's RewardResult-shaped body, or an
 * { ok: false, error } — never throws.
 */
export async function rewardTickets(loyaltyConfig, { playerId, tickets, source, idempotencyKey }) {
  if (loyaltyConfig?.vendor !== "centeredge") {
    return { ok: false, error: `no server-side loyalty client for vendor ${loyaltyConfig?.vendor}` };
  }
  const base = centerEdgeBase(loyaltyConfig.apiBase);
  const token = process.env.CENTEREDGE_API_TOKEN || DEFAULT_TOKEN;
  try {
    const res = await fetch(
      `${base}/api/v1/players/${encodeURIComponent(playerId)}/tickets/reward`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tickets, source, idempotencyKey }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? `POS HTTP ${res.status}` };
    }
    return data;
  } catch (err) {
    return { ok: false, error: `POS unreachable: ${err.message ?? "network error"}` };
  }
}
