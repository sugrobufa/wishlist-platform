import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Тон интерфейса (тикет 25). Памятка — design/package/handoff/tone.md,
// словарь-источник — design/package/handoff/messages-ru.json.
//
// Зачем тест: тон держится не редактурой, а границей. Одна новая строка с
// «Вы вошли как» или с восклицательным знаком возвращает продукт к тому, за
// что владелец и написал «айтишниковские тексты». Тест ловит это на месте.
//
// ВАЖНО: списки запрещённых слов живут здесь, а не в словаре. messages/ru.json
// next-intl сериализует в разметку КАЖДОЙ страницы (тикет 29) — служебному
// тексту там не место.

type Raw = Record<string, unknown>;

function readJson(relativePath: string): Raw {
  return JSON.parse(readFileSync(resolve(__dirname, relativePath), "utf8")) as Raw;
}

/**
 * Плоская карта «Секция.ключ» → строка.
 * Верхнеуровневые строки (у пакета это `_tone`) пропускаются — они не тексты
 * интерфейса, а пометка дизайна.
 */
function flatten(raw: Raw): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [section, entries] of Object.entries(raw)) {
    if (typeof entries !== "object" || entries === null) continue;
    for (const [key, value] of Object.entries(entries as Raw)) {
      expect(typeof value, `${section}.${key} — значение словаря обязано быть строкой`).toBe(
        "string",
      );
      flat.set(`${section}.${key}`, value as string);
    }
  }
  return flat;
}

const ruRaw = readJson("../messages/ru.json");
const enRaw = readJson("../messages/en.json");
const packageRaw = readJson("../design/package/handoff/messages-ru.json");

const ru = flatten(ruRaw);
const en = flatten(enRaw);
const handoff = flatten(packageRaw);

/**
 * Граница слова по-русски: `\b` в JS смотрит на латиницу и кириллицу не видит.
 * Без этого «вы» ловилось бы внутри «выбери», а «кадр» — внутри «кадра».
 */
const LETTER = "[А-Яа-яЁёA-Za-z]";
const asWord = (body: string) => new RegExp(`(?<!${LETTER})(?:${body})(?!${LETTER})`, "iu");

/**
 * Правила памятки, которые машина умеет проверить.
 *
 * Чего в списке НЕТ и почему:
 * - «товар» — в памятке он в столбце «не говорим», но пакет сам пишет
 *   «Не похоже на страницу товара» про страницу магазина. Пакет — источник
 *   правды, значит слово живое;
 * - «повод», «статус», «тип», «флаг» — пакет говорит «дождутся следующего
 *   повода», а остальные слишком общие: тест ловил бы обычную речь.
 */
const TONE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  // «Ни одного во всём продукте. Радость передаётся смыслом, а не пунктуацией.»
  ["восклицательный знак", /!/u],
  // «Подарил(а) {name}» → «Подарок от {name}». Скобка выдаёт базу данных.
  ["родовая скобка", /\([А-Яа-яЁё/]{1,4}\)/u],
  // «Слово „ошибка“ в текстах не встречается ни разу.»
  ["слово «ошибка»", asWord("ошибк[а-я]*")],
  // Везде «ты»: комната — своё пространство, а не учреждение.
  ["обращение на «вы»", asWord("вы|вас|вам|вами|ваш[а-я]*")],
  // Слова технического контракта в интерфейсе не существуют.
  ["слово из технического контракта", asWord("наезд[а-я]*|кадр[а-я]*|хотспот[а-я]*|пресет[а-я]*")],
  // «Набор зон» — тоже слово контракта. Ловим само слово, а не только пару:
  // «От набора зависят зоны комнаты» — та же мысль теми же словами. В словаре
  // на его месте живёт «заготовка».
  ["«набор зон»", asWord("набор[а-я]*")],
  // Столбец «не говорим» из памятки — то, что нельзя спутать с живой речью.
  [
    "слово не из словаря продукта",
    asWord(
      "вишлист[а-я]*|айтем[а-я]*|забук[а-я]*|зарезервир[а-я]*|окказ[а-я]*|ивент[а-я]*|" +
        "профил[ья][а-я]*|пространств[а-я]*|категори[а-я]*|секци[а-я]*|позици[а-я]*|" +
        "коллекци[а-я]*|архив[а-я]*|упс",
    ),
  ],
];

/** Кнопка, подпись, заголовок — без точки. Длиннее — уже фраза, ей точка можно. */
const SHORT_LINE = 40;

function violations(check: (value: string) => boolean, dictionary: Map<string, string>): string[] {
  return [...dictionary]
    .filter(([, value]) => check(value))
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
}

describe("тон русского словаря", () => {
  for (const [name, pattern] of TONE_RULES) {
    it(`${name} — ни разу`, () => {
      expect(violations((value) => pattern.test(value), ru)).toEqual([]);
    });
  }

  it("короткая строка не заканчивается точкой", () => {
    const dotted = violations(
      (value) => value.length <= SHORT_LINE && value.trimEnd().endsWith("."),
      ru,
    );
    expect(dotted).toEqual([]);
  });

  it("пустых значений нет", () => {
    expect(violations((value) => value.trim() === "", ru)).toEqual([]);
  });

  it("восклицательных знаков нет и в английском каркасе", () => {
    // Памятка: «ни одного во всём продукте». Английский переведут позже, но
    // тон переносится, а не изобретается заново.
    expect(violations((value) => value.includes("!"), en)).toEqual([]);
  });
});

describe("словарь и дизайн-пакет", () => {
  it("каждая строка пакета перенесена дословно", () => {
    const drift = [...handoff]
      .filter(([key, value]) => ru.get(key) !== value)
      .map(
        ([key, value]) =>
          `${key}: в продукте ${JSON.stringify(ru.get(key))}, в пакете ${JSON.stringify(value)}`,
      );
    expect(drift).toEqual([]);
  });

  it("служебная пометка пакета в продукт не уехала", () => {
    // `_tone` — записка дизайна самому себе. В словаре она стала бы лишним
    // килобайтом в разметке каждой страницы.
    expect(ruRaw).not.toHaveProperty("_tone");
    expect(enRaw).not.toHaveProperty("_tone");
  });

  it("ключи, которых пакет не знает, — только экраны входа по ссылке", () => {
    // Тикет 19 добавил эти экраны уже после того, как дизайн собрал словарь.
    // Тексты для них написаны руками по формуле ошибок из памятки. Список
    // закреплён, чтобы новая «сирота» не проехала мимо дизайна незамеченной.
    const own = [...ru.keys()].filter((key) => !handoff.has(key)).sort();
    expect(own).toEqual([
      "AddItem.back",
      "AddItem.backToRoom",
      "SignIn.confirmBody",
      "SignIn.confirmOverline",
      "SignIn.confirmSubmit",
      "SignIn.confirmTitle",
      "SignIn.expiredBody",
      "SignIn.expiredTitle",
      "SignIn.failedBody",
      "SignIn.failedTitle",
      "SignIn.newLink",
    ]);
  });
});

describe("полнота словарей", () => {
  it("наборы ключей ru и en совпадают", () => {
    // Каркас en обязан быть полным: next-intl падает на пропущенном ключе.
    const onlyRu = [...ru.keys()].filter((key) => !en.has(key)).sort();
    const onlyEn = [...en.keys()].filter((key) => !ru.has(key)).sort();
    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it("секции совпадают и по составу", () => {
    expect(Object.keys(enRaw).sort()).toEqual(Object.keys(ruRaw).sort());
  });
});
