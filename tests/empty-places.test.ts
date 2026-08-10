// ТРИ ПУСТЫХ МЕСТА на сцене пустой комнаты (тикет 142, пакет раунда 34).
//
// ПОЧЕМУ ЗДЕСЬ НЕТ ТАБЛИЦЫ ДИЗАЙНА. Пакет прислал не только правило, но и
// receipt — прогон правила по десяти интерьерам, с приглашением сверить числа.
// Сверили: receipt посчитан по снимку `rooms.json` ДО переразметок раунда 8 и
// старше (их `zoneRect` для `cream/beauty`, `lux/travel` и `cottage/music`
// посимвольно равны нашему полю `rectOld`; отдельно уехал `study`, где
// `anything` переразмечен в раунде 13 и стал кандидатом). На нынешних
// координатах правило даёт другие тройки в четырёх комнатах из десяти. Правило
// при этом у нас и у дизайна ОДНО — разошёлся вход, и расхождение выписано
// дизайну письмом.
//
// Поэтому ожиданием служат две вещи, и обе наши:
//   1) само ПРАВИЛО — окно, трети, победа по площади, добор пустой трети,
//      выбор главного места;
//   2) СНИМОК результата на сегодняшнем `rooms.json` — чтобы следующая
//      переразметка зоны не переставила места молча.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hitTargetMin, rooms, roomsContract } from "../src/config/design";
import {
  emptyPlaces,
  isPlaceCandidate,
  placeArmPx,
  placeFill,
  placeRect,
  placesContract,
  placeThird,
  PLACE_BREATH,
  PLACE_CORNER_COUNT,
  PLACE_OPACITY,
  PLACE_STROKE_PX,
  PLACE_WINDOW,
  THIRD_BOUNDS,
} from "../src/components/scene/empty-places";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stage = read("../src/components/scene/SceneStage.tsx");

/** Место одной строкой: «ключ*  ШxВ @ x,y», звёздочка — главное (дышит). */
function line(place: { key: string; rect: { x: number; y: number; w: number; h: number }; primary: boolean }) {
  const r = place.rect;
  return `${place.key}${place.primary ? "*" : ""} ${r.w}x${r.h}@${r.x},${r.y}`;
}

/**
 * СНИМОК: что правило даёт на СЕГОДНЯШНЕМ `rooms.json` (все десять комнат, по
 * зонам, которые продукт показывает). Не «правильный ответ дизайна», а наш
 * зафиксированный результат: переразметят зону — тест упадёт, и место
 * переедет осознанно, а не молча.
 */
const SNAPSHOT: Record<string, [string, string, string]> = {
  cream: ["fashion* 51x110@150,132", "beauty 37x34@268,164", "home 38x32@425,188"],
  warm: ["beauty 60x93@194,34", "travel* 97x68@249,243", "anything 50x74@138,238"],
  lux: ["travel* 56x87@311,235", "events 40x57@338,92", "beauty 41x47@239,143"],
  emerald: ["bags 43x41@118,228", "travel* 91x63@236,268", "events 67x63@389,84"],
  bold: ["beauty* 79x58@223,190", "events 76x57@397,76", "travel 66x51@304,286"],
  cottage: ["anything 64x59@143,268", "travel* 99x69@269,254", "music 40x27@423,217"],
  gamer: ["travel* 56x56@192,245", "tech 52x34@254,147", "sport 50x35@385,175"],
  sport: ["anything* 57x46@175,278", "events 34x34@417,152", "grooming 37x34@212,170"],
  study: ["anything* 52x56@182,247", "sport 42x53@313,261", "events 34x34@423,73"],
  loft: ["tech 34x34@196,168", "music* 73x35@264,169", "books 38x38@456,100"],
};

/** Пустые трети, закрытые добором, — часть того же снимка. */
const SNAPSHOT_FALLBACK: Record<string, string[]> = {
  cream: [],
  warm: ["III"],
  lux: ["I", "III"],
  emerald: [],
  bold: ["I"],
  cottage: [],
  gamer: [],
  sport: ["II"],
  study: [],
  loft: [],
};

