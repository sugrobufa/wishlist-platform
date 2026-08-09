// Классификатор вида плитки (тикет 03).
//
// ПЕРЕПИСАН ЦЕЛИКОМ ТИКЕТОМ 124. Раньше главным здесь был инвариант №3: «пунктир
// кодирует состояние „хочу", а НЕ отсутствие фото» — в первой версии прототипа
// это перепутали (items.json v1 → commonMistake), и тест не давал ошибке
// вернуться. Инвариант отменён целиком: состояний у вещи нет, кодировать
// пунктиром нечего, и модель v2 дизайна говорит прямо — «ПУНКТИРА БОЛЬШЕ НЕТ
// ни у одной вещи», плитка с обычной границей.
//
// Тест не удалён, а развёрнут: он держит ОБРАТНОЕ утверждение — пунктира и
// полосы не бывает НИ ПРИ КАКОМ сочетании входов. Это дешёвый сторож против
// случайного возврата старого языка, пока поля `dashed`/`accentBar` ещё живут
// в форме (снимать их из разметки — заход про экраны).
//
// Серая заливка со значком/буквой по-прежнему означает ровно «фотографии нет» —
// это никогда и не было про состояние.
import { describe, expect, it } from "vitest";
import { tileAppearance, type TileItemLike } from "../src/components/zone/tile-appearance";

const PHOTO = "/rooms/p-vinyl.jpg";

function make(overrides: Partial<TileItemLike>): TileItemLike {
  return { photoUrl: null, isDemo: false, title: "Плетёная корзинка", ...overrides };
}

describe("tileAppearance", () => {
  it("вещь с фото → ни пунктира, ни полосы, ни серой заливки", () => {
    const look = tileAppearance(make({ photoUrl: PHOTO }));
    expect(look.dashed).toBe(false);
    expect(look.accentBar).toBe(false);
    expect(look.greyFill).toBe(false);
  });

  it("вещь без фото → серая заливка, и всё равно без пунктира", () => {
    const look = tileAppearance(make({ photoUrl: null }));
    expect(look.greyFill).toBe(true);
    expect(look.dashed).toBe(false);
    expect(look.accentBar).toBe(false);
  });

  it("демо-призрак → ghost, настоящая вещь → нет", () => {
    expect(tileAppearance(make({ isDemo: true })).ghost).toBe(true);
    expect(tileAppearance(make({ isDemo: false })).ghost).toBe(false);
  });

  it("ПУНКТИРА НЕ БЫВАЕТ НИ ПРИ КАКОМ ВХОДЕ (тикет 124)", () => {
    for (const photoUrl of [null, PHOTO]) {
      for (const isDemo of [false, true]) {
        for (const title of ["Что-то", "", "🎁 подарок"]) {
          const look = tileAppearance({ photoUrl, isDemo, title });
          expect(look.dashed).toBe(false);
          expect(look.accentBar).toBe(false);
          // Заливка зависит ТОЛЬКО от фотографии — и ни от чего больше.
          expect(look.greyFill).toBe(photoUrl === null);
          expect(look.ghost).toBe(isDemo);
        }
      }
    }
  });

  it("значок пула вместо буквы — только на серой заливке (тикет 82)", () => {
    const withIcon = tileAppearance(make({ photoUrl: null }), "jewel");
    expect(withIcon.poolIcon).toBe("jewel");
    expect(withIcon.monogram).toBeNull();

    const withPhoto = tileAppearance(make({ photoUrl: PHOTO }), "jewel");
    expect(withPhoto.poolIcon).toBeNull();
    expect(withPhoto.monogram).toBeNull();
  });
});
