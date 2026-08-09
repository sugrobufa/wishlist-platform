// ПЕРЕПИСАН ЦЕЛИКОМ ТИКЕТОМ 124.
//
// Файл защищал правило тикета 78: «Хочу» первым и по умолчанию — во вкладках
// зоны и в фильтре списка комнаты. Довод был продуктовый: площадка про
// подарки, и открывать зону витриной «Люблю» значило показывать первым делом
// то, что подарить нельзя.
//
// Правило растворилось вместе с состояниями. Владелец 09.08.2026: «убираем
// полностью концепцию хочу и люблю». Ставить «Хочу» первым больше негде — в
// комнате ВСЁ есть желание, делить сетку и список нечем. Но само требование
// никуда не делось, оно просто стало сильнее: не «хочу первым», а «выбора
// между состояниями нет вовсе». Именно это здесь и сторожим — чтобы вкладки
// и чипы не вернулись молча следующей правкой.
//
// Тест смотрит на ИСХОДНИКИ, а не рендерит компоненты: и вкладки, и чипы были
// видны в коде однозначно — их отсутствие видно так же.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const roomList = read("../src/components/room-list/room-list-view.tsx");
const ownerGrid = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
const addFlow = read("../src/app/room/add/add-item-flow.tsx");

describe("сетка зоны: вкладок «Хочу/Люблю» больше нет", () => {
  it("массива вкладок и переключателя вкладки не существует", () => {
    expect(zoneGrid).not.toMatch(/key: "(LOVE|WANT)"/u);
    expect(zoneGrid).not.toContain('role="tablist"');
    expect(zoneGrid).not.toContain('role="tab"');
    expect(zoneGrid).not.toContain("setTab");
  });

  it("сетка показывает ВСЕ пришедшие вещи одним списком", () => {
    // Единственный источник того, что рисуется, — сами `items`: никакого
    // отбора по состоянию между входом и разметкой не осталось.
    expect(zoneGrid).toContain("const shown = items;");
  });
});

describe("список комнаты: чипов состояния больше нет", () => {
  it("ряд «Хочу · Люблю · Все» снят, тип Filter не существует", () => {
    expect(roomList).not.toMatch(/type Filter/u);
    expect(roomList).not.toMatch(/\["(all|want|love)", t\(/u);
    expect(roomList).not.toContain("setFilter");
  });

  it("«Только свободные» остался — он про брони, а не про состояния", () => {
    expect(roomList).toContain("freeOnly");
    expect(roomList).toMatch(/items\.filter\(\(item\) => !takenIds\.has\(item\.id\)\)/u);
  });
});

describe("ни один экран не спрашивает у вещи состояние", () => {
  it("в сетке, списке и зоне хозяйки нет обращений к item.state", () => {
    for (const [name, source] of [
      ["ZoneGrid", zoneGrid],
      ["room-list-view", roomList],
      ["owner-zone-grid", ownerGrid],
    ] as const) {
      expect(source, `${name}: обращение к item.state`).not.toMatch(/item\.state/u);
    }
  });
});

/**
 * Форма добавления — последнее место, где выбор состояния ещё жил. Заход по
 * серверу свёл «люблю» на `inHall: true`, чтобы форма не падала валидацией, и
 * оставил переключатель на экране временно. Здесь он снят совсем.
 *
 * Почему это отдельная проверка, а не «и так видно»: панели были красивыми —
 * два кропа комнаты, призрачный контур, светящаяся полоса, — и вернуть их
 * соблазнительно. Экран стал короче на один выбор, и это была цель, а не
 * побочный эффект: вещь, которую кладут В КОМНАТУ, по определению «чего
 * хочется», а второе место открывается своим входом `?hall=1`.
 */
describe("форма добавления: шага «что это для тебя» больше нет", () => {
  it("панелей выбора и их модуля не существует", () => {
    expect(addFlow).not.toContain("stateChoicePanels");
    expect(addFlow).not.toContain("ItemState");
    expect(() => read("../src/app/room/add/state-choice.ts")).toThrow();
    expect(() => read("../src/app/room/add/state-choice.test.ts")).toThrow();
  });

  it("место решает АДРЕС, а не экран", () => {
    // `?hall=1` — сокровищница, без параметра — комната. Ни того, ни другого
    // человек на форме не выбирает.
    expect(addFlow).toContain("if (!toHall) {");
    expect(addFlow).toContain("inHall: false as const");
    expect(addFlow).toContain("inHall: true as const");
    expect(addFlow).not.toMatch(/setState\(/u);
  });

  it("слов «люблю» и «хочу» на экране не осталось", () => {
    for (const key of ["loveLabel", "wantLabel", "loveHint", "wantHint", "question"]) {
      expect(addFlow, key).not.toContain(`t("${key}")`);
    }
    // Заголовок называет МЕСТО.
    expect(addFlow).toContain('t("hallLabel")');
    expect(addFlow).toContain('t("roomLabel")');
  });
});
