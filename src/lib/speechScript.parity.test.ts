import { describe, expect, test } from 'vitest';
import * as ts from './speechScript';
// The server's mirror (server/lib/triviaSpeechScript.js). The running API
// cannot import TypeScript, so the words exist twice — and two copies of the
// sentences a room hears is exactly the kind of drift nobody notices until a
// game night sounds wrong. This test is the reason the duplication is safe.
// @ts-expect-error — the server mirror is plain JS with no declarations, and
// deliberately so: what this test asserts is that its OUTPUT matches, not that
// its types do.
import * as js from '../../server/lib/triviaSpeechScript.js';

const QUESTIONS = [
  { index: 0, category: 'Movies', prompt: 'Which film won Best Picture in 1994?', choices: ['Forrest Gump', 'Pulp Fiction', 'The Lion King', 'Speed'], answer: 0 },
  { index: 4, category: null, prompt: 'Rock *&* roll — how many pins?', choices: ['9', '10'], answer: 1 },
  { index: 11, category: 'House Pack', prompt: '  spaced   out   prompt  ', choices: ['A', 'B', 'C', 'D', 'E', 'F'], answer: 5 },
];

const BOARDS = [
  [],
  [{ name: 'Alex', score: 900 }],
  [{ name: 'Alex', score: 900 }, { name: 'Table 4', score: 900 }, { name: 'Sam', score: 400 }, { name: 'Jo', score: 400 }],
  [{ name: 'A', score: 0 }, { name: 'B', score: 0 }],
];

describe('the server mirror says exactly what the app says', () => {
  test('question and reveal reads', () => {
    for (const q of QUESTIONS) {
      expect(js.questionScript(q)).toEqual(ts.questionScript(q));
      expect(js.questionScript(q, { number: false })).toEqual(ts.questionScript(q, { number: false }));
      expect(js.revealScript(q)).toEqual(ts.revealScript(q));
    }
  });

  test('lobby, standings, final and personal result', () => {
    for (const code of ['B8S5Z2', 'abc234']) {
      expect(js.lobbyScript(code)).toEqual(ts.lobbyScript(code));
    }
    for (const board of BOARDS) {
      expect(js.standingsScript(board)).toEqual(ts.standingsScript(board));
      expect(js.finalScript(board)).toEqual(ts.finalScript(board));
    }
    for (const mine of [null, { correct: true, points: 130 }, { correct: false }, { choice: 2 }]) {
      expect(js.myResultScript(mine as never)).toEqual(ts.myResultScript(mine as never));
    }
  });

  test('the shared helpers agree too', () => {
    expect(js.ROOM_RATE).toBe(ts.ROOM_RATE);
    for (const i of [0, 1, 5, 6, 9]) expect(js.choiceLetter(i)).toBe(ts.choiceLetter(i));
    for (const s of ['*Rock* & roll', 'a  b', '&amp; and #hash']) {
      expect(js.speakable(s)).toBe(ts.speakable(s));
    }
    expect(js.estimateSeconds(ts.questionScript(QUESTIONS[0]))).toBeCloseTo(
      ts.estimateSeconds(ts.questionScript(QUESTIONS[0])), 10);
  });
});
