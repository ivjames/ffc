# Post-Meeting Punchlist — Bullwinkle's

Raw notes from the client meeting, organized against the current state of the
platform. Each item records what was raised, where it stands in the codebase
today, and a recommended next step, so the follow-up conversation can turn
"ideas" into scoped work. Companion docs: [`mini-golf-app-plan.md`](./mini-golf-app-plan.md)
(product phases) and [`master-control-plan.md`](./master-control-plan.md)
(admin/back-office).

> Status: **triage** — nothing here is committed work yet. Items marked
> *Clarify* need an answer from Bullwinkle's before they can be scoped.

## Raw notes (as captured)

> Bullwinkle's · Special updates / advertisements · Office integrations ·
> User data account registration · Mini leagues/team · Interactive ·
> Easy and specific · Leaderboard · Ordering food links app ·
> Rewards/tickets tie in · Social tie in scores photos

---

## Item-by-item triage

### 1. Special updates / advertisements

**Ask.** Venue wants to surface promos/announcements to players ("special
updates / advertisements").

**Today.** No announcement surface exists. Player-visible content is bundled
and publishes on rebuild via `scripts/export-content.mjs` →
`src/data/content.generated.ts` (see master-control-plan §5). The TV board
(`src/features/tv/TvLeaderboard.tsx`) and the home screen are the two obvious
display surfaces. Static signage exists only as the install-QR sheet
(`signage/`).

**Recommendation.** Add an `announcement` table (title, body, optional image,
active window, location scope, sort order) + Master Control CRUD under
`/api/admin/*`, following the archive-not-delete convention. Display: a
rotating banner slot on the home screen and an interstitial card on the TV
board between leaderboard refreshes. Promos are time-sensitive, so this is the
first real case for a **live content read** (small polled `GET
/api/announcements`) rather than rebuild-to-publish — the plan (§5) already
anticipated that flip. Offline behavior: cache last-fetched, fail silent.

**Effort.** Medium. **Depends on:** nothing — good early win.

### 2. Office integrations — *Clarify*

**Ask.** "Office integrations" — ambiguous as captured.

**Possible readings.** (a) Back-office/ops integrations for Bullwinkle's staff
(email digests of the admin overview rollup, calendar for league nights,
export to spreadsheets); (b) Microsoft Office / Google Workspace documents
(reports); (c) integration with the venue's existing POS/booking systems.

**Today.** Master Control already has a read-only rollup
(`GET /api/admin/overview`, `admin/Overview.tsx`) that could feed a scheduled
email digest cheaply. No POS integration exists anywhere.

**Recommendation.** Get the specific ask before scoping. If it's (a), a weekly
emailed overview digest is small; if it's (c), it's a project of its own and
should be tied to the food-ordering and rewards items below, which also hinge
on what POS the venue runs.

**Effort.** Unknown until clarified.

### 3. User data account registration

**Ask.** Registered player accounts (capture user data).

**Today.** Deliberately **no identity system** — three-initial arcade tags,
collisions allowed by convention (mini-golf-app-plan, "Three-initial tags"
decision). All scoring, hunt progress, and the leaderboard key off the tag
within a round. The admin side has real accounts (`admin_user`), but nothing
player-facing.

**Recommendation.** Keep tags as the zero-friction default and layer an
**optional** registration on top: claim a profile (email or phone), and a
claimed profile links its rounds going forward. This preserves the walk-up
flow the venue depends on while creating the identity spine that **rewards
(#8)**, **leagues (#4)**, and **social (#9)** all need. Requires real
decisions before build: what data is collected and why, marketing-consent
capture, minors (a family venue — likely COPPA territory for under-13
signups), and deletion requests. Server-side this is a new `player_account`
table + auth (magic-link email is the least-friction fit; no passwords),
additive to the existing `score.player_tag` model.

**Effort.** Large (the auth/privacy work, not the schema). **Blocks:** #4
leagues (team rosters), #8 rewards, #9 social attribution.

### 4. Mini leagues / teams

**Ask.** Recurring mini-leagues and team play.

**Today.** Explicitly deferred in the plan ("Group tag/leaderboard …
deferred"). The data model reserves space: a nullable `group_tag char(3)` on
scores was the sketched additive change, and the leaderboard
(`server/routes/leaderboard.js`) is already an aggregation that a group/team
dimension can slot into.

**Recommendation.** Two tiers, ship in order:
1. **Group tag (cheap, already designed).** A 3-char team tag at round start;
   team leaderboard = second aggregation over the same `score` rows. No
   accounts needed. This alone gives "team night" energy.
2. **Leagues (real feature).** Named league with a schedule (e.g. Tuesday
   nights × 8 weeks), rosters, standings across weeks, admin management in
   Master Control. Rosters want registered players → depends on #3.

**Effort.** Tier 1 small · Tier 2 large. **Depends on:** Tier 2 → #3.

### 5. Interactive / "Easy and specific" — *design principles, not features*

**Ask.** The notes "Interactive" and "Easy and specific" read as meeting
themes rather than discrete features: the experience should be interactive,
and each feature should stay easy to use and specific in purpose.

**Today.** The platform already leans interactive — the While You Wait Fun
Zone (`src/features/fun/`, 20+ arcade mini-games), the AI scavenger hunt
(`src/features/hunt/`), and the procedural putt game (`src/features/putt/`).
"Easy" is the standing bar: the core scorecard is tuned for walk-up, 1-tap
use. Interactive **course hardware** (lights/sound on holes) is Phase 4 in
the plan and stays out of scope until the software is proven.

**Recommendation.** Treat as acceptance criteria on everything else in this
list (e.g. registration must not add friction to starting a round). No
standalone work item.

### 6. Leaderboard — *already shipped*

**Ask.** Leaderboard.

**Today.** Done and live: `GET /api/leaderboard` with per-venue-timezone
day/week/month/all windows (`server/routes/leaderboard.js`) and the
full-screen TV board at `/tv` (`src/features/tv/TvLeaderboard.tsx`).

**Recommendation.** Demo it to Bullwinkle's as-is; capture any change
requests. Natural extensions already queued elsewhere in this list: team
standings (#4) and ad interstitials on the TV board (#1).

**Effort.** None (demo + feedback).

### 7. Ordering food links / app

**Ask.** Let players order food from the app.

**Today.** Nothing. The PWA has no F&B surface.

**Recommendation.** Start with **links, not ordering**: a "Food & Drink" card
(menu, and a deep link to whatever online-ordering system Bullwinkle's
already uses — Toast/Square/etc.) reachable from the home screen and the
scorecard. That's a per-location URL field in Master Control plus a UI card —
small, and it validates demand. Building ordering *into* the app means POS
integration, payments, and order status — only worth scoping if the venue's
POS has an API worth integrating (ties into #2 clarification). Note the
offline-first caveat: ordering links require connectivity; the card should
degrade gracefully offline.

**Effort.** Links small · in-app ordering large. **Depends on:** venue's POS
answer (see #2).

### 8. Rewards / tickets tie-in

**Ask.** Tie app activity into the venue's rewards/tickets economy (arcade
tickets, prizes).

**Today.** Nothing, but there are natural triggers already recorded
server-side: completed rounds, hole-in-ones (per-hole strokes are stored),
leaderboard placement, hunt completions.

**Recommendation.** Two-phase again:
1. **Manual redemption (no integration).** App-issued achievements ("Hunt
   Master", "Under Par") rendered as a QR/code screen the player shows at the
   counter; staff hand over tickets. A `reward_grant` table keyed to
   round/tag, with a redemption flag toggled from Master Control. Works
   without player accounts (per-round), better with them (#3).
2. **Ticket-system integration.** Direct crediting into the venue's card/
   ticket system (Embed, Intercard, etc.) — needs to know what Bullwinkle's
   runs; same POS/systems conversation as #2 and #7.

**Effort.** Phase 1 medium · Phase 2 unknown. **Depends on:** #3 (soft), the
systems answer (hard, for phase 2). *Clarify:* which ticket/card system the
venue uses.

### 9. Social tie-in — scores & photos

**Ask.** Players share scores and photos socially.

**Today.** The pieces exist but nothing is shareable: final scorecards
(`src/features/scorecard/`) and verified hunt photos (stored server-side on
the droplet, per master-control/hunt design). Hunt photo **content
moderation is deferred** — that decision must be revisited before any photo
leaves the venue's own storage.

**Recommendation.** Ship in order of risk:
1. **Score share (low risk).** "Share your round" on the final scorecard —
   render a branded score image client-side (canvas) and hand it to the Web
   Share API. No backend, no moderation questions, works today.
2. **Photo share (higher risk).** Sharing hunt photos re-opens moderation
   (the hunt verifier can screen for share-safety), consent (other people in
   frame), and minors. Gate behind the moderation work; don't bundle with
   step 1.

**Effort.** Score share small · photo share medium + policy work.
**Depends on:** photo share → moderation decision; account attribution → #3.

---

## Suggested sequencing

| Order | Item | Why first/later |
|---|---|---|
| 1 | Leaderboard demo (#6) | Already built — show it, collect feedback |
| 2 | Food & drink links (#7 tier 1) | Small, immediate venue value |
| 3 | Announcements/ads (#1) | Self-contained; first live-content read |
| 4 | Score sharing (#9 tier 1) | Small, no backend, marketing value |
| 5 | Group/team tag (#4 tier 1) | Already designed as additive |
| 6 | Player registration (#3) | The unlock for everything below |
| 7 | Rewards manual redemption (#8 tier 1) | Rides on triggers + accounts |
| 8 | Leagues (#4 tier 2), photo share (#9 tier 2), integrations (#2, #7/#8 tier 2) | Need accounts, clarifications, or policy work |

## Questions to bring back to Bullwinkle's

1. **"Office integrations"** — what specifically? Staff reports/email, or
   POS/booking systems?
2. **POS / ordering system** — what does the venue run for food orders, and
   does it have online ordering we can deep-link to?
3. **Ticket/rewards system** — what card/ticket platform is on the arcade
   floor (Embed, Intercard, other), and is API crediting available?
4. **Advertisements** — house promos only, or third-party/sponsor ads (which
   would need scheduling/reporting)?
5. **Player data** — what does the venue actually want to collect at
   registration, and who owns the marketing list? (Drives the consent/COPPA
   design in #3.)
