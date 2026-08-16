import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, normalizePos, normalizeHunt, withLabel } from "./validateLocation.js";

function validBody(overrides = {}) {
  return { name: "Upland", slug: "upland", ...overrides };
}

test("normalizeLocation accepts a minimal valid body and defaults sortOrder/tz", () => {
  const result = normalizeLocation(validBody());
  assert.equal(result.error, undefined);
  assert.equal(result.row.name, "Upland");
  assert.equal(result.row.slug, "upland");
  assert.equal(result.row.sortOrder, 0);
  assert.equal(result.row.tz, null);
  assert.equal(result.row.orgId, null);
});

test("normalizeLocation rejects a non-object / array body", () => {
  assert.equal(normalizeLocation(null).status, 400);
  assert.equal(normalizeLocation([]).status, 400);
  assert.equal(normalizeLocation("x").status, 400);
});

test("normalizeLocation requires a non-empty name within 200 chars", () => {
  assert.match(normalizeLocation(validBody({ name: "" })).error, /name is required/);
  assert.match(
    normalizeLocation(validBody({ name: "x".repeat(201) })).error,
    /name is required/
  );
});

test("normalizeLocation requires a lowercase kebab slug", () => {
  assert.match(normalizeLocation(validBody({ slug: "Upland" })).error, /slug must be/);
  assert.match(normalizeLocation(validBody({ slug: "up--land" })).error, /slug must be/);
  assert.match(normalizeLocation(validBody({ slug: "-upland" })).error, /slug must be/);
  assert.equal(normalizeLocation(validBody({ slug: "north-40" })).error, undefined);
});

test("normalizeLocation range-checks lat/lng and requires them together", () => {
  assert.match(normalizeLocation(validBody({ lat: 91, lng: 0 })).error, /lat must be/);
  assert.match(normalizeLocation(validBody({ lat: 0, lng: 181 })).error, /lng must be/);
  assert.match(
    normalizeLocation(validBody({ lat: 34 })).error,
    /lat and lng must be provided together/
  );
});

test("normalizeLocation derives tz from coordinates when tz is omitted", () => {
  const result = normalizeLocation(
    validBody({ lat: 34.08867, lng: -117.67946 })
  );
  assert.equal(result.error, undefined);
  assert.equal(result.row.tz, "America/Los_Angeles");
});

test("normalizeLocation prefers an explicit valid tz over derivation", () => {
  const result = normalizeLocation(
    validBody({ lat: 34.08867, lng: -117.67946, tz: "America/New_York" })
  );
  assert.equal(result.row.tz, "America/New_York");
});

test("normalizeLocation rejects an invalid explicit tz", () => {
  assert.match(normalizeLocation(validBody({ tz: "PST" })).error, /not a valid IANA zone/);
});

test("normalizeLocation validates geofenceKm is a positive number", () => {
  assert.match(normalizeLocation(validBody({ geofenceKm: 0 })).error, /geofenceKm/);
  assert.match(normalizeLocation(validBody({ geofenceKm: -1 })).error, /geofenceKm/);
  assert.equal(normalizeLocation(validBody({ geofenceKm: 2 })).row.geofenceKm, 2);
});

test("normalizeLocation validates id and orgId as uuids when provided", () => {
  assert.match(normalizeLocation(validBody({ id: "not-a-uuid" })).error, /id must be a uuid/);
  assert.match(
    normalizeLocation(validBody({ orgId: "not-a-uuid" })).error,
    /orgId must be a uuid/
  );
});

test("withLabel adds a derived tzLabel, null when tz is unset", () => {
  assert.equal(withLabel({ tz: "America/Los_Angeles" }).tzLabel, "Pacific Time (PT)");
  assert.equal(withLabel({ tz: null }).tzLabel, null);
});

test("normalizePos treats null/undefined/{} as no integration", () => {
  assert.equal(normalizePos(undefined).value, null);
  assert.equal(normalizePos(null).value, null);
  assert.equal(normalizePos({}).value, null);
});

