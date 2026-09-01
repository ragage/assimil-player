/**
 * One-off generator for the PWA icon set. Run with: node tools/generate-icons.js
 * Writes PNGs into ../icons.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);

/**
 * Draws a rounded-square badge with a play triangle on a diagonal gradient.
 * `padding` insets the artwork so the maskable variant keeps its safe zone.
 */
function drawIcon(size, { padding = 0, radius = 0.22 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = size * padding;
  const box = size - inset * 2;
  const r = box * radius;

  const cx = size / 2;
  const cy = size / 2;
  const triangleHeight = box * 0.42;
  const triangleWidth = box * 0.36;
  const leftX = cx - triangleWidth * 0.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const lx = x - inset;
      const ly = y - inset;

      let inside = lx >= 0 && ly >= 0 && lx < box && ly < box;
      if (inside && r > 0) {
        const dx = Math.max(r - lx, lx - (box - r), 0);
        const dy = Math.max(r - ly, ly - (box - r), 0);
        if (dx * dx + dy * dy > r * r) inside = false;
      }

      if (!inside) { rgba[i + 3] = 0; continue; }

      const t = (lx / box) * 0.5 + (ly / box) * 0.5;
      let red = mix(0x5b, 0x16, t);
      let green = mix(0x95, 0x1e, t);
      let blue = mix(0xff, 0x33, t);

      const ty = y - cy;
      if (Math.abs(ty) <= triangleHeight / 2) {
        const progress = (ty + triangleHeight / 2) / triangleHeight;
        const edge = leftX + triangleWidth * (1 - Math.abs(progress - 0.5) * 2);
        if (x >= leftX && x <= edge) { red = 0xff; green = 0xff; blue = 0xff; }
      }

      rgba[i] = red;
      rgba[i + 1] = green;
      rgba[i + 2] = blue;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { padding: 0.12, radius: 0.5 }],
  ['apple-touch-icon.png', 180, { radius: 0 }],
];
for (const [name, size, options] of targets) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size, options));
  console.log('wrote', name, size);
}
