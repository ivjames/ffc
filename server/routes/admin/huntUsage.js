// Admin: read-only scavenger-hunt vision-spend rollup (see HUNT-PRICING.md).
//   GET /api/admin/hunt-usage?months=<1..24>
// Monthly per-venue usage from hunt_scan — hunt rounds, scans, exact token
// sums (what Anthropic bills), and the list-price cost — so billing doesn't
// require psql access. Defaults to the last 6 calendar months.
//
// Org-scoping: an org_admin sees only their own org's venues (via
// location.org_id, same rule as overview.js). Scans whose course/venue no
// longer resolves (item deleted, then course deleted) appear with a null
// location for super_admins only — an org_admin can't claim unattributed spend.
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";

export const router = Router();

// Haiku 4.5 list rates, $ per 1M tokens — keep in sync with lib/vision.js's
// MODEL and HUNT-PRICING.md. Echoed in the response so the UI can label costs.
const INPUT_USD_PER_MTOK = 1.0;
const OUTPUT_USD_PER_MTOK = 5.0;

router.get("/", async (req, res) => {
  const scope = orgScope(req);

  // months — how far back to roll up, in calendar months including the
  // current one. Default 6, clamped to [1, 24].
  let months = Number.parseInt(req.query.months, 10);
  if (!Number.isFinite(months)) months = 6;
  months = Math.max(1, Math.min(24, months));

  try {
    const result = await pool.query(
      `
      select date_trunc('month', s.created_at)::date as month,
             l.id   as location_id,
             l.name as location_name,
             l.slug as location_slug,
             count(distinct s.round_client_id)  as hunt_rounds,
             count(*)                           as scans,
             coalesce(sum(s.input_tokens), 0)   as input_tokens,
             coalesce(sum(s.output_tokens), 0)  as output_tokens
        from hunt_scan s
        left join course   c on c.id = s.course_id
        left join location l on l.id = c.location_id
       where s.created_at >= date_trunc('month', now()) - ($2::int - 1) * interval '1 month'
         and ($1::uuid is null or l.org_id = $1)
       group by 1, l.id, l.name, l.slug
       order by 1 desc, l.name asc nulls last
    `,
      [scope, months]
    );

    return res.json({
      pricing: {
        model: "claude-haiku-4-5",
        inputUsdPerMTok: INPUT_USD_PER_MTOK,
        outputUsdPerMTok: OUTPUT_USD_PER_MTOK,
      },
      months,
      rows: result.rows.map((r) => {
        const inputTokens = Number(r.input_tokens);
        const outputTokens = Number(r.output_tokens);
        const apiCostUsd =
          Math.round(
            (inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) / 1e6 * 100
          ) / 100;
        return {
          month: r.month,
          locationId: r.location_id,
          locationName: r.location_name,
          locationSlug: r.location_slug,
          huntRounds: Number(r.hunt_rounds),
          scans: Number(r.scans),
          inputTokens,
          outputTokens,
          apiCostUsd,
        };
      }),
    });
  } catch (err) {
    console.error("[admin/hunt-usage] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