test("normalizePos canonicalizes decoupled capability blocks", () => {
  const { value } = normalizePos({ ordering: { vendor: "centeredge" } });
  assert.deepEqual(value, {
    ordering: { vendor: "centeredge", apiBase: null },
    loyalty: null,
  });
});

test("normalizePos allows different vendors per capability", () => {
  // The allowlist has one vendor today, so same-vendor blocks stand in for
  // the mixed case — the shape itself carries a vendor per capability.
  const { value } = normalizePos({
    ordering: { vendor: "centeredge", apiBase: "https://food.example.com" },
    loyalty: { vendor: "centeredge", gameRewards: true },
  });
  assert.equal(value.ordering.apiBase, "https://food.example.com");
  assert.deepEqual(value.loyalty, {
    vendor: "centeredge",
    apiBase: null,
    gameRewards: true,
  });
});

test("normalizePos rejects unknown vendors and malformed blocks", () => {
  assert.match(normalizePos({ ordering: { vendor: "square" } }).error, /pos\.ordering\.vendor/);
  assert.match(normalizePos({ loyalty: { vendor: "nope" } }).error, /pos\.loyalty\.vendor/);
  assert.match(normalizePos({ ordering: [] }).error, /pos\.ordering must be/);
});

test("normalizePos requires at least one capability block", () => {
  assert.match(normalizePos({ ordering: null, loyalty: null }).error, /at least one capability/);
});

test("normalizePos keeps gameRewards inside loyalty", () => {
  assert.match(
    normalizePos({ ordering: { vendor: "centeredge" }, loyalty: { gameRewards: true } }).error,
    /pos\.loyalty\.vendor/
  );
  assert.match(
    normalizePos({ loyalty: { vendor: "centeredge", gameRewards: "yes" } }).error,
    /gameRewards must be a boolean/
  );
  const { value } = normalizePos({ loyalty: { vendor: "centeredge" } });
  assert.equal(value.loyalty.gameRewards, false);
});

test("normalizePos canonicalizes game reward caps", () => {
  const { value } = normalizePos({
    loyalty: {
      vendor: "centeredge",
      gameRewards: true,
      gameRewardCaps: { dailyPerCard: 200, perGame: { skeeball: 25, trivia: 40 } },
    },
  });
  assert.deepEqual(value.loyalty.gameRewardCaps, {
    dailyPerCard: 200,
    perGame: { skeeball: 25, trivia: 40 },
  });
});

test("normalizePos drops all-default caps entirely", () => {
  const { value } = normalizePos({
    loyalty: {
      vendor: "centeredge",
      gameRewards: true,
      gameRewardCaps: { dailyPerCard: null, perGame: {} },
    },
  });
  assert.equal(value.loyalty.gameRewardCaps, undefined);
});

test("normalizePos canonicalizes adoption bonuses and keeps only what's set", () => {
  const { value } = normalizePos({
    loyalty: {
      vendor: "centeredge",
      gameRewards: true,
      adoptionBonus: { install: 100, signin: 0 },
    },
  });
  assert.deepEqual(value.loyalty.adoptionBonus, { install: 100, signin: 0 });
});

test("normalizePos rejects adoption bonuses that misname, exceed the max, or ride without rewards", () => {
  const withBonus = (adoptionBonus, gameRewards = true) =>
    normalizePos({ loyalty: { vendor: "centeredge", gameRewards, adoptionBonus } });
  assert.match(withBonus({ install: 50 }, false).error, /requires gameRewards/);
  assert.match(withBonus({ referral: 50 }).error, /unknown milestone "referral"/);
  assert.match(withBonus({ install: 1001 }).error, /adoptionBonus\.install/);
  assert.match(withBonus({ signin: -1 }).error, /adoptionBonus\.signin/);
  assert.match(withBonus({ install: 2.5 }).error, /adoptionBonus\.install/);
});

