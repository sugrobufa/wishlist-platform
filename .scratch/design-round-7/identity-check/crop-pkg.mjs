// Вырезка пары из ПАКЕТА раунда 7 (refs-2x/<комната>/), чтобы проверить глазами
// выборку из 118 непрошедших: node ... crop-pkg.mjs <комната/зона> [запас]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const PKG = "C:/Wishlist/Wishlist платформа главный экран final";
const REPO = process.cwd();
const OUT = path.join(REPO, ".scratch/design-round-7/identity-check");
const [target, marginArg] = process.argv.slice(2);
const MARGIN = marginArg ? Number(marginArg) : 0.8;

const ours = JSON.parse(await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"));
const pkg = JSON.parse(await readFile(path.join(PKG, "handoff/rooms.json"), "utf8"));
const IMG = ours.scene.phone.image;
const [roomId, zoneKey] = target.split("/");
const room = pkg.rooms.find((r) => r.id === roomId);
const zone = room.zones.find((z) => z.key === zoneKey);
// прямоугольник берём НАШ — против него меряет порог и наезжает камера
const rect = ours.rooms.find((r) => r.id === roomId).zones.find((z) => z.key === zoneKey).rect;

const baseFile = path.join(PKG, room.base);
const openFile = path.join(PKG, zone.openFrame);
const meta = await sharp(await readFile(baseFile)).metadata();
const W = meta.width, H = meta.height;
const mx = rect.w * MARGIN, my = rect.h * MARGIN;
const x0 = Math.max(0, rect.x - mx), y0 = Math.max(0, rect.y - my);
const x1 = Math.min(IMG.w, rect.x + rect.w + mx), y1 = Math.min(IMG.h, rect.y + rect.h + my);
const sx = W / IMG.w, sy = H / IMG.h;
const box = {
  left: Math.round(x0 * sx), top: Math.round(y0 * sy),
  width: Math.round((x1 - x0) * sx), height: Math.round((y1 - y0) * sy),
};
const VIEW = 620;
const vh = Math.round((box.height / box.width) * VIEW);
const cut = async (buf) =>
  sharp(buf).extract(box).resize(VIEW, vh, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();
const baseCut = await cut(await readFile(baseFile));
const openFull = await sharp(await readFile(openFile)).resize(W, H, { fit: "fill" }).png().toBuffer();
const openCut = await cut(openFull);
const pair = await sharp({ create: { width: VIEW * 2 + 10, height: vh, channels: 3, background: "#000" } })
  .composite([{ input: baseCut, left: 0, top: 0 }, { input: openCut, left: VIEW + 10, top: 0 }])
  .jpeg({ quality: 92 }).toBuffer();
await writeFile(path.join(OUT, `r7-${roomId}-${zoneKey}-pair.jpg`), pair);
console.log(`r7-${roomId}-${zoneKey}-pair.jpg ${VIEW * 2 + 10}x${vh} · ${zone.openVerb ?? ""}`);
