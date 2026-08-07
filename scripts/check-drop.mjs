// Приёмка партии кадров «открыто», лежащей ПЛОСКО в папке поставки.
//
//   node scripts/check-drop.mjs <папка> [--rect contract|proposal]
//
// Зачем отдельно от check-frames.mjs: тот требует раскладку пакета
// (`refs-2x/<комната>/`) и базовый кадр внутри неё. Раунд 14 приехал плоскими
// папками `suitcases/` и `boxes/` с именами `o-<комната>-<зона>.jpg`, а базу
// надо брать НАШУ — ту, с которой кадр будет кроссфейдиться на экране.
//
// ПРАВИЛО ПРИЁМКИ (handoff/reshoot-recipe.md, оно же в check-frames.mjs):
// расхождение в своей зоне ≥ 0.05 И ≥ 3× относительно фона. Фон — не «весь
// кадр», а прямоугольники ОСТАЛЬНЫХ зон комнаты: усреднение по всему кадру
// прощает переписанный фон, и на этом разошлись раунды 11 и 13.
//
// ВТОРАЯ ПРОВЕРКА — КОЛЬЦО (тикет 49): рамка вплотную снаружи прямоугольника,
// шириной с саму зону. У честного раскрытия предмет действует внутри своих
// границ, и кольцо почти не меняется; у подмены вместе с предметом
// переписывается ближайшее окружение, и кольцо плывёт. Граница — 0.09.
//
// Кольцо НЕ ловит пропажу содержимого (она внутри прямоугольника). Глаз
// остаётся обязательной частью приёмки.
import sharp from "sharp";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const REPO = path.resolve(import.meta.dirname, "..");
const FRAME_W = 630;
const FRAME_H = 351;

const OWN_MIN = 0.05;
const RATIO_MIN = 3;
const RING_MAX = 0.09;

const args = process.argv.slice(2);
const dropDir = args[0];
const rectSource = args.includes("--rect") ? args[args.indexOf("--rect") + 1] : "contract";
if (!dropDir) {
  console.error("Использование: node scripts/check-drop.mjs <папка> [--rect contract|proposal]");
  process.exit(1);
}

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const rooms = Array.isArray(contract) ? contract : contract.rooms;

/** Предложения дизайна, если они приехали рядом с кадрами. */
let proposals = {};
try {
  const changed = JSON.parse(await readFile(path.join(dropDir, "changed-fields.json"), "utf8"));
  for (const [roomId, zones] of Object.entries(changed.rooms ?? changed)) {
    for (const [key, fields] of Object.entries(zones)) {
      if (fields?.rectProposal) proposals[`${roomId}/${key}`] = fields.rectProposal;
    }
  }
} catch {
  // Файла нет — значит мерим только против контракта.
}

/** Все o-*.jpg поставки, включая вложенные папки партий. */
async function frames(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await frames(full)));
    else if (/^o-[a-z]+-[a-z]+\.jpg$/u.test(entry.name)) out.push(full);
  }
  return out;
}

const grey = async (file, w, h) => {
  const img = sharp(file).removeAlpha().greyscale();
  const sized = w ? img.resize(w, h, { fit: "fill" }) : img;
  const { data, info } = await sized.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

/** Среднее |разница| по прямоугольнику в координатах кадра 630×351. */
function meanDiff(a, b, W, H, rect) {
  const x0 = Math.max(0, Math.round((rect.x / FRAME_W) * W));
  const x1 = Math.min(W, Math.round(((rect.x + rect.w) / FRAME_W) * W));
  const y0 = Math.max(0, Math.round((rect.y / FRAME_H) * H));
  const y1 = Math.min(H, Math.round(((rect.y + rect.h) / FRAME_H) * H));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += Math.abs(a[y * W + x] - b[y * W + x]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n / 255;
}

/** Кольцо: рамка снаружи прямоугольника шириной с саму зону, за вычетом её. */
function ringDiff(a, b, W, H, rect) {
  const outer = {
    x: rect.x - rect.w / 2,
    y: rect.y - rect.h / 2,
    w: rect.w * 2,
    h: rect.h * 2,
  };
  const x0 = Math.max(0, Math.round((outer.x / FRAME_W) * W));
  const x1 = Math.min(W, Math.round(((outer.x + outer.w) / FRAME_W) * W));
  const y0 = Math.max(0, Math.round((outer.y / FRAME_H) * H));
  const y1 = Math.min(H, Math.round(((outer.y + outer.h) / FRAME_H) * H));
  const ix0 = Math.max(0, Math.round((rect.x / FRAME_W) * W));
  const ix1 = Math.min(W, Math.round(((rect.x + rect.w) / FRAME_W) * W));
  const iy0 = Math.max(0, Math.round((rect.y / FRAME_H) * H));
  const iy1 = Math.min(H, Math.round(((rect.y + rect.h) / FRAME_H) * H));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue;
      sum += Math.abs(a[y * W + x] - b[y * W + x]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n / 255;
}

const sha = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

console.log(
  `прямоугольник: ${rectSource === "proposal" ? "предложение дизайна (где есть)" : "наш контракт"}\n`,
);
console.log("комната/зона        own      фон      отн    кольцо   порог  вердикт");
console.log("------------------- -------- -------- ------ -------- ------ -------");

const results = [];
for (const file of (await frames(dropDir)).sort()) {
  const [, roomId, zoneKey] = path.basename(file, ".jpg").match(/^o-([a-z]+)-([a-z]+)$/u);
  const room = rooms.find((r) => r.id === roomId);
  const zone = room?.zones.find((z) => z.key === zoneKey);
  if (!zone) {
    console.log(`${roomId}/${zoneKey}: такой зоны в контракте нет — пропуск`);
    continue;
  }

  const baseRel = room.base.replace(/^refs-2x\/[a-z]+\//u, "refs/");
  const basePath = path.join(REPO, "design/package", baseRel);
  const base = await grey(basePath);
  const shot = await grey(file, base.w, base.h);

  const id = `${roomId}/${zoneKey}`;
  const rect = (rectSource === "proposal" && proposals[id]) || zone.rect;
  const own = meanDiff(base.data, shot.data, base.w, base.h, rect);
  const others = room.zones.filter((z) => z.key !== zoneKey);
  const bg =
    others.reduce((s, z) => s + meanDiff(base.data, shot.data, base.w, base.h, z.rect), 0) /
    others.length;
  const ring = ringDiff(base.data, shot.data, base.w, base.h, rect);
  const ratio = bg === 0 ? Infinity : own / bg;
  const pass = own >= OWN_MIN && ratio >= RATIO_MIN;
  const ringOk = ring <= RING_MAX;

  results.push({ id, own, bg, ratio, ring, pass, ringOk, rect, baseSha: basePath });
  console.log(
    `${id.padEnd(19)} ${own.toFixed(4).padEnd(8)} ${bg.toFixed(4).padEnd(8)} ` +
      `${ratio.toFixed(2).padEnd(6)} ${ring.toFixed(4).padEnd(8)} ` +
      `${pass ? "прошёл" : "НЕ ПРО"} ${ringOk ? "" : "· КОЛЬЦО ПЛЫВЁТ"}`,
  );
}

const ok = results.filter((r) => r.pass && r.ringOk);
console.log(
  `\nитог: ${ok.length} из ${results.length} прошли порог (own ≥ ${OWN_MIN}, отн ≥ ${RATIO_MIN}, кольцо ≤ ${RING_MAX})`,
);
console.log("Глаза обязательны: порог не ловит подмену предмета и пропажу содержимого.");
