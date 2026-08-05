// Приёмка кадров «открыто», когда имена файлов УЖЕ известны.
//
//   node scripts/check-frames.mjs <папка-пакета> [--rects repo|package|<путь>] [--json <файл>]
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ name-masters.mjs
//
// `name-masters.mjs` решает две задачи сразу: восстанавливает имена (у поставщика
// файлы названы UUID задания) и тем же проходом меряет локальность правки. Ради
// первой задачи там живёт вся тяжёлая машинерия — отпечатки комнат, попиксельная
// медиана пачки, венгерский алгоритм. Каждая из них — ДОГАДКА, и в раунде 5
// догадка о базовом кадре стоила двух зря отклонённых комнат («Тихая роскошь» и
// «Лофт»: за базу был принят кадр «открыто»).
//
// Здесь догадки не нужны и потому запрещены:
//
//   * комната — это имя ПАПКИ `refs-2x/<комната>/`;
//   * базовый кадр — файл, названный в контракте полем `room.base`;
//   * зона — суффикс имени `o-<комната>-<зона>.jpg`, сверенный с ключами зон.
//
// Скрипт проверяет, что имена сходятся с контрактом, и отказывается работать,
// если в папке лишний файл или базовый кадр не найден. Догадка о базовом кадре
// (минимум расхождения с попиксельной медианой пачки) остаётся, но только как
// НЕЗАВИСИМАЯ СВЕРКА: её несогласие печатается предупреждением и ни на что не
// влияет. Раунд 5 показал, что верить надо имени, а не догадке.
//
// ПРОТИВ КАКИХ ПРЯМОУГОЛЬНИКОВ МЕРЯТЬ
//
// По умолчанию — против НАШЕГО контракта (`design/package/handoff/rooms.json`):
// продукт наезжает камерой на его прямоугольники, значит и раскрытие должно
// случаться внутри них. `--rects package` меряет против прямоугольников пакета —
// это отдельный вопрос «попал ли дизайн в СВОЙ прямоугольник», полезно, когда
// числа расходятся и надо понять, чья разметка виновата.
//
// С КАКИМ БАЗОВЫМ КАДРОМ СРАВНИВАТЬ
//
// `--base package` (по умолчанию) — базовый кадр из пакета. Это оценка РАБОТЫ
// дизайна: он правил свой кадр, с ним и сверяем.
//
// `--base repo` — базовый кадр, который лежит в продукте. Это оценка того, что
// человек увидит, если мы подключим кадр «открыто», не трогая базовый: кроссфейд
// идёт именно между этой парой. Числа расходятся, когда базовые кадры пакета и
// продукта не совпадают до пикселя, — а они не совпадают.
//
// Порог — из handoff/reshoot-recipe.md, он же в name-masters.mjs:
// расхождение в своей зоне ≥ 0.05 и ≥ 3× относительно фона.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REPO = path.resolve(import.meta.dirname, "..");
const RECTS_ARG = arg("--rects", "repo");
const BASE_ARG = arg("--base", "package");
const JSON_OUT = arg("--json", null);
/** Позиционный аргумент — папка пакета; значения флагов из перебора исключаем. */
const PKG = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--rects" && args[i - 1] !== "--json");

/** Рабочий размер позонного сравнения — как в scripts/name-masters.mjs. */
const CMP_W = 1200, CMP_H = 670;
/** Ниже этого расхождения в своей зоне правка считается не состоявшейся. */
const OWN_MIN = 0.05;
/** Во сколько раз своя зона обязана измениться сильнее фона. */
const RATIO_MIN = 3;

// Читаем через буфер: sharp иначе держит дескриптор открытым, а на Windows это
// мешает последующей записи в тот же файл (та же оговорка в refs-from-masters).
const grey = async (file) =>
  sharp(await readFile(file)).resize(CMP_W, CMP_H, { fit: "fill" }).greyscale().raw().toBuffer();

