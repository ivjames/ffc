// The reviewer feedback widget's screen grab, on a PHONE — the platform the
// whole feature exists for, and the one a jsdom component test cannot speak to
// at all (the capture renders the DOM through an SVG foreignObject, which jsdom
// does not paint).
//
// This is deliberately a pixel-level assertion rather than "an image appeared".
// Every interesting failure mode of a foreignObject render still produces an
// image: a blank frame, a frame that is one flat colour because the background
// swallowed the content, or a frame whose background never painted and encoded
// as solid black. So the spec checks that the grab looks like a rendered page —
// right size, many distinct colours, and edges matching the page's own
// background rather than black.
import { test, expect, devices, type Browser } from '@playwright/test';

const PLAYER_APP = 'http://localhost:5173';

type Sampled = {
  width: number;
  height: number;
  distinctColours: number;
  edges: string[];
  bodyBackground: string;
};

/** Open the app on an emulated phone, press the pill, and measure the grab. */
async function grabOnPhone(browser: Browser, route: string, scrollY = 0): Promise<Sampled> {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  try {
    await page.goto(`${PLAYER_APP}${route}`, { waitUntil: 'networkidle' });
    if (scrollY) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300);
    }
    // Belt and braces: the DOM render must be what runs, not some platform
    // capture API that only a desktop browser would have.
    await page.evaluate(() => {
      // @ts-expect-error deleting an optional platform API for the test
      delete navigator.mediaDevices;
    });

    await page.getByRole('button', { name: /feedback/i }).click();
    // The sheet only opens once the grab has resolved, and the preview only
    // renders when a frame actually came back.
    const preview = page.getByAltText('Screenshot to attach');
    await preview.waitFor({ state: 'visible', timeout: 20_000 });

    return await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>('img[alt="Screenshot to attach"]')!;
      const blob = await (await fetch(img.src)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);

      const at = (x: number, y: number) => {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        return `${r},${g},${b}`;
      };
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i += 4 * 97) {
        seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        distinctColours: seen.size,
        edges: [
          at(0, (bitmap.height / 2) | 0),
          at(bitmap.width - 1, (bitmap.height / 2) | 0),
          at((bitmap.width / 2) | 0, 0),
          at((bitmap.width / 2) | 0, bitmap.height - 1),
        ],
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      };
    });
  } finally {
    await context.close();
  }
}

/** Parse an "r,g,b" sample. */
function rgb(sample: string): [number, number, number] {
  const [r, g, b] = sample.split(',').map(Number);
  return [r, g, b];
}

for (const route of ['/', '/arcade']) {
  test(`feedback grabs a real screenshot on a phone (${route})`, async ({ browser }) => {
    const shot = await grabOnPhone(browser, route);

    // iPhone 13 viewport (390x664 usable) at the capture's capped 2x scale.
    expect(shot.width).toBe(780);
    expect(shot.height).toBeGreaterThan(1200);

    // A blank or single-colour render is the classic silent foreignObject
    // failure — a real page render has a wide spread.
    expect(shot.distinctColours).toBeGreaterThan(50);

    // Every edge must carry the page's own background, not the black that an
    // unpainted (transparent) area encodes to in a JPEG. /arcade is tall
    // enough to scroll, which is exactly the case that used to leave an
    // unpainted frame down the left and top.
    for (const edge of shot.edges) {
      const [r, g, b] = rgb(edge);
      expect(r + g + b, `edge sample ${edge} looks unpainted`).toBeGreaterThan(60);
    }
  });
}

test('a scrolled page grabs the viewport, fully painted', async ({ browser }) => {
  // Scrolling is where the render stops covering the whole frame: the captured
  // element is offset upward to bring the viewport into view, and everything
  // the element's own box no longer covers is left transparent — which a JPEG
  // encodes as solid black. The capture paints its own background underneath
  // for exactly this case, so the bottom edge is the one that matters here.
  const shot = await grabOnPhone(browser, '/arcade', 400);

  expect(shot.distinctColours).toBeGreaterThan(50);
  for (const edge of shot.edges) {
    const [r, g, b] = rgb(edge);
    expect(r + g + b, `edge sample ${edge} looks unpainted`).toBeGreaterThan(60);
  }
});

test('the grab leaves the dev chrome out of the picture', async ({ browser }) => {
  // The reviewer is commenting on the app, not on our own overlay, so the
  // feedback pill / build stamp / skin picker are excluded from the render.
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  try {
    await page.goto(`${PLAYER_APP}/`, { waitUntil: 'networkidle' });
    const ignored = page.locator('[data-feedback-ignore]');
    await expect(ignored.first()).toBeAttached();
    expect(await ignored.count()).toBeGreaterThanOrEqual(3);
  } finally {
    await context.close();
  }
});
