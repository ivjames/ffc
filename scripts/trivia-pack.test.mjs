// The OpenTriviaQA pack: the repair rules, and the committed artifact itself.
//
// Two jobs here. The unit tests pin the decisions that are easy to "simplify"
// into a bug later — the contraction list is deliberately incomplete, the
// shuffle is deliberately seeded, the safety filter is deliberately blunt.
//
// The rest checks server/seed/open-trivia-pack.ndjson.gz as shipped. That file
// is 48,264 rows nobody will ever read, loaded straight into the bank a venue
// deals its trivia night from, so "every row would pass the admin validator"
// and "nothing in it is unfit for a room full of kids" have to be assertions,
// not a claim in a commit message.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { describe, expect, test } from 'vitest';
import { normalizeQuestion } from '../server/lib/triviaLive.js';
import {
  CATEGORY_LABELS,
  applyPackRepairs,
  applyPackTypos,
  decodeMixedUtf8,
  dedupeKey,
  isApostropheInsertion,
  isFamilySafe,
  isMinorTextEdit,
  loadPackRepairs,
  loadPackTypos,
  looksLikeSpellingQuestion,
  parseCategoryFile,
  repairApostrophes,
  shuffleChoices,
  toPackRow,
} from './lib/trivia-pack.mjs';
import { PACK_PATH } from './build-trivia-pack.mjs';

const bytes = (...values) => Uint8Array.from(values);

describe('decodeMixedUtf8', () => {
  test('keeps real UTF-8 intact', () => {
    const { text, repaired } = decodeMixedUtf8(new TextEncoder().encode('Miloš Forman'));
    expect(text).toBe('Miloš Forman');
    expect(repaired).toBe(0);
  });

  test('rescues a stray CP1252 byte instead of replacing it with U+FFFD', () => {
    // "Caf<0xe9>" — latin-1 e-acute in the middle of an otherwise UTF-8 file.
    const { text, repaired } = decodeMixedUtf8(bytes(0x43, 0x61, 0x66, 0xe9));
    expect(text).toBe('Café');
    expect(repaired).toBe(1);
    expect(text).not.toContain('�');
  });

  test('maps the 0x80..0x9F window through CP1252, not latin-1', () => {
    // 0x93/0x94 are undefined in latin-1 but are curly quotes in CP1252.
    expect(decodeMixedUtf8(bytes(0x93, 0x68, 0x69, 0x94)).text).toBe('“hi”');
  });

  test('handles both encodings in one buffer', () => {
    const buf = Uint8Array.from([...new TextEncoder().encode('Miloš, '), 0x43, 0x61, 0x66, 0xe9]);
    expect(decodeMixedUtf8(buf).text).toBe('Miloš, Café');
  });

  test('drops CP1252 undefined slots rather than inventing a character', () => {
    const { text, dropped } = decodeMixedUtf8(bytes(0x61, 0x9d, 0x62));
    expect(text).toBe('ab');
    expect(dropped).toBe(1);
  });
});

describe('repairApostrophes', () => {
  test('restores contractions the corpus stripped', () => {
    expect(repairApostrophes('Dont you ever say you cant')).toBe("Don't you ever say you can't");
    expect(repairApostrophes('Im sure Ive seen it')).toBe("I'm sure I've seen it");
  });

  test('preserves the case it found', () => {
    expect(repairApostrophes('DONT')).toBe("DON'T");
    expect(repairApostrophes('Thats')).toBe("That's");
    expect(repairApostrophes('whats')).toBe("what's");
  });

  test('leaves real words alone, however tempting they look', () => {
    // Every one of these is a word. "Fixing" them corrupts more than it saves,
    // which is why they are not in the table — a regression here is silent.
    const untouched = 'He lets its ill wed shed wont be confused';
    expect(repairApostrophes(untouched)).toBe('He lets its ill wed shed won\'t be confused');
    expect(repairApostrophes('The Slim Shady LP')).toBe('The Slim Shady LP');
    // Lowercase "im"/"ive" hide inside names; only the capitalised forms match.
    expect(repairApostrophes('Kim and Ivelisse')).toBe('Kim and Ivelisse');
  });
});

