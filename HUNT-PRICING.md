# Scavenger Hunt — Cost Model & Pricing

Last updated: 2026-08-07. Numbers assume the current implementation on this
branch: `claude-haiku-4-5` vision, client-side downscale to ≤1280px, per-item
attempt cap, per-round scan budget, and `hunt_scan` token metering.

## What one scan costs

Every `POST /api/hunt/verify` makes exactly one model call (dedupe repeats make
none). Haiku 4.5 list pricing: **$1 / 1M input tokens, $5 / 1M output tokens**.

| Component | Typical | Worst case |
|---|---|---|
| Image (≤1280px long edge, ~px/750 tokens) | ~1,100–1,640 | ~1,640 |
| Prompt + schema overhead | ~250 | ~350 |
| Output (4-field JSON verdict, `max_tokens: 1024`) | ~80 | 1,024 |
| **Cost per scan** | **≈ $0.002** | **≈ $0.007** |

If the model, image size, or `max_tokens` changes, re-derive this table first —
everything below scales from it.

## Two modes, one cost model

The hunt runs in two modes and they cost exactly the same per scan:

- **Course hunt** — a themed list played during a mini-golf round.
- **Venue hunt** — the course-free list, for sites with no mini golf (opt-in per
  venue via `location.hunt.venueMode`). No round required: a group starts a
  hunt session on the device and plays the venue's own list.

Every control below is mode-blind. The venue hunt bills through the same
`hunt_scan` rows (with `course_id` null and `location_id` carrying the venue),
obeys the same per-round/per-item/per-venue caps, and lands in the same rollup.
The only thing venue mode changes about spend is **who can start one**: a venue
hunt has no round gating it, so the daily venue cap (`dailyScanCap`) does more
work there — set one when you switch it on.

## What one round costs

The billing unit is the **hunt round**: one group (up to 4 players) playing one
list (up to 20 items). On a venue hunt the same unit is a hunt *session* — one
group's `roundClientId`, counted identically.

Spend per round is bounded by three server-side controls (`server/routes/hunt.js`):

1. **`HUNT_ATTEMPT_CAP`** (default 3) — judged shots per player per
   non-countable item per round. The working spend control. Successful finds
   dedupe; "couldn't read that photo" retries don't burn attempts; countable
   items are exempt.
2. **`HUNT_SCAN_CAP`** (default 240) — total model calls per round, sized at
   the legitimate max (4 players × 20 items × 3 attempts). The backstop; also
   the only bound on countable-item (horseshoe) grinding.
3. **Per-IP rate limit** (20/min) — bounds burn *rate*, not total.

Both caps are read from env per request, so a venue can be tightened live with
no redeploy (e.g. `HUNT_SCAN_CAP=120` for small lists).

| Scenario | Scans | Cost |
|---|---|---|
| Typical round | 40–80 | $0.08–0.16 |
| Heavy round (big list, many misses) | ~120 | ~$0.25 |
| Hard ceiling (full 240-scan burn) | 240 | ~$0.50 |

## Monthly scaling

Cost is linear in hunt rounds:

| Hunt rounds / month | Expected API cost (~$0.12/round) | Absolute ceiling (~$0.50/round) |
|---|---|---|
| 250 | ~$30 | $125 |
| 1,000 | ~$120 | $500 |
| 3,000 | ~$360 | $1,500 |
| 10,000 | ~$1,200 | $5,000 |

The ceiling column requires every group to exhaust its entire 240-scan budget —
it's an adversarial bound, not a forecast.

## Tiered monthly pricing

Design rules: each tier's included allotment costs well under half the fee at
*expected* usage, and the overage price is ≥ the hard per-round ceiling — so
overage can never lose money and tiers stay above water at both ends.

| Tier | Monthly | Included hunt rounds | Overage |
|---|---|---|---|
| Starter | $49 | 120 | $0.50/round |
| Standard | $99 | 250 | $0.50/round |
| Venue | $249 | 600 | $0.50/round |

- At expected cost (~$0.12/round), realized margin is ~70–85% at full
  utilization of any tier.
- $0.50 overage is breakeven at the theoretical 240-scan ceiling and
  profitable everywhere real; use $1.00 if you want strict 2×-worst-case
  margin on overage.
- Rule of thumb when anything changes (model price, image size, caps): keep
  the overage price ≥ the capped worst-case round cost, ideally 2×.

## Market reference (Aug 2026)

- Let's Roam: ~$99 flat per group up to 20 (~$5/person effective); consumer
  city-hunt tickets ~$10–15/person.
- GooseChase: $399/experience (8 participants), $649 (20) — corporate/events.
- Scavify: unpublished, sales-led.

As an on-course add-on the hunt's marginal cost (~$0.12/round) is 30–100×
below any market anchor, so pricing is a positioning choice, not a margin
constraint — including free-with-round (~$0.12/group absorbed as marketing).

## Reconciling against the Anthropic invoice

`hunt_scan` records the API's exact token counts per call (the number Anthropic
bills), plus model id and a denormalized `course_id`.

**In Master Control:** `GET /api/admin/hunt-usage?months=6` returns the monthly
per-venue rollup (rounds, scans, token sums, list-price cost) — org-scoped for
`org_admin`, no psql needed.

**Raw SQL equivalent:**

```sql
select l.name as venue, date_trunc('month', s.created_at) as month,
       count(distinct s.round_client_id) as hunt_rounds, count(*) as scans,
       round((sum(s.input_tokens) * 1.00 + sum(s.output_tokens) * 5.00) / 1e6, 2) as api_cost_usd
  from hunt_scan s
  left join course c on c.id = s.course_id
  join location l on l.id = coalesce(c.location_id, s.location_id)
 group by 1, 2 order by 2 desc, 1;
```

(`coalesce(c.location_id, s.location_id)` is what makes this cover both modes:
a venue-hunt scan has no course, so its venue comes from its own stamp. An
inner `join course` here silently drops every course-free hunt's spend.)

(The `1.00` / `5.00` literals are the Haiku 4.5 $/MTok rates — update alongside
any model change.)

## Backstops beyond the app

- Set a **workspace spend limit** in the Anthropic Console at ~2× expected
  monthly volume: a bug or abuse spike degrades the hunt (503s/429s) instead of
  producing a surprise bill.
- `HUNT_SCAN_CAP=0` is a per-venue kill switch (every verify 429s), effective
  without a restart.
