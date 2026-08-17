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
//
// SECURITY: the endpoint this module credits against comes ONLY from trusted
// server env — never from the venue's pos.loyalty.apiBase. That field is
// org_admin-writable (it exists as a CLIENT read-path override), so honoring
// it here would let an org admin point the URL at a server they control and
// exfiltrate the bearer token — or probe the private network — via the public
// award endpoint. When multi-tenant vendor endpoints become real, they need
// per-venue credentials stored server-side, resolved together; until then one
// env-configured endpoint + token is the whole trust story.

const DEFAULT_TOKEN = "ce-mock-dev-token"; // the mock's static dev token

function centerEdgeBase() {
  if (process.env.CENTEREDGE_API_BASE) {
    return process.env.CENTEREDGE_API_BASE.replace(/\/$/, "");
  }
  // The deployed mock runs on loopback next to this API (bin/ffc mock_up);
  // same resolution order as bin/ffc: FFC_CE_PORT, else CE_MOCK_PORT, else 8070.
  const port = process.env.FFC_CE_PORT || process.env.CE_MOCK_PORT || "8070";
  return `http://127.0.0.1:${port}`;
}

/**
 * One vendor call with the server-held credentials. `loyaltyConfig` is the
 * venue's normalized pos.loyalty block — only its `vendor` is honored (endpoint
 * + token come from server env; see the security note above). Resolves to the
 * vendor's parsed body, or an { ok: false, error, status } — never throws.
 */
async function vendorRequest(loyaltyConfig, path, init) {
  if (loyaltyConfig?.vendor !== "centeredge") {
    return { ok: false, error: `no server-side loyalty client for vendor ${loyaltyConfig?.vendor}` };
  }
  const base = centerEdgeBase();
  const token = process.env.CENTEREDGE_API_TOKEN || DEFAULT_TOKEN;
  try {
    const res = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? `POS HTTP ${res.status}`, status: res.status };
    }
    return data;
  } catch (err) {
    return { ok: false, error: `POS unreachable: ${err.message ?? "network error"}` };
  }
}

/** Credit tickets to a player card via the venue's loyalty vendor. */
export async function rewardTickets(loyaltyConfig, { playerId, tickets, source, idempotencyKey }) {
  return vendorRequest(loyaltyConfig, `/players/${encodeURIComponent(playerId)}/tickets/reward`, {
    method: "POST",
    body: JSON.stringify({ tickets, source, idempotencyKey }),
  });
}

/**
 * Look up a card by its printed number (or vendor player id). Used ONLY by the
 * account-bound link/read routes — the browser no longer reads the vendor
 * directly, so a card number can't be used to browse a stranger's account.
 */
export async function fetchPlayer(loyaltyConfig, idOrCard) {
  return vendorRequest(loyaltyConfig, `/players/${encodeURIComponent(idOrCard)}`);
}

/** Ticket history for a card the caller has already been authorized for. */
export async function fetchPlayerTransactions(loyaltyConfig, idOrCard) {
  return vendorRequest(loyaltyConfig, `/players/${encodeURIComponent(idOrCard)}/transactions`);
}
