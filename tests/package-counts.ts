// СЧЁТ ПО ФАЙЛУ — ДВИЖОК ВТОРОГО СТОРОЖА (тикет 240).
//
// Правило дизайна, записанное им самим после третьего промаха за четыре пакета:
// **«если число не посчитано по файлу, оно не пишется — ни в контракт, ни в
// README, ни в письмо»**. Здесь это правило и живёт машиной.
//
// ЧЕГО ЗДЕСЬ НЕТ НАРОЧНО. Сторож НЕ проверяет каждое число прозы: «пять
// экранов» и «два довода» машине не сосчитать, а сторож, ловящий лишнее,
// начинают обходить формулировкой. Считается ровно то, что ПРИВЯЗАНО к имени —
// к файлу, к разделу словаря, к маске ключей или к названной величине карты.
// Про остальное сторож молчит, и это не слабость: «один пойманный случай
// окупает сторожа» (тикет 240).
//
// ПОЧЕМУ ЧИСЛА СЛОВАМИ ТОЖЕ. Половина промахов написана прописью: «шесть строк
// плоско», «четырнадцать строк плоско». Регексп на `\d+` проверял бы пустоту в
// самом дорогом месте.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rooms } from "../src/config/design";
import {
  emptyPlaces,
  placeWholeInBand,
  PLACE_BAND_PHONE_REST,
} from "../src/components/scene/empty-places";
import { HANDOFF, jsonFilesIn, textOf, type Prose } from "./package-prose";

/** Числительные прописью — ровно те, которыми пакет пишет состав. */
const WORD_NUMBER: Readonly<Record<string, number>> = {
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
};

/** Длинные раньше коротких: иначе «четыре» съело бы «четырнадцать». */
const WORDS = Object.keys(WORD_NUMBER).sort((a, b) => b.length - a.length);
const EDGE = "[А-Яа-яЁёA-Za-z0-9]";
/** Число целым словом: «три» внутри «смотри» числом не является. */
const NUM = `(?<!${EDGE})(?:\\d+|${WORDS.join("|")})(?!${EDGE})`;

const numberOf = (raw: string): number =>
  /^\d+$/u.test(raw) ? Number(raw) : (WORD_NUMBER[raw.toLowerCase()] ?? Number.NaN);

const numberIn = (text: string): number => {
  const found = new RegExp(`(${NUM})`, "iu").exec(text);
  return found ? numberOf(found[1] as string) : Number.NaN;
};

/**
 * Слова счёта из тикета плюс «полка» — так пакет зовёт зону по-человечески.
 * У «полки» беглая гласная: родительный множественного — «полОк», и корень
 * `полк` его не ловит. Первая же проверка молчала ровно из-за этого.
 */
const SHELF = "пол(?:к|ок)";
const COUNT_WORD = `ключ|строк|зон|${SHELF}|комнат|адрес|мест`;
/** Одно определение между числом и словом: «7 живых строк», «28 новых ключей». */
const ADJ = "(?:(?:живых|новых|настоящих|плоских|своих|целых)\\s+)?";
const COUNT = `${NUM}\\s+${ADJ}(?:${COUNT_WORD})[а-яё]*`;

const MASK = "`?([A-Z][A-Za-z0-9]*)\\.\\*`?";
const SECTION = "`([A-Z][A-Za-z0-9]*)`";
const FILE = "`([A-Za-z0-9._/-]+\\.json)`";

const rx = (body: string) => new RegExp(body, "giu");

const jsonAt = (relative: string): unknown =>
  JSON.parse(readFileSync(join(HANDOFF, relative), "utf8"));

// ---------- счёт ключей словаря ----------

const isServiceKey = (key: string) => key.startsWith("_") || key.endsWith("_WITHDRAWN");

/**
 * КЛЮЧ СЛОВАРЯ — строка, у которой есть ИМЯ ключа продукта. Дизайн пишет их
 * двумя способами: `"Occasion.holidayNY": "…"` внутри любого узла и
 * `"Occasion": { "holidayNY": "…" }` разделом. Оба считаются одинаково,
 * служебные записки с подчёркиванием — не считаются: они проза, а не строки.
 */
function walkKeys(node: unknown, parent: string, visit: (section: string) => void): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (isServiceKey(key)) continue;
      const dotted = /^([A-Z][A-Za-z0-9]*)\.[A-Za-z][A-Za-z0-9]*$/u.exec(key);
      if (dotted) visit(dotted[1] as string);
      else if (/^[A-Z][A-Za-z0-9]*$/u.test(parent) && /^[a-z][A-Za-z0-9]*$/u.test(key))
        visit(parent);
      continue;
    }
    walkKeys(value, key, visit);
  }
}

