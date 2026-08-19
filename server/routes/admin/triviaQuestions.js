// Admin: the live-trivia question bank.
//   GET    /api/admin/trivia/questions
//            ?orgId=&locationId=&category=&q=&includeArchived=&limit=&offset=
//            -> { questions, total, limit, offset }
//   GET    /api/admin/trivia/categories        -> { categories: [{category, n}] }
//   POST   /api/admin/trivia/questions          create/update
//   POST   /api/admin/trivia/questions/:id/archive
//   POST   /api/admin/trivia/questions/:id/unarchive
//
// Three scopes, narrowest wins when a host deals a game:
//   org_id null                 the platform pack — every client can deal it
//   org_id set                  that client's own questions
//   org_id + location_id set    house questions for one venue
//
// Org scoping is the security boundary: an org_admin may only ever read and
// write rows carrying their own org_id. In particular they may NOT edit the
// platform pack (org_id null) — one client's edit would change what every
// other client's trivia night deals. Archiving a platform question for
// themselves isn't supported either; if a venue dislikes one, they run a
// category that excludes it.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel, isSuperAdmin } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { normalizeQuestion } from "../../lib/triviaLive.js";

export const router = Router();

const COLS = `id, org_id as "orgId", location_id as "locationId", category, prompt,
              choices, answer, difficulty, active, source, archived_at as "archivedAt",
              created_at as "createdAt"`;

// The bank used to be small enough to hand over whole. It isn't: the
// OpenTriviaQA import (server/importTriviaPack.js) can put ~48,000 rows in the
// platform pack, and every org_admin's list includes that pack because it is
// what their hosts deal. So the list is paged, and says how many rows the
// filter actually matched.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** A non-negative integer query param, or `fallback` when absent/unparseable. */
function intParam(raw, fallback, max) {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return max === undefined ? n : Math.min(n, max);
}

