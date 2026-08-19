// Polly's lineup and how a row becomes a SynthesizeSpeech request. The DRC row
// is the reason this file exists: it is the only clip that goes out as SSML,
// and SSML is XML, so an unescaped question is a 400 rather than a bad read.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const sent = [];
mock.module("@aws-sdk/client-polly", {
  namedExports: {
    PollyClient: class {
      async send(cmd) {
        sent.push(cmd.input);
        return {
          AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
          RequestCharacters: 42,
        };
      }
    },
    SynthesizeSpeechCommand: class {
      constructor(input) {
        this.input = input;
      }
    },
  },
});

const { providerByKey } = await import("./ttsProviders.js");
const polly = providerByKey("polly");

const GEN_ENV = { AWS_REGION: "us-east-1" };
const NO_GEN_ENV = { AWS_REGION: "eu-west-3" };

test("a generative region auditions generative against neural, with DRC as the third knob", () => {
  const rows = polly.lineup(GEN_ENV);
  assert.deepEqual(
    rows.map((r) => r.styleLabel),
    ["generative (no DRC)", "neural", "neural + DRC"]
  );
  // Same voice throughout — the engine and the compression are the variables.
  assert.deepEqual(new Set(rows.map((r) => r.voice)), new Set(["Stephen"]));
  // Priced per row: generative is nearly twice neural, and a blended rate
  // would misreport the mix.
  assert.deepEqual(rows.map((r) => r.usdPerM), [30, 16, 16]);
});

test("a region without generative still gets both neural rows, and says why", () => {
  const rows = polly.lineup(NO_GEN_ENV);
  assert.deepEqual(
    rows.map((r) => r.styleLabel),
    ["neural", "neural + DRC"]
  );
  // The point of the region check: never plan a generative request that the
  // region will reject while the rest of the batch bills anyway.
  assert.ok(!rows.some((r) => r.model === "generative"));

  // Dropping the row silently is indistinguishable from a broken bench, so
  // the reason has to reach the screen. It names the region it found and the
  // ones that would work.
  const note = polly.note(NO_GEN_ENV);
  assert.match(note, /Generative is not available in eu-west-3/);
  assert.match(note, /us-east-1/);
  assert.equal(polly.note(GEN_ENV), null, "nothing to explain when all three rows are there");
});

test("only the DRC row goes out as SSML, and its text is XML-escaped", async () => {
  sent.length = 0;
  const text = `Which band released "Rumours" & when? A, Fleetwood Mac.`;

  await polly.synth({ voice: "Stephen", model: "neural", text }, GEN_ENV);
  assert.equal(sent[0].TextType, "text");
  assert.equal(sent[0].Text, text, "a plain row is sent verbatim");

  await polly.synth({ voice: "Stephen", model: "neural", ssml: "drc", text }, GEN_ENV);
  assert.equal(sent[1].TextType, "ssml");
  assert.equal(
    sent[1].Text,
    '<speak><amazon:effect name="drc">Which band released &quot;Rumours&quot; ' +
      "&amp; when? A, Fleetwood Mac.</amazon:effect></speak>"
  );
  // An unescaped & or " here is a 400 from Polly, and band and film names in a
  // real bank carry both.
  assert.ok(!/[^;]&(?!amp;|quot;|apos;|lt;|gt;)/.test(sent[1].Text));
});

test("billing comes from the API's own count, not the wrapped SSML length", async () => {
  sent.length = 0;
  const { billed } = await polly.synth(
    { voice: "Stephen", model: "neural", ssml: "drc", text: "short" },
    GEN_ENV
  );
  assert.equal(billed, 42, "RequestCharacters, which excludes the SSML tags");
});

// --- Cartesia voice discovery -----------------------------------------------
// The droplet's failure mode: the key is valid, GET /voices answers 200, and
// the account simply has no voices. Nothing throws, so the provider reports
// itself healthy while contributing zero rows.

const cartesia = providerByKey("cartesia");

test("English is decided by accents, since language is deprecated and may be absent", () => {
  const rows = cartesia.lineup({}, [{ id: "abc", name: "Ada" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].voiceLabel, "Ada");
  assert.equal(rows[0].model, "sonic-3.5");
});

test("no voices means no rows, and the provider carries the reason", () => {
  assert.deepEqual(cartesia.lineup({}, []), []);
  // Not an error — an empty library is a valid 200. The note is what keeps an
  // empty plan from reading as a broken bench, and it names both ways out.
  assert.match(cartesia.emptyNote, /CARTESIA_VOICE_IDS/);
  assert.match(cartesia.emptyNote, /Cartesia dashboard/);
});
