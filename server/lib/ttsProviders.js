// The voice bench's providers, one adapter each.
//
// A provider declares what it can be asked for (its lineup), what it costs per
// million characters, whether it is configured, and how to turn one line of
// text into mp3 bytes. Everything else — pricing a run, storing it, replaying
// it — is provider-agnostic and lives in lib/ttsBakeoff.js.
//
// RETENTION IS THE GATE. A trivia bank is synthesized once and cached forever,
// so a provider that forbids keeping the audio is disqualified no matter how
// it sounds. Verified before each was added (TTS-PRICING.md):
//   Polly     — AWS permits storing and replaying permanently, at no charge.
//   OpenAI    — "you own the Output"; assigned outright, commercial use
//               included. Requires disclosing that the voice is AI-generated.
//   Cartesia  — "does not claim ownership of any of ... the Outputs"; the
//               commercial-use licence starts at the $5/mo Pro tier.
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

/** How the room should sound when a provider lets you ask. Polly's newscaster
 *  is a fixed preset; this is the same intent written out for the models that
 *  take direction. */
export const HOST_INSTRUCTIONS =
  "You are hosting live bar trivia. Read with warmth and energy, like a game " +
  "show host working a room: clear consonants, unhurried, a small lift of " +
  "anticipation before the answer. Never rush the choices.";

// --- Amazon Polly ------------------------------------------------------------

let pollyClient = null;
function polly(env) {
  if (!pollyClient) pollyClient = new PollyClient({ region: env.AWS_REGION || "us-east-1" });
  return pollyClient;
}

/** Generative runs in a subset of Polly's regions. A region that serves neural
 *  but not generative rejects every generative request while the neural half
 *  of a batch still bills, so the lineup is decided against the region up
 *  front rather than discovered halfway through a paid run. */
export const GENERATIVE_REGIONS = new Set([
  "us-east-1", "us-west-2", "eu-central-1", "eu-central-2", "eu-west-2",
  "ca-central-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
]);

/** SSML is XML, so a bare & or < in a question is a 400 from Polly, not a
 *  mispronunciation. Questions come from a venue's own bank and ampersands in
 *  band and film names are common, so this is a live path, not a nicety. */
function xmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const pollyProvider = {
  key: "polly",
  label: "Polly",
  usdPerM: 30, // generative; neural is 16
  configured: (env) => Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
  why: "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in server/.env",
  // Trimmed to Stephen on the operator's call: he was the best of the ten
  // Polly variants auditioned. The other voices are a `git log` away.
  //
  // Three rows, because Stephen exists on BOTH engines and the two knobs are
  // worth separating. Generative reads better but supports no DRC; neural is
  // flatter but DRC (dynamic range compression) lifts quiet consonants over
  // room noise, which is the actual problem in a bar. Comparing generative
  // against neural+DRC alone would conflate engine with compression, so plain
  // neural is the control that says which of the two did the work.
  // Why a row the operator expected is missing. Silently dropping generative
  // in a region that cannot serve it looks identical to the bench being
  // broken, and the region is not something the screen otherwise shows.
  note: (env) =>
    GENERATIVE_REGIONS.has(env.AWS_REGION || "us-east-1")
      ? null
      : `Generative is not available in ${env.AWS_REGION || "us-east-1"} — neural rows only. ` +
        `Set AWS_REGION to one of: ${[...GENERATIVE_REGIONS].join(", ")}.`,
  lineup: (env) => [
    ...(GENERATIVE_REGIONS.has(env.AWS_REGION || "us-east-1")
      ? [{ voice: "Stephen", model: "generative", styleLabel: "generative (no DRC)", usdPerM: 30 }]
      : []),
    { voice: "Stephen", model: "neural", styleLabel: "neural", usdPerM: 16 },
    { voice: "Stephen", model: "neural", styleLabel: "neural + DRC", ssml: "drc", usdPerM: 16 },
  ],
  async synth(clip, env) {
    const res = await polly(env).send(
      new SynthesizeSpeechCommand({
        Engine: clip.model,
        VoiceId: clip.voice,
        OutputFormat: "mp3",
        ...(clip.ssml === "drc"
          ? { TextType: "ssml", Text: `<speak><amazon:effect name="drc">${xmlEscape(clip.text)}</amazon:effect></speak>` }
          : { TextType: "text", Text: clip.text }),
      })
    );
    return {
      audio: Buffer.from(await res.AudioStream.transformToByteArray()),
      // The API's own count of what it billed, not our estimate.
      billed: res.RequestCharacters ?? clip.text.length,
    };
  },
};

