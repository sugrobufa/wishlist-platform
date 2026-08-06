// Приёмка ПАРТИИ кадров «открыто» раунда 8: одна комната, плоская папка.
//
//   node scripts/check-batch.mjs <папка-партии> [--base batch|repo]
//                                [--fix <rects-fix.json>] [--json <файл>]
//
// Партия раунда 8 — не пакет: в ней нет handoff/rooms.json, только кадры
// `o-<комната>-<зона>.jpg`, папка `base/` с базовым кадром и masters-*.json.
// `scripts/check-frames.mjs` заточен под полный пакет (читает контракт пакета);
// здесь тот же порог тем же способом, но по файлам партии против НАШЕГО
// контракта. Метрики — regionDiff, ringDiff, l1, guessBase — скопированы из
// check-frames.mjs дословно: числа приёмки обязаны совпадать до знака.
//
// ЧТО РЕШАЕТ --base (урок пробника раунда 8, design/ANSWERS-probe-round8.md):
//   batch (по умолчанию) — базовый кадр из папки партии `base/`. Это оценка
//     РАБОТЫ дизайна: он правил свой файл, против него и порог.
//   repo — базовый кадр продукта. Это то, что человек увидит в кроссфейде,
//     если базу партии мы не принимаем.
// Скрипт ВСЕГДА печатает сверку двух баз: sha256 и l1. Совпали байт в байт —
// глобального сдвига нет по построению; разошлись — сдвиг измерен числом, и
// решение о базе принимает приёмка, а не скрипт.
//
// --fix применяет прямоугольники из design/rects-fix.json (формат файла
// тикета 47) ПОВЕРХ контрактных — только для зон этой комнаты и только те,
// что дизайн подтвердил словами («восемь да», ОТВЕТ-раунд-8). Применённые
// печатаются: порог обязан считаться против той разметки, против которой
// зону будут показывать.
//
// Порог и кольцо — те же, что везде: своя ≥ 0.05, отношение ≥ 3, кольцо
// ≤ 0.09 как ФЛАГ (не отказ — обоснование в check-frames.mjs у RING_MAX).
// Глаза остаются обязательной частью приёмки: пропажу содержимого и подмену
// внутри прямоугольника ни порог, ни кольцо не ловят по построению.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REPO = path.resolve(import.meta.dirname, "..");
const BASE_ARG = arg("--base", "batch");
const FIX_ARG = arg("--fix", null);
const JSON_OUT = arg("--json", null);
const BATCH = args.find(
  (a, i) => !a.startsWith("--") && !["--base", "--fix", "--json"].includes(args[i - 1]),
);

/** Рабочий размер позонного сравнения — как в scripts/check-frames.mjs. */
const CMP_W = 1200, CMP_H = 670;
/** Ниже этого расхождения в своей зоне правка считается не состоявшейся. */
const OWN_MIN = 0.05;
/** Во сколько раз своя зона обязана измениться сильнее фона. */
const RATIO_MIN = 3;
/** Кольцо: флаг «раскрытие тащит окружение». Обоснование — check-frames.mjs. */
const RING_MAX = 0.09;

const grey = async (file) =>
  sharp(await readFile(file)).resize(CMP_W, CMP_H, { fit: "fill" }).greyscale().raw().toBuffer();

function regionDiff(a, b, rect, img) {
  const S = CMP_W / img.w;
  const x0 = Math.max(0, Math.round(rect.x * S));
  const y0 = Math.max(0, Math.round(rect.y * S));
  const x1 = Math.min(CMP_W, Math.round((rect.x + rect.w) * S));
  const y1 = Math.min(CMP_H, Math.round((rect.y + rect.h) * S));
  if (x1 <= x0 || y1 <= y0) return null;
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) { const i = y * CMP_W + x; s += Math.abs(a[i] - b[i]); n++; }
  return s / n / 255;
}

function ringDiff(a, b, rect, img) {
  const S = CMP_W / img.w;
  const px = (v) => Math.round(v * S);
  const ix0 = Math.max(0, px(rect.x)), iy0 = Math.max(0, px(rect.y));
  const ix1 = Math.min(CMP_W, px(rect.x + rect.w)), iy1 = Math.min(CMP_H, px(rect.y + rect.h));
  const ox0 = Math.max(0, px(rect.x - rect.w)), oy0 = Math.max(0, px(rect.y - rect.h));
  const ox1 = Math.min(CMP_W, px(rect.x + 2 * rect.w)), oy1 = Math.min(CMP_H, px(rect.y + 2 * rect.h));
  let s = 0, n = 0;
  for (let y = oy0; y < oy1; y++) {
    const insideY = y >= iy0 && y < iy1;
    for (let x = ox0; x < ox1; x++) {
      if (insideY && x >= ix0 && x < ix1) { x = ix1 - 1; continue; }
      const i = y * CMP_W + x;
      s += Math.abs(a[i] - b[i]);
      n++;
    }
  }
  return n ? s / n / 255 : null;
}

