# Text-to-speech — rates, traps, and what live trivia actually costs

Companion to `HUNT-PRICING.md` and `IMAGE-DESCRIPTION-PRICING.md`. Same house
rule applies: **re-verify every rate at build time.** TTS pricing churns, and
the comparison blogs are mostly lead-gen — two of the figures below were wrong
by 6–15× in aggregator articles and only came right from the vendors' own
pages.

Verified August 2026.

## What the app spends it on

The room hears three kinds of line, built by `src/lib/speechScript.ts`:

| line | avg characters |
| --- | --- |
| a question (announce + prompt + 4 choices) | ~150 |
| its reveal | ~37 |
| lobby join code, final podium | one-off per game |

**~187 characters per question**, measured against the 57-question House Pack.

Cost scales with the **bank**, not with games played, because the questions are
known before the lobby opens (`dealSession` picks them at create) and the audio
caches. The second game night on the same bank costs nothing.

| bank | chars | @ $4/M | @ $16/M | @ $30/M |
| --- | --- | --- | --- | --- |
| 1,000 questions | 187k | $0.75 | $2.99 | $5.61 |
| 5,000 questions | 935k | $3.74 | $14.96 | $28.05 |
| 10,000 questions | 1.87M | $7.48 | $29.92 | $56.10 |

Uncached — synthesizing every game fresh — three venues running weekly trivia,
four games a night, 20 questions each, is about **$34/year** at $16/M. Either
way this is a rounding error, so **choose on voice quality, caching rights and
operational fit, not on the rate.**

## Rates (per 1M characters)

| provider / tier | rate | notes |
| --- | --- | --- |
| Amazon Polly Standard | $4 | 5M chars/mo free, **no 12-month limit** |
| Google Standard / WaveNet | $4 | 4M chars/mo free, ongoing † |
| **Amazon Polly Neural** | **$16** | 1M/mo free, first 12 months only |
| Google Neural2 | $16 | 1M/mo free, ongoing † |
| OpenAI `tts-1` | $15 | flat per character |
| Inworld TTS-2 Flash | $15 | on-demand; TTS-2 is $25 |
| OpenAI `gpt-4o-mini-tts` | ~$18 effective | see the token trap below |
| Groq (Orpheus) | $22 | English |
| Deepgram Aura-2 / Polly Generative / Google Chirp 3 HD / `tts-1-hd` | $30 | |
| Rime Coda | $50 | Mist v3 is $30 |
| Hume Octave 2 | $50–120 | subscription; **not** the ~$7.60 aggregators quote |
| Google Studio | $160 | |
| Polly Long-form | $100 | |
| Kokoro 82M | $0.65 (Replicate) | open weights — self-hostable at $0 marginal |

† Google's pricing page truncates on fetch; those two rows are from aggregators
and should be confirmed against the primary table before anyone relies on them.

## Traps

**`gpt-4o-mini-tts` is not $12/M characters.** It is $12 per 1M *audio output
tokens* (plus $0.60/M text input). At ~6 audio tokens per text token, and
against measured read lengths, that lands near **$18/M characters** — more than
`tts-1`'s flat $15.

**`<say-as interpret-as="characters">` is unsupported on Polly neural voices.**
AWS synthesizes the affected sentence with the *standard* voice and **still
bills it at the neural rate**. The join code is exactly where you would reach
for spell-out, so it would arrive in a worse voice than the rest of the game.
`lobbyScript` spells it with commas instead — that is the correct technique
here, not a workaround to remove.

**Caching rights decide the architecture.** A provider that forbids keeping the
audio turns the per-bank costing above into a per-game bill *and* puts venue
wifi back in the critical path mid-question. This is a gate, not a preference —
see the next section.

## Retention rights — the gate

A trivia bank is synthesized **once** and replayed forever, so a provider that
does not permit storing the output is disqualified regardless of how it sounds.
Checked against each vendor's own terms before it was added to the bench:

| provider | keep + replay the audio? | source |
| --- | --- | --- |
| **Amazon Polly** | Yes, permanently, at no extra charge | AWS states speech may be stored and replayed; caching is the documented pattern |
| **OpenAI** | Yes — "you own the Output", assigned outright, commercial use included | Terms of use. Requires disclosing to end users that the voice is AI-generated |
| **Cartesia** | Yes — "does not claim ownership of any of ... the Outputs" | Terms. Commercial use of the output starts at the **$5/mo Pro tier** |
| smallest.ai | Not stated in their public terms | Ask before designing around it |
| Inworld, Hume, Rime | Not addressed on their pricing pages | Ask before designing around them |

OpenAI's AI-disclosure condition is easy here: the host screen already says the
question is being read aloud by the app, and nobody in the room mistakes it for
a person.

## The bench lineup

`server/lib/ttsProviders.js` holds one adapter per provider. Which ones appear
is decided by which keys are in `server/.env` — a provider with no key is named
on screen as skipped, so "only one column showed up" is never ambiguous.

