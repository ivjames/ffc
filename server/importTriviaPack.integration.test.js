// Integration coverage for the bulk trivia-pack importer.
//
// The thing that actually matters here is what the import must NOT touch. It
// writes into the platform pack (org_id null) — the one scope every client's
// trivia night deals from — so a bug that overwrote hand-written House Pack
// rows, or reached into a client's own questions, would change what a room
// full of people sees on the screen tonight and nobody would find out from a
// stack trace.
//
// The rows here are synthetic and carry their own `source` stamp: this suite
// shares a database with every other integration file, and dumping the real
// 47,710-question pack into it would make every other trivia test slow and
// this one's cleanup unreliable. The committed pack's own contents are
// asserted, without a database, in scripts/trivia-pack.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "./test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { pool } = await import("./db.js");
const { importPack, setPackArchived, prunePack, refreshPack, countDrifted, readPack, PACK_SOURCE } =
  await import("./importTriviaPack.js");

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SOURCE = `test-pack-${stamp}`;
let client;
let orgId;

/** A pack row shaped exactly like the ones the build script emits. */
const row = (n) => ({
  prompt: `pack-${stamp} question ${n}?`,
  choices: ["Alpha", "Beta", "Gamma", "Delta"],
  answer: n % 4,
  category: "General Knowledge",
  difficulty: 2,
  active: true,
});
const ROWS = [row(1), row(2), row(3)];

