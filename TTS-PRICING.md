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

**Caching rights decide the architecture.** AWS explicitly permits storing and
replaying generated audio permanently at no extra cost, which is what makes the
per-bank costing above real. A provider that forbids caching turns this into a
per-game bill *and* puts venue wifi back in the critical path mid-question.
Inworld, Hume and Rime do not address storage on their pricing pages — ask
before designing around them.

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

`server/scripts/tts-bakeoff.mjs` reads real questions from one venue's bank —
scoped exactly as `dealSession` scopes it, since this box is multi-tenant and an
unscoped read would pick up another client's material — and
synthesizes them through each voice and style, then writes a page that plays
them side by side with the exact billed characters and cost per clip:

```bash
cd /var/www/ffc/server
npm run tts:bakeoff -- --location upland          # pre-flight — prices it, spends nothing
npm run tts:bakeoff -- --location upland --yes    # synthesize
```

Needs Node 22 on the box (it imports the app's TypeScript script builders so the
words have one definition); the API itself still runs on 18. Run it with no
`--location` to list the venues.

Play it on the tablet you host from, through the speaker the room hears. A
voice that reads well on a laptop can vanish over a PA, which is the whole
thing being judged.