const l1 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
};

/** Базовый кадр пачки по попиксельной медиане — НЕЗАВИСИМАЯ сверка, не истина. */
function guessBase(files, greys, zones, img) {
  const median = Buffer.alloc(CMP_W * CMP_H);
  const column = new Array(files.length);
  for (let i = 0; i < CMP_W * CMP_H; i++) {
    for (let k = 0; k < files.length; k++) column[k] = greys.get(files[k])[i];
    column.sort((x, y) => x - y);
    median[i] = column[column.length >> 1];
  }
  let best = null;
  for (const f of files) {
    const peak = Math.max(...zones.map((z) => regionDiff(median, greys.get(f), z.rect, img) ?? 0));
    if (!best || peak < best.peak) best = { file: f, peak };
  }
  return best;
}

async function main() {
  if (!BATCH) {
    console.error("нужна папка партии: node scripts/check-batch.mjs <папка> [--base batch|repo] [--fix <файл>]");
    process.exit(2);
  }

  const contract = JSON.parse(
    await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
  );
  const zoneKeys = new Set(
    Object.keys(
      JSON.parse(await readFile(path.join(REPO, "design/package/handoff/zones.json"), "utf8")).keys,
    ),
  );
  const img = contract.scene.phone.image;

  // --- комната — из имён файлов партии, все обязаны сойтись -----------------
  const onDisk = (await readdir(BATCH)).filter((f) => /^o-.+\.(jpg|jpeg|png|webp)$/i.test(f));
  const parsed = onDisk.map((f) => {
    const m = f.match(/^o-([a-z]+)-([a-z]+)\.\w+$/i);
    return m ? { file: f, room: m[1], zone: m[2] } : { file: f, room: null, zone: null };
  });
  const badNames = parsed.filter((p) => !p.room);
  if (badNames.length) {
    console.error(`имена вне схемы o-<комната>-<зона>: ${badNames.map((p) => p.file).join(", ")}`);
    process.exit(2);
  }
  const roomIds = [...new Set(parsed.map((p) => p.room))];
  if (roomIds.length !== 1) {
    console.error(`в партии кадры разных комнат: ${roomIds.join(", ")} — партия это одна комната`);
    process.exit(2);
  }
  const room = contract.rooms.find((r) => r.id === roomIds[0]);
  if (!room) {
    console.error(`комнаты ${roomIds[0]} нет в контракте`);
    process.exit(2);
  }
  const unknownZones = parsed.filter((p) => !zoneKeys.has(p.zone));
  if (unknownZones.length) {
    console.error(`зоны вне справочника: ${unknownZones.map((p) => p.file).join(", ")}`);
    process.exit(2);
  }

  // --- две базы: партии и продукта; sha256 + l1 всегда ----------------------
  const baseName = path.basename(room.base);
  const batchBasePath = path.join(BATCH, "base", baseName);
  const repoBasePath = path.join(REPO, "design/package/refs", baseName);
  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  let batchBaseRaw = null;
  try {
    batchBaseRaw = await readFile(batchBasePath);
  } catch {
    batchBaseRaw = null;
  }
  const repoBaseRaw = await readFile(repoBasePath);
  const repoSha = sha(repoBaseRaw);
  const batchSha = batchBaseRaw ? sha(batchBaseRaw) : null;
  const identical = batchSha === repoSha;
  const baseDrift =
    batchBaseRaw === null ? null : identical ? 0 : l1(await grey(batchBasePath), await grey(repoBasePath));

  if (BASE_ARG === "batch" && !batchBaseRaw) {
    console.error(`в партии нет base/${baseName}, а выбран --base batch`);
    process.exit(2);
  }
  const basePath = BASE_ARG === "batch" ? batchBasePath : repoBasePath;

  // --- прямоугольники: контракт + подтверждённые правки из --fix ------------
  const zones = room.zones
    .filter((z) => zoneKeys.has(z.key))
    .map((z) => ({ key: z.key, rect: z.rect }));
  const applied = [];
  if (FIX_ARG) {
    const fix = JSON.parse(await readFile(path.resolve(FIX_ARG), "utf8"));
    for (const f of fix.zones ?? []) {
      if (f.room !== room.id) continue;
      const target = zones.find((z) => z.key === f.key);
      if (!target) continue;
      applied.push(`${f.room}/${f.key}: ${JSON.stringify(target.rect)} → ${JSON.stringify(f.rect)}`);
      target.rect = f.rect;
    }
  }

  console.log(`партия:  ${BATCH}`);
  console.log(`комната: ${room.id} (${room.name}), кадров «открыто»: ${parsed.length}`);
  console.log(`база продукта: sha256 ${repoSha.slice(0, 16)}…  (${repoBaseRaw.length} байт)`);
  console.log(
    batchBaseRaw
      ? `база партии:   sha256 ${batchSha.slice(0, 16)}…  (${batchBaseRaw.length} байт) — ` +
          (identical ? "БАЙТ В БАЙТ НАША" : `НЕ наш файл, l1 к нашей ${baseDrift.toFixed(4)}`)
      : `базы в партии НЕТ (base/${baseName} отсутствует)`,
  );
  console.log(`порог меряется против базы: ${BASE_ARG === "batch" ? "ПАРТИИ" : "ПРОДУКТА"}`);
  if (applied.length) console.log(`правки разметки из ${FIX_ARG}:\n  ${applied.join("\n  ")}`);
  console.log(`порог: своя ≥ ${OWN_MIN}, отн ≥ ${RATIO_MIN}, кольцо ≤ ${RING_MAX} (флаг)\n`);

  const baseGrey = await grey(basePath);
  const greys = new Map();
  const sizes = new Map();
  for (const p of parsed) {
    const full = path.join(BATCH, p.file);
    greys.set(p.file, await grey(full));
    sizes.set(p.file, await sharp(await readFile(full)).metadata());
  }

  // --- независимая сверка: медиана пачки против имени базового кадра --------
  const greysWithBase = new Map(greys);
  greysWithBase.set(baseName, baseGrey);
  const guess = guessBase([baseName, ...parsed.map((p) => p.file)], greysWithBase, zones, img);

  const rows = [];
  for (const p of parsed) {
    const g = greys.get(p.file);
    const per = zones.map((z) => regionDiff(baseGrey, g, z.rect, img) ?? 0);
    const j = zones.findIndex((z) => z.key === p.zone);
    const own = j >= 0 ? per[j] : 0;
    const bg = per.reduce((a, v, k) => (k === j ? a : a + v), 0) / (zones.length - 1);
    const ratio = bg ? own / bg : Infinity;
    const top = zones[per.indexOf(Math.max(...per))].key;
    const ring = j >= 0 ? (ringDiff(baseGrey, g, zones[j].rect, img) ?? 0) : 0;
    const meta = sizes.get(p.file);
    rows.push({
      zone: p.zone, file: p.file, width: meta.width, height: meta.height,
      own: +own.toFixed(4), bg: +bg.toFixed(4), ratio: +ratio.toFixed(2),
      ring: +ring.toFixed(4), ringPass: ring <= RING_MAX,
      pass: own >= OWN_MIN && ratio >= RATIO_MIN,
      why: own < OWN_MIN ? "ЗОНА НЕ ИЗМЕНИЛАСЬ" : ratio < RATIO_MIN ? "фон плывёт" : "ок",
      top, topIsOwn: top === p.zone,
    });
  }

  console.log("зона         своя     фон      отн     кольцо   размер     вердикт");
  for (const r of rows.sort((a, b) => a.zone.localeCompare(b.zone)))
    console.log(
      `${r.zone.padEnd(11)}  ${String(r.own).padEnd(8)} ${String(r.bg).padEnd(8)} ${String(r.ratio).padEnd(7)} ` +
        `${String(r.ring).padEnd(8)} ${`${r.width}×${r.height}`.padEnd(10)} ` +
        `${r.why}${r.ringPass ? "" : " + кольцо плывёт"}` +
        (r.topIsOwn ? "" : `  (сильнее всего дрогнула ${r.top})`),
    );

  const passed = rows.filter((r) => r.pass);
  console.log(`\nИТОГО: порог прошло ${passed.length} из ${rows.length}`);
  console.log(
    `сверка медианой: ${guess.file === baseName ? "совпала с именем базового кадра" : `РАСХОЖДЕНИЕ, медиана указывает на ${guess.file}`}`,
  );
  const missing = room.zones.filter(
    (z) => zoneKeys.has(z.key) && !parsed.some((p) => p.zone === z.key),
  );
  if (missing.length) console.log(`зон комнаты без кадра в партии: ${missing.map((z) => z.key).join(", ")}`);

  if (JSON_OUT) {
    await writeFile(
      JSON_OUT,
      JSON.stringify(
        {
          batch: BATCH, room: room.id, baseUsed: BASE_ARG,
          base: { repoSha, batchSha, identical, l1: baseDrift },
          rectFixesApplied: applied, ownMin: OWN_MIN, ratioMin: RATIO_MIN, ringMax: RING_MAX,
          rows,
        },
        null,
        1,
      ),
    );
    console.log(`отчёт: ${JSON_OUT}`);
  }
}

void main();
