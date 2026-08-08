# FFC — notes for Claude sessions

## Operator preferences

- **Always surface token burn and cost stats for large operations.** Any
  feature, script, or tool that makes multiple model/API calls must report
  exact billed token counts (from the API's usage object, not estimates) and
  computed cost — cumulatively for the whole operation, not just per call —
  plus a pre-flight estimate before kicking off a batch. Precedents:
  `hunt_scan` metering (server/routes/hunt.js), the admin hunt-usage rollup,
  and the vision bake-off's burn ticker (scripts/lib/vision-compare-page.mjs).

## Repo orientation

- Player PWA in `src/`, separate admin SPA in `admin/` (Master Control),
  Express API in `server/` (deployed via pm2 as `ffc-api`; nginx in front).
- Deploys clone this whole repo; `ffc deploy` (bin/ffc) pulls **main** only —
  feature branches are checked out manually + `ffc restart`.
- Server tests: `cd server && TEST_DATABASE_URL=... npm test` (needs Postgres).
- Model pricing/decisions for vision features: see `IMAGE-DESCRIPTION-PRICING.md`
  and `HUNT-PRICING.md`; re-verify provider rates at build time — cheap vision
  tiers churn fast.
