// Восстановить имена скачанных кадров по СОДЕРЖИМОМУ и заодно проверить их.
//
// ЗАЧЕМ. У поставщика файл называется UUID задания, поэтому ссылки в
// masters.json безымянные. Процедура дизайна (handoff/upscale.md) предлагает
// сопоставлять с локальными кадрами 2400 px — но их нам не отдали. Зато в
// репозитории есть базовые кадры всех десяти комнат, и этого достаточно:
//
//   1. комната — по ближайшему базовому кадру (комнаты не похожи друг на друга);
//   2. базовый кадр комнаты — тот, что ближе всех к остальным своей пачки:
//      каждый «открыто» отличается от базового в одном месте, поэтому базовый
//      лежит в центре пачки, а любой «открыто» — на её краю;
//   3. зона — прямоугольник, где расхождение с базовым максимально.
//
// Шаг 3 — это и есть проверка приёмки: если правка кадра НЕ локальна, зона не
// определяется, и это ровно тот брак, который надо увидеть до подключения.
//
//   node scripts/name-masters.mjs <папка-скачанного> <handoff/rooms.json> [<куда-разложить>]
//
// Без третьего аргумента только печатает отчёт и ничего не двигает.

import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [, , SRC = "C:/Wishlist/masters-4k", ROOMS = "C:/Wishlist/4к/handoff/rooms.json", DEST] =
  process.argv;

/** Отпечаток для узнавания комнаты: мелкая сетка яркости, дешёвая и устойчивая. */
const FP_W = 32, FP_H = 18;
/** Рабочий размер для позонного сравнения: детали не нужны, важна геометрия. */
const CMP_W = 1200, CMP_H = 670;
/** Ниже этого расхождения в своей зоне правка считается не состоявшейся. */
const OWN_MIN = 0.05;
/** Во сколько раз своя зона обязана измениться сильнее фона. */
const RATIO_MIN = 3;

const grey = (file, w, h) =>
  sharp(file).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer();

const l1 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

function regionDiff(a, b, rect, img) {
  const S = CMP_W / img.w;
  const x0 = Math.max(0, Math.round((rect.x - img.x) * S));
  const y0 = Math.max(0, Math.round((rect.y - img.y) * S));
  const x1 = Math.min(CMP_W, Math.round((rect.x - img.x + rect.w) * S));
  const y1 = Math.min(CMP_H, Math.round((rect.y - img.y + rect.h) * S));
  if (x1 <= x0 || y1 <= y0) return null;
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) { const i = y * CMP_W + x; s += Math.abs(a[i] - b[i]); n++; }
  return s / n / 255;
}

/**
 * Венгерский алгоритм: раздать строкам столбцы один-к-одному так, чтобы сумма
 * стоимостей была минимальной (стоимость = минус уверенность). Классическая
 * реализация с потенциалами, O(n³) — на матрице 13×13 это мгновенно.
 * Строк может быть больше столбцов: лишние остаются без пары (вернут −1).
 */
function hungarian(cost) {
  const n = cost.length, m = cost[0]?.length ?? 0;
  if (!n || !m) return new Array(n).fill(-1);
  const INF = Infinity;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      if (!Number.isFinite(delta)) break;
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    while (j0) { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; }
  }

  const result = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result;
}

