// Крупный план одной зоны: node .scratch/design-round-7/identity-check/zoom.mjs <комната/зона> [запас]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const REPO = process.cwd();
const REFS = path.join(REPO, "design/package/refs");
const OUT = path.join(REPO, ".scratch/design-round-7/identity-check");
const [target, marginArg] = process.argv.slice(2);
const MARGIN = marginArg ? Number(marginArg) : 0.12;

const contract = JSON.parse(await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"));
const IMG = contract.scene.phone.image;
const [roomId, zoneKey] = target.split("/");
const room = contract.rooms.find((r) => r.id === roomId);
const zone = room.zones.find((z) => z.key === zoneKey);

const baseFile = path.join(REFS, path.basename(room.base));
// у снятых тикетом 49 зон openFrame уже null, а файл лежит в legacy
const openFile = zone.openFrame
  ? path.join(REFS, path.basename(zone.openFrame))
  : path.join(REFS, "legacy", `round3-o-${roomId}-${zoneKey}.jpg`);
const meta = await sharp(await readFile(baseFile)).metadata();
const W = meta.width, H = meta.height;
const r = zone.rect;
const mx = r.w * MARGIN, my = r.h * MARGIN;
const x0 = Math.max(0, r.x - mx), y0 = Math.max(0, r.y - my);
const x1 = Math.min(IMG.w, r.x + r.w + mx), y1 = Math.min(IMG.h, r.y + r.h + my);
const sx = W / IMG.w, sy = H / IMG.h;
const box = {
  left: Math.round(x0 * sx), top: Math.round(y0 * sy),
  width: Math.round((x1 - x0) * sx), height: Math.round((y1 - y0) * sy),
};
const VIEW = 700;
const vh = Math.round((box.height / box.width) * VIEW);
const cut = async (buf) =>
  sharp(buf).extract(box).resize(VIEW, vh, { fit: "fill" }).jpeg({ quality: 94 }).toBuffer();

const baseCut = await cut(await readFile(baseFile));
const openFull = await sharp(await readFile(openFile)).resize(W, H, { fit: "fill" }).png().toBuffer();
const openCut = await cut(openFull);
const stacked = await sharp({ create: { width: VIEW, height: vh * 2 + 10, channels: 3, background: "#000" } })
  .composite([{ input: baseCut, left: 0, top: 0 }, { input: openCut, left: 0, top: vh + 10 }])
  .jpeg({ quality: 94 }).toBuffer();
const side = await sharp({ create: { width: VIEW * 2 + 10, height: vh, channels: 3, background: "#000" } })
  .composite([{ input: baseCut, left: 0, top: 0 }, { input: openCut, left: VIEW + 10, top: 0 }])
  .jpeg({ quality: 94 }).toBuffer();
const name = `${roomId}-${zoneKey}-zoom`;
await writeFile(path.join(OUT, `${name}-stack.jpg`), stacked);
await writeFile(path.join(OUT, `${name}-side.jpg`), side);
console.log(`${name}: ${VIEW}x${vh} (запас ${MARGIN})`);
