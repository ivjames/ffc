import { describe, expect, test } from 'vitest';
import { generate } from 'lean-qr';
import jsQR from 'jsqr';
import { joinCodeFromScan } from './scanJoinCode';

describe('reading a scan', () => {
  test('pulls the code out of the join link the host lobby renders', () => {
    expect(joinCodeFromScan('https://bullwinkles.ffc.lab980.com/arcade/trivia/live?code=B8S5Z2')).toBe(
      'B8S5Z2',
    );
  });

  test('takes the code from the query, not the path', () => {
    // So the route can move without breaking a QR already printed on a table
    // tent — the code is the part that has to survive.
    expect(joinCodeFromScan('https://x.example/somewhere/else?foo=1&code=abc234')).toBe('ABC234');
  });

  test('accepts a bare code from someone else’s generator', () => {
    expect(joinCodeFromScan('  b8s5z2 ')).toBe('B8S5Z2');
    expect(joinCodeFromScan('AB C-234')).toBe('ABC234');
  });

  test('ignores the rest of the room', () => {
    // The scanner sees whatever it is pointed at. Returning null is what lets
    // it keep looking instead of closing on the menu QR at the next table.
    expect(joinCodeFromScan('https://example.com/menu')).toBeNull();
    expect(joinCodeFromScan('WIFI:S:VenueGuest;T:WPA;P:hunter2;;')).toBeNull();
    expect(joinCodeFromScan('tel:+15551234567')).toBeNull();
    expect(joinCodeFromScan('')).toBeNull();
    expect(joinCodeFromScan(null)).toBeNull();
    expect(joinCodeFromScan(undefined)).toBeNull();
  });

  test('ignores things of the wrong shape', () => {
    expect(joinCodeFromScan('AB!234')).toBeNull(); // punctuation
    expect(joinCodeFromScan('ABC')).toBeNull(); // too short
    expect(joinCodeFromScan('ABCDEFGHI')).toBeNull(); // too long
    expect(joinCodeFromScan('https://x.example/?code=')).toBeNull(); // empty param
    expect(joinCodeFromScan('https://x.example/?code=no!')).toBeNull();
  });

  test('does not validate the alphabet — the server owns that', () => {
    // 'U' is excluded from generated codes, but deciding so belongs to
    // server/lib/joinCode.js. Two answers to that question is how the room
    // ends up with a code the client rejects and the server would have taken.
    expect(joinCodeFromScan('ABCU23')).toBe('ABCU23');
  });
});

/** Rasterize a lean-qr code the way the canvas does: one square per module,
 *  scaled up, with the 4-module quiet zone a decoder expects. */
function rasterize(text: string, scale = 4, quiet = 4) {
  const code = generate(text);
  const side = (code.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my);
      if (dark) {
        const i = (y * side + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side };
}

describe('the decoder against our own QR', () => {
  // The scanner is worth nothing if jsQR can't read what JoinQr draws. This
  // runs the real pair — lean-qr generates, jsQR decodes — rather than
  // trusting that two libraries agree about QR.
  test('jsQR reads the join link lean-qr generates, and the code survives', () => {
    const url = 'https://bullwinkles.ffc.lab980.com/arcade/trivia/live?code=B8S5Z2';
    const img = rasterize(url);
    const decoded = jsQR(img.data, img.width, img.height);
    expect(decoded?.data).toBe(url);
    expect(joinCodeFromScan(decoded?.data ?? '')).toBe('B8S5Z2');
  });

  test('every character in the alphabet round-trips', () => {
    // A code is 6 chars from a 32-char alphabet; a decoder that stumbled on
    // one of them would fail rarely and inexplicably, in a room.
    for (const code of ['0123AB', 'CDEFGH', 'JKMNPQ', 'RSTVWX', 'YZ9876']) {
      const url = `https://x.example/arcade/trivia/live?code=${code}`;
      const img = rasterize(url);
      expect(joinCodeFromScan(jsQR(img.data, img.width, img.height)?.data ?? '')).toBe(code);
    }
  });
});