async function main() {
  const contract = JSON.parse(await readFile(ROOMS, "utf8"));
  const img = contract.scene.phone.image;
  const zoneKeys = new Set(
    Object.keys(JSON.parse(await readFile(path.join(path.dirname(ROOMS), "zones.json"), "utf8")).keys),
  );

  const files = (await readdir(SRC)).filter((f) => /^master-\d+\.jpg$/.test(f)).sort();
  console.log(`кадров на диске: ${files.length}\n`);

  // --- шаг 1: комната по ближайшему базовому кадру репозитория --------------
  const refs = {};
  for (const room of contract.rooms) {
    const local = `design/package/refs/${path.basename(room.base)}`;
    refs[room.id] = { fp: await grey(local, FP_W, FP_H), local, room };
  }

  const bucket = {};
  for (const f of files) {
    const fp = await grey(path.join(SRC, f), FP_W, FP_H);
    let best = null;
    for (const [id, r] of Object.entries(refs)) {
      const d = l1(fp, r.fp);
      if (!best || d < best.d) best = { id, d };
    }
    (bucket[best.id] ??= []).push({ file: f, dist: +best.d.toFixed(2) });
  }
  console.log("по комнатам:", Object.entries(bucket).map(([k, v]) => `${k}:${v.length}`).join("  "), "\n");

  // --- шаг 2 и 3: базовый кадр пачки и зона каждого «открыто» ---------------
  const report = [];
  for (const room of contract.rooms) {
    const pack = bucket[room.id] ?? [];
    if (!pack.length) { console.log(`${room.id}: пусто`); continue; }

    const greys = new Map();
    for (const p of pack) greys.set(p.file, await grey(path.join(SRC, p.file), CMP_W, CMP_H));

    // базовый — минимальная сумма расстояний до остальных
    let base = null;
    for (const p of pack) {
      let sum = 0;
      for (const q of pack) if (q !== p) sum += l1(greys.get(p.file), greys.get(q.file));
      if (!base || sum < base.sum) base = { file: p.file, sum };
    }
    const baseGrey = greys.get(base.file);
    const zones = room.zones.filter((z) => zoneKeys.has(z.key));

    const opens = pack.filter((p) => p.file !== base.file);

    // Матрица «кадр × зона». Сырое расхождение сравнивать между зонами нельзя:
    // крупная и фактурная зона (полка с флаконами) шевелится сильнее мелкой
    // и гладкой на ЛЮБОЙ правке. Поэтому каждый столбец делим на его же
    // среднее по комнате — остаётся «насколько эта зона выделяется именно
    // здесь», а не «насколько она вообще шумная».
    const raw = opens.map((p) => zones.map((z) => regionDiff(baseGrey, greys.get(p.file), z.rect, img) ?? 0));
    const colMean = zones.map((_, j) => raw.reduce((a, r) => a + r[j], 0) / raw.length || 1e-9);
    const norm = raw.map((r) => r.map((v, j) => v / colMean[j]));

    // Назначение один-к-одному, максимизирующее сумму. Жадный выбор «каждому
    // кадру его лучшую зону» даёт восемь претендентов на один «Парфюм»;
    // венгерский алгоритм раздаёт зоны так, чтобы суммарная уверенность была
    // наибольшей, и второй претендент уходит к своей настоящей зоне.
    const assign = hungarian(norm.map((r) => r.map((v) => -v)));

    const rows = opens.map((p, i) => {
      const j = assign[i];
      const zone = j >= 0 ? zones[j].key : null;
      const own = j >= 0 ? raw[i][j] : 0;
      const others = raw[i].reduce((a, v, k) => (k === j ? a : a + v), 0) / (zones.length - 1);
      const sorted = [...raw[i].keys()].sort((a, b) => raw[i][b] - raw[i][a]);
      return {
        file: p.file, zone,
        own: +own.toFixed(4), bg: +others.toFixed(4),
        ratio: others ? +(own / others).toFixed(2) : Infinity,
        top: zones[sorted[0]].key, forced: j >= 0 && sorted[0] !== j,
      };
    });

    const byZone = new Map(rows.filter((r) => r.zone).map((r) => [r.zone, r]));

    console.log(`\n=== ${room.id} (${room.name}) — базовый ${base.file}`);
    console.log("файл          зона        своя     фон      отн    вердикт");
    for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
      const bad = !r.zone ? "лишний" : r.own < OWN_MIN ? "ЗОНА НЕ ИЗМЕНИЛАСЬ" : r.ratio < RATIO_MIN ? "фон плывёт" : "ок";
      console.log(
        `${r.file}  ${String(r.zone).padEnd(11)} ${String(r.own).padEnd(8)} ${String(r.bg).padEnd(8)} ${String(r.ratio).padEnd(6)} ${bad}` +
          (r.forced ? `  (сильнее всего дрогнула ${r.top})` : ""),
      );
    }
    const missing = zones.map((z) => z.key).filter((k) => !byZone.has(k));
    if (missing.length) console.log(`  без кадра: ${missing.join(", ")}`);
    report.push({ room: room.id, base: base.file, rows, missing });

    // --- раскладка по именам, если попросили ------------------------------
    if (DEST) {
      const dir = path.join(DEST, room.id);
      await mkdir(dir, { recursive: true });
      await copyFile(path.join(SRC, base.file), path.join(dir, path.basename(room.base)));
      for (const [zone, r] of byZone) {
        await copyFile(path.join(SRC, r.file), path.join(dir, `o-${room.id}-${zone}.jpg`));
      }
    }
  }

  const flat = report.flatMap((r) => r.rows.filter((x) => x.zone));
  const ok = flat.filter((r) => r.own >= OWN_MIN && r.ratio >= RATIO_MIN).length;
  console.log(`\nИТОГО: прошло порог ${ok} из ${flat.length}`);
  console.log(`порог: своя зона ≥ ${OWN_MIN}, отношение к фону ≥ ${RATIO_MIN}`);
  await writeFile(path.join(SRC, "audit.json"), JSON.stringify(report, null, 1));
  console.log(`отчёт: ${path.join(SRC, "audit.json")}`);
}

void main();
