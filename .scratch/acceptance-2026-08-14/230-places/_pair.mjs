// Пара «база ↔ кадр раскрытия» одним листом: смотрим, где на самом деле
// оживает предмет зоны. Оба файла только читаются.
import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , baseFile, openFile, rectStr, label, out] = process.argv;
const FRAME_W = 630,
  FRAME_H = 351;
const [x, y, w, h] = rectStr.split(",").map(Number);

async function panel(file, rect, W) {
  const buf = await readFile(file);
  const m = await sharp(buf).metadata();
  const kx = m.width / FRAME_W,
    ky = m.height / FRAME_H;
  const pad = Math.max(40, Math.round(Math.max(rect.w, rect.h) * 0.9));
  const outer = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad) };
  outer.w = Math.min(FRAME_W, rect.x + rect.w + pad) - outer.x;
  outer.h = Math.min(FRAME_H, rect.y + rect.h + pad) - outer.y;
  const px = {
    left: Math.round(outer.x * kx),
    top: Math.round(outer.y * ky),
    width: Math.round(outer.w * kx),
    height: Math.round(outer.h * ky),
  };
  px.width = Math.min(px.width, m.width - px.left);
  px.height = Math.min(px.height, m.height - px.top);
  const scale = W / px.width;
  const H = Math.round(px.height * scale);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect x="${(rect.x - outer.x) * kx * scale}" y="${(rect.y - outer.y) * ky * scale}" width="${rect.w * kx * scale}" height="${rect.h * ky * scale}" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `<text x="8" y="${H - 10}" font-family="monospace" font-size="20" fill="#fff" stroke="#000" stroke-width=".8">${path.basename(file)}</text>` +
      `</svg>`,
  );
  return {
    buf: await sharp(buf).extract(px).resize(W, H, { fit: "fill" }).composite([{ input: svg, top: 0, left: 0 }]).toBuffer(),
    H,
  };
}

const W = 720;
const rect = { x, y, w, h };
const a = await panel(baseFile, rect, W);
const b = await panel(openFile, rect, W);
const capH = 40;
const cap = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${capH}">` +
    `<rect width="${W * 2}" height="${capH}" fill="#111"/>` +
    `<text x="10" y="27" font-family="monospace" font-size="20" fill="#fff">${label}  rect ${rectStr}</text></svg>`,
);
const H = Math.max(a.H, b.H);
const buf = await sharp({ create: { width: W * 2, height: capH + H, channels: 3, background: "#111" } })
  .composite([
    { input: cap, top: 0, left: 0 },
    { input: a.buf, top: capH, left: 0 },
    { input: b.buf, top: capH, left: W },
  ])
  .jpeg({ quality: 90 })
  .toBuffer();
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(out);
