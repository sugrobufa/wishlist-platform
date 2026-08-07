// Примерка прямоугольника: соседи, край окна, bloomAR и — если дан кадр
// раскрытия — те же own/фон/отн/кольцо, что считает scripts/check-drop.mjs.
//
//   node .scratch/round16/try-rect.mjs <room> "zone=x,y,w,h;zone2=..." [--shot зона=файл;...]
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO = "C:/Wishlist/wishlist-platform";
const FRAME_W = 630, FRAME_H = 351;
const OWN_MIN = 0.05, RATIO_MIN = 3, RING_MAX = 0.09;

const args = process.argv.slice(2);
const roomId = args[0];
const flag = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const parse = (s) =>
  Object.fromEntries(
    (s || "")
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split("=");
        return [k, v];
      }),
  );
const cand = Object.fromEntries(
  Object.entries(parse(args[1])).map(([k, v]) => {
    const [x, y, w, h] = v.split(",").map(Number);
    return [k, { x, y, w, h }];
  }),
);
const shots = parse(flag("--shot", ""));

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const room = contract.rooms.find((r) => r.id === roomId);
/** Карта комнаты с подставленными кандидатами. */
const rectOf = (z) => cand[z.key] ?? z.rect;

const inter = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const AR = (r) => Math.max(30, Math.min(120, Math.round((r.w / r.h) * 58)));

console.log(`комната ${roomId}\n`);
for (const [key, r] of Object.entries(cand)) {
  const zone = room.zones.find((z) => z.key === key);
  const was = zone.rect;
  console.log(
    `${key}: {${was.x},${was.y},${was.w},${was.h}} → {${r.x},${r.y},${r.w},${r.h}}  ` +
      `bloomAR ${zone.bloomAR} → ${AR(r)}  площадь ${was.w * was.h} → ${r.w * r.h}`,
  );
  const left = r.x < 12 ? (Math.min(12, r.x + r.w) - r.x) * r.h : 0;
  if (left) console.log(`  ! левее края окна (x<12): ${left} px²`);
  if (r.x + r.w > FRAME_W || r.y + r.h > FRAME_H)
    console.log(`  ! вылет за кадр справа/снизу`);
  let clash = 0;
  for (const z of room.zones) {
    if (z.key === key) continue;
    const a = inter(r, rectOf(z));
    if (a > 0) {
      console.log(`  ! пересекает ${z.key}: ${a} px²`);
      clash += a;
    }
  }
  if (!clash && !left) console.log("  чисто: соседей не задевает, x ≥ 12");
  console.log("");
}

if (!Object.keys(shots).length) process.exit(0);

const basePath = path.join(REPO, "design/package", room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/"));
const grey = async (file, w, h) => {
  let img = sharp(file).removeAlpha().greyscale();
  if (w) img = img.resize(w, h, { fit: "fill" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};
const base = await grey(basePath);

function meanDiff(a, b, W, H, rect) {
  const x0 = Math.max(0, Math.round((rect.x / FRAME_W) * W));
  const x1 = Math.min(W, Math.round(((rect.x + rect.w) / FRAME_W) * W));
  const y0 = Math.max(0, Math.round((rect.y / FRAME_H) * H));
  const y1 = Math.min(H, Math.round(((rect.y + rect.h) / FRAME_H) * H));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      sum += Math.abs(a[y * W + x] - b[y * W + x]);
      n++;
    }
  return n === 0 ? 0 : sum / n / 255;
}
function ringDiff(a, b, W, H, rect) {
  const outer = { x: rect.x - rect.w / 2, y: rect.y - rect.h / 2, w: rect.w * 2, h: rect.h * 2 };
  const x0 = Math.max(0, Math.round((outer.x / FRAME_W) * W));
  const x1 = Math.min(W, Math.round(((outer.x + outer.w) / FRAME_W) * W));
  const y0 = Math.max(0, Math.round((outer.y / FRAME_H) * H));
  const y1 = Math.min(H, Math.round(((outer.y + outer.h) / FRAME_H) * H));
  const ix0 = Math.max(0, Math.round((rect.x / FRAME_W) * W));
  const ix1 = Math.min(W, Math.round(((rect.x + rect.w) / FRAME_W) * W));
  const iy0 = Math.max(0, Math.round((rect.y / FRAME_H) * H));
  const iy1 = Math.min(H, Math.round(((rect.y + rect.h) / FRAME_H) * H));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue;
      sum += Math.abs(a[y * W + x] - b[y * W + x]);
      n++;
    }
  return n === 0 ? 0 : sum / n / 255;
}

console.log("зона                own      фон      отн    кольцо   вердикт");
console.log("------------------- -------- -------- ------ -------- -------");
for (const [key, file] of Object.entries(shots)) {
  const shot = await grey(file, base.w, base.h);
  const zone = room.zones.find((z) => z.key === key);
  for (const [label, rect] of [
    ["контракт", zone.rect],
    ["кандидат", cand[key] ?? zone.rect],
  ]) {
    const own = meanDiff(base.data, shot.data, base.w, base.h, rect);
    // фон — прямоугольники ОСТАЛЬНЫХ зон, с учётом кандидатов
    const others = room.zones.filter((z) => z.key !== key);
    const bg =
      others.reduce((s, z) => s + meanDiff(base.data, shot.data, base.w, base.h, rectOf(z)), 0) /
      others.length;
    const ring = ringDiff(base.data, shot.data, base.w, base.h, rect);
    const ratio = bg === 0 ? Infinity : own / bg;
    const pass = own >= OWN_MIN && ratio >= RATIO_MIN;
    console.log(
      `${(key + " " + label).padEnd(19)} ${own.toFixed(4).padEnd(8)} ${bg.toFixed(4).padEnd(8)} ` +
        `${ratio.toFixed(2).padEnd(6)} ${ring.toFixed(4).padEnd(8)} ` +
        `${pass ? "прошёл" : "НЕ ПРО"}${ring <= RING_MAX ? "" : " · КОЛЬЦО ПЛЫВЁТ"}`,
    );
  }
}
