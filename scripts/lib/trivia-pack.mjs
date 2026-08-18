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
 */
const BLOCKED_WORDS = [
  "fuck\\w*", "shit(?:s|ty|ting|head)?", "cunts?", "bitch(?:es|y)?",
  "whore(?:s|house)?", "sluts?", "slutty", "porn", "porno", "pornstar",
  "pornograph\\w*", "masturbat\\w*", "orgasms?", "penis(?:es)?", "vaginas?",
  "nipples?", "erotic(?:a|ally)?", "blowjobs?", "dildos?",
  "prostitut(?:e|es|ion)", "brothels?", "strip(?:per|pers|club|clubs)",
  "nudity", "nude", "naked", "incest(?:uous)?", "raped?", "rapes", "rapists?",
  "raping", "molest(?:ed|er|ers|ation)?", "pedophil\\w*", "paedophil\\w*",
  "bestiality", "heroin", "cocaine", "marijuana", "cannabis", "hashish",
  "bongs?", "lsd", "methamphetamine",
];
const BLOCKED_RE = new RegExp(`\\b(?:${BLOCKED_WORDS.join("|")})\\b`, "i");

/** True when a question is safe to put on the big screen. */
export function isFamilySafe(...parts) {
  // Joined with a separator that cannot bridge two words into a false match.
  return !BLOCKED_RE.test(parts.join(" | "));
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