test("normalizePos rejects caps that loosen or misname", () => {
  const withCaps = (gameRewardCaps, gameRewards = true) =>
    normalizePos({ loyalty: { vendor: "centeredge", gameRewards, gameRewardCaps } });
  // caps ride on gameRewards being on
  assert.match(withCaps({ dailyPerCard: 100 }, false).error, /requires gameRewards/);
  // per-game caps can only tighten the hard per-round max
  assert.match(withCaps({ perGame: { skeeball: 101 } }).error, /perGame\.skeeball/);
  assert.match(withCaps({ perGame: { skeeball: 0 } }).error, /perGame\.skeeball/);
  // unknown game keys fail loudly instead of silently never applying
  assert.match(withCaps({ perGame: { coinpusher: 10 } }).error, /unknown game "coinpusher"/);
  // daily cap bounds
  assert.match(withCaps({ dailyPerCard: 0 }).error, /dailyPerCard/);
  assert.match(withCaps({ dailyPerCard: 10_001 }).error, /dailyPerCard/);
  assert.match(withCaps({ dailyPerCard: 2.5 }).error, /dailyPerCard/);
});

test("normalizePos validates apiBase as an http(s) URL", () => {
  assert.match(
    normalizePos({ ordering: { vendor: "centeredge", apiBase: "ftp://x" } }).error,
    /pos\.ordering\.apiBase/
  );
});

test("normalizeHunt normalizes empty/absent config to {} (unlimited)", () => {
  assert.deepEqual(normalizeHunt(undefined).value, {});
  assert.deepEqual(normalizeHunt(null).value, {});
  assert.deepEqual(normalizeHunt({}).value, {});
  // An explicit null cap normalizes away entirely — stored as no cap at all.
  assert.deepEqual(normalizeHunt({ dailyScanCap: null }).value, {});
});

test("normalizeHunt accepts an integer dailyScanCap >= 0 (0 = hunt disabled)", () => {
  assert.deepEqual(normalizeHunt({ dailyScanCap: 240 }).value, { dailyScanCap: 240 });
  assert.deepEqual(normalizeHunt({ dailyScanCap: 0 }).value, { dailyScanCap: 0 });
});

test("normalizeHunt rejects bad shapes, bad caps, and unknown keys", () => {
  assert.match(normalizeHunt([]).error, /hunt must be an object/);
  assert.match(normalizeHunt("240").error, /hunt must be an object/);
  assert.match(normalizeHunt({ dailyScanCap: -1 }).error, /dailyScanCap/);
  assert.match(normalizeHunt({ dailyScanCap: 2.5 }).error, /dailyScanCap/);
  assert.match(normalizeHunt({ dailyScanCap: "many" }).error, /dailyScanCap/);
  // A typo'd key must fail loudly, not silently store as "unlimited".
  assert.match(normalizeHunt({ dailyScancap: 10 }).error, /unknown key "dailyScancap"/);
});

test("normalizeLocation carries hunt through (and rejects a bad one)", () => {
  const ok = normalizeLocation(validBody({ hunt: { dailyScanCap: 50 } }));
  assert.deepEqual(ok.row.hunt, { dailyScanCap: 50 });
  // Omitted -> the column default (unlimited), so old callers change nothing.
  assert.deepEqual(normalizeLocation(validBody()).row.hunt, {});
  assert.equal(normalizeLocation(validBody({ hunt: { dailyScanCap: -3 } })).status, 400);
});

test("normalizeLocation carries pos through (and rejects a bad one)", () => {
  const ok = normalizeLocation(
    validBody({ pos: { ordering: { vendor: "centeredge" } } })
  );
  assert.equal(ok.row.pos.ordering.vendor, "centeredge");
  assert.equal(ok.row.pos.loyalty, null);
  assert.equal(normalizeLocation(validBody()).row.pos, null);
  assert.equal(normalizeLocation(validBody({ pos: { ordering: { vendor: "nope" } } })).status, 400);
});