const countKeys = (files: readonly string[], section?: string): number => {
  let total = 0;
  for (const file of files)
    walkKeys(jsonAt(file), "", (owner) => {
      if (section === undefined || owner === section) total += 1;
    });
  return total;
};

/**
 * ГДЕ ЖИВЁТ СЛОВАРЬ РАУНДА. Приложил пакет `messages-ru.json` целиком — раздел
 * считается по нему одному: дельта повторяет те же ключи, и сложение дало бы
 * двойной счёт (на round50 это ровно 8 вместо 7). Не приложил — считаем по
 * всему, что в пакете есть, и «ноль» тогда честный ответ: ключей не привезли.
 */
const dictionaryOf = (scope: Scope): readonly string[] => {
  const whole = scope.jsons.filter((file) => file.endsWith("messages-ru.json"));
  return whole.length > 0 ? whole : scope.jsons;
};

// ---------- счёт по карте зон ----------

type RoomsFile = { rooms: { id: string; sex: string; zones: { key: string }[] }[] };

const roomsOf = (scope: Scope): RoomsFile => {
  const own = scope.dir ? `${scope.dir}/rooms.json` : "rooms.json";
  return jsonAt(existsSync(join(HANDOFF, own)) ? own : "rooms.json") as RoomsFile;
};

const distinctZoneKeys = (map: RoomsFile) =>
  new Set(map.rooms.flatMap((room) => room.zones.map((zone) => zone.key))).size;
const totalAddresses = (map: RoomsFile) =>
  map.rooms.reduce((sum, room) => sum + room.zones.length, 0);
const perRoom = (map: RoomsFile, sex: string) =>
  Math.max(...map.rooms.filter((room) => room.sex === sex).map((room) => room.zones.length));

/**
 * МЕСТА В ПОКОЕ считаются нашей единственной реализацией правила ПАКЕТА
 * (`empty-places.ts` читает `handoff/places.json`), а не второй копией той же
 * геометрии: копия разошлась бы молча, и сторож начал бы сверять чужое число со
 * своей ошибкой.
 */
const placesAtRest = (): number =>
  rooms.reduce(
    (total, room) =>
      total +
      emptyPlaces(room.zones).places.filter((place) =>
        placeWholeInBand(place.rect, PLACE_BAND_PHONE_REST),
      ).length,
    0,
  );

// ---------- разбор прозы ----------

/**
 * «БЫЛО N, СТАЛО M» — обещание здесь M, а N это прошлое. Без поправки сторож
 * сверял бы с файлом историческое число и ругался бы на верную запись.
 */
const BECAME = new RegExp(`было\\s+(?:${NUM})[^.;]{0,60}?стало\\s+(${NUM})`, "iu");

type Scope = {
  /** Папка раунда («round50») или "" — верхний уровень пакета. */
  readonly dir: string;
  /** `.json` этой области: в них и считаются ключи. */
  readonly jsons: readonly string[];
  /** Проза этой области. */
  readonly lines: readonly Prose[];
};

type Rule = {
  readonly pattern: RegExp;
  readonly what: (match: RegExpExecArray) => string;
  readonly count: (match: RegExpExecArray, scope: Scope) => number | undefined;
};

