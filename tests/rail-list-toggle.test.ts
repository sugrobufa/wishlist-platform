// Знак «Списком» переключает полосу под кадром, а не уводит со страницы
// (тикет 129, приёмка владельца 09.08.2026).
//
// ЗАЧЕМ ТЕСТ. Владелец просил это дважды и оба раза снимком: сначала стрелкой
// от знака в углу ВНИЗ, в полосу, потом обведя саму область — «я же показываю
// область, куда надо поставить списком». Первая сборка (тикет 118) прочитала
// просьбу как «сделать знаком» и оставила его выходом из комнаты. Правка
// стоит ровно в этом: управление стоит там, где то, чем оно управляет, и кадр
// с экрана не уходит.
//
// Три вещи ломаются молча, и потому проверяются здесь:
// 1. знак снова становится ссылкой — и «Списком» опять уводит со страницы;
// 2. вместе со списком пропадает указатель зон — а он второе положение
//    переключателя, и на телефоне единственная дорога к 33 зонам, которые в
//    покое стоят за правым краем окна (ADR-0006);
// 3. полоса начинает менять высоту от того, что в ней показано, — а её высота
//    входит в расчёт раскладки сцены (immersive-layout.ts, тикеты 42/45).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string) => dict[ns]?.[key] ?? key,
    useLocale: () => "ru",
  };
});

