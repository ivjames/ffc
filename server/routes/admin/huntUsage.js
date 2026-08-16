// Admin: read-only scavenger-hunt vision-spend rollup (see HUNT-PRICING.md).
//   GET /api/admin/hunt-usage?months=<1..24>
// Monthly per-venue usage from hunt_scan — hunt rounds, scans, exact token
// sums (what the provider bills), and cost — so billing doesn't require psql
// access. Defaults to the last 6 calendar months. Two kinds of metered call
// roll up here, distinguished per row (hunt_scan.kind):
//   verify — player verifications (routes/hunt.js), priced at read time from
//            the Haiku list constants below (repriceable);
//   screen — admin item-image people-screens (routes/admin/huntItems.js),
//            priced at write time (hunt_scan.cost_usd — the screen's provider
//            and rate vary per call, so token math here would be wrong).
// Rows carry the org that was BILLED (orgId/orgName — hunt_scan.org_id, the
// stamp written at insert time by both metering paths), and `orgSummary`
// pre-aggregates per org per month, so a per-client invoice needs zero
// client-side math. Attribution deliberately does NOT ride the live
// course→location→org chain: an admin moving a course to another location
// (or a venue to another org) must never re-bill historical spend to the
// destination client. The location columns DO stay on the live chain — an
// operational "where does this course live now" view, not the invoice.
//
// Un-finalized verify reservations (routes/hunt.js reserveScan — rows whose
// token/cost fields are all still null) are excluded outright: nothing was
// billed yet, so they'd only surface as zero-cost phantom scan counts.
//
// Org-scoping: an org_admin sees only their own org's scans (via the
// hunt_scan.org_id stamp). Scans with a null stamp (org-less venue at bill
// time, or pre-stamp rows whose course no longer resolves) appear for
// super_admins only — an org_admin can't claim unattributed spend.
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";

export const router = Router();

// Haiku 4.5 list rates, $ per 1M tokens — keep in sync with lib/vision.js's
// MODEL and HUNT-PRICING.md. Echoed in the response so the UI can label costs.
// Applies to 'verify' rows only; 'screen' rows carry their own stored cost.
const INPUT_USD_PER_MTOK = 1.0;
const OUTPUT_USD_PER_MTOK = 5.0;

// Whole-dollar totals round to the cent (invoice lines); the verify/screen
// split keeps 4 decimals so sub-cent screen spend stays visible instead of
// rounding to $0.00.
const cents = (usd) => Math.round(usd * 100) / 100;
const tenths = (usd) => Math.round(usd * 10000) / 10000;

