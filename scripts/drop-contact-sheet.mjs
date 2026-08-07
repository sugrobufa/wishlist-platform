// Контактный лист партии: пары «база → кадр открыто» по прямоугольнику зоны.
//
//   node scripts/drop-contact-sheet.mjs <папка> <куда.jpg> [--rect contract|proposal]
//
// Приёмка порогом не заканчивается (STATE.md, «чему НЕ верить» §1): подмену
// предмета и пропажу содержимого ловят только глаза. Смотреть одиннадцать пар
// по одной — одиннадцать заходов; лист собирает их в один.
//
// Вырезка берётся с запасом в половину зоны с каждой стороны: жест обязан
// уместиться внутри прямоугольника, но увидеть, что он НЕ вылез, можно только
// вместе с окрестностью.
import sharp from "sharp";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const FRAME_W = 630;
const FRAME_H = 351;
const CELL_W = 300; // ширина одной вырезки в листе
const PAD = 8;
const LABEL_H = 22;

const [dropDir, outFile, ...rest] = process.argv.slice(2);
const rectSource = rest.includes("--rect") ? rest[rest.indexOf("--rect") + 1] : "contract";
if (!dropDir || !outFile) {
  console.error("Использование: node scripts/drop-contact-sheet.mjs <папка> <куда.jpg> [--rect …]");
  process.exit(1);
}

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const rooms = Array.isArray(contract) ? contract : contract.rooms;

let proposals = {};
try {
  const changed = JSON.parse(await readFile(path.join(dropDir, "changed-fields.json"), "utf8"));
  for (const [roomId, zones] of Object.entries(changed.rooms ?? changed)) {
    for (const [key, fields] of Object.entries(zones)) {
      if (fields?.rectProposal) proposals[`${roomId}/${key}`] = fields.rectProposal;
    }
  }
} catch {
  // необязателен
}

async function frames(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await frames(full)));
    else if (/^o-[a-z]+-[a-z]+\.jpg$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/** Вырезка зоны с запасом в половину её размера с каждой стороны. */
async function crop(file, rect, W, H) {
  const pad = { x: rect.w / 2, y: rect.h / 2 };
  const left = Math.max(0, Math.round(((rect.x - pad.x) / FRAME_W) * W));
  const top = Math.max(0, Math.round(((rect.y - pad.y) / FRAME_H) * H));
  const right = Math.min(W, Math.round(((rect.x + rect.w + pad.x) / FRAME_W) * W));
  const bottom = Math.min(H, Math.round(((rect.y + rect.h + pad.y) / FRAME_H) * H));
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  return sharp(file)
    .extract({ left, top, width: w, height: h })
    .resize(CELL_W, Math.round((CELL_W * h) / w), { fit: "fill" })
    .toBuffer({ resolveWithObject: true });
}

const files = (await frames(dropDir)).sort();
const rowsData = [];
for (const file of files) {
  const [, roomId, zoneKey] = path.basename(file, ".jpg").match(/^o-([a-z]+)-([a-z]+)$/u);
  const room = rooms.find((r) => r.id === roomId);
  const zone = room?.zones.find((z) => z.key === zoneKey);
  if (!zone) continue;
  const id = `${roomId}/${zoneKey}`;
  const rect = (rectSource === "proposal" && proposals[id]) || zone.rect;
  const baseRel = room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/");
  const basePath = path.join(REPO, "design/package", baseRel);
  const meta = await sharp(basePath).metadata();
  const a = await crop(basePath, rect, meta.width, meta.height);
  const b = await crop(file, rect, meta.width, meta.height);
  rowsData.push({
    id,
    a,
    b,
    whose: proposals[id] && rectSource === "proposal" ? "его рект" : "наш рект",
  });
}

const rowH = Math.max(...rowsData.map((r) => r.a.info.height)) + LABEL_H + PAD;
const sheetW = CELL_W * 2 + PAD * 3;
const sheetH = rowH * rowsData.length + PAD;

const composites = [];
let svg = `<svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">`;
rowsData.forEach((r, i) => {
  const y = PAD + i * rowH;
  composites.push({ input: r.a.data, left: PAD, top: y + LABEL_H });
  composites.push({ input: r.b.data, left: PAD * 2 + CELL_W, top: y + LABEL_H });
  svg +=
    `<text x="${PAD}" y="${y + 15}" font-family="monospace" font-size="14" fill="#00ffff">` +
    `${r.id} · слева база, справа «открыто» · ${r.whose}</text>`;
});
svg += "</svg>";

await sharp({
  create: { width: sheetW, height: sheetH, channels: 3, background: "#0b0806" },
})
  .composite([...composites, { input: Buffer.from(svg), left: 0, top: 0 }])
  .jpeg({ quality: 88 })
  .toFile(outFile);

console.log(`${outFile} — пар: ${rowsData.length}, ${sheetW}×${sheetH}`);
