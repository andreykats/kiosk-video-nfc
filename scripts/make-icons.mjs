// Generates public/icons/icon-{192,512}.png: a play triangle with NFC-style arcs.
// Pure Node (zlib) so no image tooling is needed. Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function pixel(x, y) {
  // Normalised coordinates in [-1, 1].
  const bg = [17, 24, 39];
  const fg = [255, 255, 255];
  const accent = [47, 129, 247];
  // Play triangle on the left.
  const tx = x + 0.3;
  if (tx > -0.35 && tx < 0.35 && Math.abs(y) < (0.35 - tx) * 0.62 + 0.0 && Math.abs(y) < 0.45) return fg;
  // Three arcs on the right, centred at (0.05, 0).
  const dx = x - 0.05;
  const r = Math.hypot(dx, y);
  const angle = Math.abs(Math.atan2(y, dx));
  if (dx > 0 && angle < 0.75) {
    for (const ring of [0.42, 0.6, 0.78]) if (Math.abs(r - ring) < 0.05) return accent;
  }
  return bg;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const ss = 4; // supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel(((px + (sx + 0.5) / ss) / size) * 2 - 1, ((py + (sy + 0.5) / ss) / size) * 2 - 1);
          for (let i = 0; i < 3; i++) acc[i] += c[i];
        }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size));
console.log('Wrote public/icons/icon-192.png and icon-512.png');
