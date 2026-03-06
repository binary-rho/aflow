/**
 * Generates Conductor logo PNGs (play + arrow) at 16, 48, 128.
 * Uses only Node built-ins (fs, zlib). No external deps.
 */
import fs from "fs";
import zlib from "zlib";

const MAGENTA = [0xe6, 0x00, 0x7e, 0xff];
const TRANSPARENT = [0, 0, 0, 0];

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let k = n;
    for (let j = 0; j < 8; j++) k = (k & 1) ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
    table[n] = k;
  }
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(out, type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const chunk = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunk), 0);
  out.push(len, chunk, crc);
}

function setPixel(pixels, w, x, y, r, g, b, a) {
  if (x < 0 || x >= w || y < 0 || y >= w) return;
  const i = (y * w + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function drawLine(pixels, w, x0, y0, x1, y1, stroke) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const half = Math.max(0, Math.ceil(stroke / 2) - 1);
  while (true) {
    for (let i = -half; i <= half; i++) {
      for (let j = -half; j <= half; j++) {
        setPixel(pixels, w, x0 + i, y0 + j, ...MAGENTA);
      }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawTriangle(pixels, w, x1, y1, x2, y2, x3, y3) {
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxY = Math.min(w - 1, Math.ceil(Math.max(y1, y2, y3)));
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    const xs = [];
    [[x1, y1, x2, y2], [x2, y2, x3, y3], [x3, y3, x1, y1]].forEach(([ax, ay, bx, by]) => {
      if (ay === by) return;
      const t = (py - ay) / (by - ay);
      if (t >= 0 && t <= 1) xs.push(ax + t * (bx - ax));
    });
    if (xs.length >= 2) {
      const xMin = Math.max(0, Math.floor(Math.min(...xs)));
      const xMax = Math.min(w - 1, Math.ceil(Math.max(...xs)));
      for (let x = xMin; x <= xMax; x++) setPixel(pixels, w, x, y, ...MAGENTA);
    }
  }
}

function renderIcon(size) {
  const scale = size / 24;
  const pixels = Buffer.alloc(size * size * 4);
  pixels.fill(0);

  const x1 = 6 * scale;
  const y1 = 7 * scale;
  const x2 = 6 * scale;
  const y2 = 17 * scale;
  const x3 = 14 * scale;
  const y3 = 12 * scale;
  drawTriangle(pixels, size, x1, y1, x2, y2, x3, y3);

  const stroke = Math.max(1, Math.round(2.5 * scale));
  drawLine(pixels, size, 13 * scale, 12 * scale, 20 * scale, 12 * scale, stroke);
  drawLine(pixels, size, 17 * scale, 9 * scale, 20 * scale, 12 * scale, stroke);
  drawLine(pixels, size, 20 * scale, 12 * scale, 17 * scale, 15 * scale, stroke);

  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0]));
    rows.push(pixels.subarray((y * size) * 4, (y * size + size) * 4));
  }
  return Buffer.concat(rows);
}

function createPng(size) {
  const raw = renderIcon(size);
  const compressed = zlib.deflateSync(raw, { level: 6 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const out = [signature];
  writeChunk(out, "IHDR", ihdr);
  writeChunk(out, "IDAT", compressed);
  writeChunk(out, "IEND", Buffer.alloc(0));

  return Buffer.concat(out);
}

const dir = new URL("../public/icons/", import.meta.url);
for (const size of [16, 48, 128]) {
  const png = createPng(size);
  fs.writeFileSync(new URL(`icon-${size}.png`, dir), png);
  console.log(`Wrote icon-${size}.png`);
}
