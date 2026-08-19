import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { sanitizeTagInput, tagError, TAG_LENGTH } from '../../lib/sanitize';
import { fetchMe } from '../../lib/authApi';
import { joinGame } from '../../lib/gamesApi';
import { createSharedLocalRound } from '../../lib/sharedMerge';
import { getMyTag, rememberMyTag } from '../../lib/myTag';
import { getRound, markActivity, putRound } from '../../db';

// Join a shared game by code (QR deep link lands here as /join?code=XXXXXX).
// No account needed — a guest phone claims a roster slot with just a tag.

const CODE_LENGTH = 6;

function sanitizeCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export default function JoinGame() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(sanitizeCodeInput(params.get('code') ?? ''));
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the holder's tag: the account's saved tag wins, else the tag this
  // phone last played under (lib/myTag). Never overwrite something typed.
  useEffect(() => {
    const remembered = getMyTag();
    if (remembered) setTag((prev) => (prev === '' ? remembered : prev));
    void fetchMe().then((me) => {
      if (me?.defaultTag) {
        setTag((prev) => (prev === '' || prev === remembered ? me.defaultTag! : prev));
      }
    });
  }, []);

  const tagErr = tag.length === TAG_LENGTH ? tagError(tag) : null;
  const ready = code.length === CODE_LENGTH && tag.length === TAG_LENGTH && !tagErr;

  async function join() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res = await joinGame(code, tag);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.status === 404
          ? 'No open game with that code — check it with the host.'
          : res.status === 0
            ? "You're offline — joining needs a connection."
            : res.error,
      );
      return;
    }
    // Crashed the Party is about joining SOMEONE ELSE's game. The host typing
    // their own code is a rejoin — /api/games/join hands a signed-in creator
    // their existing seat back — so gate on the slot: seat 0 is the creator's
    // by construction (createGame inserts it), and every joiner lands above it.
    // A guest host whose tag is reclaimed by a stranger is the one case this
    // reads wrong, and it errs toward not granting, which is the right way to
    // be wrong about a badge.
    if (res.slot !== 0) void markActivity('social', 'join'); // achievements (device-local)
    // The tag just claimed a seat FROM THIS PHONE — that's the holder's tag.
    rememberMyTag(tag);
    const clientId = `shared:${res.snapshot.game.id}`;
    // Rejoin on a device that already mirrors this game: keep the local state
    // (scores survive), just refresh the credentials.
    const existing = await getRound(clientId);
    const round =
      existing?.shared != null
        ? {
            ...existing,
            shared: {
              ...existing.shared,
              participantToken: res.participantToken,
              slot: res.slot,
            },
          }
        : createSharedLocalRound(res.snapshot, res.participantToken, res.slot);
    await putRound(round);
    navigate(`/golf/play/${clientId}`, { replace: true });
  }

  return (
    <Screen>
      <TopBar title="Join a game" back="/" />
      <Content>
        <p className="mb-5 text-sm text-fairway-100/70">
          Ask the host for their 6-character code (it's on their lobby screen), pick your
          arcade tag, and you'll score on the same card from your own phone.
        </p>

        <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">Join code</label>
        <input
          value={code}
          onChange={(e) => {
            setCode(sanitizeCodeInput(e.target.value));
            setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          placeholder="AB12CD"
          aria-label="Join code"
          className="surface-sunk font-arcade w-56 rounded-xl border border-fairway-800/60 px-4 py-2.5 text-center text-3xl font-bold uppercase tracking-[0.25em] text-fairway-50 focus:border-fairway-500 focus:outline-none"
        />

        <label className="mb-1.5 mt-5 block text-sm font-semibold text-fairway-100/80">
          Your tag{' '}
          <span className="font-normal text-fairway-100/70">(3 letters/numbers, arcade style)</span>
        </label>
        <input
          value={tag}
          onChange={(e) => {
            setTag(sanitizeTagInput(e.target.value));
            setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={TAG_LENGTH}
          placeholder="ABC"
          aria-label="Your player tag"
          className="surface-sunk font-arcade w-32 rounded-xl border border-fairway-800/60 px-4 py-2.5 text-center text-2xl font-bold uppercase tracking-widest text-fairway-50 focus:border-fairway-500 focus:outline-none"
          style={{ borderColor: tagErr ? '#ef4444' : undefined }}
        />
        {tagErr && <p className="mt-1.5 text-sm text-danger">{tagErr}</p>}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <div className="mt-6">
          <Button onClick={() => void join()} disabled={!ready || busy}>
            {busy ? 'Joining…' : 'Join game'}
          </Button>
        </div>
      </Content>
    </Screen>
  );
}
