// Пара «база → раскрытие» одним куском кадра, чтобы смотреть глазами.
//   node .scratch/round16/pair.mjs <room> <x,y,w,h> <файл-раскрытия> <out.jpg> [подпись]
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "C:/Wishlist/wishlist-platform";
const FRAME_W = 630, FRAME_H = 351;
const [roomId, rectStr, shotFile, out, note = ""] = process.argv.slice(2);
const [x, y, w, h] = rectStr.split(",").map(Number);

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const room = contract.rooms.find((r) => r.id === roomId);
const basePath = path.join(REPO, "design/package", room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/"));

const meta = await sharp(basePath).metadata();
const px = {
  left: Math.round((x / FRAME_W) * meta.width),
  top: Math.round((y / FRAME_H) * meta.height),
  width: Math.round((w / FRAME_W) * meta.width),
  height: Math.round((h / FRAME_H) * meta.height),
};
const OUT_W = 1300;
const scale = OUT_W / px.width;
const OUT_H = Math.round(px.height * scale);

const cut = async (file) =>
  sharp(await sharp(file).resize(meta.width, meta.height, { fit: "fill" }).toBuffer())
    .extract(px)
    .resize(OUT_W, OUT_H, { fit: "fill" })
    .toBuffer();

const capH = 34;
const cap = (t) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${capH}">` +
      `<rect width="${OUT_W}" height="${capH}" fill="#111"/>` +
      `<text x="10" y="24" font-family="monospace" font-size="19" fill="#fff">${t}</text></svg>`,
  );

const buf = await sharp({
  create: { width: OUT_W, height: (capH + OUT_H) * 2, channels: 3, background: "#111" },
})
  .composite([
    { input: cap(`база — ${roomId} {${x},${y},${w},${h}} ${note}`), top: 0, left: 0 },
    { input: await cut(basePath), top: capH, left: 0 },
    { input: cap(`раскрытие — ${path.basename(shotFile)}`), top: capH + OUT_H, left: 0 },
    { input: await cut(shotFile), top: capH * 2 + OUT_H, left: 0 },
  ])
  .jpeg({ quality: 90 })
  .toBuffer();
await writeFile(out, buf);
console.log(out);