before(async () => {
  await ensureSchema();
  client = await pool.connect();
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Pack Test ${stamp}`,
    `pack-test-${stamp}`,
  ]);
  orgId = org.rows[0].id;
  // A client's own question, sharing a prompt with one of the pack rows. The
  // import must neither update it nor treat it as "already present".
  await testQuery(
    `insert into trivia_question (org_id, category, prompt, choices, answer)
     values ($1, 'House', $2, '["Alpha","Beta"]'::jsonb, 0)`,
    [orgId, ROWS[0].prompt]
  );
});

after(async () => {
  await testQuery(`delete from trivia_question where source = $1`, [SOURCE]);
  await testQuery(`delete from trivia_question where org_id = $1`, [orgId]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  client?.release();
  await pool.end();
});

test("inserts the pack into the platform scope and stamps its source", async () => {
  const { inserted, alreadyPresent } = await importPack(client, ROWS, { source: SOURCE });
  assert.equal(inserted, 3);
  assert.equal(alreadyPresent, 0);

  const rows = await testQuery(
    `select org_id, location_id, category, choices, answer, difficulty, active, archived_at
       from trivia_question where source = $1 order by prompt`,
    [SOURCE]
  );
  assert.equal(rows.rowCount, 3);
  for (const q of rows.rows) {
    assert.equal(q.org_id, null, "the pack belongs to no client");
    assert.equal(q.location_id, null);
    assert.equal(q.category, "General Knowledge");
    assert.equal(q.active, true);
    assert.equal(q.archived_at, null);
    assert.deepEqual(q.choices, ["Alpha", "Beta", "Gamma", "Delta"]);
  }
});

test("a second run inserts nothing", async () => {
  const { inserted, alreadyPresent } = await importPack(client, ROWS, { source: SOURCE });
  assert.equal(inserted, 0);
  assert.equal(alreadyPresent, 3);
  const count = await testQuery(`select count(*)::int as n from trivia_question where source = $1`, [SOURCE]);
  assert.equal(count.rows[0].n, 3);
});

test("a client's identically-worded question is left alone", async () => {
  const theirs = await testQuery(
    `select category, choices, source from trivia_question where org_id = $1`,
    [orgId]
  );
  assert.equal(theirs.rowCount, 1);
  assert.equal(theirs.rows[0].category, "House", "still their row, not overwritten by the pack's");
  assert.deepEqual(theirs.rows[0].choices, ["Alpha", "Beta"]);
  assert.equal(theirs.rows[0].source, null, "and it is not credited to the import");
});

test("--dry-run reports what it would do and writes nothing", async () => {
  const fresh = [row(90), row(91)];
  const { inserted } = await importPack(client, fresh, { source: SOURCE, dryRun: true });
  assert.equal(inserted, 2);
  const count = await testQuery(`select count(*)::int as n from trivia_question where source = $1`, [SOURCE]);
  assert.equal(count.rows[0].n, 3, "the transaction was rolled back");
});

test("archive retires the pack, and unarchive brings it back", async () => {
  const off = await setPackArchived(client, { archived: true, source: SOURCE });
  assert.equal(off.changed, 3);
  const archived = await testQuery(
    `select count(*)::int as n from trivia_question where source = $1 and archived_at is not null`,
    [SOURCE]
  );
  assert.equal(archived.rows[0].n, 3);

  // Archiving twice is not an error, and does not double-count.
  assert.equal((await setPackArchived(client, { archived: true, source: SOURCE })).changed, 0);

  const on = await setPackArchived(client, { archived: false, source: SOURCE });
  assert.equal(on.changed, 3);
  const live = await testQuery(
    `select count(*)::int as n from trivia_question where source = $1 and archived_at is null`,
    [SOURCE]
  );
  assert.equal(live.rows[0].n, 3);
});

test("prune retires rows a rebuilt pack has dropped, and nothing else", async () => {
  // This is how a tightened content filter actually reaches a live bank.
  // Inserting is idempotent but never takes anything back, so without prune a
  // question dropped for safety would keep being dealt forever.
  const shrunk = [ROWS[0], ROWS[1]]; // ROWS[2] is gone from the rebuilt pack

  const dry = await prunePack(client, shrunk, { source: SOURCE, dryRun: true });
  assert.equal(dry.pruned, 1);
  const stillLive = await testQuery(
    `select count(*)::int as n from trivia_question where source = $1 and archived_at is null`,
    [SOURCE]
  );
  assert.equal(stillLive.rows[0].n, 3, "--dry-run rolled back");

  const { pruned } = await prunePack(client, shrunk, { source: SOURCE });
  assert.equal(pruned, 1);
  const gone = await testQuery(
    `select prompt from trivia_question where source = $1 and archived_at is not null`,
    [SOURCE]
  );
  assert.deepEqual(gone.rows.map((r) => r.prompt), [ROWS[2].prompt]);

  // Running it again is a no-op rather than an error.
  assert.equal((await prunePack(client, shrunk, { source: SOURCE })).pruned, 0);

  // The operator's own question shares nothing with the pack's prompt list,
  // and must not be swept up by "not in the pack".
  const theirs = await testQuery(
    `select archived_at from trivia_question where org_id = $1`,
    [orgId]
  );
  assert.equal(theirs.rows[0].archived_at, null, "a client's own row is never pruned");

  // And the hand-written House Pack (source null) is out of scope entirely.
  const house = await testQuery(
    `select count(*)::int as n from trivia_question
      where org_id is null and source is null and archived_at is not null`
  );
  assert.equal(house.rows[0].n, 0);

  await setPackArchived(client, { archived: false, source: SOURCE });
});

test("refresh updates a row the pack corrected without changing its prompt", async () => {
  // The case --prune cannot reach. A typo fix inside an OPTION leaves the
  // prompt identical, so the row is "already present" to importPack and the
  // correction never lands: 1,804 rows in the real pack are exactly this.
  const corrected = ROWS.map((r) =>
    r.prompt === ROWS[1].prompt ? { ...r, choices: ["Alpha", "Beta", "Gamma", "Hopper"] } : r
  );

  const reinsert = await importPack(client, corrected, { source: SOURCE });
  assert.equal(reinsert.inserted, 0, "prompt is unchanged, so nothing is inserted");

  const before = await testQuery(
    `select choices from trivia_question where source = $1 and prompt = $2`,
    [SOURCE, ROWS[1].prompt]
  );
  assert.deepEqual(before.rows[0].choices, ["Alpha", "Beta", "Gamma", "Delta"], "still stale");

  assert.equal(await countDrifted(client, corrected, { source: SOURCE }), 1);

  const { updated } = await refreshPack(client, corrected, { source: SOURCE });
  assert.equal(updated, 1);

  const after = await testQuery(
    `select choices, answer from trivia_question where source = $1 and prompt = $2`,
    [SOURCE, ROWS[1].prompt]
  );
  assert.deepEqual(after.rows[0].choices, ["Alpha", "Beta", "Gamma", "Hopper"]);
  assert.equal(after.rows[0].answer, ROWS[1].answer, "the answer index still points where the pack says");

  // Idempotent: the bank now agrees with the pack, so there is nothing to do.
  assert.equal((await refreshPack(client, corrected, { source: SOURCE })).updated, 0);
  assert.equal(await countDrifted(client, corrected, { source: SOURCE }), 0);

  // Put the fixture back for the tests that follow.
  await refreshPack(client, ROWS, { source: SOURCE });
});

test("refresh leaves a client's own question alone, even at the same prompt", async () => {
  const hijack = [{ ...ROWS[0], choices: ["Zulu", "Yankee", "Xray", "Whiskey"] }];
  await refreshPack(client, hijack, { source: SOURCE });
  const mine = await testQuery(
    `select choices from trivia_question where org_id = $1 and prompt = $2`,
    [orgId, ROWS[0].prompt]
  );
  assert.deepEqual(mine.rows[0].choices, ["Alpha", "Beta"], "the org's own row is untouched");
  await refreshPack(client, ROWS, { source: SOURCE });
});

test("refresh does not resurrect a question an operator retired", async () => {
  // Retiring a question is a judgement about the question; correcting its
  // spelling must not put it back on the screen behind the operator's back.
  await testQuery(`update trivia_question set archived_at = now() where source = $1 and prompt = $2`, [
    SOURCE,
    ROWS[2].prompt,
  ]);
  const corrected = ROWS.map((r) =>
    r.prompt === ROWS[2].prompt ? { ...r, choices: ["Alpha", "Beta", "Gamma", "Omega"] } : r
  );
  const { updated } = await refreshPack(client, corrected, { source: SOURCE });
  assert.equal(updated, 1, "the text is still corrected");
  const after = await testQuery(
    `select choices, archived_at from trivia_question where source = $1 and prompt = $2`,
    [SOURCE, ROWS[2].prompt]
  );
  assert.deepEqual(after.rows[0].choices, ["Alpha", "Beta", "Gamma", "Omega"]);
  assert.ok(after.rows[0].archived_at, "but it stays retired");

  await testQuery(`update trivia_question set archived_at = null where source = $1 and prompt = $2`, [
    SOURCE,
    ROWS[2].prompt,
  ]);
  await refreshPack(client, ROWS, { source: SOURCE });
});

test("refresh --dry-run reports what it would change and writes nothing", async () => {
  const corrected = ROWS.map((r) =>
    r.prompt === ROWS[0].prompt ? { ...r, choices: ["Alpha", "Beta", "Gamma", "Sigma"] } : r
  );
  const { updated } = await refreshPack(client, corrected, { source: SOURCE, dryRun: true });
  assert.equal(updated, 1, "it reports the row it would have touched");
  const after = await testQuery(
    `select choices from trivia_question where source = $1 and prompt = $2`,
    [SOURCE, ROWS[0].prompt]
  );
  assert.deepEqual(after.rows[0].choices, ["Alpha", "Beta", "Gamma", "Delta"], "but rolled back");
});

test("archiving the pack leaves the hand-written House Pack dealing", async () => {
  await setPackArchived(client, { archived: true, source: SOURCE });
  const house = await testQuery(
    `select count(*)::int as n from trivia_question
      where org_id is null and source is null and archived_at is null`
  );
  assert.ok(house.rows[0].n >= 1, "the seeded House Pack survives an archive of the import");
  await setPackArchived(client, { archived: false, source: SOURCE });
});

test("the committed pack loads, and every row survives the validator on the way in", async () => {
  // readPack re-validates each row and cross-checks the header count, so this
  // is the guard against shipping a pack the importer would choke on halfway.
  const { header, rows } = await readPack();
  assert.equal(header.pack, PACK_SOURCE);
  assert.equal(header.license, "CC BY-SA 4.0");
  assert.equal(rows.length, header.count);
  // A floor, not a target: it catches a build that quietly lost half the
  // corpus. Lowered from 45,000 when the screen-length bounds dropped 3,853
  // rows a host could not reasonably read out.
  assert.ok(rows.length > 40_000, `expected a full pack, got ${rows.length}`);
});