describe('isApostropheInsertion', () => {
  test('accepts pure apostrophe insertions', () => {
    expect(isApostropheInsertion('dogs ears', "dog's ears")).toBe(true);
    expect(isApostropheInsertion('students union', "students' union")).toBe(true);
    expect(isApostropheInsertion('Ill see you', "I'll see you")).toBe(true);
  });

  test('rejects anything that is not purely an insertion', () => {
    expect(isApostropheInsertion('dogs ears', 'dogs ears')).toBe(false); // no-op
    expect(isApostropheInsertion('dogs ears', "dog's ear")).toBe(false); // deletion
    expect(isApostropheInsertion('dogs ears', "Dog's ears")).toBe(false); // case change
    expect(isApostropheInsertion('dogs ears', "dog's, ears")).toBe(false); // other punctuation
  });
});

describe('applyPackRepairs', () => {
  const mkRows = () => [
    {
      prompt: 'A Chinese Crested dogs ears are not cropped.',
      choices: ['True', 'False'],
      answer: 0,
      category: 'Animals',
      difficulty: 2,
      active: true,
    },
    {
      prompt: 'What is the worlds largest desert?',
      choices: ['Sahara', 'Gobi', 'Arabian', 'Kalahari'],
      answer: 0,
      category: 'Geography',
      difficulty: 2,
      active: true,
    },
  ];

  test('applies prompt and choice fixes, keyed by the unrepaired prompt', () => {
    const rows = mkRows();
    const { applied, skipped } = applyPackRepairs(rows, [
      { q: 'A Chinese Crested dogs ears are not cropped.', f: 'p', b: 'dogs ears', a: "dog's ears" },
      { q: 'What is the worlds largest desert?', f: 'p', b: 'worlds largest', a: "world's largest" },
    ]);
    expect(applied).toBe(2);
    expect(skipped).toEqual([]);
    expect(rows[0].prompt).toBe("A Chinese Crested dog's ears are not cropped.");
    expect(rows[1].prompt).toBe("What is the world's largest desert?");
  });

  test('a second pass over the repaired rows is a no-op', () => {
    const rows = mkRows();
    const entries = [{ q: 'What is the worlds largest desert?', f: 'p', b: 'worlds', a: "world's" }];
    applyPackRepairs(rows, entries);
    const again = applyPackRepairs(rows, entries);
    expect(again.applied).toBe(0);
    expect(again.skipped).toEqual([{ entry: entries[0], reason: 'no-such-prompt' }]);
  });

  test('refuses an edit that is not a pure apostrophe insertion', () => {
    const rows = mkRows();
    const { applied, skipped } = applyPackRepairs(rows, [
      { q: 'What is the worlds largest desert?', f: 'p', b: 'worlds', a: 'worlds biggest' },
    ]);
    expect(applied).toBe(0);
    expect(skipped[0].reason).toBe('not-insertion-only');
  });

  test('refuses a match that continues a word on either side', () => {
    const rows = [{ ...mkRows()[0], prompt: 'Which TV shows starred a big-headed kid?' }];
    const { applied, skipped } = applyPackRepairs(rows, [
      { q: 'Which TV shows starred a big-headed kid?', f: 'p', b: 'shows star', a: "show's star" },
    ]);
    expect(applied).toBe(0);
    expect(skipped[0].reason).toBe('mid-word-match');
  });

  test('refuses a substring that matches more than once', () => {
    const rows = [{ ...mkRows()[0], prompt: 'The dogs saw the dogs bone.' }];
    const { skipped } = applyPackRepairs(rows, [
      { q: 'The dogs saw the dogs bone.', f: 'p', b: 'dogs', a: "dog's" },
    ]);
    expect(skipped[0].reason).toBe('ambiguous-match');
  });

  test('refuses a fix whose result would collide with another prompt', () => {
    const rows = [
      { ...mkRows()[1] },
      { ...mkRows()[1], prompt: "What is the world's largest desert?" },
    ];
    const { applied, skipped } = applyPackRepairs(rows, [
      { q: 'What is the worlds largest desert?', f: 'p', b: 'worlds', a: "world's" },
    ]);
    expect(applied).toBe(0);
    expect(skipped[0].reason).toBe('dedupe-collision');
  });

  test('fixes a choice by its position without touching the answer index', () => {
    const rows = mkRows();
    const { applied } = applyPackRepairs(rows, [
      { q: 'What is the worlds largest desert?', f: 1, b: 'Gobi', a: "Gob'i" },
    ]);
    expect(applied).toBe(1);
    expect(rows[1].choices[1]).toBe("Gob'i");
    expect(rows[1].answer).toBe(0);
  });
});

