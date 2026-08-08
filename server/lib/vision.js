// Scavenger-hunt vision verification (Phase 3).
//
// The browser never talks to the model directly — it POSTs a photo to
// /api/hunt/verify, and this module proxies the call to Claude so the API key
// (ANTHROPIC_API_KEY, already on the droplet) stays server-side.
//
// We ask the model three things at once (one call, one bill):
//   1. Is the target item actually present in the photo?  (the verdict)
//   2. Does the photo look like a photo-of-a-photo — a picture of a screen or a
//      printout rather than the real object?  (anti-cheat)
//   3. Moderation: is the content safe for a family venue, and are people /
//      apparent minors in frame? People in photos are WELCOME — the flags feed
//      display/sharing policy, not a people ban; only unsafe content blocks.
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
    unsafe: {
      type: "boolean",
      description:
        "True if the content is inappropriate for a family entertainment venue: nudity or sexual content, graphic violence or injury, obscene gestures, visible slurs or hate symbols, drug use, or someone being deliberately humiliated or harassed. Ordinary people having fun is NOT unsafe.",
    },
    unsafe_reason: {
      type: "string",
      description:
        "When unsafe is true: one short neutral category phrase (e.g. 'obscene gesture'), never a graphic description. Empty string when safe.",
    },
    people_present: {
      type: "boolean",
      description: "True if any person is visible in the photo (even partially).",
    },
    minors_present: {
      type: "boolean",
      description:
        "True if any visible person appears to be a child or teenager. When in doubt about age, err toward true.",
    },
  },
  required: [
    "present", "confidence", "reason", "photo_of_photo",
    "unsafe", "unsafe_reason", "people_present", "minors_present",
  ],
};

/**
 * Verify whether `itemName` appears in the supplied image.
 *
 * @param {object} args
 * @param {string} args.imageBase64  Base64-encoded image bytes (no data: prefix).
 * @param {string} args.mediaType    One of ALLOWED_MEDIA_TYPES.
 * @param {string} args.itemName     Human description of the target, e.g. "A windmill".
 * @param {string} [args.itemHint]   Optional hint to give the model context.
 * @param {string} [args.itemExtraPrompt]  Optional operator-written judging
 *   guidance for this item (hunt_item.extra_prompt, managed in Master
 *   Control → Hunt), appended verbatim to the prompt.
 * @returns {Promise<{present:boolean, confidence:number, reason:string, photoOfPhoto:boolean,
 *   unsafe:boolean, unsafeReason:string, peoplePresent:boolean, minorsPresent:boolean,
 *   usage:{model:string, inputTokens:number|null, outputTokens:number|null}}>}
 *   `usage` carries the API's exact token counts so the route can meter spend
 *   (hunt_scan) — it's the number Anthropic bills, not an estimate.
 */
export async function verifyItemInImage({ imageBase64, mediaType, itemName, itemHint, itemExtraPrompt }) {
  const anthropic = getClient();

  const target = itemHint ? `${itemName} (${itemHint})` : itemName;
  // extra_prompt is operator-authored (Master Control → Hunt, admin-gated),
  // the same trust level as the name/hint already interpolated above it.
  const extra = itemExtraPrompt
    ? `\n\nAdditional judging guidance from the venue for this item:\n${itemExtraPrompt}`
    : "";
  const prompt =
    `You are the judge for a mini-golf scavenger hunt. A player submitted this photo ` +
    `claiming it shows: "${target}".\n\n` +
    `Decide whether the target item is genuinely, clearly visible in the photo. Be ` +
    `reasonably lenient about angle, lighting, and partial views, but do NOT credit a ` +
    `find where the item is absent, ambiguous, or only implied.\n\n` +
    `Also judge anti-cheat: set photo_of_photo to true if this looks like a picture of a ` +
    `screen, monitor, phone, or a printed photograph rather than a real-world scene.\n\n` +
    `Also moderate the photo for a family entertainment venue. People posing or playing ` +
    `in the photo are welcome and expected — that alone is never unsafe. Set unsafe to ` +
    `true only for genuinely inappropriate content: nudity or sexual content, graphic ` +
    `violence or injury, obscene gestures, visible slurs or hate symbols, drug use, or ` +
    `someone being deliberately humiliated. Record whether any people are visible, and ` +
    `whether any appear to be minors (when unsure about age, err toward true).` +
    extra;

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

  // Exact token counts for this call, straight from the API's usage object —
  // this is what Anthropic bills, so it's what the route records for metering.
  const usage = {
    model: response.model || MODEL,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };

  // With output_config.format the answer is a single JSON text block. If the
  // model produced none (e.g. the token budget went entirely to thinking), flag
  // it as retryable so the route can tell the player to try again rather than
  // surfacing an opaque 500. The call was still billed, so carry the usage on
  // the error for the route to meter.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    const err = new Error("vision returned no text content");
    err.code = "VISION_NO_OUTPUT";
    err.usage = usage;
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
    unsafe: Boolean(parsed.unsafe),
    unsafeReason: typeof parsed.unsafe_reason === "string" ? parsed.unsafe_reason : "",
    peoplePresent: Boolean(parsed.people_present),
    minorsPresent: Boolean(parsed.minors_present),
    usage,
  };
}
