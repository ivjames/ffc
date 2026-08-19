import { afterEach, describe, expect, test, vi } from 'vitest';
import { setMuted } from './sound';
import {
  chunkForSpeech,
  setSpeechEnabled,
  speak,
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

  test('a tie at the top is announced as a tie, not an arbitrary trophy', () => {
    // The board is sorted by score and broken by join order, so reading it
    // positionally would hand the win to whoever signed up first — out loud,
    // in front of the room.
    expect(
      finalScript([
        { name: 'Alex', score: 900 },
        { name: 'Table 4', score: 900 },
        { name: 'Sam', score: 100 },
      ]),
    ).toEqual([
      "That's the game. It's a tie at the top: Alex and Table 4, with 900 points each.",
      'Third, Sam, 100.',
    ]);
  });

  test('places below a tie follow it — two firsts are followed by third', () => {
    const lines = finalScript([
      { name: 'Alex', score: 900 },
      { name: 'Table 4', score: 900 },
      { name: 'Sam', score: 400 },
      { name: 'Jo', score: 400 },
    ]);
    expect(lines[1]).toBe('Third, Sam and Jo, 400.');
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

  test('a local voice beats a better-sounding remote one', () => {
    // Several preferred voices (Google's especially) synthesize on a server.
    // In a venue with bad wifi, "it will speak" beats timbre.
    const picked = pickVoice([
      { name: 'Google US English', lang: 'en-US', localService: false },
      { name: 'Albert', lang: 'en-US', localService: true },
    ]);
    expect(picked?.name).toBe('Albert');
  });

  test('the preferred order still decides among local voices', () => {
    const picked = pickVoice([
      { name: 'Albert', lang: 'en-US', localService: true },
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Google US English', lang: 'en-US', localService: false },
    ]);
    expect(picked?.name).toBe('Samantha');
  });

  test('platforms that never report localService still get the preferred name', () => {
    const picked = pickVoice([
      { name: 'Albert', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US' },
    ]);
    expect(picked?.name).toBe('Samantha');
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

describe('the mute button', () => {
  // A stand-in for the browser's speech engine, so the node-side test can
  // watch what the module actually asks it to do.
  function stubSpeech() {
    const cancel = vi.fn();
    const spoken: string[] = [];
    class Utterance {
      text: string;
      voice: unknown = null;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('window', {
      speechSynthesis: {
        cancel,
        speak: (u: { text: string }) => spoken.push(u.text),
        getVoices: () => [],
      },
      SpeechSynthesisUtterance: Utterance,
    });
    // `speak()` constructs the bare global, the same object a browser exposes
    // on window — node needs both halves stubbed to stand in for that.
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    return { cancel, spoken };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    setMuted(false);
    setSpeechEnabled(false);
  });

  test('muting mid-question cuts the sentence already in the air', () => {
    // Mute drops the AudioContext gain, which silences the effects instantly
    // but does nothing to a voice that is already reading — the queue has to
    // be cancelled explicitly.
    const { cancel, spoken } = stubSpeech();
    setSpeechEnabled(true);
    speak(['Question 1.', 'Who painted the Mona Lisa?']);
    expect(spoken).toHaveLength(2);

    cancel.mockClear();
    setMuted(true);
    expect(cancel).toHaveBeenCalled();
  });

  test('nothing new is spoken while muted', () => {
    const { spoken } = stubSpeech();
    setSpeechEnabled(true);
    setMuted(true);
    speak('Question 2.');
    expect(spoken).toEqual([]);
  });
});

// The bug this guards: read-aloud is PERSISTED per device but the browser's
// unlock is per page load, so a host who switched the voice on at some earlier
// game arrives with speech enabled and nothing ever primed. Priming only from
// the toggle meant the room's first phase read silently, and the only way out
// was flipping the voice off and on — which doesn't even re-read the phase on
// screen (both trivia screens read a phase once), so the voice appeared to
// start at the SECOND question.
describe('priming for a device that already had the voice on', () => {
  // Fresh module per test: whether this page has primed is module state, and
  // the whole point of these tests is what happens on a cold page load.
  async function freshSpeech() {
    vi.resetModules();
    const cancel = vi.fn();
    const spoken: string[] = [];
    class Utterance {
      text: string;
      voice: unknown = null;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('window', {
      speechSynthesis: { cancel, speak: (u: { text: string }) => spoken.push(u.text), getVoices: () => [] },
      SpeechSynthesisUtterance: Utterance,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    const mod = await import('./speech');
    return { mod, spoken };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test('the first tap primes when the voice was already on', async () => {
    const { mod, spoken } = await freshSpeech();
    mod.setSpeechEnabled(true); // as if restored from localStorage, no toggle tapped
    mod.primeSpeechOnce();
    expect(spoken).toEqual([' ']);
  });

  test('later taps do not re-prime', async () => {
    const { mod, spoken } = await freshSpeech();
    mod.setSpeechEnabled(true);
    mod.primeSpeechOnce();
    mod.primeSpeechOnce();
    mod.primeSpeechOnce();
    expect(spoken).toEqual([' ']);
  });

  test('a tap with the voice off stays silent', async () => {
    const { mod, spoken } = await freshSpeech();
    mod.setSpeechEnabled(false);
    mod.primeSpeechOnce();
    expect(spoken).toEqual([]);
  });

  test('the toggle still primes, and covers the tap that follows it', async () => {
    const { mod, spoken } = await freshSpeech();
    mod.primeSpeech(); // what toggleSpeech(true) does inside the tap
    mod.setSpeechEnabled(true);
    expect(spoken).toEqual([' ']);
    mod.primeSpeechOnce();
    expect(spoken).toEqual([' ']);
  });
});
