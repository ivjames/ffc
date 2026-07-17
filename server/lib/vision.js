// Scavenger-hunt vision verification (Phase 3).
//
// The browser never talks to the model directly — it POSTs a photo to
// /api/hunt/verify, and this module proxies the call to Claude so the API key
// (ANTHROPIC_API_KEY, already on the droplet) stays server-side.
//
// We ask the model two things at once:
//   1. Is the target item actually present in the photo?  (the verdict)
//   2. Does the photo look like a photo-of-a-photo — a picture of a screen or a
//      printout rather than the real object?  (anti-cheat)
//
// The answer is constrained to a JSON schema via structured outputs so the
// caller gets a typed object, never free-form prose to parse.
import Anthropic from "@anthropic-ai/sdk";

// A single-image "is this item present + is it a photo-of-a-photo" check is a
// simple classification, so we run it on Haiku 4.5 — ~5x cheaper per token than
// Opus ($1/$5 vs $5/$25 per 1M in/out). This matters most for `countable` items
// like the Western horseshoes, where every shot is judged (no dedup), so cost
// scales with how many photos a group takes.
const MODEL = "claude-haiku-4-5";

// One client for the process. `new Anthropic()` reads ANTHROPIC_API_KEY from the
// environment; construction is lazy so the server still boots (and other routes
// still work) on a box where the key isn't set yet.
let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("vision unavailable: ANTHROPIC_API_KEY is not set");
    err.code = "VISION_UNCONFIGURED";
    throw err;
  }
  if (!client) client = new Anthropic();
  return client;
}

export function isVisionConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Media types we accept from the client and forward to the model.
export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: {
      type: "boolean",
      description: "True only if the target item is clearly visible in the photo.",
    },
    confidence: {
      type: "number",
      description: "Confidence from 0 (guess) to 1 (certain) that the verdict is correct.",
    },
    reason: {
      type: "string",
      description: "One short sentence explaining the verdict, for the player to read.",
    },
    photo_of_photo: {
      type: "boolean",
      description:
        "True if the image looks like a picture of a screen, monitor, or printed photo rather than a real-world scene (a cheating attempt).",
    },
  },
  required: ["present", "confidence", "reason", "photo_of_photo"],
};

/**
 * Verify whether `itemName` appears in the supplied image.
 *
 * @param {object} args
 * @param {string} args.imageBase64  Base64-encoded image bytes (no data: prefix).
 * @param {string} args.mediaType    One of ALLOWED_MEDIA_TYPES.
 * @param {string} args.itemName     Human description of the target, e.g. "A windmill".
 * @param {string} [args.itemHint]   Optional hint to give the model context.
 * @returns {Promise<{present:boolean, confidence:number, reason:string, photoOfPhoto:boolean}>}
 */
export async function verifyItemInImage({ imageBase64, mediaType, itemName, itemHint }) {
  const anthropic = getClient();

  const target = itemHint ? `${itemName} (${itemHint})` : itemName;
  const prompt =
    `You are the judge for a mini-golf scavenger hunt. A player submitted this photo ` +
    `claiming it shows: "${target}".\n\n` +
    `Decide whether the target item is genuinely, clearly visible in the photo. Be ` +
    `reasonably lenient about angle, lighting, and partial views, but do NOT credit a ` +
    `find where the item is absent, ambiguous, or only implied.\n\n` +
    `Also judge anti-cheat: set photo_of_photo to true if this looks like a picture of a ` +
    `screen, monitor, phone, or a printed photograph rather than a real-world scene.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    // The answer is a 4-field JSON verdict, so 1024 is ample (down from 2048, to
    // cap worst-case output cost). Haiku 4.5 doesn't run adaptive thinking, and a
    // single-image yes/no classification doesn't need it — we go straight to the
    // structured verdict, which is both cheaper and makes an empty response (the
    // VISION_NO_OUTPUT path below) very unlikely. `effort` isn't supported on
    // Haiku either, so the only output_config knob here is the JSON schema.
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: VERDICT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  // With output_config.format the answer is a single JSON text block. If the
  // model produced none (e.g. the token budget went entirely to thinking), flag
  // it as retryable so the route can tell the player to try again rather than
  // surfacing an opaque 500.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    const err = new Error("vision returned no text content");
    err.code = "VISION_NO_OUTPUT";
    throw err;
  }
  const parsed = JSON.parse(textBlock.text);

  // Clamp confidence into [0,1] defensively.
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  return {
    present: Boolean(parsed.present),
    confidence,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    photoOfPhoto: Boolean(parsed.photo_of_photo),
  };
}
