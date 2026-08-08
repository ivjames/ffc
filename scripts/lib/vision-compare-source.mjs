// Web image sourcing for the bake-off dataset: pull random photos from
// Lorem Picsum (no key, CC-licensed photo pool), screen each with a
// schema-enforced Haiku scan that names the subject AND rejects any image
// with a person visible (test-data policy: nothing with people leaves our
// infrastructure), then store the keepers with subject = ground truth.
//
// Cost: one Haiku scan (~$0.003) per CANDIDATE, including rejects — the
// caller gets exact usage back for the burn ticker.
import { sourceScan } from "./vision-compare-core.mjs";
import { addDatasetImage } from "./vision-compare-store.mjs";

const MAX_COUNT = 24;
const TRIES_PER_IMAGE = 4;

export async function sourceImagesFromWeb(countRaw) {
  let count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count < 1) count = 8;
  count = Math.min(count, MAX_COUNT);

  const added = [];
  let rejectedPeople = 0;
  let failures = 0;
  let tried = 0;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };

  while (added.length < count && tried < count * TRIES_PER_IMAGE) {
    tried += 1;
    try {
      // Random photo at production dimensions — the hunt's client-side
      // downscale caps uploads at 1280px long edge (4:3 phone shots land at
      // 1280x960), so sourced test images bill the same tokens real player
      // photos do. `seed` keeps each fetch distinct without needing
      // redirects disabled.
      const seed = Math.random().toString(36).slice(2, 10);
      const res = await fetch(`https://picsum.photos/seed/${seed}/1280/960`);
      if (!res.ok) {
        failures += 1;
        continue;
      }
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      const img = { base64, mediaType: "image/jpeg" };
      const scan = await sourceScan(img);
      usage.calls += 1;
      usage.inputTokens += scan.inputTokens || 0;
      usage.outputTokens += scan.outputTokens || 0;
      usage.cost += scan.cost || 0;
      if (scan.peoplePresent) {
        rejectedPeople += 1;
        continue;
      }
      if (!scan.subject) {
        failures += 1;
        continue;
      }
      added.push(addDatasetImage({
        name: "web-" + seed + ".jpg",
        subject: scan.subject,
        alsoVisible: scan.alsoVisible,
        mediaType: "image/jpeg",
        base64,
      }));
    } catch {
      failures += 1;
    }
  }

  return { added, rejectedPeople, failures, tried, usage };
}