router.get("/", async (req, res) => {
  const scope = orgScope(req);

  // months — how far back to roll up, in calendar months including the
  // current one. Default 6, clamped to [1, 24].
  let months = Number.parseInt(req.query.months, 10);
  if (!Number.isFinite(months)) months = 6;
  months = Math.max(1, Math.min(24, months));

  try {
    // One query at (month, org, location, kind) grain; the two payload
    // shapes (per-venue rows, per-org summary) fold from it below.
    const result = await pool.query(
      `
      select date_trunc('month', s.created_at)::date as month,
             s.org_id as org_id,
             o.name   as org_name,
             l.id   as location_id,
             l.name as location_name,
             l.slug as location_slug,
             s.kind as kind,
             count(distinct s.round_client_id)  as hunt_rounds,
             count(*)                           as scans,
             coalesce(sum(s.input_tokens), 0)   as input_tokens,
             coalesce(sum(s.output_tokens), 0)  as output_tokens,
             coalesce(sum(s.cost_usd), 0)       as stored_cost_usd
        from hunt_scan s
        left join org      o on o.id = s.org_id
        left join course   c on c.id = s.course_id
        left join location l on l.id = c.location_id
       where s.created_at >= date_trunc('month', now()) - ($2::int - 1) * interval '1 month'
         and ($1::uuid is null or s.org_id = $1)
         and (s.input_tokens is not null or s.output_tokens is not null or s.cost_usd is not null)
       group by 1, s.org_id, o.name, l.id, l.name, l.slug, s.kind
       order by 1 desc, l.name asc nulls last
    `,
      [scope, months]
    );

    // Fold the kind-grain groups into per-venue rows and the per-org summary.
    // Cost per group: verify = token math at the list rates; screen = the
    // exact per-call cost stamped at write time.
    const rowByKey = new Map(); // month|locationId -> row
    const orgByKey = new Map(); // month|orgId      -> summary entry
    for (const r of result.rows) {
      const inputTokens = Number(r.input_tokens);
      const outputTokens = Number(r.output_tokens);
      const scans = Number(r.scans);
      const isScreen = r.kind === "screen";
      const costUsd = isScreen
        ? Number(r.stored_cost_usd)
        : (inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) / 1e6;

      const monthKey = r.month instanceof Date ? r.month.toISOString() : String(r.month);
      // org_id in the key: a venue reassigned to another org mid-month keeps
      // one row per billed org — invoice lines must never merge across clients.
      const rowKey = `${monthKey}|${r.location_id}|${r.org_id}`;
      let row = rowByKey.get(rowKey);
      if (!row) {
        row = {
          month: r.month,
          orgId: r.org_id,
          orgName: r.org_name,
          locationId: r.location_id,
          locationName: r.location_name,
          locationSlug: r.location_slug,
          huntRounds: 0,
          scans: 0,
          verifyScans: 0,
          screenScans: 0,
          inputTokens: 0,
          outputTokens: 0,
          verifyCostUsd: 0,
          screenCostUsd: 0,
          apiCostUsd: 0,
        };
        rowByKey.set(rowKey, row);
      }
      // hunt_rounds counts distinct round_client_id — null on screen rows, so
      // only the verify group contributes (count(distinct) skips nulls).
      row.huntRounds += Number(r.hunt_rounds);
      row.scans += scans;
      row[isScreen ? "screenScans" : "verifyScans"] += scans;
      row.inputTokens += inputTokens;
      row.outputTokens += outputTokens;
      row[isScreen ? "screenCostUsd" : "verifyCostUsd"] += costUsd;
      row.apiCostUsd += costUsd;

      // Per-org per-month invoice line, keyed on the write-time stamp.
      // Unattributed spend (stamp null — an org-less venue at bill time, or
      // a pre-stamp row whose course no longer resolves) folds under orgId
      // null, super_admin-only by the $1 filter above.
      const orgKey = `${monthKey}|${r.org_id}`;
      let org = orgByKey.get(orgKey);
      if (!org) {
        org = {
          month: r.month,
          orgId: r.org_id,
          orgName: r.org_name,
          huntRounds: 0,
          scans: 0,
          verifyScans: 0,
          screenScans: 0,
          inputTokens: 0,
          outputTokens: 0,
          verifyCostUsd: 0,
          screenCostUsd: 0,
          apiCostUsd: 0,
        };
        orgByKey.set(orgKey, org);
      }
      org.huntRounds += Number(r.hunt_rounds);
      org.scans += scans;
      org[isScreen ? "screenScans" : "verifyScans"] += scans;
      org.inputTokens += inputTokens;
      org.outputTokens += outputTokens;
      org[isScreen ? "screenCostUsd" : "verifyCostUsd"] += costUsd;
      org.apiCostUsd += costUsd;
    }

    const finishCosts = (entry) => ({
      ...entry,
      verifyCostUsd: tenths(entry.verifyCostUsd),
      screenCostUsd: tenths(entry.screenCostUsd),
      apiCostUsd: cents(entry.apiCostUsd),
    });

    return res.json({
      pricing: {
        model: "claude-haiku-4-5",
        inputUsdPerMTok: INPUT_USD_PER_MTOK,
        outputUsdPerMTok: OUTPUT_USD_PER_MTOK,
      },
      months,
      rows: [...rowByKey.values()].map(finishCosts),
      // Rows inherit the query's (month desc, venue name) order via Map
      // insertion; the summary re-sorts since orgs interleave across venues.
      orgSummary: [...orgByKey.values()]
        .sort(
          (a, b) =>
            new Date(b.month) - new Date(a.month) ||
            String(a.orgName ?? "￿").localeCompare(String(b.orgName ?? "￿"))
        )
        .map(finishCosts),
    });
  } catch (err) {
    console.error("[admin/hunt-usage] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
