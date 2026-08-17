// Unit coverage for à la carte module resolution (lib/modules.js).
//
// The property that matters most here is BACK-COMPAT: every location that
// exists today has `modules = {}`, and must resolve exactly as it did before
// this layer was added. A regression here doesn't throw — it silently takes a
// live venue's Food tab away, which is why the legacy cases are pinned first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModules, moduleStatus, normalizeModules } from "./modules.js";

const loyalty = (extra = {}) => ({ vendor: "centeredge", apiBase: null, ...extra });

test("no modules object resolves to the pre-modules behavior", () => {
  // Ungated before, ungated now.
  assert.deepEqual(resolveModules({ pos: null }), {
    arcade: true,
    hunt: true,
    ordering: false,
    rewards: false,
    gameTickets: false,
  });

  // Vendor config alone lit these surfaces up before this layer existed.
  const wired = {
    pos: { ordering: { vendor: "centeredge", apiBase: null }, loyalty: loyalty({ gameRewards: true }) },
  };
  assert.deepEqual(resolveModules(wired), {
    arcade: true,
    hunt: true,
    ordering: true,
    rewards: true,
    gameTickets: true,
  });

  // Loyalty wired but game rewards not sold — the old gameRewards flag.
  const noTickets = { pos: { ordering: null, loyalty: loyalty({ gameRewards: false }) } };
  assert.equal(resolveModules(noTickets).rewards, true);
  assert.equal(resolveModules(noTickets).gameTickets, false);
});

test("an explicit module switches a wired capability off without touching the wiring", () => {
  const pos = { ordering: null, loyalty: loyalty({ gameRewards: true }) };
  // This is the whole point of the layer: the credentials stay in place.
  const off = resolveModules({ pos, modules: { rewards: false } });
  assert.equal(off.rewards, false);
  assert.equal(off.gameTickets, false, "tickets collapse with the surface they land on");
  assert.deepEqual(pos.loyalty, loyalty({ gameRewards: true }), "wiring untouched");

  const backOn = resolveModules({ pos, modules: { rewards: true } });
  assert.equal(backOn.rewards, true);
  assert.equal(backOn.gameTickets, true);
});

test("entitlement cannot conjure missing wiring", () => {
  // Switching rewards on for a venue with no loyalty vendor must not produce a
  // surface with nothing behind it.
  const resolved = resolveModules({ pos: null, modules: { rewards: true, ordering: true } });
  assert.equal(resolved.rewards, false);
  assert.equal(resolved.ordering, false);
});

test("game tickets require the rewards surface", () => {
  const pos = { ordering: null, loyalty: loyalty({ gameRewards: true }) };
  const resolved = resolveModules({ pos, modules: { rewards: false, gameTickets: true } });
  assert.equal(resolved.gameTickets, false, "tickets would credit a card the player can't see");
});

test("arcade and hunt are entitlement-only — they need no vendor", () => {
  assert.equal(resolveModules({ pos: null, modules: { arcade: false } }).arcade, false);
  assert.equal(resolveModules({ pos: null, modules: { hunt: false } }).hunt, false);
  assert.equal(resolveModules({ pos: null, modules: { arcade: true } }).arcade, true);
});

test("moduleStatus explains WHY a module isn't live", () => {
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

  // Sold but unwired vs. simply not sold — different problems, different fixes.
  const unwired = byKey(moduleStatus({ pos: null, modules: { rewards: true } }));
  assert.equal(unwired.rewards.live, false);
  assert.equal(unwired.rewards.entitled, true);
  assert.equal(unwired.rewards.wired, false);
  assert.equal(unwired.rewards.blockedBy, "not-wired");

  const unsold = byKey(
    moduleStatus({ pos: { ordering: null, loyalty: loyalty() }, modules: { rewards: false } })
  );
  assert.equal(unsold.rewards.blockedBy, "not-enabled");
  assert.equal(unsold.rewards.wired, true, "the wiring is still there, just unsold");

  const dependency = byKey(
    moduleStatus({
      pos: { ordering: null, loyalty: loyalty({ gameRewards: true }) },
      modules: { rewards: false, gameTickets: true },
    })
  );
  assert.equal(dependency.gameTickets.blockedBy, "requires");
});

test("moduleStatus marks derived values as inherited", () => {
  const rows = moduleStatus({ pos: { ordering: null, loyalty: loyalty() } });
  assert.ok(
    rows.every((r) => r.inherited),
    "a venue with no explicit settings has made no decisions"
  );
  const decided = moduleStatus({
    pos: { ordering: null, loyalty: loyalty() },
    modules: { rewards: true },
  });
  assert.equal(decided.find((r) => r.key === "rewards").inherited, false);
  assert.equal(decided.find((r) => r.key === "arcade").inherited, true);
});

test("normalizeModules validates and stays sparse", () => {
  assert.deepEqual(normalizeModules(null), { value: null });
  assert.deepEqual(normalizeModules({}), { value: null }, "empty stores as null, not {}");
  assert.deepEqual(normalizeModules({ rewards: false }), { value: { rewards: false } });
  // null drops a key back to the derived default rather than pinning it.
  assert.deepEqual(normalizeModules({ rewards: null }), { value: null });

  assert.match(normalizeModules({ nope: true }).error, /unknown module/);
  assert.match(normalizeModules({ rewards: "yes" }).error, /must be a boolean/);
  assert.match(normalizeModules([]).error, /must be an object/);
});
