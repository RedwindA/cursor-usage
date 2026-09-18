import { deflateSync } from "node:zlib";

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const bit = crc & 1;
      crc = crc >>> 1;
      if (bit) crc ^= 0xedb88320;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function setPx(rgba, size, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function fillRoundRect(rgba, size, x0, y0, x1, y1, radius, color) {
  const [r, g, b, a = 255] = color;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const cx = x < x0 + radius ? x0 + radius : x > x1 - radius ? x1 - radius : x;
      const cy = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
      const insideCorner =
        (x >= x0 + radius && x <= x1 - radius) ||
        (y >= y0 + radius && y <= y1 - radius) ||
        (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius;
      if (insideCorner) setPx(rgba, size, x, y, r, g, b, a);
    }
  }
}

export function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = Math.round(size * 0.06);
  fillRoundRect(rgba, size, pad, pad, size - 1 - pad, size - 1 - pad, Math.round(size * 0.22), [20, 20, 20, 255]);
  const barX0 = Math.round(size * 0.22);
  const barX1 = Math.round(size * 0.78);
  const h = Math.max(2, Math.round(size * 0.12));
  const y1 = Math.round(size * 0.38);
  const y2 = Math.round(size * 0.58);
  fillRoundRect(rgba, size, barX0, y1, barX1, y1 + h, Math.round(h / 2), [142, 162, 255, 255]);
  fillRoundRect(rgba, size, barX0, y2, Math.round(size * 0.58), y2 + h, Math.round(h / 2), [226, 177, 90, 255]);
  return encodePng(size, size, rgba);
}
