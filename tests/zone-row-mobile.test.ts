// Экран зоны списком на телефоне — обход приёмки 10.08.2026.
//
// ЗАЧЕМ ТЕСТ. Оба дефекта ломаются молча: разметка остаётся валидной, падать
// нечему, а на телефоне до «Добавить вещь» надо домотать и название вещи лежит
// на её же цене. Проверяем правила, а не пиксели.
//
// A Дорога «+ Добавить вещь» стоит НАД списком: под ним она уезжала вниз
//   вместе с каждой новой вещью (строка 93 px: при двенадцати вещах — 1368 px
//   от верха, почти два телефонных экрана). Ровно это замечание владельца
//   тикет 139 уже исполнил в листе зоны внутри сцены.
// B Мета-строка (цена + огоньки) на телефоне уходит ПОД название: знаки
//   действий (90 px) оставляли названию 71 px на 375 и 56 на 360, и слово
//   ложилось на цену — «Хронограф» заходил на «140 000 ₽» на 9 и 24 px.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../src/app/room/zone/[zone]/page.tsx");
const grid = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
const own = read("../src/app/room/zone/[zone]/owner-zone-grid.module.css");
const shared = read("../src/components/room-list/room-list.module.css");

/** Телефонная ветка раскладки — точное дополнение десктопной, порог один. */
const PHONE_BRANCH = /@media not all and \(min-width: 1024px\) \{([\s\S]*?)\n\}/gu;
const phoneBlocks = (css: string) => [...css.matchAll(PHONE_BRANCH)].map((m) => m[1] ?? "");

/** Число из правила общей строки: `.thumb { width: 72px }` и т. п. */
const numberIn = (css: string, selector: string, property: string): number => {
  const block = new RegExp(`\\.${selector} \\{([^}]*)\\}`, "u").exec(css)?.[1] ?? "";
  const raw = new RegExp(`${property}: (\\d+(?:\\.\\d+)?)px`, "u").exec(block)?.[1];
  expect(raw, `в общей строке пропало правило .${selector} { ${property} }`).toBeTruthy();
  return Number(raw);
};

describe("A — дорога «Добавить вещь» над списком зоны", () => {
  it("ссылка в зону идёт РАНЬШЕ сетки, а не под ней", () => {
    // Проверяем ПОРЯДОК, а не наличие: ссылка была на месте и до правки — она
    // просто стояла в конце списка, и список её отодвигал.
    const add = page.indexOf("href={`/room/add?zone=${zone.key}`}");
    const list = page.indexOf("<OwnerZoneGrid");
    expect(add, "дорога «+ Добавить вещь» пропала с экрана зоны").toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(add, "ссылка снова уехала под список").toBeLessThan(list);
  });

  it("отступ у неё нижний: она стоит над списком, а не липнет к нему", () => {
    expect(page).toContain('className="pressable mb-6 inline-block text-xs font-semibold"');
  });
});

describe("B — название вещи не ложится на цену", () => {
  it("поправка живёт ТОЛЬКО в телефонной ветке: десктоп её не видит", () => {
    const phone = phoneBlocks(own);
    expect(phone.length, "телефонная ветка поправки пропала").toBe(1);
    expect(phone[0]).toContain("flex-wrap: wrap;");
    expect(phone[0]).toContain("order: 3;");
    // Вне ветки — только объявление отступа, никакой раскладки.
    const outside = own.replace(PHONE_BRANCH, "");
    expect(outside, "правило переноса вылезло из телефонной ветки").not.toContain("flex-wrap");
    expect(outside).not.toContain("margin-left");
  });

  it("селекторы двухклассовые — иначе вес не перебьёт общую строку", () => {
    // `.row` и `.meta` заданы в room-list одним классом. Правило такого же
    // веса зависело бы от порядка склейки модулей в бандл, то есть молчало бы
    // через раз.
    expect(own).toMatch(/\.rows \.row \{/u);
    expect(own).toMatch(/\.rows \.meta \{/u);
  });

  it("отступ мета-строки СЧИТАЕТСЯ по общей строке, а не подобран на глаз", () => {
    // Мета-строка встаёт под названием, значит её отступ — это миниатюра плюс
    // промежуток строки. Числа принадлежат room-list.module.css; разъедутся
    // там — тест скажет здесь.
    const thumb = numberIn(shared, "thumb", "width");
    const gap = numberIn(shared, "row", "gap");
    const indent = /--zr-meta-indent: (\d+)px;/u.exec(own)?.[1];
    expect(indent, "объявление --zr-meta-indent пропало").toBeTruthy();
    expect(Number(indent), "отступ мета-строки разъехался с общей строкой").toBe(thumb + gap);
    expect(own).toContain("margin-left: var(--zr-meta-indent);");
  });

  it("классы поправки надеты на все три узла — иначе она молчит", () => {
    // Правила ищут `.rows .row` и `.rows .meta`: потеряй экран любой из трёх
    // классов, и раскладка тихо вернётся к прежней.
    expect(grid).toContain("${rl.rows} ${z.rows}");
    expect(grid).toContain("${rl.row} ${z.row}");
    expect(grid).toContain("${rl.meta} ${z.meta}");
  });

  it("общая строка «комнаты списком» остаётся нетронутой", () => {
    // У неё три жильца вместо четырёх (знаков действий там нет по пакету), и
    // названию достаётся 168–182 px. Чинит себя экран зоны, а не все сразу.
    // (`flex-wrap` в файле есть — у пилюль фильтра; речь про саму строку.)
    const row = /\.row \{([^}]*)\}/u.exec(shared)?.[1] ?? "";
    expect(row, "правило общей строки пропало").toContain("display: flex;");
    expect(row, "перенос уехал в общую строку — он телефонный и только зоны").not.toContain(
      "flex-wrap",
    );
    expect(shared).not.toContain("--zr-meta-indent");
    // И телефонной ветки у общей строки по-прежнему нет вовсе.
    expect(phoneBlocks(shared).length).toBe(0);
  });
});
