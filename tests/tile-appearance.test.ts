// Классификатор вида плитки (тикет 03).
//
// ПЕРЕПИСАН ДВАЖДЫ ТИКЕТОМ 124, и второй раз — этим заходом.
//
// Раньше главным здесь был инвариант №3: «пунктир кодирует состояние „хочу", а
// НЕ отсутствие фото» — в первой версии прототипа это перепутали (items.json
// v1 → commonMistake), и тест не давал ошибке вернуться. Заход по серверу
// инвариант отменил и развернул тест: он держал ОБРАТНОЕ — что `dashed` и
// `accentBar` всегда false.
//
// ЧТО ИЗМЕНИЛОСЬ СЕЙЧАС И ПОЧЕМУ. Полей `dashed`/`accentBar` больше нет вовсе:
// поле, которое всегда false, следующая правка однажды снова научится
// включать, а вместе с ним вернётся и пунктир. Проверять теперь нечего — и
// это и есть проверка: у вида плитки не осталось НИ ОДНОГО входа, от которого
// зависела бы граница. Сторожим это иначе — формой результата (лишних ключей
// в ней нет) и разметкой (в CSS-модуле нет ни одного пунктирного правила для
// вещи). Тест не удалён и не ослаблен: он сменил предмет вслед за кодом.
//
// Серая заливка со значком/буквой по-прежнему означает ровно «фотографии нет» —
// это никогда и не было про состояние.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tileAppearance, type TileItemLike } from "../src/components/zone/tile-appearance";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const PHOTO = "/rooms/p-vinyl.jpg";

function make(overrides: Partial<TileItemLike>): TileItemLike {
  return { photoUrl: null, isDemo: false, title: "Плетёная корзинка", ...overrides };
}

describe("tileAppearance", () => {
  it("вещь с фото → серой заливки нет", () => {
    expect(tileAppearance(make({ photoUrl: PHOTO })).greyFill).toBe(false);
  });

  it("вещь без фото → серая заливка", () => {
    expect(tileAppearance(make({ photoUrl: null })).greyFill).toBe(true);
  });

  it("демо-призрак → ghost, настоящая вещь → нет", () => {
    expect(tileAppearance(make({ isDemo: true })).ghost).toBe(true);
    expect(tileAppearance(make({ isDemo: false })).ghost).toBe(false);
  });

  it("вид плитки решают ровно два входа — фотография и «пример»", () => {
    // Ни `dashed`, ни `accentBar`, ни любого другого ключа состояния в форме
    // нет: вернуть пунктир нельзя, не изменив саму форму результата.
    for (const photoUrl of [null, PHOTO]) {
      for (const isDemo of [false, true]) {
        for (const title of ["Что-то", "", "🎁 подарок"]) {
          const look = tileAppearance({ photoUrl, isDemo, title });
          expect(Object.keys(look).sort()).toEqual([
            "ghost",
            "greyFill",
            "monogram",
            "poolIcon",
          ]);
          // Заливка зависит ТОЛЬКО от фотографии — и ни от чего больше.
          expect(look.greyFill).toBe(photoUrl === null);
          expect(look.ghost).toBe(isDemo);
        }
      }
    }
  });

  it("ПУНКТИРА НЕТ И В РАЗМЕТКЕ — ни в плитке, ни в строке, ни в миниатюрах", () => {
    // Классификатор мог бы остаться чистым, а правило вернуться прямо в CSS —
    // именно так пунктир и жил до тикета 124. Поэтому проверяем и стили: у
    // вещи не должно остаться ни одного пунктирного класса.
    const files = [
      "../src/components/zone/zone-grid.module.css",
      "../src/components/room-list/room-list.module.css",
      "../src/components/scene/zone-list.module.css",
      "../src/components/scene/zone-index.module.css",
    ];
    for (const file of files) {
      const css = read(file);
      expect(css, `${file}: класс пунктирной вещи`).not.toMatch(
        /\.(mediaDashed|thumbWant|chipWant)\b/u,
      );
      // `dashed` как таковой законен — им нарисована рамка ФОКУСА (контракт
      // tokens.json → zoneMarker.focus). Незаконен он у плитки, миниатюры и
      // чипа: ловим по правилам границы, а не по слову.
      expect(css, `${file}: пунктирная граница вещи`).not.toMatch(
        /border:\s*1px dashed[^;]*;\s*\n\s*background-color: rgba\(255, 255, 255, 0\.04\)/u,
      );
    }
    expect(read("../src/components/zone/ItemTile.tsx")).not.toContain("look.dashed");
    expect(read("../src/components/zone/ItemTile.tsx")).not.toContain("look.accentBar");
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
