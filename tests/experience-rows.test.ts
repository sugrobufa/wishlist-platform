// Впечатления строками (тикет 115, доска 34d · турн 9b).
//
// Правило доски: «форму выбирает ЗОНА, а не человек». Проверяется именно
// оно — что зона `events` показывается строками у ОБОИХ (гость и хозяйка), а
// остальные остаются плитками. Смешанной сетки нет ни в одном виде.
//
// Числа строки (высота 92, миниатюра 96×68, разделитель) живут в css-модуле
// и сверяются с ним же: разъедутся — тест скажет, какое именно.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join("src", "components", "zone", relative), "utf8");

describe("форму выбирает зона (тикет 115)", () => {
  it("сетка переключается на строки ровно по ключу зоны events", () => {
    const grid = read("ZoneGrid.tsx");
    expect(grid).toContain('const EXPERIENCE_ZONE = "events"');
    expect(grid).toContain("zoneKey === EXPERIENCE_ZONE");
    expect(grid).toContain("<ExperienceRows");
  });

  it("ключ зоны приходит и гостю, и хозяйке — форма одна на обоих", () => {
    // Если ключ перестанут передавать с гостевой стороны, впечатления у
    // гостя молча вернутся плитками — а доска запрещает разные формы.
    const guest = readFileSync(
      path.join("src", "app", "r", "[slug]", "page.tsx"),
      "utf8",
    );
    const owner = readFileSync(path.join("src", "app", "room", "page.tsx"), "utf8");
    expect(guest).toContain("zoneKey={zoneKey}");
    expect(owner).toContain("zoneKey={zone.key}");
  });

  it("три места пустой зоны — только у хозяйки (гость чужую полку не заводит)", () => {
    const grid = read("ZoneGrid.tsx");
    expect(grid).toContain("ownerEmpty");
    const owner = readFileSync(path.join("src", "app", "room", "page.tsx"), "utf8");
    expect(owner).toContain("ownerEmpty");
    const guest = readFileSync(path.join("src", "app", "r", "[slug]", "page.tsx"), "utf8");
    expect(guest).not.toContain("ownerEmpty");
  });

  it("числа строки — из спецификации, дословно", () => {
    const css = read("experience-rows.module.css");
    expect(css).toContain("min-height: 92px");
    expect(css).toContain("padding: 12px 15px");
    expect(css).toContain("gap: 13px");
    expect(css).toContain("width: 96px");
    expect(css).toContain("height: 68px");
    expect(css).toContain("border-top: 1px solid rgba(255, 255, 255, 0.07)");
    // Просрочка: миниатюра гаснет ровно теми числами, что прислали.
    expect(css).toContain("grayscale(0.55) brightness(0.55)");
  });

  it("тройка «когда · где · до» сжимается в одну строку, пустые поля выпадают", () => {
    const rows = read("experience-rows.tsx");
    expect(rows).toContain('.join(" · ")');
    expect(rows).toContain("filter((part): part is string => Boolean(part && part.trim() !== \"\"))");
  });
});