describe('isMinorTextEdit', () => {
  test('accepts corrections', () => {
    expect(isMinorTextEdit('two milllion years', 'two million years')).toBe(true);
    expect(isMinorTextEdit('Micheal Jackson', 'Michael Jackson')).toBe(true);
    expect(isMinorTextEdit('the results was', 'the results were')).toBe(true);
    // A doubled word costs its whole length, so the bound has a floor.
    expect(isMinorTextEdit('the the same', 'the same')).toBe(true);
  });

  test('refuses a rewrite', () => {
    expect(
      isMinorTextEdit(
        'In what year was the worlds first pizza parlor built?',
        'In what year did pizza restaurants first appear?'
      )
    ).toBe(false);
    expect(isMinorTextEdit('Which planet is closest to the sun?', 'Which planet orbits nearest our star?')).toBe(false);
  });

  test('refuses a no-op and rejects wholesale word-count changes', () => {
    expect(isMinorTextEdit('million', 'million')).toBe(false);
    expect(isMinorTextEdit('a cat', 'a large orange cat')).toBe(false);
  });

  test('bounds blast radius, not meaning — a short swap is the verifier\'s problem', () => {
    // Documented deliberately: no string metric separates "was"->"were" from
    // "cat"->"dog", so this gate cannot be the thing that decides correctness.
    expect(isMinorTextEdit('cat', 'dog')).toBe(true);
  });
});

describe('looksLikeSpellingQuestion', () => {
  test('flags a question whose subject is the spelling', () => {
    expect(
      looksLikeSpellingQuestion({
        prompt: 'Can you find the correct spelling of this group/singer?',
        choices: ['Lenyd Skynard', 'Lynyrd Skynyrd', 'Lenird Skynerd', 'Linard Skinard'],
      })
    ).toBe(true);
  });

  test('flags it from an option too, not just the prompt', () => {
    expect(
      looksLikeSpellingQuestion({ prompt: 'Where did Sid get his stage name?', choices: ['His mother\'s maiden name spelled backwards'] })
    ).toBe(true);
  });

  test('leaves ordinary questions alone', () => {
    expect(looksLikeSpellingQuestion({ prompt: 'Which planet is closest to the sun?', choices: ['Mercury'] })).toBe(false);
  });
});