const { ZoneRail } = await import("../src/components/scene/zone-rail");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rail = read("../src/components/scene/zone-rail.tsx");
const railCss = read("../src/components/scene/zone-index.module.css");
const ownerPage = read("../src/app/room/page.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const listView = read("../src/components/room-list/room-list-view.tsx");

const ZONES = [
  { key: "clothes", label: "Одежда" },
  { key: "beauty", label: "Красота и уход" },
] as unknown as Parameters<typeof ZoneRail>[0]["zones"];

/** Дети — строка действий полосы; тесту в ней нечего проверять, отдаём пустую. */
const draw = (roomList?: unknown) =>
  renderToStaticMarkup(
    createElement(
      ZoneRail,
      {
        zones: ZONES,
        viewer: "owner",
        accent: "#E7C9A9",
        ...(roomList === undefined ? {} : { roomList: roomList as never }),
      } as never,
      null,
    ),
  );

describe("знак стоит в полосе, а не в углу сцены", () => {
  it("это КНОПКА, а не ссылка: маршрут не меняется", () => {
    const markup = draw(createElement("p", null, "все вещи"));
    expect(markup).toContain("<button");
    // Ни одной ссылки на отдельный экран списка из самой полосы.
    expect(markup).not.toContain("/room/list");
    expect(rail).not.toMatch(/<Link[^>]*room\/list/u);
  });

  it("у знака видимое включённое состояние", () => {
    // Иначе человек не поймёт, в каком из двух видов он находится.
    const markup = draw(createElement("p", null, "все вещи"));
    expect(markup).toContain('aria-pressed="false"');
    expect(rail).toContain("aria-pressed={showList}");
    expect(rail).toMatch(/listMarkOn/u);
    expect(railCss).toMatch(/\.stack \.listMarkOn \{[\s\S]*?border-color: var\(--rail-accent/u);
  });

  it("слово живёт в aria-label и подсказке — на экране его нет", () => {
    const markup = draw(createElement("p", null, "все вещи"));
    expect(markup).toContain('aria-label="Списком"');
    expect(markup).toContain('title="Списком"');
    expect(markup).not.toMatch(/>Списком</u);
  });

  it("второе нажатие возвращает зоны: переключатель — чистая инверсия", () => {
    expect(rail).toContain("setAsList((value) => !value)");
    // Состояние клиентское и на сессию: это взгляд, а не настройка — ни в
    // БД, ни в cookie, ни в хранилище браузера оно не пишется. Ловим ЧТЕНИЕ и
    // ЗАПИСЬ, а не слово: про cookie в этом файле написано в комментарии.
    expect(rail).toContain("useState(false)");
    expect(rail).not.toMatch(/document\.cookie|localStorage|sessionStorage/u);
    expect(rail).not.toMatch(/fetch\(|Action\(/u);
  });

  it("без узла списка полоса ровно такая, какой была: знака нет", () => {
    const markup = draw();
    expect(markup).not.toContain('aria-label="Списком"');
  });
});

describe("указатель зон — второе положение, а не остаток", () => {
  it("в покое полоса показывает именно зоны", () => {
    const markup = draw(createElement("p", null, "плоский список"));
    expect(markup).toContain("Одежда");
    expect(markup).toContain("Красота и уход");
    // Список всех вещей в покое не смонтирован вовсе.
    expect(markup).not.toContain("плоский список");
  });

  it("оба вида оглавления на месте: горизонтальный и вертикальный", () => {
    // Рисуются ОБА, лишний гасится медиа-запросом своего модуля — на телефоне
    // вертикальный список, на десктопе указатель со сводкой.
    expect(rail).toContain("<ZoneIndex");
    expect(rail).toContain("<ZoneList");
  });
});

describe("список встал в полосу, не сломав раскладку", () => {
  it("прокручивается сам, а не распирает полосу", () => {
    expect(railCss).toMatch(/\.listPane \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/u);
  });

  it("на десктопе не выше своей ленты — иначе поедет коробка сцены", () => {
    expect(railCss).toMatch(
      /\.listPane \{\s*max-height: calc\(var\(--imm-rail-bottom, 116px\) - 52px\);/u,
    );
    // Высота полосы в расчёте раскладки не изменилась.
    const layout = read("../src/components/scene/immersive-layout.ts");
    expect(layout).not.toContain("listPane");
  });

  it("знак стоит справа, действия — слева одной группой", () => {
    // `.imm-row` растаскивает детей `space-between`; без обёртки знак встал бы
    // третьим в ряду, а не у правого края (у хозяйки в строке ещё «Добавить
    // вещь» и «поделиться»).
    expect(rail).toContain("s.rowLead");
    expect(railCss).toMatch(/\.rowLead \{[\s\S]*?display: flex;/u);
    expect(railCss).toMatch(/\.stack \.listMark \{[\s\S]*?width: var\(--hit-target-min, 44px\);/u);
  });
});

describe("одинаково у хозяйки и у гостя", () => {
  it("обе страницы отдают полосе список всех вещей", () => {
    expect(ownerPage).toMatch(/roomList=\{\s*<RoomListView/u);
    expect(guestPage).toMatch(/roomList=\{[\s\S]{0,400}<GuestRoomListView/u);
  });

  it("встроенный список не рисует свой переключатель «Комната / Список»", () => {
    // Он уводил бы со страницы — ровно то, от чего тикет и избавляется.
    expect(listView).toContain("{!embedded && roomHref && (");
    expect(ownerPage).toContain("embedded");
    expect(guestPage).toContain("embedded");
  });

  it("у гостя список слушается тех же фильтров, что и зоны", () => {
    // Спрятанные вещи и выключенные зоны отрезал сервис (инвариант №5),
    // демо-призраки отброшены здесь, «уже дарят» приезжает набором `taken`
    // из некэшируемого канала.
    expect(guestPage).toContain("visibleZones(preset.zones, room.zonesOff)");
    expect(guestPage).toMatch(/\.filter\(\(item\) => !item\.isDemo\)/u);
    const guestList = read("../src/app/r/[slug]/list/guest-room-list.tsx");
    expect(guestList).toContain("takenIds={taken}");
  });

  it("второго запроса канала «занято» на экране комнаты не появилось", () => {
    // Провайдер уже стоит на всей странице; список берёт вид БЕЗ своего.
    expect(guestPage).toContain("<GuestRoomListView");
    expect(guestPage).not.toContain("<GuestRoomList ");
  });
});

describe("отдельные маршруты списка живы (долг тикета 129)", () => {
  it("страницы никуда не делись — прямые ссылки не ломаем", () => {
    expect(() => read("../src/app/room/list/page.tsx")).not.toThrow();
    expect(() => read("../src/app/r/[slug]/list/page.tsx")).not.toThrow();
  });
});