/**
 * Прямоугольник зоны → пиксели рабочего кадра CMP_W×CMP_H.
 *
 * Разметка живёт в координатах САМОГО КАДРА 630×351 (ADR-0006), поэтому перевод —
 * один множитель `CMP_W / img.w`. Слагаемого `−img.x` (то есть `+12`) здесь нет и
 * быть не должно: оно переводило прежнюю разметку из координат окна 430 в кадр.
 * Вернуть его — значит мерить порог на участке 12 px правее предмета.
 */
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

/** Средний модуль разности по всему кадру — им же меряется «композиция поехала». */
const l1 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
};

/** Базовый кадр пачки по попиксельной медиане — НЕЗАВИСИМАЯ сверка имени, не источник истины. */
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
  if (!PKG) {
    console.error("нужна папка пакета: node scripts/check-frames.mjs <папка> [--rects repo|package|<путь>]");
    process.exit(2);
  }

  const pkgContractPath = path.join(PKG, "handoff/rooms.json");
  const pkgContract = JSON.parse(await readFile(pkgContractPath, "utf8"));

  const rectsPath =
    RECTS_ARG === "repo" ? path.join(REPO, "design/package/handoff/rooms.json")
    : RECTS_ARG === "package" ? pkgContractPath
    : path.resolve(RECTS_ARG);
  const rectsContract = JSON.parse(await readFile(rectsPath, "utf8"));

  const img = rectsContract.scene.phone.image;
  const zoneKeys = new Set(
    Object.keys(JSON.parse(await readFile(path.join(path.dirname(rectsPath), "zones.json"), "utf8")).keys),
  );
  const rectOf = new Map();
  for (const room of rectsContract.rooms)
    for (const zone of room.zones) rectOf.set(`${room.id}/${zone.key}`, zone.rect);

  console.log(`пакет:          ${PKG}`);
  console.log(`прямоугольники: ${rectsPath}`);
  console.log(`базовый кадр:   ${BASE_ARG === "repo" ? "из продукта (design/package/refs)" : "из пакета"}`);
  console.log(`порог:          своя зона ≥ ${OWN_MIN}, отношение к фону ≥ ${RATIO_MIN}\n`);

  const report = [];
  /** Настоящие поломки: файла нет, лишний файл, базовый кадр не найден по имени. */
  let problems = 0;
  /** Медиана не согласилась с именем. НЕ поломка — см. итог. */
  let guessDisagreed = 0;

  for (const room of pkgContract.rooms) {
    const dir = path.join(PKG, path.dirname(room.base));
    const baseName = path.basename(room.base);

    // --- имена: базовый кадр берётся из контракта, раскрытия — по схеме -----
    const onDisk = (await readdir(dir)).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (!onDisk.includes(baseName)) {
      console.log(`${room.id}: базового кадра ${baseName} в ${dir} нет — комната пропущена`);
      problems++;
      continue;
    }
    const opens = room.zones
      .filter((z) => z.openFrame && zoneKeys.has(z.key))
      .map((z) => ({ key: z.key, file: path.basename(z.openFrame) }));

    const expected = new Set([baseName, ...opens.map((o) => o.file)]);
    const extra = onDisk.filter((f) => !expected.has(f));
    const missing = opens.filter((o) => !onDisk.includes(o.file)).map((o) => o.file);
    if (extra.length) console.log(`${room.id}: ЛИШНИЕ файлы в папке: ${extra.join(", ")}`);
    if (missing.length) console.log(`${room.id}: НЕТ файлов: ${missing.join(", ")}`);
    problems += extra.length + missing.length;

    const present = opens.filter((o) => onDisk.includes(o.file));
    const greys = new Map();
    greys.set(baseName, await grey(path.join(dir, baseName)));
    for (const o of present) greys.set(o.file, await grey(path.join(dir, o.file)));

    // Зоны комнаты в той разметке, против которой меряем.
    const zones = room.zones
      .filter((z) => zoneKeys.has(z.key) && rectOf.has(`${room.id}/${z.key}`))
      .map((z) => ({ key: z.key, rect: rectOf.get(`${room.id}/${z.key}`) }));

    // --- независимая сверка имени базового кадра ---------------------------
    const guess = guessBase([baseName, ...present.map((o) => o.file)], greys, zones, img);
    const guessOk = guess.file === baseName;
    if (!guessOk) guessDisagreed++;

    // --- композиция: базовый кадр пакета против нынешнего кадра продукта ----
    let drift = null;
    try {
      drift = l1(greys.get(baseName), await grey(path.join(REPO, "design/package/refs", baseName)));
    } catch {
      drift = null;
    }

    const baseGrey =
      BASE_ARG === "repo"
        ? await grey(path.join(REPO, "design/package/refs", baseName))
        : greys.get(baseName);
    const rows = [];
    for (const o of present) {
      const g = greys.get(o.file);
      const per = zones.map((z) => regionDiff(baseGrey, g, z.rect, img) ?? 0);
      const j = zones.findIndex((z) => z.key === o.key);
      const own = j >= 0 ? per[j] : 0;
      const bg = per.reduce((a, v, k) => (k === j ? a : a + v), 0) / (zones.length - 1);
      const ratio = bg ? own / bg : Infinity;
      const top = zones[per.indexOf(Math.max(...per))].key;
      rows.push({
        zone: o.key, file: o.file,
        own: +own.toFixed(4), bg: +bg.toFixed(4), ratio: +ratio.toFixed(2),
        pass: own >= OWN_MIN && ratio >= RATIO_MIN,
        why: own < OWN_MIN ? "ЗОНА НЕ ИЗМЕНИЛАСЬ" : ratio < RATIO_MIN ? "фон плывёт" : "ок",
        top, topIsOwn: top === o.key,
      });
    }

    const ok = rows.filter((r) => r.pass).length;
    console.log(
      `\n=== ${room.id} (${room.name}) — базовый ${baseName}` +
        `  · сверка медианой: ${guessOk ? "совпала" : `РАСХОЖДЕНИЕ, медиана указывает на ${guess.file}`}` +
        (drift === null ? "" : `  · композиция против продукта ${drift.toFixed(4)}`),
    );
    console.log("зона         своя     фон      отн     вердикт");
    for (const r of rows.sort((a, b) => a.zone.localeCompare(b.zone)))
      console.log(
        `${r.zone.padEnd(11)}  ${String(r.own).padEnd(8)} ${String(r.bg).padEnd(8)} ${String(r.ratio).padEnd(7)} ${r.why}` +
          (r.topIsOwn ? "" : `  (сильнее всего дрогнула ${r.top})`),
      );
    console.log(`  прошло ${ok} из ${rows.length}`);

    report.push({ room: room.id, name: room.name, base: baseName, baseByName: true, guessAgrees: guessOk, guessedBase: guess.file, compositionDrift: drift === null ? null : +drift.toFixed(4), rows });
  }

  const flat = report.flatMap((r) => r.rows);
  const passed = flat.filter((r) => r.pass);
  console.log(`\nИТОГО: прошло порог ${passed.length} из ${flat.length}`);
  console.log("сводка по комнатам:");
  for (const r of report)
    console.log(`  ${r.room.padEnd(9)} ${String(r.rows.filter((x) => x.pass).length).padStart(2)} / ${r.rows.length}`);
  if (problems) console.log(`\nПОЛОМКА: ${problems} несоответствий имён файлов — см. выше`);
  if (guessDisagreed) {
    // Не повод не верить имени: медиана пачки опознаёт базовый кадр только
    // тогда, когда правки локальны. Если почти каждый «открыто» перерисован
    // целиком, медиана ближе к случайному «открыто», чем к базовому. Ровно на
    // этом в раунде 5 зря отклонили две комнаты — поэтому здесь она только
    // сверка. Само число полезно: оно и есть мера «правки не локальны».
    console.log(
      `\nсверка медианой разошлась с именем в ${guessDisagreed} комнатах из ${report.length} — ` +
        "ожидаемо, если правки не локальны; имя сильнее догадки",
    );
  }

  if (JSON_OUT) {
    await writeFile(JSON_OUT, JSON.stringify({ package: PKG, rects: rectsPath, ownMin: OWN_MIN, ratioMin: RATIO_MIN, report }, null, 1));
    console.log(`\nотчёт: ${JSON_OUT}`);
  }
}

void main();