describe('applyPackTypos', () => {
  const mkRows = () => [
    {
      prompt: 'A Clydesdale horse can weight up to 1,000 pounds.',
      choices: ['True', 'False'],
      answer: 1,
      category: 'Animals',
      difficulty: 2,
      active: true,
    },
    {
      prompt: 'Can you find the correct spelling of this group/singer?',
      choices: ['Lenyd Skynard', 'Lynyrd Skynyrd', 'Lenird Skynerd', 'Linard Skinard'],
      answer: 1,
      category: 'Music',
      difficulty: 2,
      active: true,
    },
  ];

  test('applies a correction', () => {
    const rows = mkRows();
    const { applied, skipped } = applyPackTypos(rows, [
      { q: 'A Clydesdale horse can weight up to 1,000 pounds.', f: 'p', b: 'can weight up', a: 'can weigh up' },
    ]);
    expect(applied).toBe(1);
    expect(skipped).toEqual([]);
    expect(rows[0].prompt).toBe('A Clydesdale horse can weigh up to 1,000 pounds.');
  });

  test('refuses to touch a spelling question, however plausible the fix', () => {
    // Correcting the distractors here leaves four identical options and no
    // question. The guard is on the row, because the trap is the row.
    const rows = mkRows();
    const { applied, skipped } = applyPackTypos(rows, [
      { q: 'Can you find the correct spelling of this group/singer?', f: 0, b: 'Lenyd Skynard', a: 'Lynyrd Skynyrd' },
    ]);
    expect(applied).toBe(0);
    expect(skipped[0].reason).toBe('guarded-row');
    expect(rows[1].choices[0]).toBe('Lenyd Skynard');
  });

  test('refuses an entry that rewrites rather than corrects', () => {
    const rows = mkRows();
    const { applied, skipped } = applyPackTypos(rows, [
      {
        q: 'A Clydesdale horse can weight up to 1,000 pounds.',
        f: 'p',
        b: 'A Clydesdale horse can weight up to 1,000 pounds.',
        a: 'A Shire horse is among the heaviest breeds in the world.',
      },
    ]);
    expect(applied).toBe(0);
    expect(skipped[0].reason).toBe('not-a-minor-edit');
  });

  test('a second pass over the repaired rows is a no-op', () => {
    const rows = mkRows();
    const entries = [
      { q: 'A Clydesdale horse can weight up to 1,000 pounds.', f: 'p', b: 'can weight up', a: 'can weigh up' },
    ];
    applyPackTypos(rows, entries);
    expect(applyPackTypos(rows, entries).applied).toBe(0);
  });
});

describe('isFamilySafe', () => {
  test('blocks the words that must never reach the big screen', () => {
    expect(isFamilySafe('Who said this line?', 'Fuck, Im dead')).toBe(false);
    expect(isFamilySafe('Which actress appeared nude on a magazine cover?')).toBe(false);
    expect(isFamilySafe('Which drug is derived from the coca plant?', 'Cocaine')).toBe(false);
  });

  test('does not read a blocked root inside an innocent word', () => {
    expect(isFamilySafe('Who sang Finally in 1992?', 'CeCe Peniston')).toBe(true);
    expect(isFamilySafe('Which sculptor carved the Well of Moses?', 'Claus Sluter')).toBe(true);
    expect(isFamilySafe('Which 1962 caveman film is also called Orgasmo?')).toBe(true);
    expect(isFamilySafe('Which city hosts the Scunthorpe Telegraph?')).toBe(true);
  });

  test('checks every option, not just the prompt', () => {
    expect(isFamilySafe('Pick one', 'A horse', 'A dildo', 'A cat')).toBe(false);
  });

  test('blocks slurs', () => {
    // The corpus contains exactly one: a John Lennon song title, filed in
    // Music as a legitimate music-history question and completely unsayable
    // at a children's party. A host reads the options aloud before anyone in
    // the room can react, so this is the one list where a miss cannot be
    // walked back.
    expect(isFamilySafe('Which song was banned?', 'Woman Is the N-word of the World')).toBe(true);
    expect(isFamilySafe('Which song was banned?', 'Woman Is the Nigger of the World')).toBe(false);
    expect(isFamilySafe('What did the character shout?', 'A homophobic faggot slur')).toBe(false);
  });

  test('blocks sexual activity described as a phrase', () => {
    // Built from words that are individually everywhere in the corpus, so the
    // pattern has to match the act rather than the noun.
    expect(isFamilySafe('What does GAMBOL mean?', 'to have sex', 'to skip about')).toBe(false);
    expect(isFamilySafe('She had a sexual relationship with her co-star.')).toBe(false);
    expect(isFamilySafe('Sex acts like a natural antihistamine.')).toBe(false);
    expect(isFamilySafe('He was sexually abused by four of the guards.')).toBe(false);
    expect(isFamilySafe('What appeared on TV as AIDS spread?', 'Condoms')).toBe(false);
  });

  test('does not swallow ordinary trivia that merely sounds close', () => {
    // Over-blocking has a cost too. Each of these was a real false positive
    // while the filter was being tuned, and each would be a question the venue
    // is poorer for losing.
    expect(isFamilySafe('The pink ribbon raises awareness of what?', 'Breast cancer')).toBe(true);
    expect(isFamilySafe('In which stroke can a flip turn be used?', 'Breaststroke')).toBe(true);
    expect(isFamilySafe("What was Louis Prima's nickname?", 'The King of Swingers')).toBe(true);
    expect(isFamilySafe('What is the smallest self-reproducing organism?', 'Mycoplasma genitalium')).toBe(true);
    expect(isFamilySafe("A crocodile's sex is determined by nest temperature.", 'True')).toBe(true);
    expect(isFamilySafe('Parthenogenesis is an asexual form of reproduction.', 'True')).toBe(true);
    // Grim history is still history, and a filter that hid it would be wrong
    // in a different direction.
    expect(isFamilySafe('Which film is about the Holocaust?', "Schindler's List")).toBe(true);
    expect(isFamilySafe('How did Broderick Crawford die?', 'He committed suicide.')).toBe(true);
    expect(isFamilySafe('Which knight did Guinevere have an affair with?', 'Lancelot')).toBe(true);
  });
});

