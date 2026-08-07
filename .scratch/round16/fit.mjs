// Кусок кадра крупно со ВСЕМИ прямоугольниками зон, где кандидаты подставлены.
// Глаза — обязательная часть приёмки разметки (STATE.md, «чему НЕ верить» §1).
//
//   node .scratch/round16/fit.mjs <room> <x,y,w,h> "zone=x,y,w,h;..." <out.jpg> [--shot файл]
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "C:/Wishlist/wishlist-platform";
const FRAME_W = 630, FRAME_H = 351;
const args = process.argv.slice(2);
const [roomId, view, candStr, out] = args;
const shot = args.indexOf("--shot") >= 0 ? args[args.indexOf("--shot") + 1] : null;
const [vx, vy, vw, vh] = view.split(",").map(Number);
const cand = Object.fromEntries(
  (candStr || "")
    .split(";")
    .filter(Boolean)
    .map((p) => {
      const [k, v] = p.split("=");
      const [x, y, w, h] = v.split(",").map(Number);
      return [k, { x, y, w, h }];
    }),
);

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const room = contract.rooms.find((r) => r.id === roomId);
const basePath = path.join(REPO, "design/package", room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/"));
const meta = await sharp(basePath).metadata();

const px = {
  left: Math.round((vx / FRAME_W) * meta.width),
  top: Math.round((vy / FRAME_H) * meta.height),
  width: Math.round((vw / FRAME_W) * meta.width),
  height: Math.round((vh / FRAME_H) * meta.height),
};
const W = 1500;
const scale = W / px.width;
const H = Math.round(px.height * scale);
const sx = W / vw, sy = H / vh;

let g = "";
for (let x = Math.ceil(vx / 10) * 10; x <= vx + vw; x += 10) {
  g += `<line x1="${(x - vx) * sx}" y1="0" x2="${(x - vx) * sx}" y2="${H}" stroke="#00ffff" stroke-width="1" opacity=".3"/>`;
  g += `<text x="${(x - vx) * sx + 2}" y="14" font-family="monospace" font-size="13" fill="#00ffff">${x}</text>`;
}
for (let y = Math.ceil(vy / 10) * 10; y <= vy + vh; y += 10) {
  g += `<line x1="0" y1="${(y - vy) * sy}" x2="${W}" y2="${(y - vy) * sy}" stroke="#00ffff" stroke-width="1" opacity=".3"/>`;
  g += `<text x="2" y="${(y - vy) * sy - 3}" font-family="monospace" font-size="13" fill="#00ffff">${y}</text>`;
}
for (const z of room.zones) {
  const r = cand[z.key] ?? z.rect;
  const isNew = Boolean(cand[z.key]);
  const col = isNew ? "#3dff7a" : "#ff2d55";
  g += `<rect x="${(r.x - vx) * sx}" y="${(r.y - vy) * sy}" width="${r.w * sx}" height="${r.h * sy}" fill="none" stroke="${col}" stroke-width="${isNew ? 4 : 2}"/>`;
  g += `<text x="${(r.x - vx) * sx + 4}" y="${(r.y - vy) * sy - 5}" font-family="monospace" font-size="19" font-weight="bold" fill="${col}" stroke="#000" stroke-width=".7">${z.key}${isNew ? " ★" : ""}</text>`;
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g}</svg>`);

const src = shot
  ? await sharp(shot).resize(meta.width, meta.height, { fit: "fill" }).toBuffer()
  : await readFile(basePath);
const buf = await sharp(src)
  .extract(px)
  .resize(W, H, { fit: "fill" })
  .composite([{ input: svg, top: 0, left: 0 }])
  .jpeg({ quality: 90 })
  .toBuffer();
await writeFile(out, buf);
console.log(out);
