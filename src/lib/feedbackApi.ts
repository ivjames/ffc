import { apiUrl } from '../sync';
import { fileToUpload } from './image';
import { getDeviceId } from './deviceId';
import { getCurrentLocationId } from './location';

// Reviewer commentary client (server: routes/feedback.js). One call: a
// comment, plus the context the reviewer shouldn't have to type — which screen
// they were on, which build they were running, what device they held. The
// screenshot is optional and goes through the same downscale path as every
// other image in this app (src/lib/image.ts), so a 4 MB phone screenshot
// lands as ~600 KB and never trips a body limit.
//
// The widget that calls this is dev-mode-gated (src/ui/FeedbackButton.tsx).

// The reviewer's name, remembered so they type it once per device rather than
// once per note. Not identity — just a label on the note in Master Control.
const NAME_KEY = 'ffc:feedbackReviewer';

export function getReviewerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setReviewerName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // Private mode: the name just won't persist to the next note.
  }
}

/** Server-side ceiling (routes/feedback.js) — mirrored so the UI can count down. */
export const MAX_FEEDBACK_CHARS = 4000;

export type FeedbackResult = {
  ok: true;
  id: string;
  createdAt: string;
  hasScreenshot: boolean;
  /** Set when a screenshot was sent but the disk budget was spent — the
   *  comment still filed, so the UI says so rather than reporting failure. */
  screenshotDropped?: boolean;
};

export async function submitFeedback(input: {
  body: string;
  screenPath: string;
  reviewer?: string;
  screenshot?: File | null;
}): Promise<FeedbackResult> {
  const image = input.screenshot ? await fileToUpload(input.screenshot) : null;

  const res = await fetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: input.body,
      screenPath: input.screenPath,
      reviewer: input.reviewer || undefined,
      deviceId: getDeviceId(),
      locationId: getCurrentLocationId(),
      appBuild: __BUILD_ID__,
      userAgent: navigator.userAgent,
      ...(image ? { imageBase64: image.base64, mediaType: image.mediaType } : {}),
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Could not send feedback (HTTP ${res.status})`);
  }
  return data as FeedbackResult;
}