describe('shuffleChoices', () => {
  test('is deterministic for a given prompt, so a rebuild is a no-op diff', () => {
    const a = shuffleChoices('Which planet is closest to the sun?', ['Mercury', 'Venus', 'Mars', 'Earth'], 0);
    const b = shuffleChoices('Which planet is closest to the sun?', ['Mercury', 'Venus', 'Mars', 'Earth'], 0);
    expect(a).toEqual(b);
  });

  test('keeps the answer index pointing at the same text', () => {
    const source = ['Mercury', 'Venus', 'Mars', 'Earth'];
    for (let answer = 0; answer < source.length; answer++) {
      const out = shuffleChoices(`prompt ${answer}`, source, answer);
      expect(out.choices).toHaveLength(source.length);
      expect(new Set(out.choices)).toEqual(new Set(source));
      expect(out.choices[out.answer]).toBe(source[answer]);
    }
  });

  test('pins "None of these" to the last slot', () => {
    const out = shuffleChoices('Pick one', ['None of these', 'Alpha', 'Beta', 'Gamma'], 0);
    expect(out.choices.at(-1)).toBe('None of these');
    expect(out.choices[out.answer]).toBe('None of these');
  });

  test('keeps two anchored options together at the end, in source order', () => {
    const out = shuffleChoices('Pick one', ['Alpha', 'Beta', 'None of these', 'Both of these'], 1);
    expect(out.choices.slice(-2)).toEqual(['None of these', 'Both of these']);
    expect(out.choices[out.answer]).toBe('Beta');
  });

  test('actually moves things — a no-op shuffle would pass every test above', () => {
    const source = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const moved = Array.from({ length: 40 }, (_, i) => shuffleChoices(`q${i}`, source, 0)).filter(
      (out) => out.choices[0] !== 'Alpha'
    );
    expect(moved.length).toBeGreaterThan(20);
  });
});

describe('parseCategoryFile', () => {
  const FILE = [
    '',
    '#Q A specialist in snakes is called one of these.',
    '^ Ophiologist',
    'A Pisciculturist',
    'B Ophiologist',
    '',
    '#Q Finish the proverb:',
    '',
    'Poets are born, ________.',
    '^ ...not made.',
    'A ...but can also be made.',
    'B ...not made.',
    '',
  ].join('\n');

  test('reads prompt, answer text and options', () => {
    const [first] = parseCategoryFile(FILE);
    expect(first.prompt).toBe('A specialist in snakes is called one of these.');
    expect(first.answerText).toBe('Ophiologist');
    expect(first.choices).toEqual(['Pisciculturist', 'Ophiologist']);
  });

  test('does not mistake a prompt starting "A " for an option', () => {
    // The corpus is full of prompts like the first one above. Counting that
    // line as an option is the parse bug that silently invents a fifth choice.
    expect(parseCategoryFile(FILE)[0].choices).toHaveLength(2);
  });

  test('folds a multi-line prompt onto one line', () => {
    expect(parseCategoryFile(FILE)[1].prompt).toBe('Finish the proverb: Poets are born, ________.');
  });
});