const RULES: readonly Rule[] = [
  // `strings-delta.json` (38 ключей) — счёт ключей словаря в НАЗВАННОМ файле.
  {
    pattern: rx(`${FILE}\\s*[(—-]\\s*(?:${COUNT})`),
    what: (m) => `ключи словаря в \`${m[1]}\``,
    count: (m, scope) => {
      const named = scope.dir ? `${scope.dir}/${m[1]}` : (m[1] as string);
      return existsSync(join(HANDOFF, named)) ? countKeys([named]) : undefined;
    },
  },
  // 27 ключей раздела Pool.* — счёт по МАСКЕ, в файлах этого же пакета. Слово
  // счёта необязательно: пакет 48 пишет просто «28 `Pool.*` + 5 `FriendRow.*`»,
  // и маска сама по себе якорь достаточный — спутать её не с чем.
  {
    pattern: rx(
      `${NUM}\\s+(?:${ADJ}(?:${COUNT_WORD})[а-яё]*\\s+)?(?:раздела\\s+|секции\\s+)?${MASK}`,
    ),
    what: (m) => `маска \`${m[1]}.*\``,
    count: (m, scope) => countKeys(dictionaryOf(scope), m[1] as string),
  },
  // `ZoneCounterGuest`: шесть строк — счёт живых строк НАЗВАННОГО раздела.
  {
    pattern: rx(`(?:раздел[а-яё]*\\s+)?${SECTION}\\s*[:(—-]\\s*(?:${COUNT})`),
    what: (m) => `раздел \`${m[1]}\``,
    count: (m, scope) => countKeys(dictionaryOf(scope), m[1] as string),
  },
  // 7 строк раздела `ZoneList` — тот же счёт, обратный порядок слов.
  {
    pattern: rx(`(?:${COUNT})\\s+(?:раздела|секции)\\s+${SECTION}`),
    what: (m) => `раздел \`${m[1]}\``,
    count: (m, scope) => countKeys(dictionaryOf(scope), m[1] as string),
  },
  // «Все полки сразу» — теперь 15 полок. Положение ALL берёт ВСЕ полки карты, а
  // их столько, сколько РАЗЛИЧНЫХ ключей зон в `rooms.json`.
  {
    pattern: rx(
      `(?:Все\\s+полки\\s+сразу|Всё\\s+вместе|Все\\s+десять|setDescriptionALL)` +
        `[^.;]{0,80}?(${NUM}\\s+${ADJ}(?:${SHELF}|зон)[а-яё]*)`,
    ),
    what: () => "различных ключей зон в `rooms.json`",
    count: (_m, scope) => distinctZoneKeys(roomsOf(scope)),
  },
  // 134 адреса всего — словарь адресов целиком.
  {
    pattern: rx(`(${NUM}\\s+адрес[а-яё]*)\\s+(?:всего|всех)`),
    what: () => "всех записей зон в `rooms.json`",
    count: (_m, scope) => totalAddresses(roomsOf(scope)),
  },
  // 13 в женских комнатах, 14 в мужских — состав полок по набору комнат.
  {
    pattern: rx(`(${NUM})\\s+в\\s+(женских|мужских)`),
    what: (m) => `полок в ${m[2] === "женских" ? "женской" : "мужской"} комнате`,
    count: (m, scope) => perRoom(roomsOf(scope), m[2] === "женских" ? "F" : "M"),
  },
  // 30 мест в покое, стало 23 — счёт по правилу самого пакета (`places.json`).
  {
    pattern: rx(`(${NUM}\\s+мест[а-яё]*)\\s+в\\s+покое`),
    what: () => "мест, видимых целиком в покое телефона (правило `places.json`)",
    count: () => placesAtRest(),
  },
];

/** Обещание: число, вырванная фраза и то, что по нему посчитано. */
export type Claim = {
  readonly line: Prose;
  /** Кусок прозы, из которого взято число, — он и печатается в отчёте. */
  readonly phrase: string;
  readonly promised: number;
  /** Что именно сторож пошёл считать: «раздел `PoolInline`», «маска `Pool.*`». */
  readonly what: string;
  readonly counted: number;
};

function claimsIn(scope: Scope): Claim[] {
  const claims: Claim[] = [];
  for (const line of scope.lines) {
    const became = BECAME.exec(line.text);
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line.text)) !== null) {
        const promised = became ? numberOf(became[1] as string) : numberIn(match[0]);
        if (!Number.isFinite(promised)) continue;
        const counted = rule.count(match, scope);
        if (counted === undefined || !Number.isFinite(counted)) continue;
        claims.push({
          line,
          phrase: became ? became[0] : match[0],
          promised,
          what: rule.what(match),
          counted,
        });
      }
    }
  }
  return claims;
}

/**
 * Все обещания раунда, посчитанные по его же файлам. Совпавшие возвращаются
 * тоже — иначе не отличить «сторож промолчал, потому что сошлось» от «сторож не
 * нашёл ни одного числа», а второе и есть тихая смерть проверки.
 */
export const claimsOfRound = (dir: string): Claim[] =>
  claimsIn({ dir, jsons: jsonFilesIn(dir), lines: textOf(dir) });

/** То же по живым файлам верхнего уровня: имена корпуса задаёт тест. */
export const claimsOfLive = (files: readonly string[]): Claim[] =>
  claimsIn({
    dir: "",
    jsons: files.filter((file) => file.endsWith(".json")),
    lines: textOf(...files),
  });

/** Расхождения — то, ради чего сторож и заведён. */
export const mismatches = (claims: readonly Claim[]): Claim[] =>
  claims.filter(({ promised, counted }) => promised !== counted);

/**
 * «файл, строка, обещано N, посчитано M» — иначе сторожа пропускают глазами.
 * Голова отделена от хвоста нарочно: по ней сверяются списки известного, и
 * резать её из готовой строки нельзя — в самой фразе скобки встречаются
 * («`strings-delta.json` (38 ключей»).
 */
export const head = ({ line, phrase, promised, counted }: Claim): string =>
  `${line.file}:${line.place} — «${phrase.trim()}»: обещано ${promised}, посчитано ${counted}`;

/** Та же голова плюс то, ЧЕМ посчитано, — полная строка отчёта. */
export const say = (claim: Claim): string => `${head(claim)} (${claim.what})`;
