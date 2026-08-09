// Поля впечатления не стираются правкой карточки (починка 09.08.2026).
//
// БАГ, КОТОРЫЙ ЭТОТ ФАЙЛ СТОРОЖИТ. `updateItem` пишет «Когда · Где · Годен до»
// БЕЗУСЛОВНО:
//
//   eventWhen: data.eventWhen ?? null,
//   eventWhere: data.eventWhere ?? null,
//   validUntil: dayToUtc(data.validUntil),
//
// То есть «не отправить поле» здесь означает не «оставить как было», а
// «стереть». Карточка правки этих полей не знала и не слала — и любое
// сохранение вещи из зоны «Впечатления» (тикет 97) обнуляло срок годности
// сертификата. Молча: ошибки нет, форма закрывается, человек узнаёт об этом,
// когда придёт в ресторан.
//
// Жил баг с тикета 97 и не попадался, потому что стрелял только в двух зонах
// из тринадцати. А после того, как шкала желания переехала в правку НА МЕСТЕ
// (раунд 29), его стал спускать даже тап по огоньку: тот же `buildInput`.
//
// Проверяем ТРИ звена цепи — стереть достаточно одного разорванного.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { itemForOwner } from "../src/server/dto/items";

const read = (relative: string) =>
  readFileSync(path.join(__dirname, relative), "utf8");

const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
const service = read("../src/server/services/items.ts");

/** Минимальная строка Item — только то, что читает сериализатор. */
function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    roomId: "r1",
    zone: "events",
    title: "Ужин на двоих",
    note: null,
    photoKey: null,
    hidden: false,
    inHall: false,
    price: null,
    currency: null,
    priceVisibility: "ALL",
    size: null,
    color: null,
    desire: null,
    giverName: null,
    receivedAt: null,
    eventWhen: "в субботу",
    eventWhere: "«Пушкин»",
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("звено 1 — сервис по-прежнему пишет поля безусловно", () => {
  it("updateItem обнуляет поля, которых не было во входе", () => {
    // Это НЕ баг сервиса: он честно записывает форму целиком. Тест стоит
    // здесь, чтобы правка сервиса не сняла молча причину, ради которой
    // существуют звенья 2 и 3. Изменится поведение — упадёт этот тест, и
    // тогда можно осознанно снять и остальные.
    expect(service).toMatch(/eventWhen: data\.eventWhen \?\? null/u);
    expect(service).toMatch(/eventWhere: data\.eventWhere \?\? null/u);
    expect(service).toMatch(/validUntil: dayToUtc\(data\.validUntil\)/u);
  });
});

describe("звено 2 — DTO хозяйки несёт поля в ОБЕИХ формах", () => {
  it("вещь комнаты отдаёт «Когда · Где · Годен до»", () => {
    const dto = itemForOwner(itemRow());
    expect(dto.eventWhen).toBe("в субботу");
    expect(dto.eventWhere).toBe("«Пушкин»");
    expect(dto.validUntil).toBe("2026-12-31");
  });

  it("вещь СОКРОВИЩНИЦЫ отдаёт их тоже — сертификат не перестаёт истекать", () => {
    // Форма витрины не показывает эти поля, но карточка обязана их ЗНАТЬ:
    // иначе сохранение дарителя сотрёт срок годности подаренного сертификата.
    const dto = itemForOwner(itemRow({ inHall: true }));
    expect(dto.eventWhen).toBe("в субботу");
    expect(dto.validUntil).toBe("2026-12-31");
  });

  it("пустые значения остаются пустыми, а не превращаются в строки", () => {
    const dto = itemForOwner(
      itemRow({ eventWhen: null, eventWhere: null, validUntil: null }),
    );
    expect(dto.eventWhen).toBeNull();
    expect(dto.eventWhere).toBeNull();
    expect(dto.validUntil).toBeNull();
  });
});

describe("звено 3 — карточка правки ОТПРАВЛЯЕТ поля, а не забывает их", () => {
  /** Тело buildInput — то, что уходит на сервер при любом сохранении. */
  // `\r?` обязателен: рабочее дерево на Windows держит CRLF, и регекс по
  // голому `\n` не находит закрывающую скобку вовсе — тест «проходил бы»
  // на пустой строке, если бы не проверка ниже.
  const buildInput = /function buildInput\([\s\S]*?\r?\n {2}\}/u.exec(card)?.[0] ?? "";

  it("buildInput нашёлся", () => {
    expect(buildInput, "изменилось имя или форма функции — проверь тест").not.toBe("");
  });

  it("все три поля уходят на сервер", () => {
    expect(buildInput).toMatch(/eventWhen:/u);
    expect(buildInput).toMatch(/eventWhere:/u);
    expect(buildInput).toMatch(/validUntil:/u);
  });

  it("поля лежат в ОБЩЕЙ части, а не в ветке комнаты", () => {
    // Ветки две (комната и витрина), и попади поля в одну из них — вторая
    // снова начнёт стирать. Общая часть называется `common` и собирается до
    // развилки: проверяем, что все три стоят до первого `? {`.
    const commonPart = buildInput.split("return")[0] ?? "";
    expect(commonPart).toMatch(/eventWhen:/u);
    expect(commonPart).toMatch(/eventWhere:/u);
    expect(commonPart).toMatch(/validUntil:/u);
  });

  it("значения берутся из состояния карточки, а не из пустых строк", () => {
    // Дешёвая, но важная проверка: `eventWhen: undefined` тоже «отправлено»
    // и тоже стирает. Значение обязано приходить из useState, заведённого от
    // самой вещи.
    expect(card).toMatch(/useState\(item\.eventWhen \?\? ""\)/u);
    expect(card).toMatch(/useState\(item\.eventWhere \?\? ""\)/u);
    expect(card).toMatch(/useState\(item\.validUntil \?\? ""\)/u);
  });

  it("поля ПОКАЗЫВАЮТСЯ в зонах впечатлений — по той же развилке, что в добавлении", () => {
    expect(card).toMatch(/isExperienceZone\(zone\)/u);
  });
});
