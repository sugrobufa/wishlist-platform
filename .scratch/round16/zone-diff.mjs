// Расхождение база↔кадр по КАЖДОЙ зоне комнаты: видно, свой предмет двигался
// или переписана вся сцена.
//   node .scratch/round16/zone-diff.mjs <room> <файл>
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO = "C:/Wishlist/wishlist-platform";
const FRAME_W = 630, FRAME_H = 351;
const [roomId, file] = process.argv.slice(2);
const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const room = contract.rooms.find((r) => r.id === roomId);
const basePath = path.join(REPO, "design/package", room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/"));
const grey = async (f, w, h) => {
  let img = sharp(f).removeAlpha().greyscale();
  if (w) img = img.resize(w, h, { fit: "fill" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};
const base = await grey(basePath);
const shot = await grey(file, base.w, base.h);
const md = (rect) => {
  const x0 = Math.max(0, Math.round((rect.x / FRAME_W) * base.w));
  const x1 = Math.min(base.w, Math.round(((rect.x + rect.w) / FRAME_W) * base.w));
  const y0 = Math.max(0, Math.round((rect.y / FRAME_H) * base.h));
  const y1 = Math.min(base.h, Math.round(((rect.y + rect.h) / FRAME_H) * base.h));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s += Math.abs(base.data[y * base.w + x] - shot.data[y * base.w + x]);
      n++;
    }
  return n ? s / n / 255 : 0;
};
console.log(`${roomId} ← ${path.basename(file)}`);
const rows = room.zones
  .map((z) => ({ key: z.key, d: md(z.rect), r: z.rect }))
  .sort((a, b) => b.d - a.d);
for (const r of rows)
  console.log(`  ${r.key.padEnd(10)} ${r.d.toFixed(4)}  {${r.r.x},${r.r.y},${r.r.w},${r.r.h}}`);
// весь кадр целиком
console.log(`  ${"ВЕСЬ КАДР".padEnd(10)} ${md({ x: 0, y: 0, w: FRAME_W, h: FRAME_H }).toFixed(4)}`);
