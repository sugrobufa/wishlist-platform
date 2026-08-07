// Классификатор вида плитки (тикет 03). Главный тест — инвариант №3 CLAUDE.md:
// пунктир кодирует состояние «хочу», а НЕ отсутствие фото. В первой версии
// прототипа это перепутали (items.json → commonMistake) — тест не даёт
// ошибке вернуться.
import { describe, expect, it } from "vitest";
import { tileAppearance, type TileItemLike } from "../src/components/zone/tile-appearance";

const PHOTO = "/rooms/p-vinyl.jpg";

function make(overrides: Partial<TileItemLike>): TileItemLike {
  return { state: "WANT", photoUrl: null, isDemo: false, title: "Плетёная корзинка", ...overrides };
}

describe("tileAppearance", () => {
  it("«хочу» с фото → пунктир и полоса, без серой заливки", () => {
    const look = tileAppearance(make({ state: "WANT", photoUrl: PHOTO }));
    expect(look.dashed).toBe(true);
    expect(look.accentBar).toBe(true);
    expect(look.greyFill).toBe(false);
  });

  it("«хочу» без фото → пунктир + серая заливка", () => {
    const look = tileAppearance(make({ state: "WANT", photoUrl: null }));
    expect(look.dashed).toBe(true);
    expect(look.greyFill).toBe(true);
  });

  it("«люблю» без фото → серая заливка БЕЗ пунктира (историческая ошибка прототипа)", () => {
    const look = tileAppearance(make({ state: "LOVE", photoUrl: null }));
    expect(look.greyFill).toBe(true);
    expect(look.dashed).toBe(false);
    expect(look.accentBar).toBe(false);
  });

  it("«люблю» с фото → ни пунктира, ни заливки", () => {
    const look = tileAppearance(make({ state: "LOVE", photoUrl: PHOTO }));
    expect(look.dashed).toBe(false);
    expect(look.greyFill).toBe(false);
    expect(look.accentBar).toBe(false);
  });

  it("демо-призрак → ghost, настоящая вещь → нет", () => {
    expect(tileAppearance(make({ isDemo: true })).ghost).toBe(true);
    expect(tileAppearance(make({ isDemo: false })).ghost).toBe(false);
  });

  it("полоса 2px — строгий спутник пунктира, а ghost не влияет на код состояния", () => {
    for (const state of ["LOVE", "WANT"] as const) {
      for (const photoUrl of [null, PHOTO]) {
        for (const isDemo of [false, true]) {
          const look = tileAppearance({ state, photoUrl, isDemo, title: "Что-то" });
          expect(look.accentBar).toBe(look.dashed);
          expect(look.dashed).toBe(state === "WANT");
          expect(look.ghost).toBe(isDemo);
        }
      }
    }
  });
});

// Заглушка вместо чёрной дыры (тикет 68, приёмка 07.08): владелец увидел
// в зоне подряд четыре-пять пустых плиток. Предметных кадров в пакете 15 на
// 19 пулов, у 54 примеров из 80 фотографии нет вовсе.
describe("буква вместо отсутствующего фото", () => {
  it("нет фото → первая буква названия заглавной", () => {
    expect(tileAppearance(make({ title: "плетёная корзинка" })).monogram).toBe("П");
    expect(tileAppearance(make({ title: "Ночной крем" })).monogram).toBe("Н");
  });

  it("есть фото → буквы нет: место занято настоящим кадром", () => {
    expect(tileAppearance(make({ photoUrl: PHOTO })).monogram).toBeNull();
  });

  it("буква ходит РОВНО с серой заливкой — это одна и та же пометка «фото нет»", () => {
    for (const state of ["LOVE", "WANT"] as const) {
      for (const photoUrl of [null, PHOTO]) {
        const look = tileAppearance(make({ state, photoUrl }));
        expect(look.monogram !== null).toBe(look.greyFill);
        // И НЕ ходит с пунктиром: инвариант №3 остаётся нетронутым.
        expect(look.monogram !== null).toBe(photoUrl === null);
      }
    }
  });

  // --- Значок пула зоны (тикет 82) -----------------------------------------

  it("нет фото + зона со значком → значок вместо буквы", () => {
    const look = tileAppearance(make({ title: "Подарок маме" }), "travel");
    expect(look.poolIcon).toBe("travel");
    // Буква уступает место: два знака в одном слоте — это уже спор.
    expect(look.monogram).toBeNull();
  });

  it("есть фото → значка нет, как и буквы: место занято настоящим кадром", () => {
    expect(tileAppearance(make({ photoUrl: PHOTO }), "travel").poolIcon).toBeNull();
  });

  it("зона без своего значка → возвращается буква", () => {
    // `money` значка не имеет — такого пула в пакете нет вовсе.
    const money = tileAppearance(make({ title: "Мечта" }), "money");
    expect(money.poolIcon).toBeNull();
    expect(money.monogram).toBe("М");
    // Пул вообще не передали (список без зоны) — то же самое.
    const none = tileAppearance(make({ title: "Мечта" }));
    expect(none.poolIcon).toBeNull();
    expect(none.monogram).toBe("М");
  });

  it("ИНВАРИАНТ №3: значок ходит с отсутствием фото, а не с «хочу»", () => {
    for (const state of ["LOVE", "WANT"] as const) {
      for (const photoUrl of [null, PHOTO]) {
        const look = tileAppearance(make({ state, photoUrl }), "books");
        expect(look.poolIcon !== null).toBe(look.greyFill);
        expect(look.poolIcon !== null).toBe(photoUrl === null);
        // Пунктир по-прежнему говорит только про состояние.
        expect(look.dashed).toBe(state === "WANT");
      }
    }
  });

  it("в слоте заглушки всегда ровно один знак — либо значок, либо буква", () => {
    for (const pool of [null, "money", "travel", "jewel"]) {
      const look = tileAppearance(make({ title: "Что-то" }), pool);
      const marks = [look.poolIcon, look.monogram].filter((mark) => mark !== null).length;
      expect(marks, `pool=${pool}`).toBe(1);
    }
  });

  it("пустое или пробельное название буквы не даёт — рисовать нечего", () => {
    expect(tileAppearance(make({ title: "" })).monogram).toBeNull();
    expect(tileAppearance(make({ title: "   " })).monogram).toBeNull();
  });

  it("суррогатная пара в начале не разъезжается половинкой символа", () => {
    // Название приходит от человека: эмодзи первым знаком — законный ввод.
    expect(tileAppearance(make({ title: "🎁 подарок" })).monogram).toBe("🎁");
  });
});