describe('toPackRow', () => {
  const ask = (raw, seen = new Set()) => toPackRow(raw, { category: 'General Knowledge', seen });
  const GOOD = {
    prompt: 'Which planet is closest to the sun?',
    answerText: 'Mercury',
    choices: ['Mercury', 'Venus', 'Mars', 'Earth'],
  };

  test('produces a row the admin validator accepts', () => {
    const { row } = ask(GOOD);
    expect(normalizeQuestion(row).error).toBeUndefined();
    expect(row.category).toBe('General Knowledge');
    expect(row.choices[row.answer]).toBe('Mercury');
  });

  test('rejects an answer that is not one of the options', () => {
    expect(ask({ ...GOOD, answerText: 'Pluto' })).toEqual({ reject: 'answer-not-in-choices' });
  });

  test('rejects a question with no answer marker', () => {
    expect(ask({ ...GOOD, answerText: null })).toEqual({ reject: 'no-answer-marker' });
  });

  test('rejects the second sighting of a prompt', () => {
    const seen = new Set();
    expect(ask(GOOD, seen).row).toBeTruthy();
    expect(ask(GOOD, seen)).toEqual({ reject: 'duplicate-prompt' });
  });

  test('treats punctuation and case as noise when deduping', () => {
    expect(dedupeKey('Who wrote "Hamlet"?')).toBe(dedupeKey('who wrote hamlet'));
  });

  test('defers the length rules to the validator rather than restating them', () => {
    const result = ask({ ...GOOD, prompt: 'x'.repeat(301) });
    expect(result.reject).toBe('rejected-by-validator');
    expect(result.detail).toMatch(/3\.\.300/);
  });

  test('leaves True/False in the order a host would read it', () => {
    const { row } = ask({ prompt: 'Cats have nine lives.', answerText: 'False', choices: ['True', 'False'] });
    expect(row.choices).toEqual(['True', 'False']);
    expect(row.answer).toBe(1);
  });

  test('marks For Kids easy and leaves every other category on the default', () => {
    const seen = new Set();
    expect(toPackRow(GOOD, { category: 'For Kids', seen }).row.difficulty).toBe(1);
    expect(toPackRow({ ...GOOD, prompt: 'Another?' }, { category: 'Sports', seen }).row.difficulty).toBe(2);
  });
});

