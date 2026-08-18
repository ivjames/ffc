// What the MC actually says — the words, and nothing about how they are said.
//
// Split out of lib/speech.ts (which owns the browser's SpeechSynthesis) so this
// half has ZERO imports and runs anywhere: the player app, a node script, and
// the server when it pre-synthesizes a game's audio. The room must hear the
// same sentences whichever of those built them, and the surest way to
// guarantee that is for there to be one copy of them.
//
// Keep it dependency-free. The moment this imports the browser — or the
// server — it stops being the shared source and becomes a third dialect.

// A hair under normal. Room audio and a crowd both eat consonants, and a host
// reading a question aloud naturally goes slower than conversation.
export const ROOM_RATE = 0.95;

//
// Pure string builders, kept apart from the speaking so they can be read (and
// tested) as the script they are.

const LETTERS = 'ABCDEF';

/** The letter a choice is announced and displayed under. */
export function choiceLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/** Spoken form of one line of text: strips the markup and shorthand that reads
 *  fine on screen and badly out loud. */
export function speakable(text: string): string {
  return text
    .replace(/[*_`#~]/g, '')
    .replace(/&amp;/g, ' and ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The MC's opening line, said once when a game's lobby opens. The join code
 *  is spelled out with commas because a voice reading "ABC123" as a word is
 *  the one thing in the room nobody can act on. */
export function lobbyScript(joinCode: string): string[] {
  const spelled = joinCode.toUpperCase().split('').join(', ');
  return [`Live trivia is starting. Join on your phone with the code ${spelled}.`];
}

/** Reading a question to the room: category, the prompt, then the choices by
 *  letter. Returned as separate lines so each lands with a beat after it —
 *  people need the gap to hold four options in their head. */
export function questionScript(
  question: { index: number; category?: string | null; prompt: string; choices: string[] },
  opts: { number?: boolean } = {},
): string[] {
  const lines: string[] = [];
  const head: string[] = [];
  if (opts.number !== false) head.push(`Question ${question.index + 1}.`);
  if (question.category) head.push(`${speakable(question.category)}.`);
  if (head.length > 0) lines.push(head.join(' '));
  lines.push(speakable(question.prompt));
  for (const [i, choice] of question.choices.entries()) {
    lines.push(`${choiceLetter(i)}. ${speakable(choice)}.`);
  }
  return lines;
}

/** Giving the answer. `answer` is the index of the correct choice. */
export function revealScript(question: { choices: string[]; answer?: number }): string[] {
  const { answer, choices } = question;
  if (answer == null || choices[answer] === undefined) return [];
  return [`The correct answer is ${choiceLetter(answer)}. ${speakable(choices[answer])}.`];
}

/** Where the room stands after a reveal — the top two, which is as much as
 *  anyone can follow by ear between questions. Silent while the board is
 *  still all zeroes, because "nobody has any points" is not worth saying. */
export function standingsScript(board: { name: string; score: number }[]): string[] {
  const scoring = board.filter((e) => e.score > 0);
  if (scoring.length === 0) return [];
  const [first, second] = scoring;
  const lead =
    second && second.score === first.score
      ? `${speakable(first.name)} and ${speakable(second.name)} are tied for the lead with ${first.score} points.`
      : `${speakable(first.name)} leads with ${first.score} points.`;
  return [lead];
}

/** "A", "A and B", "A, B and C" — how a person reads a list out loud. */
function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Places below the winner, spoken. Standard competition ranking, so a
 *  two-way tie at the top is followed by THIRD, not second. */
const PLACES = ['', '', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

/** The board grouped into score tiers, each with the place it actually
 *  occupies — everyone on the same score shares one place. */
function podium(board: { name: string; score: number }[]) {
  const tiers: { place: number; score: number; names: string[] }[] = [];
  for (const [i, e] of board.entries()) {
    const last = tiers[tiers.length - 1];
    // The place is the entrant's own position, so a tier that starts at index 2
    // is third — the two above it took first and second between them.
    if (last && last.score === e.score) last.names.push(speakable(e.name));
    else tiers.push({ place: i + 1, score: e.score, names: [speakable(e.name)] });
  }
  return tiers;
}

/** The final scoreboard, read out as a podium.
 *
 *  Ties are read as ties. The board arrives sorted by score but broken by
 *  join order, so reading it positionally would hand the trophy to whoever
 *  happened to sign up first and call an equal score "second" — in front of
 *  the room, out loud, which is the worst place to get that wrong. */
export function finalScript(board: { name: string; score: number }[]): string[] {
  if (board.length === 0) return ["That's the end of the game."];
  const tiers = podium(board);
  const [top, ...rest] = tiers;

  const lines = [
    top.names.length === 1
      ? `That's the game. The winner is ${top.names[0]}, with ${top.score} points.`
      : `That's the game. It's a tie at the top: ${andList(top.names)}, with ${top.score} points each.`,
  ];

  const runnersUp = rest.slice(0, 2);
  if (runnersUp.length > 0) {
    lines.push(
      runnersUp
        .map((t) => `${PLACES[t.place] ?? `Number ${t.place}`}, ${andList(t.names)}, ${t.score}.`)
        .join(' '),
    );
  }
  return lines;
}

/** What a player's own phone says at the reveal, when they've asked for the
 *  game to be read to them. */
export function myResultScript(
  myAnswer: { correct?: boolean; points?: number } | null | undefined,
): string[] {
  if (!myAnswer || myAnswer.correct === undefined) return [];
  return myAnswer.correct
    ? [`Correct. Plus ${myAnswer.points ?? 0} points.`]
    : ['Not this time.'];
}

/** Roughly how long a script takes to read, in seconds. Used to warn a host
 *  whose timer is shorter than the question takes to say. ~2.6 words a second
 *  is a normal reading pace scaled by the room rate above. */
export function estimateSeconds(lines: string[]): number {
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  // Plus a beat between utterances, which is where the gaps actually come from.
  return words / (2.8 * ROOM_RATE) + lines.length * 0.35;
}
