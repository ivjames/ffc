// People-screen for hunt-item vetting images (Master Control → Hunt).
//
// Test-data policy (CLAUDE.md): images used for model testing must not
// contain people, because they get sent to third-party providers. Every
// image uploaded into an item's vetting set is therefore screened by the
// bench's descriptor scan (scripts/lib/vision-compare-core.mjs — one cheap
// schema-forced call that names the subject AND flags people) BEFORE it is
// written to disk; anyone visible → the upload is rejected outright.
//
// This thin wrapper exists so routes/admin/huntItems.js has one seam the
// integration tests can mock (mock.module, same arrangement as lib/vision.js
// in the hunt tests) without touching the shared bench core.
import {
  PROVIDERS,
  isConfigured,
  sourceScan,
} from "../../scripts/lib/vision-compare-core.mjs";

/** True when at least one descriptor provider has its API key set. */
export function isScreeningConfigured() {
  return PROVIDERS.some((p) => isConfigured(p));
}

/**
 * Screen one image: name its subject and flag people. One billed model call.
 *
 * @param {{imageBase64: string, mediaType: string}} args
 * @returns {Promise<{peoplePresent: boolean, subject: string, provider: string,
 *   inputTokens: number|null, outputTokens: number|null, cost: number|null}>}
 *   Token counts are the provider-reported (billed) numbers; cost is computed
 *   from the bench's rate table — surfaced to the operator per CLAUDE.md.
 */
export async function screenItemImage({ imageBase64, mediaType }) {
  const scan = await sourceScan({ base64: imageBase64, mediaType });
  return {
    peoplePresent: scan.peoplePresent,
    subject: scan.subject,
    provider: scan.provider,
    inputTokens: scan.inputTokens,
    outputTokens: scan.outputTokens,
    cost: scan.cost,
  };
}