describe("142 — правило выбора трёх мест", () => {
  it("снимок на сегодняшнем rooms.json: десять комнат по три места", () => {
    for (const room of rooms) {
      const run = emptyPlaces(room.zones);
      expect(run.places.map(line), `${room.id}: места переехали`).toEqual(SNAPSHOT[room.id]);
      expect(run.fallbackThirds, `${room.id}: другой добор третей`).toEqual(
        SNAPSHOT_FALLBACK[room.id],
      );
    }
  });

  it("окно и трети — числа контракта, а не наши", () => {
    expect([PLACE_WINDOW.x0, PLACE_WINDOW.x1]).toEqual([105, 525]);
    expect(THIRD_BOUNDS).toEqual([245, 385]);
    // Окно — центральные 420 из 630: поля слева и справа одинаковые.
    expect(PLACE_WINDOW.x0).toBe(placesContract.frame.w - PLACE_WINDOW.x1);
    // Трети равны: 140 каждая.
    expect(THIRD_BOUNDS[0] - PLACE_WINDOW.x0).toBe(140);
    expect(THIRD_BOUNDS[1] - THIRD_BOUNDS[0]).toBe(140);
    expect(PLACE_WINDOW.x1 - THIRD_BOUNDS[1]).toBe(140);
  });

  it("кандидат — прямоугольник ЦЕЛИКОМ в окне; треть решает центр", () => {
    expect(isPlaceCandidate({ x: 105, y: 0, w: 420, h: 10 })).toBe(true);
    expect(isPlaceCandidate({ x: 104, y: 0, w: 10, h: 10 })).toBe(false);
    expect(isPlaceCandidate({ x: 520, y: 0, w: 10, h: 10 })).toBe(false);
    expect(placeThird({ x: 105, y: 0, w: 10, h: 10 })).toBe(0);
    expect(placeThird({ x: 240, y: 0, w: 10, h: 10 })).toBe(1);
    expect(placeThird({ x: 380, y: 0, w: 10, h: 10 })).toBe(2);
  });

  it("в трети побеждает площадь, ничья — порядок в rooms.json", () => {
    const big = { key: "big", rect: { x: 110, y: 10, w: 90, h: 90 } };
    const small = { key: "small", rect: { x: 110, y: 110, w: 40, h: 40 } };
    const mid2 = { key: "mid2", rect: { x: 260, y: 10, w: 60, h: 60 } };
    const far3 = { key: "far3", rect: { x: 400, y: 10, w: 50, h: 50 } };
    expect(emptyPlaces([small, big, mid2, far3]).places.map((p) => p.key)).toEqual([
      "big",
      "mid2",
      "far3",
    ]);
    // Две одинаковые площади в одной трети — берётся та, что раньше в списке.
    const twinA = { key: "twinA", rect: { x: 110, y: 10, w: 50, h: 50 } };
    const twinB = { key: "twinB", rect: { x: 170, y: 10, w: 50, h: 50 } };
    expect(emptyPlaces([twinA, twinB, mid2, far3]).places[0]?.key).toBe("twinA");
    expect(emptyPlaces([twinB, twinA, mid2, far3]).places[0]?.key).toBe("twinB");
  });

  it("пустая треть закрывается добором по площади — мест остаётся три", () => {
    // Все три кандидата в одной трети (случай «Пентхауса» из письма дизайна).
    const zones = [
      { key: "a", rect: { x: 250, y: 10, w: 100, h: 100 } },
      { key: "b", rect: { x: 250, y: 120, w: 80, h: 80 } },
      { key: "c", rect: { x: 250, y: 210, w: 60, h: 60 } },
      { key: "d", rect: { x: 250, y: 280, w: 40, h: 40 } },
    ];
    const run = emptyPlaces(zones);
    expect(run.places.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect(run.fallbackThirds).toEqual(["I", "III"]);
  });

  it("кандидатов меньше трёх — отдаём сколько есть, а не выдумываем зону", () => {
    // Контракт этой ветки не описывает; нейтральный дефолт — молчание.
    const run = emptyPlaces([{ key: "one", rect: { x: 200, y: 10, w: 50, h: 50 } }]);
    expect(run.places).toHaveLength(1);
    expect(run.places[0]?.primary).toBe(true);
  });

  it("ЗОНЫ БЕЗ ПРЕДМЕТА в кандидаты не идут — вопреки букве контракта", () => {
    // `places.json` пишет «выключенные зоны в rooms.json отсутствуют, исключать
    // нечего», и про наш файл это неверно: восемь зон стоят с `objectAbsent`,
    // продукт их не показывает (инвариант №9, 122 из 130). Сам дизайн считал
    // так же — иначе тройка «Спорта» в его receipt не воспроизводится.
    const absent = roomsContract.rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.objectAbsent).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(absent.sort()).toEqual(
      [
        "emerald/beauty",
        "loft/gaming",
        "lux/music",
        "sport/gaming",
        "sport/watches",
        "study/gaming",
        "study/tech",
        "warm/music",
      ].sort(),
    );
    // Фильтр стоит В САМОМ ПРАВИЛЕ, а не только у вызова: победила бы иначе.
    const zones = [
      { key: "absent", rect: { x: 250, y: 10, w: 120, h: 120 }, objectAbsent: true },
      { key: "real", rect: { x: 250, y: 140, w: 60, h: 60 } },
    ];
    expect(emptyPlaces(zones).places.map((p) => p.key)).toEqual(["real"]);
    // И ни одна скрытая зона не попала в снимок.
    for (const room of rooms) {
      for (const place of emptyPlaces(room.zones).places) {
        expect(absent, `${room.id}/${place.key}: место на зоне без предмета`).not.toContain(
          `${room.id}/${place.key}`,
        );
      }
    }
  });

  it("мест ровно три в каждой комнате, и каждое ведёт в ЖИВУЮ зону", () => {
    for (const room of rooms) {
      const { places } = emptyPlaces(room.zones);
      expect(places, `${room.id}: мест не три`).toHaveLength(3);
      expect(new Set(places.map((p) => p.key)).size, `${room.id}: место повторило зону`).toBe(3);
      for (const place of places) {
        expect(
          room.zones.some((zone) => zone.key === place.key),
          `${room.id}/${place.key}: место ведёт в зону, которой на экране нет`,
        ).toBe(true);
      }
      expect(places.filter((p) => p.primary), `${room.id}: главных мест не одно`).toHaveLength(1);
    }
  });

  it("главное место — наибольшая площадь МЕСТА, а не зоны", () => {
    for (const room of rooms) {
      const { places } = emptyPlaces(room.zones);
      const areas = places.map((p) => p.rect.w * p.rect.h);
      const primary = places.findIndex((p) => p.primary);
      expect(areas[primary], `${room.id}: дышит не самое большое место`).toBe(Math.max(...areas));
    }
  });
});

