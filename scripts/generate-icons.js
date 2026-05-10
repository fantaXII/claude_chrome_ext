/**
 * Generates simple PNG icons for the Chrome extension
 * Uses only Node.js built-ins (zlib + fs) — no npm packages needed
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'extension', 'icons');
mkdirSync(iconsDir, { recursive: true });

// ── CRC32 ──────────────────────────────────────────────────────────────────
function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}

const CRC_TABLE = makeCRCTable();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk builder ──────────────────────────────────────────────────────
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── PNG generator ──────────────────────────────────────────────────────────
function createPNG(size, drawFn) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB color type
  // compression, filter, interlace = 0

  // Raw image: filter_byte + R,G,B per pixel per row
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen, 0);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter byte: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = drawFn(x, y, size);
      const off = y * rowLen + 1 + x * 3;
      raw[off]     = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const idat = deflateSync(raw, { level: 6 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG sig
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Draw function: purple circle with "C" ──────────────────────────────────
function drawIcon(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background: dark purple
  const bg  = [26, 26, 46];
  // Circle fill: brand purple
  const fill = [124, 58, 237];
  // Text color: white (approximated as a cross pattern)
  const white = [255, 255, 255];

  if (dist > r) return bg; // outside circle

  // Simple "C" shape using relative coordinates
  const nx = dx / r; // -1..1
  const ny = dy / r; // -1..1

  // "C" = right half of circle cut out + top/bottom bars
  const innerR = 0.5;
  const innerDist = Math.sqrt(nx * nx + ny * ny);

  // Draw letter "C": arc from ~45° to ~315°, thickness 0.2
  if (innerDist > 0.38 && innerDist < 0.72) {
    // Check if we're NOT in the opening (right side, middle band)
    const angle = Math.atan2(ny, nx) * 180 / Math.PI; // -180..180
    const inOpening = nx > 0.1 && Math.abs(ny) < 0.35;
    if (!inOpening) return white;
  }

  return fill;
}

// ── Generate icons ─────────────────────────────────────────────────────────
const sizes = [16, 48, 128];

for (const size of sizes) {
  const png = createPNG(size, drawIcon);
  const path = join(iconsDir, `icon${size}.png`);
  writeFileSync(path, png);
  console.log(`  ✓ icon${size}.png (${png.length} bytes)`);
}
