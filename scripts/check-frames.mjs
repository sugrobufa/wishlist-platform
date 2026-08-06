// Приёмка кадров «открыто», когда имена файлов УЖЕ известны.
//
//   node scripts/check-frames.mjs <папка-пакета> [--rects repo|package|<путь>] [--json <файл>]
//   node scripts/check-frames.mjs --self [--json <файл>]
//
// `--self` меряет НАШИ подключённые пары «base ↔ openFrame» прямо из
// design/package/refs — то есть ровно ту пару, которая кроссфейдится на экране.
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
//
// ВТОРАЯ ПРОВЕРКА — КОЛЬЦО (тикет 49)
//
// Порог локальности считает «свою зону» против фона, а фоном служат
// прямоугольники ОСТАЛЬНЫХ зон комнаты, разбросанных по кадру. Если модель
// перерисовала один участок вместе с ближайшей стеной и столешницей, но не
// тронула дальние углы, отношение выходит отличным — и кадр проходит, хотя
// предмет подменён другим (`emerald/jewelry`: вместо шкатулки косметика).
//
// Кольцо меряет расхождение в рамке ВПЛОТНУЮ СНАРУЖИ прямоугольника, шириной
// с саму зону. У честного раскрытия предмет действует внутри своих границ, и
// кольцо почти не меняется; у подмены вместе с предметом переписывается его
// ближайшее окружение, и кольцо плывёт.
//
// Кольцо НЕ ловит пропажу содержимого (`cream/fashion`: половина одежды
// исчезла со штанги) — она целиком внутри прямоугольника. Глаз остаётся
// обязательной частью приёмки, автоматика только сокращает ему работу.

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
const SELF = args.includes("--self");
/** Позиционный аргумент — папка пакета; значения флагов из перебора исключаем. */
const PKG = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--rects" && args[i - 1] !== "--json");

/** Рабочий размер позонного сравнения — как в scripts/name-masters.mjs. */
const CMP_W = 1200, CMP_H = 670;
/** Ниже этого расхождения в своей зоне правка считается не состоявшейся. */
const OWN_MIN = 0.05;
/** Во сколько раз своя зона обязана измениться сильнее фона. */
const RATIO_MIN = 3;
/**
 * Кольцо вокруг зоны: выше этого расхождения раскрытие тащит за собой
 * окружение — верный признак, что предмет переписан, а не открыт.
 *
 * Число выбрано ПО ДАННЫМ: прогон `--self` по всем 30 подключённым парам
 * (тикет 49) дал кольцо от 0.0151 до 0.2560. Самый широкий пустой промежуток
 * распределения — между `cottage/perfume` 0.0826 и `cream/bags` 0.1010
 * (0.018 шириной), 0.09 лежит внутри него. Требование тикета выполняется
 * с большим запасом: `emerald/bags` 0.0236 и `cream/jewelry` 0.0295 проходят,
 * `emerald/jewelry` 0.2560 — нет.
 *
 * ЭТО НЕ ОТКАЗ, А ФЛАГ, и вот почему: выше линии оказались 10 кадров, девять
 * из них глаз опознал как подмену, а десятый — `study/events` 0.1295 — честное
 * раскрытие, у которого действие («билеты выходят из рамки») законно выходит
 * за прямоугольник. Автоматический отказ убил бы единственный кадр, ради
 * которого раунд 7 стоило принимать. Ниже линии, наоборот, спряталось восемь
 * подмен, уместившихся внутрь прямоугольника целиком (`study/sneakers` 0.0152,
 * `gamer/sneakers` 0.0192 — предмет заменён другим, а окружение не тронуто).
 * Поэтому кольцо печатается отдельной колонкой и в `pass` не входит.
 */
const RING_MAX = 0.09;

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

/**
 * Кольцо вокруг зоны: рамка вплотную снаружи прямоугольника, шириной с саму
 * зону (по горизонтали — `w`, по вертикали — `h`), обрезанная краем кадра.
 * Считается средний модуль разности по пикселям кольца, сама зона исключена.
 */
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

/**
 * `--self`: наши подключённые пары «base ↔ openFrame» из design/package/refs.
 * Это ровно та пара, которая кроссфейдится на экране, поэтому здесь и живёт
 * калибровка кольца: числа отчёта относятся к тому, что видит человек.
 */