describe("142 — геометрия места из прямоугольника зоны", () => {
  it("формула читается из контракта, а не переписана числом", () => {
    // Если дизайн подвинет коэффициент или зажимы, правка доедет сама.
    expect(placesContract.placeGeometry.w).toBe("min(max(round(0.62 * zone.w), 34), 120, zone.w)");
    expect(placesContract.placeGeometry.h).toBe("min(max(round(0.62 * zone.h), 34), 110, zone.h)");
    // «Одежда» кремовой: 83×191 → 51×110 (совпадает и с образцом на доске 42a).
    expect(placeRect({ x: 134, y: 91, w: 83, h: 191 })).toEqual({ x: 150, y: 132, w: 51, h: 110 });
    // Зона ниже нижнего зажима: место не может быть больше своей зоны.
    expect(placeRect({ x: 413, y: 188, w: 62, h: 32 })).toEqual({ x: 425, y: 188, w: 38, h: 32 });
  });

  it("место лежит ВНУТРИ своей зоны и соосно с ней — на всех зонах контракта", () => {
    // Из этого свойства следует поведение: своей кнопки месту не нужно, тап
    // проходит сквозь него в кнопку зоны того же центра.
    for (const room of rooms) {
      for (const zone of room.zones) {
        const place = placeRect(zone.rect);
        const label = `${room.id}/${zone.key}`;
        expect(place.w, `${label}: место шире зоны`).toBeLessThanOrEqual(zone.rect.w);
        expect(place.h, `${label}: место выше зоны`).toBeLessThanOrEqual(zone.rect.h);
        expect(place.x, `${label}: место вылезло влево`).toBeGreaterThanOrEqual(zone.rect.x);
        expect(place.y, `${label}: место вылезло вверх`).toBeGreaterThanOrEqual(zone.rect.y);
        expect(place.x + place.w).toBeLessThanOrEqual(zone.rect.x + zone.rect.w);
        expect(place.y + place.h).toBeLessThanOrEqual(zone.rect.y + zone.rect.h);
        // Центры совпадают с точностью до округления в полпикселя кадра.
        expect(
          Math.abs(place.x + place.w / 2 - (zone.rect.x + zone.rect.w / 2)),
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(place.y + place.h / 2 - (zone.rect.y + zone.rect.h / 2)),
        ).toBeLessThanOrEqual(0.5);
        // Верхний зажим держится всегда, нижний — пока зона не меньше него.
        expect(place.w, `${label}: место шире потолка`).toBeLessThanOrEqual(120);
        expect(place.h, `${label}: место выше потолка`).toBeLessThanOrEqual(110);
        if (zone.rect.w >= 34) expect(place.w).toBeGreaterThanOrEqual(34);
        if (zone.rect.h >= 34) expect(place.h).toBeGreaterThanOrEqual(34);
      }
    }
  });

  it("хит-цель у места уже есть — её держит кнопка зоны", () => {
    // Контракт просит «прямоугольник места, растянутый от центра до >= 44×44
    // экранных px». Отдельного механизма не заводим: `.hotspot::after`
    // добивает прямоугольник ЗОНЫ до hitTargetMin от центра, а центр у зоны и
    // места общий — значит и место накрыто целиком.
    expect(hitTargetMin).toBe(44);
    expect(placesContract.placeGeometry.hitTarget).toContain("44");
    expect(sceneCss).toContain("top: min(0px, calc(50% - var(--hit-min) / 2));");
  });

  it("плечо уголка укорачивается только у мелкого места", () => {
    expect(placeArmPx({ x: 0, y: 0, w: 38, h: 32 })).toBe(11);
    expect(placeArmPx({ x: 0, y: 0, w: 120, h: 110 })).toBe(11);
    // «Коттедж», музыка: 40×27 — меньшая сторона ниже 32, плечо 35% от неё.
    expect(placeArmPx({ x: 0, y: 0, w: 40, h: 27 })).toBeCloseTo(9.45, 2);
    // Плечи двух углов не смыкаются ни на одном месте всех десяти комнат —
    // иначе разомкнутые углы превратились бы в непрерывную рамку.
    for (const room of rooms) {
      for (const place of emptyPlaces(room.zones).places) {
        const arm = placeArmPx(place.rect);
        expect(arm * 2, `${room.id}/${place.key}: углы сомкнулись в рамку`).toBeLessThan(
          Math.min(place.rect.w, place.rect.h),
        );
      }
    }
  });
});

