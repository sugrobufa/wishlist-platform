// Счётчик зоны: «N вещей» хозяйке и «сколько из скольких свободно» гостю
// (тикет 124, инвариант №8 в новой редакции).
//
// ЗАЧЕМ ТЕСТ — и почему он не про арифметику.
//
// Второе число ПРОИЗВОДНО ОТ БРОНЕЙ, а сводка зоны складывается внутри кэша
// комнаты и уезжает в полностраничный ISR. Хозяйка открывает СВОЮ ЖЕ гостевую
// ссылку и получает тот же кэшированный HTML: «7 свободно» при восьми вещах
// сказало бы ей поимённо, что одну с этой полки забрали. Это ровно то, что
// запрещает инвариант №1 — «ни имени, ни вещи, ни в API, ни в кэше», — и
// поймать такую утечку глазами нельзя: экран выглядит невинно.
//
// Поэтому здесь три разные проверки:
//  - выбор случая — чистой функцией (пять случаев легко перепутать, и
//    перепутанными они выглядят правдоподобно);
//  - слова — сверкой с пакетом дизайна (форма «N из M» его, не наша);
//  - МЕСТО, где число считается, — чтением исходников: в DTO сводки его быть
//    не должно ни в каком виде.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { zoneCounterLine } from "../src/components/scene/zone-counter";
import { zoneSummaryForGuest, zoneSummaryForOwner } from "../src/server/dto/zone-summary";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const summaryDto = read("../src/server/dto/zone-summary.ts");
const zoneList = read("../src/components/scene/zone-list.tsx");
const zoneIndex = read("../src/components/scene/zone-index.tsx");
const zoneFree = read("../src/app/r/[slug]/booking/zone-free.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");

describe("пять случаев строки — по пакету дизайна", () => {
  it("все свободны, и вещь одна", () => {
    expect(zoneCounterLine(1, 1).key).toBe("summaryFreeSingle");
  });

  it("все свободны, вещей несколько", () => {
    expect(zoneCounterLine(4, 4)).toEqual({ key: "summaryFreeAll", values: { n: 4, m: 4 } });
  });

  it("свободна последняя", () => {
    expect(zoneCounterLine(4, 1)).toEqual({ key: "summaryFreeLast", values: { n: 1, m: 4 } });
  });

  it("свободна часть", () => {
    expect(zoneCounterLine(4, 3)).toEqual({ key: "summaryFreeSome", values: { n: 3, m: 4 } });
  });

  it("свободных не осталось", () => {
    expect(zoneCounterLine(4, 0)).toEqual({ key: "summaryFreeNone", values: { n: 0, m: 4 } });
  });

  it("мусор не рисует полстроки", () => {
    // Свободных больше, чем вещей, быть не может; отрицательных тоже.
    expect(zoneCounterLine(3, 9)).toEqual({ key: "summaryFreeAll", values: { n: 3, m: 3 } });
    expect(zoneCounterLine(3, -2)).toEqual({ key: "summaryFreeNone", values: { n: 0, m: 3 } });
  });

  it("слова взяты у дизайна дословно, и «занято» среди них нет", () => {
    expect(ru.Scene.summaryFreeSingle).toBe("вещь одна и свободна");
    expect(ru.Scene.summaryFreeAll).toBe("все {m} свободны");
    expect(ru.Scene.summaryFreeLast).toBe("1 из {m} свободна");
    expect(ru.Scene.summaryFreeSome).toBe("{n} из {m} свободны");
    // «Занято» из мира парковок, а тут комната: у дизайна «уже дарят», и это
    // та же фраза, которой помечена сама вещь.
    expect(ru.Scene.summaryFreeNone).toBe("все {m} уже дарят");
    for (const key of [
      "summaryFreeSingle",
      "summaryFreeAll",
      "summaryFreeLast",
      "summaryFreeSome",
      "summaryFreeNone",
    ] as const) {
      expect(en.Scene, `английский каркас: ${key}`).toHaveProperty(key);
    }
  });
});

describe("второе число НЕ в кэшируемой сводке (инвариант №1)", () => {
  const item = {
    id: "i1",
    title: "Кашемир",
    zone: "clothes",
    photoUrl: null,
    isDemo: false,
    inHall: false,
    price: "14900",
    currency: "RUB",
  };

  it("в форме сводки нет ключа про свободное или занятое — ни у кого", () => {
    const owner = zoneSummaryForOwner("clothes", [item as never]);
    const guest = zoneSummaryForGuest("clothes", [item as never]);
    for (const [who, summary] of [
      ["хозяйка", owner],
      ["гость", guest],
    ] as const) {
      const keys = Object.keys(summary);
      expect(keys, who).not.toContain("free");
      expect(keys, who).not.toContain("taken");
      expect(keys, who).not.toContain("booked");
      expect(keys, who).not.toContain("available");
    }
    // Формы совпадают по составу: разницу между зрителями делает не сводка, а
    // то, какие вещи в неё приехали.
    expect(Object.keys(owner)).toEqual(Object.keys(guest));
  });

  it("сам файл DTO ни одной брони не читает", () => {
    expect(summaryDto).not.toMatch(/prisma\.booking|findMany|bookingId/u);
  });

  it("число считает ЭКРАН, из некэшируемого канала «занято»", () => {
    expect(zoneFree).toContain("useGuestBooking()");
    expect(zoneFree).toContain("zoneCounterLine(total, free)");
    // Своего запроса ради счётчика не заводится: канал уже есть.
    expect(zoneFree).not.toContain("fetch(");
  });

  it("узел строится только для гостя и только у непустых зон", () => {
    expect(guestPage).toContain("<GuestZoneFree");
    expect(guestPage).toMatch(/\.filter\(\(\[, summary\]\) => summary\.count > 0\)/u);
    // Демо-призраки в счёт не идут: их id ничего не значит вне рендера, и
    // сводка их тоже не считает.
    expect(guestPage).toMatch(/itemIds=\{[\s\S]{0,160}!item\.isDemo/u);
  });
});

describe("хозяйке — только «N вещей», и на её собственной комнате тоже", () => {
  it("оба оглавления показывают узел ТОЛЬКО гостю", () => {
    for (const [name, source] of [
      ["ZoneList", zoneList],
      ["ZoneIndex", zoneIndex],
    ] as const) {
      expect(source, name).toContain('viewer === "guest" && counters?.[zone.key] != null');
      // Хозяйке — строка словаря с погашенной второй половиной.
      expect(source, name).toContain('tCounts("zoneCounts", { total');
    }
  });

  it("комната хозяйки узлов счётчика не собирает вовсе", () => {
    const ownerPage = read("../src/app/room/page.tsx");
    expect(ownerPage).not.toContain("counters=");
    expect(ownerPage).not.toContain("GuestZoneFree");
  });

  it("без узла говорим то же, что хозяйке: врать нечем", () => {
    // Канал не ответил или зритель — сама хозяйка по своей ссылке: строка
    // откатывается к «N вещей», а не показывает «всё свободно» наугад.
    expect(zoneList).toContain('counters?.[zone.key] != null');
  });
});