async function selfMode() {
  const contractPath = path.join(REPO, "design/package/handoff/rooms.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const img = contract.scene.phone.image;
  const REFS = path.join(REPO, "design/package/refs");
  const flat = (ref) => path.join(REFS, path.basename(ref));

  console.log(`пары:   design/package/refs (base ↔ openFrame нашего контракта)`);
  console.log(`порог:  своя ≥ ${OWN_MIN}, отн ≥ ${RATIO_MIN}, кольцо ≤ ${RING_MAX}\n`);

  const report = [];
  for (const room of contract.rooms) {
    const opens = room.zones.filter((z) => z.openFrame);
    if (!opens.length) continue;
    const baseGrey = await grey(flat(room.base));
    const zones = room.zones.map((z) => ({ key: z.key, rect: z.rect }));
    const rows = [];
    for (const zone of opens) {
      const g = await grey(flat(zone.openFrame));
      const per = zones.map((z) => regionDiff(baseGrey, g, z.rect, img) ?? 0);
      const j = zones.findIndex((z) => z.key === zone.key);
      const own = per[j];
      const bg = per.reduce((a, v, k) => (k === j ? a : a + v), 0) / (zones.length - 1);
      const ring = ringDiff(baseGrey, g, zone.rect, img) ?? 0;
      rows.push({
        zone: zone.key, verb: zone.openVerb ?? "",
        own: +own.toFixed(4), bg: +bg.toFixed(4), ratio: +(bg ? own / bg : Infinity).toFixed(2),
        ring: +ring.toFixed(4), ringPass: ring <= RING_MAX,
      });
    }
    console.log(`=== ${room.id} (${room.name}) — базовый ${path.basename(room.base)}`);
    console.log("зона         своя     фон      отн     кольцо   кольцо?  глагол");
    for (const r of rows.sort((a, b) => a.zone.localeCompare(b.zone)))
      console.log(
        `${r.zone.padEnd(11)}  ${String(r.own).padEnd(8)} ${String(r.bg).padEnd(8)} ` +
          `${String(r.ratio).padEnd(7)} ${String(r.ring).padEnd(8)} ${(r.ringPass ? "ок" : "ПЛЫВЁТ").padEnd(8)} ${r.verb}`,
      );
    console.log("");
    report.push({ room: room.id, rows });
  }
  const all = report.flatMap((r) => r.rows.map((x) => ({ ...x, id: `${r.room}/${x.zone}` })));
  const sorted = [...all].sort((a, b) => a.ring - b.ring);
  console.log(`ИТОГО пар: ${all.length}, кольцо проходит ${all.filter((r) => r.ringPass).length}`);
  console.log("кольцо по возрастанию:");
  for (const r of sorted) console.log(`  ${String(r.ring).padEnd(8)} ${r.id}`);
  if (JSON_OUT) {
    await writeFile(JSON_OUT, JSON.stringify({ mode: "self", ringMax: RING_MAX, rows: all }, null, 1));
    console.log(`\nотчёт: ${JSON_OUT}`);
  }
}

async function main() {
  if (SELF) return selfMode();
  if (!PKG) {
    console.error("нужна папка пакета: node scripts/check-frames.mjs <папка> [--rects repo|package|<путь>]");
    console.error("или свои пары:      node scripts/check-frames.mjs --self");
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
      const rect = j >= 0 ? zones[j].rect : null;
      const ring = rect ? (ringDiff(baseGrey, g, rect, img) ?? 0) : 0;
      rows.push({
        zone: o.key, file: o.file,
        own: +own.toFixed(4), bg: +bg.toFixed(4), ratio: +ratio.toFixed(2),
        ring: +ring.toFixed(4), ringPass: ring <= RING_MAX,
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
    console.log("зона         своя     фон      отн     кольцо   вердикт");
    for (const r of rows.sort((a, b) => a.zone.localeCompare(b.zone)))
      console.log(
        `${r.zone.padEnd(11)}  ${String(r.own).padEnd(8)} ${String(r.bg).padEnd(8)} ${String(r.ratio).padEnd(7)} ` +
          `${String(r.ring).padEnd(8)} ${r.why}${r.ringPass ? "" : " + кольцо плывёт"}` +
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