describe("142 — вид места: числа контракта против CSS", () => {
  it("четыре угла, толщина 1.5, срез прямой", () => {
    expect(PLACE_CORNER_COUNT).toBe(4);
    expect(PLACE_STROKE_PX).toBe(1.5);
    expect(placesContract.visual.corners.cap).toContain("прямой");
    expect(stage.match(/s\.placeCorner(?![A-Z])/gu) ?? []).toHaveLength(PLACE_CORNER_COUNT);
    expect(stage).toContain('"--place-stroke-rest": `${PLACE_STROKE_PX}px`');
    for (const corner of ["TL", "TR", "BR", "BL"]) {
      expect(sceneCss, `угол ${corner} пропал из CSS`).toContain(`.placeCorner${corner} {`);
    }
    // Уголок нарисован ПОЛОСАМИ, а не границей: `border-width: 1.5px` браузер
    // прижимает к целому устройственному пикселю (на dpr 1.25 меряется обратно
    // как 0.8 — замерено на стенде), а полоса-градиент держит ровно 1.5.
    expect(sceneCss).toMatch(
      /\.placeCorner \{[^}]*background-size: 100% var\(--place-stroke\), var\(--place-stroke\) 100%;/u,
    );
    expect(sceneCss).not.toMatch(/\.placeCorner[A-Z]* \{[^}]*border/u);
  });

  it("альфы и партитура дыхания — из places.json", () => {
    expect(PLACE_OPACITY.others).toBe(0.55);
    expect(PLACE_OPACITY.breathFrom).toBe(0.55);
    expect(PLACE_OPACITY.breathTo).toBe(0.85);
    expect(PLACE_OPACITY.reduced).toBe(0.7);
    expect(PLACE_BREATH).toBe("3.6s ease-in-out infinite alternate");
    expect(sceneCss).toMatch(/\.placePrimary \{\s*animation: place-breath var\(--place-breath\);/u);
    expect(sceneCss).toMatch(
      /@keyframes place-breath \{[\s\S]*var\(--place-o0\)[\s\S]*var\(--place-o1\)/u,
    );
    // prefers-reduced-motion: дыхания нет, главное место стоит на .7.
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(reduced).toContain("animation: none;");
    expect(reduced).toContain("opacity: var(--place-o-reduced);");
  });

  it("заливка — градиент акцента .08 к нулю на 75%", () => {
    expect(placeFill()).toBe(
      "linear-gradient(180deg, color-mix(in srgb, var(--place-accent) 8%, transparent), transparent 75%)",
    );
    // Цвет — РОДНОЙ акцент комнаты, а не тонированный светом `--accent`.
    expect(stage).toContain('"--place-accent": preset.accent');
  });

  it("ПУНКТИРА У МЕСТА НЕТ — ни одного признака умершей плитки «хочу»", () => {
    // Инвариант №3 отменён целиком (тикет 124): пунктира не бывает ни при
    // каком входе. Место — не плитка, но человек прочтёт его глазами, поэтому
    // сторожим разметку: рамка разомкнута (четыре угла, а не border коробки),
    // штриха нет, толщина 1.5, скругления нет.
    // Комментарии снимаем: слова «пунктир» и `dashed` в прозе про то, ПОЧЕМУ
    // его здесь нет, — это объяснение, а не правило.
    const rules = sceneCss.replace(/\/\*[\s\S]*?\*\//gu, "");
    const block = /\.place \{[\s\S]*?\.hotspotsHidden \.place \{[\s\S]*?\n\}/u.exec(rules)?.[0];
    expect(block, "блок правил места пропал из CSS").toBeTruthy();
    expect(block).not.toMatch(/dashed|dotted/u);
    expect(block).not.toMatch(/border-radius/u);
    // Рамки коробки у места нет — только границы углов.
    expect(block).not.toMatch(/\.place \{[^}]*border:/u);
    // И полосы света под местом тоже нет: свет обещан подписью сцены.
    expect(block).not.toMatch(/box-shadow/u);
    expect(placesContract.visual.noLightLine).toContain("НЕТ");
  });

  it("ФОКУС МЕСТА СВОЙ — пунктирная рамка метки зоны на него не приходит", () => {
    // Ловушка: `--zone-focus-outline` это `1px dashed {accent}` из контракта
    // (законный, но единственный законный) пунктир. Приди он на уголки места —
    // на тёмной пустой сцене человек прочтёт ровно умершее «хочу».
    // Место фокус не принимает вовсе: это не кнопка, у него нет tabindex и
    // aria-роли, а `pointer-events: none` не даёт даже нажать.
    expect(stage).not.toMatch(/<button[^>]*s\.place/u);
    expect(stage).not.toMatch(/className=\{[^}]*s\.place[^}]*\}[\s\S]{0,300}(tabIndex|onClick)/u);
    expect(sceneCss).not.toMatch(/\.place[A-Za-z]*:focus/u);
    expect(sceneCss).not.toMatch(/\.place[A-Za-z]*[^{}]*\{[^}]*--zone-focus-outline/u);
    // А ответ на фокус кнопки у места есть — свой: толще и ярче, без штриха.
    const focus = /\.hotspotSlot:has\(\.hotspot:focus-visible\) \.place \{([\s\S]*?)\n\}/u.exec(
      sceneCss,
    )?.[1];
    expect(focus, "у места пропал свой вид фокуса").toBeTruthy();
    expect(focus).toContain("--place-stroke: calc(var(--place-stroke-rest) * 2);");
    expect(focus).toContain("opacity: 1;");
    expect(focus).not.toMatch(/dashed|dotted/u);
  });

  it("подписи у места нет — имя зоны говорит наезд", () => {
    expect(placesContract.visual.noCaption).toContain("подписей у мест нет");
    expect(stage).toMatch(/aria-hidden\s*\n\s*className=\{place\.primary/u);
  });
});

describe("142 — места живут ровно столько же, сколько тёмная сцена", () => {
  it("рисуются только в пустой комнате и уходят с первой вещью", () => {
    // Отдельного правила «исчезнуть» не нужно: места висят на том же `empty`,
    // что и темнота, а `empty` — это `itemCount === 0` (тикет 137).
    expect(stage).toContain("empty ? emptyPlaces(zones).places : []");
    expect(read("../src/app/room/page.tsx")).toContain("const emptyRoom = itemCount === 0;");
    expect(placesContract.behavior.dismiss).toContain("первой вещи");
  });

  it("СЛОЙ МЕСТ ЛЕЖИТ МИМО ФИЛЬТРА ПУСТОЙ КОМНАТЫ", () => {
    // `brightness(.42)` пустой комнаты (grading.ts) применяется к фотографиям
    // внутри стопки камеры — `.frame` и `.openFrame`. Попади места туда, их
    // .55 умножилась бы на .42 и подсказка утонула бы в темноте, ради которой
    // её и рисуют. Проверяем: фильтр стоит ровно на двух слоях, и место в
    // разметке — потомок слоя хотспотов, а не кадра.
    const filtered = [...sceneCss.matchAll(/([\w.]+) \{[^}]*filter: var\(--grade-filter/gu)];
    expect(filtered.map((m) => m[1]).sort()).toEqual([".frame", ".openFrame"]);
    const layer = stage.indexOf("ref={hotspotsLayerRef}");
    const place = stage.indexOf("s.placeCornerTL");
    expect(layer).toBeGreaterThan(-1);
    expect(place, "место уехало из слоя хотспотов — проверь фильтр").toBeGreaterThan(layer);
  });

  it("при открытой зоне места уходят вместе с хотспотами", () => {
    expect(sceneCss).toMatch(/\.hotspotsHidden \.place \{\s*opacity: 0;\s*animation: none;/u);
  });

  it("тап по месту = наезд на его зону: место прозрачно для пальца", () => {
    expect(sceneCss).toMatch(/\.place \{[^}]*pointer-events: none;/u);
    expect(placesContract.behavior.tap).toContain("наезд на его зону");
  });
});
