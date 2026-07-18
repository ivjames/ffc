// Dev-only: rasterize every hole straight from the shared world geometry into a
// single PNG montage, so the course layout can be eyeballed without a browser.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { W, H, HOLE_R, BALL_R, ROUGH_BAND, HOLES, sdUnion } from '../src/features/putt/world.ts';

const SCALE = 3; // field px per image px
const CW = W / SCALE; // cell width  (120)
const CH = H / SCALE; // cell height (180)
const COLS = 3;
const ROWS = 3;
const IW = COLS * CW;
const IH = ROWS * CH;

type RGB = [number, number, number];
const OFF: RGB = [10, 36, 23]; // off the playable surface
const FAIRWAY: RGB = [26, 143, 74];
const PUTTING: RGB = [55, 192, 109]; // the green (putting surface)
const COLLAR: RGB = [43, 122, 67]; // rough fringe at the green's edge
const WALL_PALETTE: RGB[] = [
  [239, 68, 68], // red
  [59, 130, 246], // blue
  [245, 158, 11], // amber
  [168, 85, 247], // purple
  [236, 72, 153], // pink
  [20, 184, 166], // teal
];
const SAND: RGB = [227, 205, 140];
const WATER: RGB = [42, 151, 220];
const CUP: RGB = [4, 22, 12];
const MARK: RGB = [248, 250, 252];

const img = Buffer.alloc(IW * IH * 3);
const put = (x: number, y: number, c: RGB) => {
  const o = (y * IW + x) * 3;
  img[o] = c[0];
  img[o + 1] = c[1];
  img[o + 2] = c[2];
};

for (let hi = 0; hi < HOLES.length; hi++) {
  const h = HOLES[hi];
  const ox = (hi % COLS) * CW;
  const oy = Math.floor(hi / COLS) * CH;
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const fx = cx * SCALE;
      const fy = cy * SCALE;
      let col: RGB = OFF;
      const sdF = sdUnion(fx, fy, h.fairway);
      const sdG = sdUnion(fx, fy, h.green);
      // Putting surface on top; collar only on the green fringe that isn't
      // fairway; fairway (incl. the throat) stays clear of rough.
      if (sdG <= -ROUGH_BAND) col = PUTTING;
      else if (sdG < 0) col = sdF < 0 ? FAIRWAY : COLLAR;
      else if (sdF < 0) col = FAIRWAY;
      if (col !== OFF) {
        // hazards only where on the surface → chopped at the rail
        if (h.water && sdUnion(fx, fy, h.water) < 0) col = WATER;
        if (h.pits && sdUnion(fx, fy, h.pits) < 0) col = SAND;
        if (h.walls) {
          for (let wi = 0; wi < h.walls.length; wi++) {
            if (sdUnion(fx, fy, [h.walls[wi]]) < 0) {
              col = WALL_PALETTE[wi % WALL_PALETTE.length];
              break;
            }
          }
        }
      }
      if (Math.hypot(fx - h.cup.x, fy - h.cup.y) < HOLE_R) col = CUP;
      if (Math.hypot(fx - h.tee.x, fy - h.tee.y) < BALL_R) col = MARK;
      // cell border
      if (cx === 0 || cy === 0) col = [30, 41, 37];
      put(ox + cx, oy + cy, col);
    }
  }
}

// --- minimal truecolor PNG encoder -----------------------------------------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
const raw = Buffer.alloc(IH * (1 + IW * 3));
for (let y = 0; y < IH; y++) {
  raw[y * (1 + IW * 3)] = 0; // filter: none
  img.copy(raw, y * (1 + IW * 3) + 1, y * IW * 3, (y + 1) * IW * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(IW, 0);
ihdr.writeUInt32BE(IH, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] || 'holes.png';
writeFileSync(out, png);
console.log(`wrote ${out} (${IW}x${IH})`);