| provider | row(s) | rate used | exact? |
| --- | --- | --- | --- |
| **Polly** | Stephen, generative engine | $30/M | yes — the API returns `RequestCharacters` |
| **OpenAI** | `gpt-4o-mini-tts` / `ash`, plain **and** with host direction | ~$18/M | **estimated** — billed in audio tokens |
| **Cartesia** | `sonic-3.5`, up to 2 discovered English voices | ~$50/M | **estimated** — billed in credits |

**Polly is one row on purpose.** Ten variants were auditioned — Joanna, Matthew
and Ruth across neural and generative, with and without newscaster and DRC —
and **Stephen generative** won by ear. The rest are a `git log` away; carrying
them forward only made every run cost more and take longer to listen through.

**OpenAI is here for `instructions`.** It is the only provider in the lineup
that takes free-text direction on accent, emotion and pace, so both of its rows
are the same voice and the direction is the only variable:

> You are hosting live bar trivia. Read with warmth and energy, like a game
> show host working a room: clear consonants, unhurried, a small lift of
> anticipation before the answer. Never rush the choices.

That is `HOST_INSTRUCTIONS`, and it is the same intent Polly's newscaster
preset encodes — written out, for the models that can be asked.

**Cartesia's voices are UUIDs**, so the lineup is *discovered* from
`GET /voices` rather than hardcoded; a guessed id is a 404 on a paid run. Pin
specific ones with `CARTESIA_VOICE_IDS`. If the key is present but the API
refuses it, the bench reports the error and **skips the provider** rather than
planning clips that would fail halfway through a billed run.

## The generative engine

Neural read as "meh" the first time it was auditioned on real questions, which
is the usual verdict on it for anything performed rather than announced.
Generative is what the bench ships now:

- **en-US generative voices**: Danielle, Joanna, Matthew, Ruth, Salli, Stephen,
  Tiffany. Stephen is the one in the lineup.
- **$30/M against neural's $16.** A 5,000-question bank: $28 once, versus $15.
  Still not the deciding factor.
- **No newscaster, no DRC** — generative supports neither. It is expressive
  without markup rather than because of it, so those knobs stop applying.
- **Region-limited**: us-east-1, us-west-2, eu-central-1/2, eu-west-2,
  ca-central-1, and several ap-* regions. Not every region Polly serves. The
  bench checks `AWS_REGION` against that list **before** planning, because a
  region that serves neural but not generative rejects every generative request
  while the neural half of a batch still bills. In a non-generative region the
  lineup falls back to Stephen neural and the row says so.
- **One caveat worth weighing for trivia**: AWS documents an emergency-stop
  mechanism against model hallucination, and says it "could end up cutting a
  word during a generation step". A clipped word in a question read to a room
  is a worse failure than a flat delivery, so listen for it. Cached audio helps
  — a bad clip is caught once and re-synthesized, not re-rolled every game.

## Polly specifics that shaped the design

- **Voices**: en-US neural includes Danielle, Gregory, Joanna, Kendra,
  Kimberly, Salli, Joey, Matthew, Ruth, Stephen. **Joanna and Matthew are the
  two that support the newscaster speaking style** (`<amazon:domain
  name="news">`) — the announcer register this needs.
- **`<amazon:effect name="drc">`** (dynamic range compression) is fully
  supported on neural and lifts quiet consonants over room noise. No equivalent
  exists in the browser voice the app falls back to.
- **`<emphasis>` is unavailable** on neural; `<break>` is fully supported.
- **SSML tags are not billed** — only the words count.
- **Limits**: 3,000 billed characters per `SynthesizeSpeech` (we use ~150);
  neural runs 8 tps, burst 10, up to 18 concurrent. Pre-generating a
  20-question game is ~40 clips ≈ 5 seconds, comfortably inside the 90-second
  lobby.

## Auditioning

**Master Control → Ops → Voice bench** (`admin/VoiceBench.tsx`): pick a venue,
see the price, synthesize, and play the clips. That is the one that matters — the clips have to be judged on the tablet
you host from, through the speaker the room hears, and files written to a
directory on the droplet are not listenable.

The same engine runs from the command line when you'd rather:

`scripts/tts-bakeoff.mjs` reads real questions from one venue's bank —
scoped exactly as `dealSession` scopes it, since this box is multi-tenant and an
unscoped read would pick up another client's material — and synthesizes them
through every configured provider, reporting billed characters and cost per
provider:

```bash
cd /var/www/ffc/server
npm run tts:bakeoff -- --location upland          # pre-flight — prices it, spends nothing
npm run tts:bakeoff -- --location upland --yes    # synthesize
```

Either way the clips land under `data/tts-bakeoff/<run>/` (override with
`TTS_BAKEOFF_DIR`; point it at `$APP_DIR/shared/...` to survive deploys) and
show up in the Voice bench's "replay a past run" picker.

Run it with no `--location` to list the venues.

Play it on the tablet you host from, through the speaker the room hears. A
voice that reads well on a laptop can vanish over a PA, which is the whole
thing being judged.
