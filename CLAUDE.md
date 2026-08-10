# FFC — notes for Claude sessions

## Environment status

- **This deployment is staging / development only — there is NO production
  yet.** Nothing is live to real players and **no money is attached to
  anything** — rewards, loyalty-card tickets, and grants have no monetary value
  in this environment. Treat the app as being in development mode: don't gate
  work behind production-risk caution (polluting boards, minting "real" tickets,
  irreversible payouts) — those concerns don't apply until a real production
  environment exists. Still keep changes reversible and tests green; just don't
  ask for prod-style sign-off on staging data.

## Operator preferences

- **Always surface token burn and cost stats for large operations.** Any
  feature, script, or tool that makes multiple model/API calls must report
  exact billed token counts (from the API's usage object, not estimates) and
  computed cost — cumulatively for the whole operation, not just per call —
  plus a pre-flight estimate before kicking off a batch. Precedents:
  `hunt_scan` metering (server/routes/hunt.js), the admin hunt-usage rollup,
  and the vision bake-off's burn ticker (scripts/lib/vision-compare-page.mjs).

- **No guests in test datasets.** Images used for model testing/evaluation
  (e.g. the vision bake-off) must not contain people — they get sent to
  third-party providers. The stored-photo picker filters on the hunt
  verifier's `people_present` flag; keep that invariant in any new test
  tooling. (Production hunt photos may contain people per the venue's
  policy — this rule is about test data leaving our infrastructure.)

## Repo orientation

- Player PWA in `src/`, separate admin SPA in `admin/` (Master Control),
  Express API in `server/` (deployed via pm2 as `ffc-api`; nginx in front).
- Deploys clone this whole repo; `ffc deploy` (bin/ffc) pulls **main** only —
  feature branches are checked out manually + `ffc restart`.
- Server tests: `cd server && TEST_DATABASE_URL=... npm test` (needs Postgres).
- Model pricing/decisions for vision features: see `IMAGE-DESCRIPTION-PRICING.md`
  and `HUNT-PRICING.md`; re-verify provider rates at build time — cheap vision
  tiers churn fast.