router.get("/questions", async (req, res) => {
  const scope = orgScope(req);
  const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
  if (locationId && !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  const limit = intParam(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = intParam(req.query.offset, 0);
  if (limit === null || offset === null) {
    return res.status(400).json({ ok: false, error: "limit and offset must be non-negative integers" });
  }
  // Narrowing by category is what makes a paged bank usable — 48,000 rows is
  // not a list anyone scrolls, but "Sports" is 2,819 and "For Kids" is 748.
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;
  // Substring search over the prompt. Even inside one category the smallest
  // bucket is 173 rows and the largest is 8,201, so "find me that Lennon
  // question" is not a scrolling problem — it is a search problem.
  // Escaped before it reaches LIKE: a host searching "50%" or "Rock_n_Roll"
  // means those characters literally, not as wildcards.
  const q = typeof req.query.q === "string" && req.query.q.trim()
    ? req.query.q.trim().slice(0, 100).replace(/([\\%_])/g, "\\$1")
    : null;

  // A super_admin may narrow to one org; an org_admin is pinned to theirs.
  let orgId = scope;
  if (!scope && typeof req.query.orgId === "string" && req.query.orgId) {
    if (!UUID_RE.test(req.query.orgId)) {
      return res.status(400).json({ ok: false, error: "orgId must be a uuid" });
    }
    orgId = req.query.orgId;
  }

  try {
    // An org_admin sees their own rows PLUS the read-only platform pack, since
    // that's what their hosts will actually be dealing. `org_id nulls last`
    // keeps a client's own questions on the first page even when the platform
    // pack behind them runs to tens of thousands of rows.
    const where = `where ($1::uuid is null or org_id = $1 or org_id is null)
                     and ($2::uuid is null or location_id = $2 or location_id is null)
                     and ($3::bool or archived_at is null)
                     and ($4::text is null or category = $4)
                     and ($5::text is null or prompt ilike '%' || $5 || '%' escape '\\')`;
    const filters = [orgId, locationId, includeArchived, category, q];
    const [result, counted] = await Promise.all([
      pool.query(
        `select ${COLS} from trivia_question ${where}
          order by org_id nulls last, category, created_at, id
          limit $6 offset $7`,
        [...filters, limit, offset]
      ),
      pool.query(`select count(*)::int as n from trivia_question ${where}`, filters),
    ]);
    return res.json({
      ok: true,
      questions: result.rows,
      total: counted.rows[0].n,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[admin/trivia] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// The category filter's options, with a count each. Derived rather than
// configured: categories are just a text column, so the imported pack, the
// House Pack seed and anything a venue types are all equally real, and a
// hard-coded list would go stale the first time someone invented one.
router.get("/categories", async (req, res) => {
  const scope = orgScope(req);
  let orgId = scope;
  if (!scope && typeof req.query.orgId === "string" && req.query.orgId) {
    if (!UUID_RE.test(req.query.orgId)) {
      return res.status(400).json({ ok: false, error: "orgId must be a uuid" });
    }
    orgId = req.query.orgId;
  }
  try {
    // Same visibility rule as the list, so the dropdown can never offer a
    // category that filters down to nothing.
    const result = await pool.query(
      `select category, count(*)::int as n from trivia_question
        where ($1::uuid is null or org_id = $1 or org_id is null)
          and archived_at is null
        group by category order by n desc, category`,
      [orgId]
    );
    return res.json({ ok: true, categories: result.rows });
  } catch (err) {
    console.error("[admin/trivia] categories error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/questions", async (req, res) => {
  const check = normalizeQuestion(req.body);
  if (check.error) return res.status(400).json({ ok: false, error: check.error });
  const row = check.row;
  const scope = orgScope(req);

  // Whose question is this? An org_admin's is always their own; a super_admin
  // says explicitly, and may write the platform pack by passing no orgId.
  let orgId;
  if (scope) {
    orgId = scope;
  } else {
    const raw = req.body?.orgId;
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw !== "string" || !UUID_RE.test(raw)) {
        return res.status(400).json({ ok: false, error: "orgId must be a uuid" });
      }
      orgId = raw;
    } else {
      orgId = null; // the platform pack
    }
  }

  const locationId = req.body?.locationId ?? null;
  if (locationId !== null && (typeof locationId !== "string" || !UUID_RE.test(locationId))) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid or null" });
  }

  const id = req.body?.id ?? null;
  if (id !== null && (typeof id !== "string" || !UUID_RE.test(id))) {
    return res.status(400).json({ ok: false, error: "id must be a uuid" });
  }

  try {
    if (id) {
      // Verify ownership BEFORE writing: without this an org_admin could edit
      // the platform pack (or another client's question) by naming its id.
      const existing = await pool.query(`select org_id as "orgId" from trivia_question where id = $1`, [id]);
      if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
      const ownerOrg = existing.rows[0].orgId;
      // Order matters only for the MESSAGE — both are 403. The platform-pack
      // case is the more specific one, so it answers first: "not your
      // question" would be true but unhelpful for a row nobody owns.
      if (ownerOrg === null && !isSuperAdmin(req)) {
        return res.status(403).json({ ok: false, error: "the platform pack is read-only here" });
      }
      if (scope && ownerOrg !== scope) {
        return res.status(403).json({ ok: false, error: "forbidden: not your question" });
      }
      const updated = await pool.query(
        `update trivia_question
            set category = $1, prompt = $2, choices = $3::jsonb, answer = $4,
                difficulty = $5, active = $6, location_id = $7
          where id = $8
          returning ${COLS}`,
        [row.category, row.prompt, JSON.stringify(row.choices), row.answer, row.difficulty, row.active, locationId, id]
      );
      await audit({
        action: "trivia.question.update",
        entity: "trivia_question",
        entityId: id,
        detail: row,
        actor: actorLabel(req),
      });
      return res.json({ ok: true, question: updated.rows[0] });
    }

    const inserted = await pool.query(
      `insert into trivia_question (org_id, location_id, category, prompt, choices, answer, difficulty, active)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       returning ${COLS}`,
      [orgId, locationId, row.category, row.prompt, JSON.stringify(row.choices), row.answer, row.difficulty, row.active]
    );
    await audit({
      action: "trivia.question.create",
      entity: "trivia_question",
      entityId: inserted.rows[0].id,
      detail: row,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, question: inserted.rows[0] });
  } catch (err) {
    console.error("[admin/trivia] save error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Archive, never delete — the house style everywhere else in Master Control.
// A question already dealt into a running game keeps working: trivia_session
// pins its question_ids at start, so archiving cannot change what a room is
// currently looking at.
async function setArchived(req, res, archived) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const scope = orgScope(req);
  try {
    const existing = await pool.query(`select org_id as "orgId" from trivia_question where id = $1`, [id]);
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    const ownerOrg = existing.rows[0].orgId;
    if (ownerOrg === null && !isSuperAdmin(req)) {
      return res.status(403).json({ ok: false, error: "the platform pack is read-only here" });
    }
    if (scope && ownerOrg !== scope) {
      return res.status(403).json({ ok: false, error: "forbidden: not your question" });
    }
    const updated = await pool.query(
      `update trivia_question set archived_at = $1 where id = $2 returning ${COLS}`,
      [archived ? new Date() : null, id]
    );
    await audit({
      action: archived ? "trivia.question.archive" : "trivia.question.unarchive",
      entity: "trivia_question",
      entityId: id,
      detail: null,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, question: updated.rows[0] });
  } catch (err) {
    console.error("[admin/trivia] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}

router.post("/questions/:id/archive", (req, res) => setArchived(req, res, true));
router.post("/questions/:id/unarchive", (req, res) => setArchived(req, res, false));

