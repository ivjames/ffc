// Turning the OpenTriviaQA corpus into rows the live-trivia bank can deal.
//
// The upstream corpus (https://github.com/uberspot/OpenTriviaQA, CC BY-SA 4.0)
// is ~49k questions in a hand-maintained text format. It is good material and
// bad data: the files are mixed UTF-8/CP1252, apostrophes were stripped out of
// every contraction at some point in its history, a few hundred questions are
// nowhere near family-venue safe, and a couple of thousand carry options
// longer than the admin API will accept.
//
// So nothing here trusts the source. Every row is put through
// `normalizeQuestion` — the SAME validator the admin write path uses — and
// anything it rejects is dropped with a counted reason rather than patched
// into the bank. The pack can only ever contain questions an operator could
// have typed into Master Control by hand.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQuestion } from "../../server/lib/triviaLive.js";

/**
 * CP1252's 0x80..0x9F range, the bytes that make a latin-1 fallback wrong.
 * Everything from 0xA0 up already agrees with Unicode, so only this window
 * needs a table. `null` marks the five undefined slots — those bytes are
 * dropped rather than turned into U+FFFD, since a stray control byte in the
 * middle of a word is noise, not content.
 */
const CP1252_HIGH = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];

/** How many continuation bytes a UTF-8 lead byte promises, or 0 if it isn't one. */
function utf8SequenceLength(byte) {
  if (byte < 0x80) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

const UTF8_DECODER = new TextDecoder("utf-8");

/**
 * Decode a buffer that is *mostly* UTF-8 but salted with CP1252 bytes.
 *
 * `buf.toString("utf8")` replaces every bad byte with U+FFFD, which is how
 * "Insomnia Café" reaches the screen as "Insomnia Caf?". Decoding the whole
 * file as CP1252 instead mangles the (majority) UTF-8 names — "Milos with a
 * caron" comes out as "MiloÅ¡". Neither is good enough for text a host reads
 * aloud, so this walks the bytes once and picks per sequence: a valid UTF-8
 * sequence decodes as UTF-8, a lone high byte falls back to CP1252.
 *
 * @param {Uint8Array} buf
 * @returns {{ text: string, repaired: number, dropped: number }}
 */
export function decodeMixedUtf8(buf) {
  const out = [];
  let repaired = 0;
  let dropped = 0;
  let i = 0;
  while (i < buf.length) {
    const lead = buf[i];
    const need = utf8SequenceLength(lead);
    let valid = need > 0 && i + need <= buf.length;
    for (let k = 1; valid && k < need; k++) {
      if ((buf[i + k] & 0xc0) !== 0x80) valid = false;
    }
    if (valid) {
      // Single-byte sequences are ASCII; longer ones go through TextDecoder as
      // a unit so the surrogate maths stays in its hands rather than ours.
      out.push(need === 1 ? String.fromCharCode(lead) : UTF8_DECODER.decode(buf.subarray(i, i + need)));
      i += need;
      continue;
    }
    if (lead >= 0x80) {
      const mapped = lead < 0xa0 ? CP1252_HIGH[lead - 0x80] : lead;
      if (mapped === null) {
        dropped++;
      } else {
        out.push(String.fromCodePoint(mapped));
        repaired++;
      }
    } else {
      dropped++;
    }
    i += 1;
  }
  return { text: out.join(""), repaired, dropped };
}

/**
 * Contractions the corpus stripped apostrophes out of.
 *
 * Deliberately incomplete. Every entry here is a string that is ONLY ever a
 * mangled contraction — "dont" and "youre" are not words. The tempting ones
 * are left out on purpose: "ill", "lets", "its", "wed" and "shed" are all real
 * English, and "fixing" them would corrupt more questions than it repaired.
 * `Im` and `Ive` are matched case-sensitively for the same reason.
 */
const CONTRACTIONS = [
  ["dont", "don't"], ["cant", "can't"], ["wont", "won't"], ["isnt", "isn't"],
  ["didnt", "didn't"], ["doesnt", "doesn't"], ["wasnt", "wasn't"], ["werent", "weren't"],
  ["hasnt", "hasn't"], ["havent", "haven't"], ["hadnt", "hadn't"], ["wouldnt", "wouldn't"],
  ["couldnt", "couldn't"], ["shouldnt", "shouldn't"], ["arent", "aren't"], ["aint", "ain't"],
  ["thats", "that's"], ["whats", "what's"], ["whos", "who's"], ["theyre", "they're"],
  ["youre", "you're"], ["weve", "we've"], ["theyve", "they've"], ["youve", "you've"],
  ["oclock", "o'clock"],
];
const CONTRACTION_RE = new RegExp(`\\b(${CONTRACTIONS.map(([bad]) => bad).join("|")})\\b`, "gi");
const CONTRACTION_MAP = new Map(CONTRACTIONS);

/** Restore apostrophes, preserving the source's capitalisation. */
export function repairApostrophes(text) {
  return text
    .replace(CONTRACTION_RE, (match) => {
      const fixed = CONTRACTION_MAP.get(match.toLowerCase());
      if (match === match.toUpperCase()) return fixed.toUpperCase();
      if (match[0] === match[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
      return fixed;
    })
    // Case-sensitive: a lowercase "im" or "ive" is too easy to hit inside a name.
    .replace(/\bIm\b/g, "I'm")
    .replace(/\bIve\b/g, "I've");
}

/**
 * Content that does not go on a screen in a family fun center.
 *
 * Tuned to over-block. A false positive costs one question out of fifty
 * thousand; a false negative puts a sex act or a slur in front of a room at a
 * nine-year-old's birthday party. Word boundaries — rather than the loose
 * `\w*` suffixes it is tempting to write — keep "Peniston", "Sluter" and
 * "Orgasmo" from being read as the roots they happen to contain, but where a
 * suffix really is open-ended the wildcard stays.
 *
 * Not shared with server/lib/sanitize.js. That BLOCKLIST is sixteen three-letter
 * combinations for player initials, matched whole; it holds "GOD", "GAY" and
 * "JEW" because those are what people type into a scoreboard, and applying it
 * to prose would drop a Renaissance question for the word "god".
 */
const BLOCKED_WORDS = [
  "fuck\\w*", "shit(?:s|ty|ting|head)?", "cunts?", "bitch(?:es|y)?",
  "whore(?:s|house)?", "sluts?", "slutty", "porn", "porno", "pornstar",
  "pornograph\\w*", "masturbat\\w*", "orgasms?", "penis(?:es)?", "vaginas?",
  "nipples?", "erotic(?:a|ally)?", "blowjobs?", "dildos?",
  "prostitut(?:e|es|ion)", "brothels?", "strip(?:per|pers|club|clubs)",
  "striptease", "nudity", "nude", "naked", "incest(?:uous)?", "raped?",
  "rapes", "rapists?", "raping", "molest(?:ed|er|ers|ation)?", "pedophil\\w*",
  "paedophil\\w*", "bestiality", "heroin", "cocaine", "marijuana", "cannabis",
  "hashish", "bongs?", "lsd", "methamphetamine",
  // Sexual anatomy and acts named outright. "genitals" is bounded so
  // "Mycoplasma genitalium" survives as the microbiology question it is.
  "genitals?", "testicles?", "virginity", "condoms?", "intercourse",
  "copulator(?:y|ies)", "fornicat\\w*", "erections?", "promiscuous",
  "promiscuity",
];

/**
 * Slurs. Written out because a blocklist that obscures its own entries cannot
 * be reviewed or maintained, and this is the one list where a miss is
 * unrecoverable — the host reads the options aloud before anyone can react.
 *
 * This is what caught the one row in the corpus that needed it: a John Lennon
 * song whose title carries a racial slur, sitting in Music as a legitimate
 * music-history question and completely unsayable at a children's party.
 */
const SLURS = [
  "nigg(?:er|ers|a|as)", "faggots?", "kikes?", "spics?", "chinks?",
  "wetbacks?", "gooks?", "coons?", "wops?", "dagos?", "retard(?:s|ed)?",
  "tranny", "trannies", "cripples?", "midgets?",
];

/**
 * Sexual activity described in a phrase rather than a word.
 *
 * These have to be phrases, because the single words they are built from are
 * everywhere in legitimate trivia. "Sex" alone appears 179 times in the corpus
 * and is almost always biology or grammar — the sex of a crocodile is set by
 * nest temperature, parthenogenesis is asexual reproduction. So the pattern
 * matches the act, not the noun.
 */
const BLOCKED_PHRASES = [
  /\b(?:have|having|had|has)\s+sex\b/i,
  /\bsex\s+acts?\b/i,
  /\bsex(?:ual)?\s+(?:activity|relations|relationship|relationships|encounters?|partners?|positions?|abuse|assault|harassment)\b/i,
  /\bsexually\s+(?:active|explicit|abused|assaulted|transmitted|suggestive)\b/i,
  /\bone[- ]night\s+stands?\b/i,
  /\blose|lost|losing\s+(?:his|her|their|your|my)\s+virgin\w*/i,
];

const BLOCKED_RE = new RegExp(`\\b(?:${[...BLOCKED_WORDS, ...SLURS].join("|")})\\b`, "i");

/**
 * True when a question is safe to put on the big screen.
 *
 * Deliberately NOT blocked, because over-blocking has a cost too and these are
 * ordinary trivia subjects a venue would be poorer without: "breast" (cancer
 * awareness, the breaststroke, "the moon on the breast of the new-fallen
 * snow"), "affair" and "mistress" (Guinevere, Madame de Pompadour), "swinger"
 * (Louis Prima, the King of Swingers), sexual orientation as a biographical
 * fact, and the grim end of history — suicide, the Holocaust, slavery. A
 * filter that swallowed those would be its own kind of wrong.
 */
export function isFamilySafe(...parts) {
  // Joined with a separator that cannot bridge two words into a false match.
  const text = parts.join(" | ");
  return !BLOCKED_RE.test(text) && !BLOCKED_PHRASES.some((re) => re.test(text));
}

/**
 * Options that only make sense last. Shuffling "None of these" into slot B
 * reads as a bug to every player in the room, so these keep the anchor
 * position they were written for.
 */
const PIN_LAST_RE = /\b(?:none|all|any|either|neither|both) of (?:these|the above|them|the others)\b/i;

/** xmur3 — a string to a 32-bit seed, so a rebuild shuffles identically. */
function seedFrom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — a small seeded PRNG, enough for a Fisher-Yates over six items. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal the options into a stable-but-arbitrary order.
 *
 * The corpus leans on A and B — 28% of its answers sit in each of the first
 * two slots against 22% in each of the last two. That is a small edge, but it
 * is free to remove, and a regular at a weekly trivia night is exactly the
 * person who would find it. Seeded on the prompt so rebuilding the pack does
 * not reshuffle every question and churn the diff.
 *
 * @returns {{ choices: string[], answer: number }}
 */
export function shuffleChoices(prompt, choices, answer) {
  const correct = choices[answer];
  const pinned = choices.filter((c) => PIN_LAST_RE.test(c));
  const movable = choices.filter((c) => !PIN_LAST_RE.test(c));
  const rand = mulberry32(seedFrom(prompt));
  for (let i = movable.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [movable[i], movable[j]] = [movable[j], movable[i]];
  }
  const ordered = [...movable, ...pinned];
  return { choices: ordered, answer: ordered.indexOf(correct) };
}

/** True/false reads wrong in any order but this one. */
function isTrueFalse(choices) {
  if (choices.length !== 2) return false;
  const lower = choices.map((c) => c.toLowerCase()).sort();
  return lower[0] === "false" && lower[1] === "true";
}

/**
 * The upstream directory names, mapped to categories a host would pick from a
 * menu. `newest` and `rated` are not topics — they are "added recently" and
 * "someone rated this", holding the same grab-bag of subjects as `general` —
 * so they fold into General Knowledge rather than shipping as two categories
 * no host could interpret.
 */
export const CATEGORY_LABELS = {
  animals: "Animals",
  "brain-teasers": "Brain Teasers",
  celebrities: "Celebrities",
  entertainment: "Entertainment",
  "for-kids": "For Kids",
  general: "General Knowledge",
  geography: "Geography",
  history: "History",
  hobbies: "Hobbies",
  humanities: "Humanities",
  literature: "Literature",
  movies: "Movies",
  music: "Music",
  newest: "General Knowledge",
  people: "People",
  rated: "General Knowledge",
  "religion-faith": "Religion & Faith",
  "science-technology": "Science & Technology",
  sports: "Sports",
  television: "Television",
  "video-games": "Video Games",
  world: "World",
};

/**
 * `for-kids` is the one difficulty signal the corpus actually carries, so it
 * is the only one used. Nothing else is guessed: difficulty is an editorial
 * judgement, and inventing one for 49,000 rows would be noise wearing a
 * number. Everything else lands on the schema's own default.
 */
const EASY_CATEGORIES = new Set(["For Kids"]);

/**
 * Pull questions out of one OpenTriviaQA category file.
 *
 * The format is line-oriented and forgiving: `#Q ` opens a question (whose
 * text may run over several lines), `^ ` gives the answer text, and `A `..`H `
 * give the options. The answer is matched back to an option by text, which
 * doubles as the integrity check — two questions in the corpus name an answer
 * that is not among their own options, and they are dropped, not guessed at.
 *
 * @returns {Array<{ prompt: string, answerText: string|null, choices: string[] }>}
 */
export function parseCategoryFile(text) {
  const questions = [];
  for (const block of text.split(/(?:^|\n)#Q /).slice(1)) {
    const promptLines = [];
    let answerText = null;
    const choices = [];
    for (const line of block.split("\n")) {
      const option = /^([A-H]) (.*)$/.exec(line);
      if (answerText === null && line.startsWith("^ ")) {
        answerText = line.slice(2).trim();
      } else if (answerText !== null && option) {
        choices.push(option[2].trim());
      } else if (answerText === null) {
        promptLines.push(line);
      }
    }
    questions.push({
      // Prompts wrap across lines in the source; a bank row is one line.
      prompt: promptLines.join(" ").replace(/\s+/g, " ").trim(),
      answerText,
      choices,
    });
  }
  return questions;
}

/** Every reason a source question can fail to become a bank row. */
export const REJECT_REASONS = [
  "no-answer-marker",
  "answer-not-in-choices",
  "not-family-safe",
  "duplicate-prompt",
  "rejected-by-validator",
];

/**
 * Turn one parsed question into a `trivia_question` row, or say why not.
 *
 * @param {{prompt: string, answerText: string|null, choices: string[]}} raw
 * @param {{ category: string, seen: Set<string> }} ctx
 * @returns {{ row: object } | { reject: string, detail?: string }}
 */
export function toPackRow(raw, { category, seen }) {
  if (raw.answerText === null) return { reject: "no-answer-marker" };

  const prompt = repairApostrophes(raw.prompt);
  const choices = raw.choices.map((c) => repairApostrophes(c));
  const answerText = repairApostrophes(raw.answerText);

  const answer = choices.indexOf(answerText);
  if (answer === -1) return { reject: "answer-not-in-choices" };

  if (!isFamilySafe(prompt, ...choices)) return { reject: "not-family-safe" };

  // Dedupe on the prompt alone, case- and punctuation-insensitively: the same
  // question appears in several category files with its options reordered, and
  // hearing it twice in one night is the failure a player actually notices.
  const key = dedupeKey(prompt);
  if (seen.has(key)) return { reject: "duplicate-prompt" };

  const dealt = isTrueFalse(choices)
    ? { choices: ["True", "False"], answer: answerText.toLowerCase() === "true" ? 0 : 1 }
    : shuffleChoices(prompt, choices, answer);

  // The admin validator has the final say — length bounds, distinctness, the
  // lot. If it would not accept this row from a human typing it into Master
  // Control, the pack does not get to smuggle it in.
  const checked = normalizeQuestion({
    prompt,
    choices: dealt.choices,
    answer: dealt.answer,
    category,
    difficulty: EASY_CATEGORIES.has(category) ? 1 : 2,
  });
  if (checked.error) return { reject: "rejected-by-validator", detail: checked.error };

  seen.add(key);
  return { row: checked.row };
}

/** The key two questions must share to count as the same question. */
export function dedupeKey(prompt) {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Judgment repairs: apostrophes `repairApostrophes` cannot restore by rule.
 *
 * "dogs ears", "the worlds largest", "Lets", "Ill" — whether each needs an
 * apostrophe depends on the sentence, so these were adjudicated one at a time
 * (a model sweep over the whole pack, each accepted fix independently
 * verified) and committed as data. Each NDJSON line is one fix:
 *
 *   {"q": <exact prompt of the row>, "f": "p"|0..3, "b": <substring as it
 *    stands>, "a": <the same substring with apostrophes inserted>}
 *
 * `q` keys the row by its pre-repair prompt, so a rebuild from upstream hits
 * every entry, while re-running the repair over an already-patched pack
 * matches nothing and is a no-op. `f` is "p" for the prompt or a choice
 * position in the built (post-shuffle) row.
 */
export const REPAIRS_PATH = join(dirname(fileURLToPath(import.meta.url)), "trivia-pack-repairs.ndjson");

export function loadPackRepairs(path = REPAIRS_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** True when `after` is exactly `before` with one or more apostrophes added. */
export function isApostropheInsertion(before, after) {
  let i = 0;
  let inserted = 0;
  for (const ch of after) {
    if (ch === before[i]) i++;
    else if (ch === "'") inserted++;
    else return false;
  }
  return i === before.length && inserted > 0;
}

/**
 * Shared applier for both overlays.
 *
 * Nothing here trusts the entry file: `allow` decides whether the edit is the
 * kind this overlay is permitted to make, the match must be unique and
 * whole-word, a prompt edit must not collide with another row's dedupe key,
 * and the repaired row must still pass the admin validator. Anything that
 * fails is skipped with a reason — a repair pass must never be the thing that
 * corrupts the pack.
 */
function applyEdits(rows, entries, { allow, allowReason, guard }) {
  const byPrompt = new Map(rows.map((r) => [r.prompt, r]));
  const byKey = new Map(rows.map((r) => [dedupeKey(r.prompt), r]));
  const skipped = [];
  let applied = 0;

  for (const e of entries) {
    const skip = (reason) => skipped.push({ entry: e, reason });
    const row = byPrompt.get(e.q);
    if (!row) { skip("no-such-prompt"); continue; }
    if (!allow(e.b, e.a)) { skip(allowReason); continue; }
    if (guard && guard(row)) { skip("guarded-row"); continue; }

    const isPrompt = e.f === "p";
    const field = isPrompt ? row.prompt : row.choices[e.f];
    if (typeof field !== "string") { skip("no-such-field"); continue; }
    const at = field.indexOf(e.b);
    if (at === -1) { skip("before-not-found"); continue; }
    if (field.indexOf(e.b, at + 1) !== -1) { skip("ambiguous-match"); continue; }
    // An entry must not continue a word on either side — "shows star" matching
    // inside "TV shows starred" would corrupt correct text.
    const alpha = (ch) => ch !== undefined && /[a-z]/i.test(ch);
    if ((alpha(field[at - 1]) && alpha(e.b[0])) || (alpha(field[at + e.b.length]) && alpha(e.b[e.b.length - 1]))) {
      skip("mid-word-match");
      continue;
    }
    const fixed = field.slice(0, at) + e.a + field.slice(at + e.b.length);

    // A choice edit that lands on another choice means the options were near
    // misses of each other on purpose — a spelling question that never says
    // the word "spelling", like "Commercial or mercantile activity. (noun)"
    // over four manglings of "business". Structure catches what vocabulary
    // cannot, so this guard is checked for every overlay.
    if (!isPrompt) {
      const clash = row.choices.some((c, i) => i !== e.f && c.trim().toLowerCase() === fixed.trim().toLowerCase());
      if (clash) { skip("would-duplicate-choice"); continue; }
    }

    const candidate = isPrompt
      ? { ...row, prompt: fixed }
      : { ...row, choices: row.choices.map((c, i) => (i === e.f ? fixed : c)) };
    if (isPrompt) {
      const oldKey = dedupeKey(row.prompt);
      const newKey = dedupeKey(fixed);
      if (newKey !== oldKey && byKey.has(newKey)) { skip("dedupe-collision"); continue; }
      if (normalizeQuestion(candidate).error) { skip("fails-validator"); continue; }
      byKey.delete(oldKey);
      byKey.set(newKey, row);
      row.prompt = fixed;
    } else {
      if (normalizeQuestion(candidate).error) { skip("fails-validator"); continue; }
      row.choices[e.f] = fixed;
    }
    applied++;
  }
  return { applied, skipped };
}

/**
 * Apply the committed apostrophe repairs to built rows, mutating in place.
 *
 * The replacement must be a pure apostrophe insertion — the property that
 * makes this overlay safe to apply without re-reading every question.
 */
export function applyPackRepairs(rows, entries) {
  return applyEdits(rows, entries, {
    allow: isApostropheInsertion,
    allowReason: "not-insertion-only",
  });
}

/**
 * Typo and grammar repairs: the corpus is hand-maintained and full of
 * ordinary mistakes — "milllion", "Micheal", "thery" for "they're", doubled
 * words, subject-verb disagreement.
 *
 * These cannot be insertion-only, so the safety story is different. Each
 * entry was proposed by a model sweep, independently verified in sentence
 * context, and is re-checked at apply time against `isMinorTextEdit`: an
 * entry may correct wording, never rewrite it. Same file format as the
 * apostrophe overlay.
 */
export const TYPOS_PATH = join(dirname(fileURLToPath(import.meta.url)), "trivia-pack-typos.ndjson");

export function loadPackTypos(path = TYPOS_PATH) {
  return loadPackRepairs(path);
}

/** Levenshtein distance, bounded by `cap` so a long pair exits early. */
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * True when `after` corrects `before` rather than rewriting it.
 *
 * This bounds blast radius, NOT meaning. "was" -> "were" and "cat" -> "dog"
 * are the same shape to any string metric, so whether an edit is *right* is
 * the verifier's job and this function's job is only to guarantee that an
 * entry cannot quietly swap out the content of a question. Three bounds, all
 * of which must hold: the word count may move by at most one (so "alot" ->
 * "a lot" and a doubled-word deletion stay expressible, a reworded sentence
 * does not), the character distance stays inside a quarter of the original
 * with a floor of four so short corrections still fit, and no edit may exceed
 * 20 characters however long the span is.
 */
export function isMinorTextEdit(before, after) {
  if (!before || !after || before === after) return false;
  if (isDoubledWordRemoval(before, after)) return true;
  const words = (s) => s.trim().split(/\s+/).length;
  if (Math.abs(words(before) - words(after)) > 1) return false;
  const cap = Math.min(20, Math.max(4, Math.ceil(before.length * 0.25)));
  return editDistance(before, after, cap) <= cap;
}

/**
 * True when `after` is `before` with one adjacent repeated word dropped.
 *
 * Deleting a doubled word costs its whole length plus a space, which busts a
 * proportional distance bound on a short span — "have have" -> "have" is five
 * characters out of nine. So this class of edit is recognised for what it is
 * rather than measured: the two spans must be identical word sequences apart
 * from one word that repeats the one before it, case-insensitively, which is
 * a defect no matter which of the pair survives ("the The" -> "The").
 */
export function isDoubledWordRemoval(before, after) {
  const b = before.trim().split(/\s+/);
  const a = after.trim().split(/\s+/);
  if (b.length !== a.length + 1) return false;
  for (let i = 1; i < b.length; i++) {
    if (b[i].toLowerCase() !== b[i - 1].toLowerCase()) continue;
    const collapsed = b.slice(0, i).concat(b.slice(i + 1));
    if (collapsed.length === a.length && collapsed.every((w, k) => w === a[k])) return true;
  }
  return false;
}

/**
 * Questions whose subject IS the spelling, where a typo fix destroys the
 * question.
 *
 * The corpus asks "Can you find the correct spelling of this group/singer?"
 * over four manglings of Lynyrd Skynyrd; correcting the distractors leaves
 * four identical options and no question. Whole rows are held back rather
 * than individual fields, because the trap is the row, not the string.
 */
const SPELLING_QUESTION_RE = /\b(?:spell|spells|spelled|spelling|spellings|misspell\w*|spelt)\b/i;

export function looksLikeSpellingQuestion(row) {
  return SPELLING_QUESTION_RE.test([row.prompt, ...row.choices].join(" | "));
}

/**
 * How much question fits on a screen a room is reading from.
 *
 * The admin validator's 300-character ceiling is a sanity bound on what the
 * API will store, not a judgement about what plays in a venue. A host reads
 * the prompt and then every option aloud while a TV shows them, so length is
 * a gameplay property: the corpus's longest entry is a 300-character
 * biography of George Burns with a quotation attached, which is a paragraph
 * with a question mark, not a trivia question.
 *
 * Options are capped harder than prompts on purpose. There is one prompt and
 * up to six options, all of them read out, so a wordy option costs the room
 * more time than a wordy prompt does.
 *
 * Applied AFTER the repair overlays, never before: restoring an apostrophe or
 * an ampersand makes a row longer, so measuring first would keep rows that
 * end up over the line.
 */
export const MAX_PROMPT_CHARS = 180;
export const MAX_CHOICE_CHARS = 60;

/** True when a row is short enough to deal. */
export function fitsOnScreen(row) {
  return row.prompt.length <= MAX_PROMPT_CHARS && row.choices.every((c) => c.length <= MAX_CHOICE_CHARS);
}

/**
 * Split built rows into the ones a venue can deal and the ones it cannot.
 *
 * @param {object[]} rows
 * @returns {{ kept: object[], dropped: object[], longPrompt: number, longChoice: number }}
 */
export function dropOversized(rows) {
  const kept = [];
  const dropped = [];
  let longPrompt = 0;
  let longChoice = 0;
  for (const row of rows) {
    if (fitsOnScreen(row)) {
      kept.push(row);
      continue;
    }
    if (row.prompt.length > MAX_PROMPT_CHARS) longPrompt++;
    if (row.choices.some((c) => c.length > MAX_CHOICE_CHARS)) longChoice++;
    dropped.push(row);
  }
  return { kept, dropped, longPrompt, longChoice };
}

/**
 * Ampersand restorations: the character upstream lost entirely.
 *
 * The corpus contains no `&` at all — 47,710 questions, zero — while every
 * other symbol appears in the hundreds. Each one was dropped before the data
 * ever reached us (the gap is present in a fresh upstream clone too), leaving
 * a double space behind: "Gateman, Goodbury  Graves Funeral Home",
 * "Peter, Paul  Mary", "Laverne  Shirley".
 *
 * Because only `&` went missing, a gap either held one or was always a stray
 * double space — and which it is cannot be decided by shape. "Sonny  Cher" is
 * two people; "John  Lithgow" is one. So each gap was judged individually and
 * the survivors committed here; the ones that were merely stray spaces live in
 * the typo overlay instead, as ordinary whitespace fixes.
 */
export const AMPERSANDS_PATH = join(dirname(fileURLToPath(import.meta.url)), "trivia-pack-ampersands.ndjson");

export function loadPackAmpersands(path = AMPERSANDS_PATH) {
  return loadPackRepairs(path);
}

/**
 * True when `after` is `before` with one run of blanks replaced by " & ".
 *
 * As tight as `isApostropheInsertion`, and for the same reason: an overlay
 * that can only do one mechanically-checkable thing does not need every row
 * re-read to be trusted. An entry cannot move text, change a word, or put an
 * ampersand anywhere except into a gap that upstream left behind.
 */
export function isAmpersandRestoration(before, after) {
  if (!before || !after || before === after) return false;
  const gap = /  +/g;
  for (let m = gap.exec(before); m; m = gap.exec(before)) {
    if (before.slice(0, m.index) + " & " + before.slice(m.index + m[0].length) === after) return true;
  }
  return false;
}

/** Apply the committed ampersand restorations to built rows, mutating in place. */
export function applyPackAmpersands(rows, entries) {
  return applyEdits(rows, entries, {
    allow: isAmpersandRestoration,
    allowReason: "not-an-ampersand-restoration",
    guard: looksLikeSpellingQuestion,
  });
}

/** Apply the committed typo repairs to built rows, mutating in place. */
export function applyPackTypos(rows, entries) {
  return applyEdits(rows, entries, {
    allow: isMinorTextEdit,
    allowReason: "not-a-minor-edit",
    guard: looksLikeSpellingQuestion,
  });
}
