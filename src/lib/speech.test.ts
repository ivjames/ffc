import { describe, expect, test } from 'vitest';
import {
  chunkForSpeech,
  choiceLetter,
  estimateSeconds,
  finalScript,
  lobbyScript,
  myResultScript,
  pickVoice,
  questionScript,
  revealScript,
  speakable,
  standingsScript,
} from './speech';

describe('chunking', () => {
  test('short text is one utterance', () => {
    expect(chunkForSpeech('Who painted the Mona Lisa?')).toEqual(['Who painted the Mona Lisa?']);
  });

  test('empty text says nothing', () => {
    expect(chunkForSpeech('   ')).toEqual([]);
  });

  test('long text is split on sentences, under the limit', () => {
    const text = `${'a'.repeat(80)}. ${'b'.repeat(80)}. ${'c'.repeat(80)}.`;
    const chunks = chunkForSpeech(text, 100);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  test('a single sentence longer than the limit is split on words', () => {
    // Chrome silently truncates around fifteen seconds of speech, so nothing
    // may exceed the limit even when there is no sentence boundary to use.
    const chunks = chunkForSpeech(`${'word '.repeat(60)}`, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });
});

describe('spoken text', () => {
  test('markup and ampersands are read as words', () => {
    expect(speakable('*Rock* & roll')).toBe('Rock and roll');
  });

  test('choices are lettered to match the buttons on screen', () => {
    expect([0, 1, 2, 3].map(choiceLetter)).toEqual(['A', 'B', 'C', 'D']);
  });
});

const QUESTION = {
  index: 2,
  category: 'Movies',
  prompt: 'Which film won Best Picture in 1994?',
  choices: ['Forrest Gump', 'Pulp Fiction', 'The Lion King', 'Speed'],
  answer: 0,
};

describe('the script', () => {
  test('a question is announced, then read, then its choices by letter', () => {
    expect(questionScript(QUESTION)).toEqual([
      'Question 3. Movies.',
      'Which film won Best Picture in 1994?',
      'A. Forrest Gump.',
      'B. Pulp Fiction.',
      'C. The Lion King.',
      'D. Speed.',
    ]);
  });

  test('the join code is spelled out, not read as a word', () => {
    // "ABC123" said as a word is the one thing in the room nobody can act on.
    expect(lobbyScript('abc123')).toEqual([
      'Live trivia is starting. Join on your phone with the code A, B, C, 1, 2, 3.',
    ]);
  });

  test('the reveal names the letter and the choice', () => {
    expect(revealScript(QUESTION)).toEqual(['The correct answer is A. Forrest Gump.']);
  });

  test('nothing is said when the answer is still withheld', () => {
    // Player payloads carry no `answer` until the question closes; the reveal
    // read must not invent one.
    expect(revealScript({ choices: QUESTION.choices })).toEqual([]);
  });

  test('standings are silent before anyone has scored', () => {
    expect(standingsScript([{ name: 'Table 4', score: 0 }])).toEqual([]);
  });

  test('a tie at the top is read as a tie', () => {
    expect(
      standingsScript([
        { name: 'Table 4', score: 200 },
        { name: 'Alex', score: 200 },
      ]),
    ).toEqual(['Table 4 and Alex are tied for the lead with 200 points.']);
  });

  test('the final read is a podium', () => {
    expect(
      finalScript([
        { name: 'Alex', score: 900 },
        { name: 'Table 4', score: 700 },
        { name: 'Sam', score: 100 },
        { name: 'Jo', score: 50 },
      ]),
    ).toEqual([
      "That's the game. The winner is Alex, with 900 points.",
      'Second, Table 4, 700. Third, Sam, 100.',
    ]);
  });

  test('a personal result is only spoken once it is known', () => {
    expect(myResultScript(null)).toEqual([]);
    expect(myResultScript({ choice: 1 } as { correct?: boolean })).toEqual([]);
    expect(myResultScript({ correct: true, points: 130 })).toEqual(['Correct. Plus 130 points.']);
  });
});

describe('voice choice', () => {
  test('prefers a known-good English voice over whatever came first', () => {
    const picked = pickVoice([
      { name: 'Albert', lang: 'en-US', localService: true },
      { name: 'Samantha', lang: 'en-US', localService: true },
    ]);
    expect(picked?.name).toBe('Samantha');
  });

  test('ignores non-English voices when an English one exists', () => {
    const picked = pickVoice([
      { name: 'Amélie', lang: 'fr-CA', localService: true },
      { name: 'Albert', lang: 'en-GB', localService: true },
    ]);
    expect(picked?.name).toBe('Albert');
  });

  test('prefers a local voice — it starts instantly and survives bad wifi', () => {
    const picked = pickVoice([
      { name: 'Cloudy', lang: 'en-US', localService: false },
      { name: 'Albert', lang: 'en-US', localService: true },
    ]);
    expect(picked?.name).toBe('Albert');
  });

  test('no voices at all is not an error — the platform default is used', () => {
    expect(pickVoice([])).toBeNull();
  });
});

describe('read-aloud timing', () => {
  test('a four-choice question is estimated at a realistic read length', () => {
    const seconds = estimateSeconds(questionScript(QUESTION));
    expect(seconds).toBeGreaterThan(6);
    expect(seconds).toBeLessThan(20);
  });
});