describe('the committed pack', () => {
  const pack = (async () => {
    const lines = createInterface({ input: createReadStream(PACK_PATH).pipe(createGunzip()) });
    let header = null;
    const rows = [];
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (header === null) header = JSON.parse(line);
      else rows.push(JSON.parse(line));
    }
    return { header, rows };
  })();

  test('carries the attribution CC BY-SA 4.0 requires', async () => {
    const { header } = await pack;
    expect(header.pack).toBe('opentriviaqa');
    expect(header.license).toBe('CC BY-SA 4.0');
    expect(header.source).toBe('https://github.com/uberspot/OpenTriviaQA');
    expect(header.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('holds the number of questions its header claims', async () => {
    const { header, rows } = await pack;
    expect(rows).toHaveLength(header.count);
    expect(rows.length).toBeGreaterThan(45_000);
  });

  test('every row would be accepted from a human typing it into Master Control', async () => {
    const { rows } = await pack;
    const rejected = rows
      .map((row) => ({ row, error: normalizeQuestion(row).error }))
      .filter((r) => r.error);
    expect(rejected.map((r) => `${r.error}: ${r.row.prompt}`)).toEqual([]);
  });

  test('every row is family-safe', async () => {
    const { rows } = await pack;
    const unsafe = rows.filter((r) => !isFamilySafe(r.prompt, ...r.choices)).map((r) => r.prompt);
    expect(unsafe).toEqual([]);
  });

  test('holds none of the explicit material an earlier filter let through', async () => {
    // Independent of isFamilySafe on purpose. The assertion above only proves
    // the pack agrees with whatever the filter currently says; this one names
    // the actual strings that reached the committed artifact once, so
    // loosening the filter cannot quietly bring them back.
    const { rows } = await pack;
    const banned = [
      /\bto have sex\b/i,
      /\bsex acts?\b/i,
      /\bsexual relationship\b/i,
      /\bsexually abused\b/i,
      /\bcondoms?\b/i,
      /\bvirginity\b/i,
      /\berections?\b/i,
      /\bnigg(?:er|a)\b/i,
    ];
    const offenders = rows
      .filter((r) => banned.some((re) => re.test([r.prompt, ...r.choices].join(' | '))))
      .map((r) => r.prompt);
    expect(offenders).toEqual([]);
  });

  test('no prompt appears twice', async () => {
    const { rows } = await pack;
    const seen = new Set();
    const repeats = rows.map((r) => dedupeKey(r.prompt)).filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(repeats).toEqual([]);
  });

  test('only uses categories the build knows how to produce', async () => {
    const { rows } = await pack;
    const known = new Set(Object.values(CATEGORY_LABELS));
    expect([...new Set(rows.map((r) => r.category))].filter((c) => !known.has(c))).toEqual([]);
  });

  test('no answer is stranded in a slot the shuffle should have flattened', async () => {
    // The source leans 28/28/22/22 toward A and B. If the shuffle ever stops
    // running, this is the assertion that notices.
    const { rows } = await pack;
    const four = rows.filter((r) => r.choices.length === 4);
    const share = [0, 1, 2, 3].map((i) => four.filter((r) => r.answer === i).length / four.length);
    for (const s of share) expect(s).toBeGreaterThan(0.23);
    for (const s of share) expect(s).toBeLessThan(0.27);
  });

  test('no stripped contraction survived the repair', async () => {
    const { rows } = await pack;
    const broken = rows.filter((r) => /\b(dont|cant|didnt|wasnt|youre|thats|arent)\b/i.test(r.prompt));
    expect(broken.map((r) => r.prompt)).toEqual([]);
  });

  test('every committed typo repair is a bounded correction, not a rewrite', () => {
    for (const e of loadPackTypos()) {
      expect(isMinorTextEdit(e.b, e.a), JSON.stringify(e)).toBe(true);
    }
  });

  test('the committed typo repairs are already applied — re-applying is a no-op', async () => {
    const { rows } = await pack;
    const cloned = rows.map((r) => ({ ...r, choices: [...r.choices] }));
    expect(applyPackTypos(cloned, loadPackTypos()).applied).toBe(0);
  });

  test('no typo repair targets a question about spelling', async () => {
    const { rows } = await pack;
    const byPrompt = new Map(rows.map((r) => [r.prompt, r]));
    const offenders = loadPackTypos()
      .map((e) => byPrompt.get(e.q))
      .filter((row) => row && looksLikeSpellingQuestion(row));
    expect(offenders).toEqual([]);
  });

  test('every committed judgment repair is a pure apostrophe insertion', () => {
    for (const e of loadPackRepairs()) {
      expect(isApostropheInsertion(e.b, e.a), JSON.stringify(e)).toBe(true);
    }
  });

  test('the committed judgment repairs are already applied — re-applying is a no-op', async () => {
    const { rows } = await pack;
    const cloned = rows.map((r) => ({ ...r, choices: [...r.choices] }));
    expect(applyPackRepairs(cloned, loadPackRepairs()).applied).toBe(0);
  });

  test('no replacement characters — the encoding repair reached every file', async () => {
    const { rows } = await pack;
    const mojibake = rows.filter((r) => [r.prompt, ...r.choices].some((s) => s.includes('�')));
    expect(mojibake.map((r) => r.prompt)).toEqual([]);
  });
});
