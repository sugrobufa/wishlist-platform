// Сборка экранных кадров продукта из оригиналов поставщика.
//
//   node scripts/refs-from-masters.mjs <папка-разложенных> [--width 2800] [--write]
//
// На входе — папка, которую делает `scripts/name-masters.mjs` третьим аргументом:
// `<папка>/<комната>/<имя из контракта>.jpg` в оригинальном разрешении (4096…5504 px).
// На выходе — плоские файлы `design/package/refs/<имя>.jpg` шириной 2800 px, те самые,
// что раздаёт `src/app/rooms/[image]/route.ts`.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ШАГ, А НЕ ПРОСТО КОПИРОВАНИЕ
//
// 1. Оригиналы в git класть нельзя: 144 файла по 2.3 МБ — 265 МБ. Продукту столько
//    пикселей не нужно (расчёт — в шапке `design/package/refs/README.md`).
// 2. Перед заменой кадра надо убедиться, что КОМПОЗИЦИЯ не поехала. Прямоугольники
//    зон привязаны к нынешнему кадру; если поставщик перегенерировал сцену вместо
//    правки одного предмета, мебель сдвинется и все 13 хотспотов комнаты станут
//    недействительны. Порог — тот же, что у приёмки кадров: средний модуль разности
//    яркости с нынешним кадром ≤ 0.05 (оба в сером 1200×670).
//
// Комната, не прошедшая порог, пропускается ЦЕЛИКОМ — и базовый кадр, и «открыто»:
// кадр «открыто» имеет смысл только в паре со своим базовым, кроссфейд между чужими
// кадрами — это и есть «вся комната поплыла».
//
// Прямоугольников зон этот скрипт НЕ проецирует: он сравнивает кадры целиком и
// разбирает список файлов по `openFrame`. Смена системы координат раунда 4 его
// поэтому не задевает — позонная арифметика живёт только в `name-masters.mjs`
// (`regionDiff`). Что меняется само собой: принятых зон стало 39 вместо 49,
// значит и файлов скрипт разложит меньше.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const SRC = args.find((a) => !a.startsWith("--")) ?? "";
const WRITE = args.includes("--write");
const WIDTH = Number(args[args.indexOf("--width") + 1]) || 2800;

const REPO = path.resolve(import.meta.dirname, "..");
const REFS = path.join(REPO, "design/package/refs");
const CONTRACT = path.join(REPO, "design/package/handoff/rooms.json");

/** Порог «композиция не поехала»: средний модуль разности яркости с нынешним кадром. */
const COMPOSITION_MAX = 0.05;

/**
 * Комнаты, которым порог прощён ПОИМЁННО (`--allow warm,loft`).
 *
 * Порог — прокси: он охраняет прямоугольники зон, но измеряет кадр целиком.
 * Когда прямоугольники сверены с новым кадром ГЛАЗАМИ и стоят на предметах,
 * прокси больше не нужен — есть прямое наблюдение, которое сильнее.
 *
 * Именной пропуск, а не пониженный порог: снизить число значило бы молча
 * пропускать и то, что никто не смотрел. Здесь же в командной строке видно,
 * за какую комнату человек поручился.
 */
const ALLOW = (args[args.indexOf("--allow") + 1] ?? "").split(",").filter(Boolean);
/** Рабочий размер сравнения — как в scripts/name-masters.mjs. */
const CMP_W = 1200, CMP_H = 670;

/** Путь контракта (`refs-2x/cream/v4-cream.jpg`) → имя файла раздачи (`v4-cream.jpg`). */
const flat = (ref) => path.basename(ref);

// Читаем через буфер: sharp держит открытым дескриптор входного файла, а нынешний
// кадр мы сначала сравниваем, а потом перезаписываем — на Windows открытый
// дескриптор ломает запись («unable to write to target»).
const grey = async (file) =>
  sharp(await readFile(file)).resize(CMP_W, CMP_H, { fit: "fill" }).greyscale().raw().toBuffer();

const l1 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
};

async function main() {
  if (!SRC) {
    console.error("нужна папка с разложенными кадрами (см. scripts/name-masters.mjs)");
    process.exit(2);
  }
  const contract = JSON.parse(await readFile(CONTRACT, "utf8"));
  const rejected = [];
  const written = [];
  let bytes = 0;

  for (const room of contract.rooms) {
    const baseName = flat(room.base);
    const srcBase = path.join(SRC, room.id, baseName);
    const curBase = path.join(REFS, baseName);

    const drift = l1(await grey(curBase), await grey(srcBase));
    const allowed = ALLOW.includes(room.id);
    const passed = drift <= COMPOSITION_MAX || allowed;
    const verdict = drift <= COMPOSITION_MAX
      ? "принят"
      : allowed
        ? "ПРОПУЩЕН ИМЕНЕМ — зоны сверены глазами"
        : "ОТКЛОНЁН — кадры комнаты не берём";
    console.log(
      `${room.id.padEnd(9)} композиция ${drift.toFixed(4)} ${drift <= COMPOSITION_MAX ? "≤" : ">"} ${COMPOSITION_MAX}  ${verdict}`,
    );
    if (!passed) {
      rejected.push({ room: room.id, drift: +drift.toFixed(4) });
      continue;
    }

    const files = [
      { src: srcBase, out: baseName },
      ...room.zones
        .filter((zone) => zone.openFrame)
        .map((zone) => ({ src: path.join(SRC, room.id, flat(zone.openFrame)), out: flat(zone.openFrame) })),
    ];
    for (const file of files) {
      if (WRITE) {
        await sharp(await readFile(file.src))
          .resize({ width: WIDTH })
          .jpeg({ quality: 88, mozjpeg: true })
          .toFile(path.join(REFS, file.out));
      }
      const size = WRITE ? (await stat(path.join(REFS, file.out))).size : 0;
      bytes += size;
      written.push(file.out);
    }
  }

  console.log(
    `\n${WRITE ? "записано" : "СУХОЙ ПРОГОН (без --write) — записалось бы"}: ${written.length} файлов, ` +
      `${WIDTH} px${WRITE ? `, ${(bytes / 1048576).toFixed(1)} МБ` : ""}`,
  );
  if (rejected.length) {
    console.log(`комнаты без кадров: ${rejected.map((r) => `${r.room} (${r.drift})`).join(", ")}`);
    console.log("их зоны обязаны остаться без openFrame — фильтр в src/config/design.ts");
  }
}

void main();
