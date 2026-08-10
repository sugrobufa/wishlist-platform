// Дамп карты зон для дизайна (тикет 154).
//
// ЗАЧЕМ. Устав проекта: прямоугольники зон измеряет РАЗРАБОТКА, дизайн держит
// свою копию. Копия отстаёт — за историю это уже дало десять неверных
// заявлений в его письмах, и все десять оказались не выдумкой, а устаревшим
// снимком нашей карты. Раунд 36 он сверил свой прототип со своим же
// контрактом и нашёл расхождение у 59 зон из 128; двигать прямоугольники
// отказался, пока не получит наш дамп («иначе появится четвёртая карта»).
//
// ПОЧЕМУ СКРИПТОМ, А НЕ РУКАМИ. Дамп придётся отдавать снова после каждой
// переразметки. Собранный руками файл — это ещё одна копия карты, которая
// начнёт отставать в тот же день; собранный командой — просто вид на
// `rooms.json`, и версия в нём честная.
//
// ЧТО ОТДАЁМ, КРОМЕ ПРЯМОУГОЛЬНИКОВ:
// - `objectAbsent` — восемь зон, у которых предмета в кадре нет вовсе. Их
//   нельзя выбирать под места пустой сцены (round36 это уже поправил);
// - `remappedRound` и `rectOld` — история переразметки. Она и есть ответ на
//   вопрос «где разошлось»: если его число совпадает с нашим `rectOld`, его
//   снимок сделан до этого раунда, и спорить не о чем.
//
// Запуск: `node scripts/dump-rooms-map.mjs [путь-вывода]`
// По умолчанию пишет в папку отправки дизайну.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "design", "package", "handoff", "rooms.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

const DATE = "2026-08-10";
const OUT_DEFAULT = path.join(
  "C:",
  "Wishlist",
  "ДЛЯ-ДИЗАЙНЕРА-базы-2800",
  `rooms-map-${DATE}.json`,
);

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
  } catch {
    return "неизвестен (git недоступен)";
  }
})();

const zones = [];
for (const room of contract.rooms) {
  for (const zone of room.zones) {
    const row = {
      room: room.id,
      key: zone.key,
      rect: zone.rect,
    };
    // Только то, что меняет РЕШЕНИЕ на его стороне. Вид, кадры раскрытия и
    // наши заметки приёмки в дамп не идут: это карта, а не весь контракт.
    if (zone.objectAbsent) row.objectAbsent = true;
    if (zone.remappedRound) {
      row.remappedRound = zone.remappedRound;
      if (zone.rectOld) row.rectOld = zone.rectOld;
    }
    zones.push(row);
  }
}

const remapped = zones.filter((z) => z.remappedRound);
const byRound = {};
for (const z of remapped) byRound[z.remappedRound] = (byRound[z.remappedRound] ?? 0) + 1;

const dump = {
  mapSnapshot: {
    version: `dev-${DATE}`,
    date: DATE,
    source: "design/package/handoff/rooms.json — наш контракт, ветка main",
    commit,
    generatedBy: "scripts/dump-rooms-map.mjs",
    note:
      "Прямоугольники измеряет разработка (устав). Это ПОЛНАЯ карта на дату: " +
      "не выборка и не таблица приёмки. Пересчитывать от неё.",
  },
  frame: {
    w: contract.scene?.phone?.image?.w ?? 630,
    h: contract.scene?.phone?.image?.h ?? 351,
    note:
      "Система координат — кадр 630×351 (ADR-0006). Из неё выводятся обе " +
      "раскладки: десктоп x × 1.7778, телефон x − 12 (окно 430 ездит по кадру " +
      "и показывает его с 12 по 442).",
  },
  counts: {
    rooms: contract.rooms.length,
    zones: zones.length,
    objectAbsent: zones.filter((z) => z.objectAbsent).length,
    shownInProduct: zones.length - zones.filter((z) => z.objectAbsent).length,
    remappedSinceRound4: remapped.length,
    remappedByRound: byRound,
  },
  countMismatch: {
    yours: 128,
    ours: zones.length,
    note:
      "У вас 128 «живых зон», у нас 130 — по 13 в каждой из десяти комнат, " +
      "без исключений. Разница в две зоны; какие именно у вас отсутствуют, " +
      "мы отсюда не видим — списка зон в ваших пакетах нет. Историческая " +
      "подсказка: в раунде 21 вы прислали rooms.json эпохи раунда 8, и в нём " +
      "не было ровно двух зон — sport/gaming и loft/gaming. Обе на месте в " +
      "этом дампе (обе с objectAbsent: предмета в интерьере нет, но зона " +
      "существует). Проверьте у себя; если дело не в них — пришлите свои 128 " +
      "ключей списком, разницу назовём за минуту.",
  },
  zones,
};

const out = process.argv[2] ?? OUT_DEFAULT;
writeFileSync(out, `${JSON.stringify(dump, null, 1)}\n`, "utf8");
console.log(
  `дамп карты: ${out}\n` +
    `комнат ${dump.counts.rooms} · зон ${dump.counts.zones} · ` +
    `objectAbsent ${dump.counts.objectAbsent} · переразмечено ${dump.counts.remappedSinceRound4}\n` +
    `снимок ${dump.mapSnapshot.version}, коммит ${commit}`,
);