// --- OpenAI ------------------------------------------------------------------

const openaiProvider = {
  key: "openai",
  label: "OpenAI",
  // gpt-4o-mini-tts bills $12/1M AUDIO OUTPUT tokens, not characters. At the
  // documented ~6 audio tokens per text token, and against the read lengths
  // measured from this bank, that lands near $18 per million characters. An
  // estimate by construction — the API returns no character count — so the
  // ticker says so.
  usdPerM: 18,
  estimated: true,
  configured: (env) => Boolean(env.OPENAI_API_KEY),
  why: "OPENAI_API_KEY in server/.env",
  // The reason this provider is here: `instructions` steers accent, emotion,
  // intonation and pace. Both rows are the same voice so the direction is the
  // only variable.
  lineup: () => [
    { voice: "ash", model: "gpt-4o-mini-tts", styleLabel: "plain", usdPerM: 18 },
    {
      voice: "ash",
      model: "gpt-4o-mini-tts",
      styleLabel: "host direction",
      instructions: HOST_INSTRUCTIONS,
      usdPerM: 18,
    },
  ],
  async synth(clip, env) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: clip.model,
        voice: clip.voice,
        input: clip.text,
        instructions: clip.instructions,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 160)}`);
    }
    return { audio: Buffer.from(await res.arrayBuffer()), billed: clip.text.length };
  },
};

// --- Cartesia ----------------------------------------------------------------

// Cartesia voices are UUIDs, so the lineup is discovered rather than
// hardcoded: a guessed id is a 404 on a paid run. Set CARTESIA_VOICE_IDS
// (comma-separated) to pin specific ones.
let cartesiaVoices = null;

export async function loadCartesiaVoices(env) {
  if (cartesiaVoices) return cartesiaVoices;
  const pinned = (env.CARTESIA_VOICE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pinned.length > 0) {
    cartesiaVoices = pinned.map((id) => ({ id, name: id.slice(0, 8) }));
    return cartesiaVoices;
  }
  const res = await fetch("https://api.cartesia.ai/voices", {
    headers: {
      authorization: `Bearer ${env.CARTESIA_API_KEY}`,
      "Cartesia-Version": CARTESIA_VERSION,
    },
  });
  if (!res.ok) throw new Error(`Cartesia voices ${res.status}`);
  const body = await res.json();
  const all = Array.isArray(body) ? body : (body.data ?? []);
  cartesiaVoices = all
    .filter((v) => !v.language || v.language.startsWith("en"))
    .slice(0, 2)
    .map((v) => ({ id: v.id, name: v.name ?? v.id.slice(0, 8) }));
  return cartesiaVoices;
}

const CARTESIA_VERSION = "2026-08-14";

const cartesiaProvider = {
  key: "cartesia",
  label: "Cartesia",
  // Their plans are credit-based and no per-character rate is published; this
  // is the Pro tier's math at one credit per character. Flagged as estimated
  // so nobody quotes it as fact.
  usdPerM: 50,
  estimated: true,
  configured: (env) => Boolean(env.CARTESIA_API_KEY),
  why: "CARTESIA_API_KEY in server/.env",
  discover: loadCartesiaVoices,
  lineup: (env, voices = []) =>
    voices.map((v) => ({
      voice: v.id,
      voiceLabel: v.name,
      model: "sonic-3.5",
      styleLabel: "sonic-3.5",
      usdPerM: 50,
    })),
  async synth(clip, env) {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CARTESIA_API_KEY}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model_id: clip.model,
        transcript: clip.text,
        voice: clip.voice,
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cartesia ${res.status}: ${body.slice(0, 160)}`);
    }
    return { audio: Buffer.from(await res.arrayBuffer()), billed: clip.text.length };
  },
};

export const PROVIDERS = [pollyProvider, openaiProvider, cartesiaProvider];

export function providerByKey(key) {
  return PROVIDERS.find((p) => p.key === key) ?? null;
}
