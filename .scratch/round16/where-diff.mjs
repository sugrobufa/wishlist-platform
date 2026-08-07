// Где именно происходит жест: карта расхождения база↔раскрытие в координатах
// кадра 630×351. Печатает рамку значимого изменения и рисует тепловую карту.
//
//   node where-diff.mjs <room> <zone> <файл-раскрытия> [--thr 0.10] [--out f.jpg]
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "C:/Wishlist/wishlist-platform";
const FRAME_W = 630, FRAME_H = 351;

const args = process.argv.slice(2);
const [roomId, zoneKey, shotFile] = args;
const flag = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const THR = Number(flag("--thr", 0.1));
const OUT = flag("--out", null);

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const room = contract.rooms.find((r) => r.id === roomId);
const baseRel = room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/");
const basePath = path.join(REPO, "design/package", baseRel);

const grey = async (file, w, h) => {
  let img = sharp(file).removeAlpha().greyscale();
  if (w) img = img.resize(w, h, { fit: "fill" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

const base = await grey(basePath);
const shot = await grey(shotFile, base.w, base.h);
console.log(`база ${baseRel} ${base.w}×${base.h}`);

// средний |diff| по каждой клетке кадра 630×351
const cell = new Float64Array(FRAME_W * FRAME_H);
const cnt = new Int32Array(FRAME_W * FRAME_H);
for (let y = 0; y < base.h; y++) {
  const cy = Math.min(FRAME_H - 1, Math.floor((y / base.h) * FRAME_H));
  for (let x = 0; x < base.w; x++) {
    const cx = Math.min(FRAME_W - 1, Math.floor((x / base.w) * FRAME_W));
    cell[cy * FRAME_W + cx] += Math.abs(base.data[y * base.w + x] - shot.data[y * base.w + x]);
    cnt[cy * FRAME_W + cx]++;
  }
}
for (let i = 0; i < cell.length; i++) cell[i] = cell[i] / cnt[i] / 255;

// рамка клеток выше порога + масса
let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, mass = 0, hot = 0;
for (let y = 0; y < FRAME_H; y++)
  for (let x = 0; x < FRAME_W; x++) {
    const v = cell[y * FRAME_W + x];
    if (v >= THR) {
      hot++;
      mass += v;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
console.log(`порог ${THR}: клеток ${hot}, рамка {${x0},${y0},${x1 - x0 + 1},${y1 - y0 + 1}}`);

// «ядро»: 90% массы, отсекая одиночные клетки — по проценту от края
const vals = [];
for (let y = 0; y < FRAME_H; y++)
  for (let x = 0; x < FRAME_W; x++)
    if (cell[y * FRAME_W + x] >= THR) vals.push({ x, y, v: cell[y * FRAME_W + x] });
vals.sort((a, b) => b.v - a.v);
let acc = 0;
const core = [];
for (const p of vals) {
  if (acc / mass >= 0.9) break;
  acc += p.v;
  core.push(p);
}
const cx0 = Math.min(...core.map((p) => p.x)), cx1 = Math.max(...core.map((p) => p.x));
const cy0 = Math.min(...core.map((p) => p.y)), cy1 = Math.max(...core.map((p) => p.y));
console.log(`ядро 90% массы: {${cx0},${cy0},${cx1 - cx0 + 1},${cy1 - cy0 + 1}} (клеток ${core.length})`);

// профиль по строкам и столбцам ядра — где полосы жеста
const rowSum = new Float64Array(FRAME_H), colSum = new Float64Array(FRAME_W);
for (const p of vals) { rowSum[p.y] += p.v; colSum[p.x] += p.v; }
const topRows = [...rowSum.keys()].filter((y) => rowSum[y] > 0).sort((a, b) => rowSum[b] - rowSum[a]);
console.log("строки с наибольшей массой:", topRows.slice(0, 12).sort((a, b) => a - b).join(","));
const bandRows = [...rowSum.keys()].filter((y) => rowSum[y] > 0);
console.log(`полоса по Y: ${Math.min(...bandRows)}…${Math.max(...bandRows)}`);
const bandCols = [...colSum.keys()].filter((x) => colSum[x] > 0);
console.log(`полоса по X: ${Math.min(...bandCols)}…${Math.max(...bandCols)}`);

// сколько массы попадает в прямоугольник контракта
const zone = room.zones.find((z) => z.key === zoneKey);
const inRect = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const share = (r) => vals.filter((p) => inRect(r, p)).reduce((s, p) => s + p.v, 0) / mass;
console.log(
  `масса внутри контракта {${zone.rect.x},${zone.rect.y},${zone.rect.w},${zone.rect.h}}: ${(share(zone.rect) * 100).toFixed(1)}%`,
);
for (const z of room.zones) {
  const s = share(z.rect);
  if (s > 0.01) console.log(`  … в зоне ${z.key}: ${(s * 100).toFixed(1)}%`);
}

if (OUT) {
  const W = 1600, H = Math.round((W * FRAME_H) / FRAME_W);
  const sx = W / FRAME_W, sy = H / FRAME_H;
  let g = "";
  for (const p of vals) {
    const a = Math.min(1, (p.v - THR) / 0.25);
    g += `<rect x="${p.x * sx}" y="${p.y * sy}" width="${sx + 0.5}" height="${sy + 0.5}" fill="#ff2d55" opacity="${(0.25 + 0.65 * a).toFixed(2)}"/>`;
  }
  for (const z of room.zones) {
    g += `<rect x="${z.rect.x * sx}" y="${z.rect.y * sy}" width="${z.rect.w * sx}" height="${z.rect.h * sy}" fill="none" stroke="#00ffff" stroke-width="2"/>`;
    g += `<text x="${z.rect.x * sx + 3}" y="${z.rect.y * sy - 4}" font-family="monospace" font-size="15" fill="#00ffff">${z.key}</text>`;
  }
  g += `<rect x="${cx0 * sx}" y="${cy0 * sy}" width="${(cx1 - cx0 + 1) * sx}" height="${(cy1 - cy0 + 1) * sy}" fill="none" stroke="#ffee00" stroke-width="3"/>`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g}</svg>`);
  const buf = await sharp(await readFile(basePath))
    .resize(W, H, { fit: "fill" })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  await writeFile(OUT, buf);
  console.log(OUT);
}
