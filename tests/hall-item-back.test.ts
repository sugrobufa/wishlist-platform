import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ru from "../messages/ru.json";

const CARD = readFileSync(
  resolve(process.cwd(), "src/app/room/zone/[zone]/i/[id]/item-card.tsx"),
  "utf8",
);

/**
 * 243 — ИЗ ВЕЩИ СОКРОВИЩНИЦЫ «НАЗАД» ВЕДЁТ В СОКРОВИЩНИЦУ.
 *
 * Приёмка владельца 14.08.2026: «попадаю не в сокровищницу, а в список всей
 * категории, а потом вообще в комнату. Нелогично». Вход в карточку из витрины
 * один — перо-заметка, — а выход шёл в полку комнаты, которую человек не
 * открывал.
 *
 * Проверяется РАЗМЕТКОЙ, а не рендером: знак — `<Link href>`, и вся починка в
 * том, какой адрес в него подставлен. Рендерить карточку целиком ради одной
 * ссылки значило бы поднимать половину продукта.
 */
describe("243 — знак возврата ведёт туда, где вещь живёт", () => {
  it("адрес считается по месту вещи: витрина → сокровищница, комната → полка", () => {
    expect(CARD).toContain('const backHref = item.inHall ? "/room/hall" : zoneHref;');
    // Подпись знака едет вместе с адресом — иначе экран назывался бы полкой,
    // а вёл в сокровищницу.
    expect(CARD).toContain('const backLabel = item.inHall ? tHall("toHall") : zoneLabel;');
  });

  it("в самом знаке стоят backHref и backLabel, а не прежние zoneHref/zoneLabel", () => {
    expect(CARD).toContain("<Link href={backHref} aria-label={backLabel}");
    // Прежней связки в шапке не осталось: если она вернётся, вернётся и жалоба.
    expect(CARD).not.toContain("<Link href={zoneHref} aria-label={zoneLabel}");
  });

  it("строка «стоит в полке» осталась дорогой В ПОЛКУ — она не «назад»", () => {
    // Указание места вещи верно и для витрины: вернувшись в комнату, вещь
    // встанет именно туда. Подменить её на сокровищницу значило бы починить
    // жалобу и сломать смысл.
    expect(CARD).toContain("<Link href={zoneHref} className={`pressable ${s.shelfRow}`}>");
  });
});

/**
 * 242 — ПОДСКАЗКА СОКРОВИЩНИЦЫ ГОВОРИТ ПРО СВОЙ ЭКРАН.
 *
 * «Зачем писать, что в комнате. Просто напиши, что тут хранятся вещи такие-то и
 * такие» — слово владельца, та же приёмка.
 */
describe("242 — подсказка сокровищницы", () => {
  const hint: string = ru.Hall.ownerHint;

  it("не объясняет комнату — ни словом", () => {
    expect(hint.toLowerCase()).not.toContain("комнат");
  });

  it("называет, что здесь лежит, и что этих вещей не дарят", () => {
    expect(hint).toContain("подарки");
    expect(hint).toContain("покупки");
    // Единственный факт, который человеку тут нужен (инвариант 8 устава).
    expect(hint).toMatch(/не дарят/u);
  });

  it("говорит на «ты» и без рода человека — правила сторожа тона", () => {
    expect(hint).not.toMatch(/\bвы\b|\bвас\b|\bваш/iu);
    // Прошедшее время с родовым окончанием — то, чем болели строки складчины.
    expect(hint).not.toMatch(/(ла|лась)\b/u);
  });
});
