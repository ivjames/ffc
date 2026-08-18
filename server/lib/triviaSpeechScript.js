// What the MC actually says — the words, and nothing about how they are said.
//
// MIRRORS src/lib/speechScript.ts, the same way lib/venueHours.js mirrors its
// TypeScript twin. The player app builds these lines in the browser for its
// own read-aloud; the server builds the identical lines when it synthesizes
// audio (the Polly bake-off today, pre-generated game audio next), and the
// running API cannot import a .ts file.
//
// Keep the two in step. `src/lib/speechScript.parity.test.ts` runs both
// against the same inputs and fails on any difference, so a change to one
// without the other is caught in the repo rather than by ear, in a room.
//
// Dependency-free on purpose, exactly like the TypeScript side.

// A hair under normal. Room audio and a crowd both eat consonants, and a host
// reading a question aloud naturally goes slower than conversation.
export const ROOM_RATE = 0.95;

const LETTERS = "ABCDEF";

/** The letter a choice is announced and displayed under. */
export function choiceLetter(index) {
  return LETTERS[index] ?? String(index + 1);
}

/** Spoken form of one line of text: strips the markup and shorthand that reads
 *  fine on screen and badly out loud. */
export function speakable(text) {
  return text
    .replace(/[*_`#~]/g, "")
    .replace(/&amp;/g, " and ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The MC's opening line, said once when a game's lobby opens. The join code
 *  is spelled out with commas because a voice reading "ABC123" as a word is
 *  the one thing in the room nobody can act on. (It is spelled rather than
 *  marked up because Polly's <say-as interpret-as="characters"> falls back to
 *  the STANDARD voice on a neural request while still billing neural — see
 *  TTS-PRICING.md.) */
export function lobbyScript(joinCode) {
  const spelled = joinCode.toUpperCase().split("").join(", ");
  return [`Live trivia is starting. Join on your phone with the code ${spelled}.`];
}

/** Reading a question to the room: category, the prompt, then the choices by
 *  letter. Returned as separate lines so each lands with a beat after it —
 *  people need the gap to hold four options in their head. */
export function questionScript(question, opts = {}) {
  const lines = [];
  const head = [];
  if (opts.number !== false) head.push(`Question ${question.index + 1}.`);
  if (question.category) head.push(`${speakable(question.category)}.`);
  if (head.length > 0) lines.push(head.join(" "));
  lines.push(speakable(question.prompt));
  for (const [i, choice] of question.choices.entries()) {
    lines.push(`${choiceLetter(i)}. ${speakable(choice)}.`);
  }
  return lines;
}

/** Giving the answer. `answer` is the index of the correct choice. */
export function revealScript(question) {
  const { answer, choices } = question;
  if (answer == null || choices[answer] === undefined) return [];
  return [`The correct answer is ${choiceLetter(answer)}. ${speakable(choices[answer])}.`];
}

/** Where the room stands after a reveal — the top two, which is as much as
 *  anyone can follow by ear between questions. Silent while the board is
 *  still all zeroes, because "nobody has any points" is not worth saying. */
export function standingsScript(board) {
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
function andList(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Places below the winner, spoken. Standard competition ranking, so a
 *  two-way tie at the top is followed by THIRD, not second. */
const PLACES = ["", "", "Second", "Third", "Fourth", "Fifth", "Sixth"];

/** The board grouped into score tiers, each with the place it actually
 *  occupies — everyone on the same score shares one place. */
function podium(board) {
  const tiers = [];
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
export function finalScript(board) {
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
        .join(" ")
    );
  }
  return lines;
}

/** What a player's own phone says at the reveal, when they've asked for the
 *  game to be read to them. */
export function myResultScript(myAnswer) {
  if (!myAnswer || myAnswer.correct === undefined) return [];
  return myAnswer.correct
    ? [`Correct. Plus ${myAnswer.points ?? 0} points.`]
    : ["Not this time."];
}

/** Roughly how long a script takes to read, in seconds. */
export function estimateSeconds(lines) {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return words / (2.8 * ROOM_RATE) + lines.length * 0.35;
}
