// ТРИ ПУСТЫХ МЕСТА на сцене пустой комнаты (тикет 142; приёмка `places-v3.3`
// пакета раунда 41 — тикет 168).
//
// ПОЧЕМУ ЗДЕСЬ НЕТ ТАБЛИЦЫ ДИЗАЙНА — И ПОСЛЕ ТОГО, КАК ОНА СОШЛАСЬ. В раунде 34
// receipt пакета был посчитан по снимку `rooms.json` ДО переразметок, и тройки
// расходились в четырёх комнатах из десяти. Раунд 37 пересчитан по нашему дампу
// карты: 30 прямоугольников из 30 равны нашим, тройки и дышащее место совпали
// все десять. Ожиданием таблица всё равно не становится — 19 из 30 выбранных
// зон помечены на пересъёмку, и когда карта поедет, поедут и места.
//
// Поэтому ожиданием служат две вещи, и обе наши:
//   1) само ПРАВИЛО — окно, трети, победа по площади, добор пустой трети,
//      выбор главного места, `drawIfWhole`;
//   2) СНИМОК результата на сегодняшнем `rooms.json` — чтобы следующая
//      переразметка зоны не переставила места молча.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hitTargetMin,
  rooms,
  roomsContract,
  scene,
  zoneNotOnFrame,
  zonesHiddenByProduct,
  zonesWithoutRect,
} from "../src/config/design";
import { phoneWindowOnFrame } from "../src/components/scene/immersive-layout";
import { EMPTY_ROOM_FILTER } from "../src/components/scene/grading";
import {
  emptyPlaces,
  isPlaceCandidate,
  placeArmPx,
  placeFill,
  placeFocusGlow,
  placeRect,
  placesContract,
  placeThird,
  placeWholeInBand,
  PLACE_BAND_MS,
  PLACE_BAND_PHONE_REST,
  PLACE_BREATH,
  PLACE_CAMERA_FADE,
  PLACE_CORNER_COUNT,
  PLACE_FOCUS,
  PLACE_OPACITY,
  PLACE_STROKE_PX,
  PLACE_WINDOW,
  THIRD_BOUNDS,
} from "../src/components/scene/empty-places";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stage = read("../src/components/scene/SceneStage.tsx");
const panEngine = read("../src/components/scene/use-scene-pan.ts");

/**
 * Место одной строкой: «ключ*  ШxВ @ x,y  armN  видно-ли-в-покое-телефона».
 * Звёздочка — главное (дышит). Всё, что решает правило, стоит в одной строке
 * намеренно: переразметка зоны меняет её целиком, и diff читается глазами.
 */
function line(place: { key: string; rect: { x: number; y: number; w: number; h: number }; primary: boolean }) {
  const r = place.rect;
  const seen = placeWholeInBand(r, PLACE_BAND_PHONE_REST) ? "в-покое" : "за-кромкой";
  return `${place.key}${place.primary ? "*" : ""} ${r.w}x${r.h}@${r.x},${r.y} arm${placeArmPx(r)} ${seen}`;
}

/**
 * СНИМОК: что правило даёт на СЕГОДНЯШНЕМ `rooms.json` (все десять комнат, по
 * зонам, которые продукт показывает). Не «правильный ответ дизайна», а наш
 * зафиксированный результат: переразметят зону — тест упадёт, и место
 * переедет осознанно, а не молча.
 *
 * «за-кромкой» — место, которое в покое телефона (окно 12…442) лежит не
 * целиком: по `drawIfWhole` оно не рисуется и приезжает паном. Таких семь из
 * тридцати, и в каждой комнате остаётся не меньше двух мест.
 */
const SNAPSHOT: Record<string, [string, string, string]> = {
  cream: [
    "fashion* 51x110@150,132 arm11 в-покое",
    "beauty 37x34@268,164 arm11 в-покое",
    "home 38x32@425,188 arm11 за-кромкой",
  ],
  warm: [
    "beauty 60x93@194,34 arm11 в-покое",
    "travel* 97x68@249,243 arm11 в-покое",
    "anything 50x74@138,238 arm11 в-покое",
  ],
  lux: [
    "travel* 56x87@311,235 arm11 в-покое",
    "events 40x57@338,92 arm11 в-покое",
    "beauty 41x47@239,143 arm11 в-покое",
  ],
  emerald: [
    "bags 43x41@118,228 arm11 в-покое",
    "travel* 91x63@236,268 arm11 в-покое",
    "events 67x63@389,84 arm11 за-кромкой",
  ],
  bold: [
    "beauty* 79x58@223,190 arm11 в-покое",
    "events 76x57@397,76 arm11 за-кромкой",
    "travel 66x51@304,286 arm11 в-покое",
  ],
  cottage: [
    "anything 64x59@143,268 arm11 в-покое",
    "travel* 99x69@269,254 arm11 в-покое",
    "music 40x27@423,217 arm9 за-кромкой",
  ],
  // ЧЕТЫРЕ МУЖСКИЕ КОМНАТЫ ПЕРЕЕХАЛИ ТИКЕТОМ 233 — осознанно, и вот почему.
  // Пакет 50 назвал общее правило разметки: «прямоугольник берёт предмет
  // ВМЕСТЕ С ТЕМ, ЧТО ЕГО ДЕРЖИТ — раму, полку, столешницу». По нему
  // переразмечены семь зон: `events` во всех четырёх мужских комнатах (рамка с
  // билетами была обрезана по стопке корешков, рама выпадала за край) и три
  // зоны, чьи места владелец увидел висящими в воздухе 14.08.2026 —
  // `gamer/sport` (стояла на голой стене над скамьёй), `sport/grooming` (на
  // стене слева от зеркала) и `study/sport` (на полу под столом: размечена по
  // кадру «открыто», где гантели ВЫНУТЫ из стойки).
  //
  // Тройки переехали в трёх комнатах из четырёх, и каждый переезд — следствие
  // площади, а не выбора: `events` после взятия рамы стала крупнейшим
  // кандидатом своей трети в `gamer` (6600 против 5808 у sport) и в `loft`
  // (9090 против 6608 у music), а в `study` обошла переехавшую `sport`
  // (4424 против 4278). Ни одно место больше не садится в пустоту — вырезки
  // в `.scratch/acceptance-2026-08-14/233-rects/after/`.
  gamer: [
    "travel* 56x56@192,245 arm11 в-покое",
    "tech 52x34@254,147 arm11 в-покое",
    "events 41x62@411,94 arm11 за-кромкой",
  ],
  sport: [
    "anything* 57x46@175,278 arm11 в-покое",
    "grooming 34x29@230,206 arm10 в-покое",
    "events 45x68@399,104 arm11 за-кромкой",
  ],
  study: [
    "anything* 52x56@182,247 arm11 в-покое",
    "events 35x49@415,78 arm11 за-кромкой",
    "sport 38x43@387,277 arm11 в-покое",
  ],
  loft: [
    "tech 34x34@196,168 arm11 в-покое",
    "events* 63x56@352,99 arm11 в-покое",
    "books 38x38@456,100 arm11 за-кромкой",
  ],
};

/**
 * Пустые трети, закрытые добором, — часть того же снимка.
 *
 * Тикет 233 поменял их местами у двух комнат: `sport/grooming` переехала с
 * голой стены (центр 230, треть I) на поднос с уходом (центр 246.5, треть II)
 * и закрыла среднюю треть собой; `study/sport` наоборот — с пола под столом
 * (центр 334, треть II) на стойку с гантелями у кресла (центр 406, треть III),
 * и средняя треть «Кабинета» опустела.
 */
const SNAPSHOT_FALLBACK: Record<string, string[]> = {
  cream: [],
  warm: ["III"],
  lux: ["I", "III"],
  emerald: [],
  bold: ["I"],
  cottage: [],
  gamer: [],
  sport: [],
  study: ["II"],
  loft: [],
};

/**
 * Сколько мест человек видит на телефоне в покое — второй половиной снимка.
 *
 * У «Геймера» было три, стало два: третье место переехало с зоны `sport`
 * (скамья, центр кадра) на `events` — рамку с билетами, которая висит правее
 * и в покое телефона (12…442) не помещается целиком. Место не потеряно, оно
 * приезжает паном (`rule.drawIfWhole`), и двух в комнате правило требует —
 * два и осталось.
 */
const SNAPSHOT_PHONE_AT_REST: Record<string, number> = {
  cream: 2,
  warm: 3,
  lux: 3,
  emerald: 2,
  bold: 2,
  cottage: 2,
  gamer: 2,
  sport: 2,
  study: 2,
  loft: 2,
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
    // Окно — центральные 420 из 630: поля слева и справа одинаковые. Ширину
    // кадра берём У СЕБЯ: кадр 630×351 наш (ADR-0006), контракт его только
    // повторяет. В `places-v3` блок `frame` пропал и уронил нам импорт,
    // `places-v3.2` вернул его — сверяем, что повтор верный, и не более того.
    expect(PLACE_WINDOW.x0).toBe(scene.phone.image.w - PLACE_WINDOW.x1);
    expect(placesContract.frame.w).toBe(scene.phone.image.w);
    expect(placesContract.frame.h).toBe(scene.phone.image.h);
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

  it("ЗОНЫ БЕЗ ПРЕДМЕТА в кандидаты не идут", () => {
    // Раунд 34 писал «выключенные зоны в rooms.json отсутствуют, исключать
    // нечего», и про наш файл это было неверно. `places-v3` ошибку признал и
    // перечислил все восемь адресов поимённо — сверяем список целиком.
    const absent = roomsContract.rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.objectAbsent).map((zone) => `${room.id}/${zone.key}`),
    );
    const named = [
      "emerald/beauty",
      "loft/gaming",
      "lux/music",
      "sport/gaming",
      "sport/watches",
      "study/gaming",
      "study/tech",
      "warm/music",
    ];
    expect(absent.sort()).toEqual([...named].sort());
    for (const address of named) {
      expect(placesContract.rule.candidate, `${address}: пропал из списка контракта`).toContain(
        address,
      );
    }
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

  it("МЕСТО НЕ ВСТАЁТ НА ЗОНУ БЕЗ ПРЯМОУГОЛЬНИКА — ни при каком контракте (тикеты 230, 235)", () => {
    // Проверка выше сторожит `objectAbsent` — ФЛАГ ДИЗАЙН-ПАКЕТА. Решает же не
    // он, а наши списки адресов: `zonesHiddenByProduct` (зоны нет вовсе) и
    // `zonesWithoutRect` (живая полка без места на кадре, тикет 235). Место на
    // любой из них — уголок, ведущий в никуда: камера поедет к предмету,
    // которого в этом интерьере нет.
    //
    // Условие теперь и в самом контракте, дословно (пакет 50,
    // `round50/zones-eight.json` → `threePlaces.hiddenZoneExcluded`): «место
    // берётся только у зоны, у которой ЕСТЬ прямоугольник. Нет прямоугольника —
    // нет и места, уголок вёл бы в никуда. Условия в контракте не было,
    // вписано». Наше правило с ним совпало — сверяем оба, чтобы совпадение не
    // разъехалось молча (14.08.2026 владелец увидел ровно места, замечание 3).
    const contract = JSON.parse(
      read("../design/package/handoff/round50/zones-eight.json"),
    ) as { threePlaces: { hiddenZoneExcluded: string } };
    expect(contract.threePlaces.hiddenZoneExcluded).toContain("ЕСТЬ прямоугольник");

    expect([...zonesHiddenByProduct, ...zonesWithoutRect].sort()).toEqual(
      [
        ...roomsContract.rooms.flatMap((room) =>
          room.zones.filter((zone) => zone.objectAbsent).map((zone) => `${room.id}/${zone.key}`),
        ),
        // Полки `bar` в контракте ещё нет — её заводит тикет 234; адреса стоят
        // в списке вперёд, чтобы новая полка не вышла в кадр меткой на пустом
        // месте (тот же реестр, что в design-contract.test.ts).
        "gamer/bar",
        "sport/bar",
        "loft/bar",
      ].sort(),
    );
    // И то же самое РЕЗУЛЬТАТОМ, а не сверкой списков. Правило зовём СЫРЫМ
    // контрактом — все 130 зон, фильтр пресета не участвует: так проверяется
    // само правило, а не то, что вызывающий отфильтровал за него.
    for (const room of roomsContract.rooms) {
      for (const place of emptyPlaces(room.zones).places) {
        expect(
          zoneNotOnFrame(room.id, place.key),
          `${room.id}/${place.key}: место на зоне, которой в кадре нет`,
        ).toBe(false);
      }
    }
    // И на живом пресете: полка без места на кадре в тройку не попадает, хотя
    // из пресета её больше не выбрасывают (тикет 235 — она там есть, с флагом).
    for (const room of rooms) {
      const withoutRect = room.zones.filter((zone) => zone.withoutRect).map((zone) => zone.key);
      for (const place of emptyPlaces(room.zones).places) {
        expect(withoutRect, `${room.id}/${place.key}: место на полке без прямоугольника`).not.toContain(
          place.key,
        );
      }
    }
    // Тройка на сыром контракте совпадает с тройкой на пресете во всех десяти:
    // фильтр правила и фильтр вызова дают один ответ, и переставить места
    // молча нельзя ни с одной стороны.
    for (const room of rooms) {
      const raw = roomsContract.rooms.find((candidate) => candidate.id === room.id);
      expect(emptyPlaces(raw?.zones ?? []).places.map((place) => place.key), room.id).toEqual(
        emptyPlaces(room.zones).places.map((place) => place.key),
      );
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

  it("главное место — наибольшая площадь МЕСТА, а не зоны; но только среди видимых", () => {
    // ДО ТИКЕТА 233 ЗДЕСЬ СТОЯЛО ПРОСТО `Math.max(...areas)` — и это было
    // наблюдение, а не правило. Контракт с `places-v3` говорит две вещи сразу:
    // `rule.primary` — «наибольшая площадь МЕСТА из трёх», `rule.
    // primaryWholeAtRest` — «дышащее место обязано быть целиком в покое
    // телефона; если наибольшее обрезано, дышит следующее из целиком видимых».
    // Второе тогда не двигало ничего («сегодня выполняется у всех десяти без
    // правок»), поэтому оба условия сходились в одно число.
    //
    // Переразметка тикета 233 их развела: в «Спорте» самое большое место —
    // `events` 45×68 = 3060 на рамке с билетами, и в покое оно за кромкой
    // (399…444 при правой 442). Дышит `anything` 57×46 = 2622 — следующее по
    // площади из видимых, ровно как велит `primaryWholeAtRest`. Поэтому
    // ожидание теперь считается по правилу целиком, а не по его половине.
    for (const room of rooms) {
      const { places } = emptyPlaces(room.zones);
      const visible = places.filter((p) => placeWholeInBand(p.rect, PLACE_BAND_PHONE_REST));
      const pool = visible.length ? visible : places;
      const areas = pool.map((p) => p.rect.w * p.rect.h);
      const primary = places.find((p) => p.primary);
      expect(primary, `${room.id}: дышащего места нет`).toBeTruthy();
      expect(
        primary && primary.rect.w * primary.rect.h,
        `${room.id}: дышит не самое большое из целиком видимых`,
      ).toBe(Math.max(...areas));
    }
    // И ровно одна комната пользуется этой развилкой — «Спорт». Сторож нарочно
    // называет её по имени: вернись все десять к простому максимуму, здесь
    // упадёт, и разница между правилом и наблюдением снова станет видна.
    const bigger = rooms.filter((room) => {
      const { places } = emptyPlaces(room.zones);
      const primary = places.find((p) => p.primary);
      const max = Math.max(...places.map((p) => p.rect.w * p.rect.h));
      return primary ? primary.rect.w * primary.rect.h !== max : false;
    });
    expect(bigger.map((room) => room.id)).toEqual(["sport"]);
  });

  it("ничья дышащего места — по порядку зон в rooms.json, а не победителей третей", () => {
    // `places-v3 → rule.primary`: «при полном равенстве — порядок зон в
    // rooms.json (та же цепочка, что у выбора зоны)». Порядок победителей
    // третей идёт СЛЕВА НАПРАВО и с порядком зон не совпадает: две одинаковые
    // зоны, поставленные в списке во второй и первой трети, дают победителей
    // [вторая-треть-справа? нет — сначала I], и ничью обязан решить index.
    expect(placesContract.rule.primary).toContain("порядок зон в rooms.json");
    const later = { key: "later", rect: { x: 260, y: 10, w: 60, h: 60 } };
    const earlier = { key: "earlier", rect: { x: 110, y: 10, w: 60, h: 60 } };
    const filler = { key: "filler", rect: { x: 400, y: 10, w: 40, h: 40 } };
    // `later` стоит в списке ПЕРВЫМ, но живёт во второй трети — среди
    // победителей он второй. Площади мест равны, и дышать обязан он.
    const run = emptyPlaces([later, earlier, filler]);
    expect(run.places.map((p) => p.key)).toEqual(["earlier", "later", "filler"]);
    expect(run.places.find((p) => p.primary)?.key).toBe("later");
  });
});

describe("157 — drawIfWhole: обрезанных мест не бывает", () => {
  it("видимая полоса — НЕ окно правила: 12…442 против 105…525", () => {
    // Две полосы путают охотнее всего. Окно правила выбирает ЗОНЫ и одно на
    // все устройства; видимая полоса решает, РИСОВАТЬ ли выбранное место, и у
    // телефона она своя — покой окна 430 по кадру 630 (ADR-0006).
    expect(PLACE_BAND_PHONE_REST).toEqual(phoneWindowOnFrame(0));
    expect([PLACE_BAND_PHONE_REST.left, PLACE_BAND_PHONE_REST.right]).toEqual([12, 442]);
    expect(PLACE_BAND_PHONE_REST.left).not.toBe(PLACE_WINDOW.x0);
    expect(placesContract.rule.drawIfWhole).toContain("целиком");
  });

  it("правило считает целиком, а не по касанию кромки", () => {
    const band = { left: 12, right: 442 };
    expect(placeWholeInBand({ x: 12, y: 0, w: 430, h: 10 }, band)).toBe(true);
    expect(placeWholeInBand({ x: 11, y: 0, w: 10, h: 10 }, band)).toBe(false);
    expect(placeWholeInBand({ x: 433, y: 0, w: 10, h: 10 }, band)).toBe(false);
    expect(placeWholeInBand({ x: 432, y: 0, w: 10, h: 10 }, band)).toBe(true);
  });

  it("В КАЖДОЙ КОМНАТЕ В ПОКОЕ ОСТАЁТСЯ НЕ МЕНЬШЕ ДВУХ МЕСТ", () => {
    // Условие приёмки правила (тикет 157). Без него drawIfWhole принимать
    // нельзя: подсказка «сюда встанет вещь» в единственном экземпляре читается
    // не как приглашение, а как единственно верное место.
    let total = 0;
    for (const room of rooms) {
      const seen = emptyPlaces(room.zones).places.filter((p) =>
        placeWholeInBand(p.rect, PLACE_BAND_PHONE_REST),
      );
      expect(seen.length, `${room.id}: в покое телефона осталось меньше двух мест`).toBe(
        SNAPSHOT_PHONE_AT_REST[room.id],
      );
      expect(seen.length).toBeGreaterThanOrEqual(2);
      total += seen.length;
    }
    // Двадцать два из тридцати: восемь третьих мест уезжают за правую кромку.
    // Было двадцать три; двадцать вторым стало место «Геймера» — тикет 233
    // переставил его тройку с зоны `sport` на `events`, а рамка с билетами
    // висит правее покоя телефона.
    expect(total).toBe(22);
    // Эти же два числа дизайн внёс в контракт с наших замеров (`places-v3.2`).
    // Сверяем не ради красоты: если наша карта поедет, замеры в контракте
    // устареют молча, а так тест назовёт расхождение вслух.
    //
    // РАСХОЖДЕНИЕ ЕСТЬ, И ОНО НАЗВАНО ВСЛУХ ИМЕННО ЗДЕСЬ: строку контракта мы
    // сторожим неизменной (это ЕГО замер, переписывать чужой файл нельзя), а
    // наше число уехало на единицу вниз. Разница уходит письмом вместе с
    // переразметкой 233; до ответа обе стороны стоят рядом и видны в диффе.
    expect(placesContract.rule.drawIfWholeMeasured).toContain("было 30 мест в покое, стало 23");
    expect(total, "замер контракта устарел ровно на одно место — «Геймера»").toBe(23 - 1);
  });

  it("дышит только целиком видимое место (primaryWholeAtRest)", () => {
    expect(placesContract.rule.primaryWholeAtRest).toContain("целиком");
    for (const room of rooms) {
      const primary = emptyPlaces(room.zones).places.find((p) => p.primary);
      expect(primary, `${room.id}: дышащего места нет`).toBeTruthy();
      expect(
        primary && placeWholeInBand(primary.rect, PLACE_BAND_PHONE_REST),
        `${room.id}: дышит место, обрезанное кромкой`,
      ).toBe(true);
    }
    // И правило работает, а не совпадает: самое большое место за кромкой —
    // дышит следующее по площади из видимых.
    const wide = { key: "wide", rect: { x: 380, y: 10, w: 140, h: 140 } };
    const inside = { key: "inside", rect: { x: 110, y: 10, w: 100, h: 100 } };
    const tiny = { key: "tiny", rect: { x: 260, y: 10, w: 40, h: 40 } };
    const run = emptyPlaces([wide, inside, tiny]);
    expect(placeWholeInBand(run.places[2]!.rect, PLACE_BAND_PHONE_REST)).toBe(false);
    expect(run.places.find((p) => p.primary)?.key).toBe("inside");
  });

  it("правило ВЫБОРА трёх зон от этого не меняется — меняется только рисование", () => {
    // Место за кромкой не выпадает из тройки: окно ездит, и оно приезжает.
    for (const room of rooms) {
      expect(emptyPlaces(room.zones).places, `${room.id}`).toHaveLength(3);
    }
  });

  it("в разметке проверку считает CSS — потому что полоса едет с окном", () => {
    // Движок пана намеренно не трогает React (ре-рендер на каждый кадр
    // пальца), поэтому он пишет позицию окна в кадр-px, а CSS сравнивает.
    expect(panEngine).toContain('setProperty("--pan-frame"');
    expect(panEngine).toContain('"--pan-frame",'); // и снимается при уходе с телефона
    expect(stage).toContain('"--place-x0": `${place.rect.x}`');
    expect(stage).toContain('"--place-x1": `${place.rect.x + place.rect.w}`');
    expect(stage).toContain('"--place-band-l0": `${PLACE_BAND_PHONE_REST.left}`');
    expect(stage).toContain('"--place-band-r0": `${PLACE_BAND_PHONE_REST.right}`');
    // Шаг: `clamp(0, разность, 1)` с двух сторон, объединённые max.
    const place = /\.place \{[\s\S]*?\n\}/u.exec(sceneCss)?.[0] ?? "";
    expect(place).toContain("--band-l: calc(var(--place-band-l0) + var(--pan-frame, 0));");
    expect(place).toContain("--band-r: calc(var(--place-band-r0) + var(--pan-frame, 0));");
    expect(place).toMatch(/--place-off: max\(\s*clamp\(0, calc\(var\(--band-l\)/u);
    expect(place).toContain("--place-on: calc(1 - var(--place-off));");
    // На десктопе кадр виден целиком — шаг выключен, второй полосы нет.
    expect(sceneCss).toMatch(
      /@media \(min-width: 1024px\) \{\s*\.place \{\s*--place-off: 0;\s*\}\s*\}/u,
    );
  });

  it("ПОЯВЛЕНИЕ И УХОД ПО ПОЛОСЕ — 120 мс контракта, а не 200 мс наезда", () => {
    // Своего числа у полосы не было, и она ехала на длительности ВОЗВРАТА
    // КАМЕРЫ просто потому, что обе прозрачности жили на одном элементе.
    // `places-v3.2` дал полосе своё («чтобы у кромки не хлопало»), и числа
    // разошлись — значит обязаны разойтись и слои.
    expect(PLACE_BAND_MS).toBe(120);
    expect(PLACE_BAND_MS).not.toBe(PLACE_CAMERA_FADE.backMs);
    expect(placesContract.rule.drawIfWhole).toContain("появление и уход — 120 мс opacity");
    expect(stage).toContain('"--place-band-ms": `${PLACE_BAND_MS}ms`');
    // Коробка места везёт наезд, рисунок внутри — полосу.
    const place = /\.place \{[\s\S]*?\n\}/u.exec(sceneCss)?.[0] ?? "";
    expect(place).toContain("transition: opacity var(--place-in-ms) var(--ease-out);");
    expect(place).toContain("opacity: var(--place-o);");
    expect(sceneCss).toMatch(
      /\.placeFill,\s*\.placeCorner \{\s*opacity: var\(--place-on\);\s*transition: opacity var\(--place-band-ms\) var\(--ease-out\);\s*\}/u,
    );
  });

  it("НИ ОДНО СОСТОЯНИЕ ВИДА НЕ ВОСКРЕШАЕТ СКРЫТОЕ МЕСТО", () => {
    // Раньше это держалось дисциплиной: множитель --place-on приходилось
    // повторять в кейфреймах дыхания, в reduced-motion и в фокусе — анимация в
    // каскаде выше обычных объявлений, и забытый множитель означал бы мигающее
    // обрезанное место. Теперь полоса живёт СВОИМ слоем, и до неё не
    // дотягивается ни одно состояние вида: `var(--place-on)` встречается в
    // ПРАВИЛАХ ровно один раз — в объявлении рисунка. Это и есть вся проверка.
    // Комментарии снимаем: в них та же переменная названа словами.
    const rules = sceneCss.replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(rules.match(/var\(--place-on\)/gu) ?? []).toHaveLength(1);
    expect(sceneCss).toMatch(/@keyframes place-breath \{[\s\S]*?var\(--place-o0\)[\s\S]*?\n\}/u);
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(reduced).toContain("opacity: var(--place-o-reduced);");
    const focus = /\.hotspotSlot:has\(\.hotspot:focus-visible\) \.place \{([\s\S]*?)\n\}/u.exec(
      sceneCss,
    )?.[1];
    expect(focus).toContain("opacity: 1;");
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

  it("ПЛЕЧО УГОЛКА — ФОРМУЛА РАУНДА 37: max(6, min(11, round(0.35 · меньшая)))", () => {
    // Прежде это была проза с порогом «< 32 px» и дробным результатом (9.45).
    // Теперь — формула с обычным округлением и полом 6.
    expect(placesContract.visual.corners.armSmall).toContain(
      "max(6, min(11, round(0.35 * min(place.w, place.h))))",
    );
    // Верхний зажим формулы — то же число, что armPx: две записи одного плеча
    // разойтись не должны.
    expect(placeArmPx({ x: 0, y: 0, w: 120, h: 110 })).toBe(placesContract.visual.corners.armPx);
    expect(placeArmPx({ x: 0, y: 0, w: 38, h: 32 })).toBe(11);
    // «Коттедж», музыка: 40×27 — контрольный случай пакета. round(0.35 · 27) =
    // round(9.45) = 9, а не 9.45: округление обычное, .5 вверх.
    expect(placeArmPx({ x: 0, y: 0, w: 40, h: 27 })).toBe(9);
    // Пол 6: короче уголок перестаёт быть уголком.
    expect(placeArmPx({ x: 0, y: 0, w: 10, h: 8 })).toBe(6);
    // Плечо всегда целое — дробных плеч формула больше не даёт.
    for (const room of rooms) {
      for (const place of emptyPlaces(room.zones).places) {
        const arm = placeArmPx(place.rect);
        expect(Number.isInteger(arm), `${room.id}/${place.key}: дробное плечо`).toBe(true);
        // Плечи двух углов не смыкаются — иначе разомкнутые углы превратились
        // бы в непрерывную рамку.
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

  it("альфы и партитура дыхания — из states.rest, а не из visual.opacity", () => {
    // Ключи переехали в раунде 37: `visual.opacity` исчез, числа лежат в
    // `states.rest`, причём размах, партитура и reduced-motion — одной строкой.
    expect(placesContract.states.rest.othersOpacity).toBe(0.55);
    expect(PLACE_OPACITY.others).toBe(0.55);
    expect(PLACE_OPACITY.breathFrom).toBe(0.55);
    expect(PLACE_OPACITY.breathTo).toBe(0.85);
    expect(PLACE_OPACITY.reduced).toBe(0.7);
    expect(PLACE_BREATH).toBe("3.6s ease-in-out infinite alternate");
    expect(sceneCss).toMatch(/\.placePrimary \{\s*animation: place-breath var\(--place-breath\);/u);
    // prefers-reduced-motion: дыхания нет, главное место стоит на .7.
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(reduced).toContain("animation: none;");
    expect(reduced).toContain("--place-o-reduced");
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
    expect(placesContract.visual.noLightLine).toContain("полосы света под местом нет");
    // Четвёртый признак («прямой угол») дизайн убрал сам — он ничего не
    // различал: прямые углы у нас умолчание всего продукта.
    expect(placesContract.notDashed).toContain("ЧЕТВЁРТЫЙ УБРАН");
  });

  it("ЧИСЛА ФОКУСА ЧИТАЮТСЯ ИЗ КОНТРАКТА, А НЕ СТОЯТ КОНСТАНТАМИ (тикет 168)", () => {
    // Ловушка: `--zone-focus-outline` это `1px dashed {accent}` из контракта
    // (законный, но единственный законный) пунктир. Приди он на уголки места —
    // на тёмной пустой сцене человек прочтёт ровно умершее «хочу». Дизайн эту
    // находку принял; в `states.focusVisible` (теперь псевдоним) она закрыта
    // ответом одним словом.
    expect(placesContract.states.focusVisible.dashed).toBe("НЕТ");
    // ВОПРОС ПИСЬМА 44 (ПУНКТ 9) ЗАКРЫТ. Раунд 40 снёс числа фокуса вместе с
    // ролью кнопки, и мы держали их своим дефолтом — константами, потому что
    // читать было неоткуда. `places-v3.3` вернул их ключом `states.zoneFocus`
    // нашей же формулировкой: фокус на кнопке зоны, место подсвечивается ВСЛЕД.
    // Констант больше нет: `PLACE_FOCUS` разбирает эту строку.
    expect(placesContract.states.zoneFocus.what).toContain("фокус живёт на кнопке зоны");
    expect(placesContract.states.zoneFocus.note).toContain("наш ключ, не ваш дефолт");
    // Числа СЧИТАНЫ, а не переписаны: ожидание берём из самой строки контракта,
    // а не из литералов рядом. Разойдись разбор — здесь и упадёт.
    const said = placesContract.states.zoneFocus.place;
    expect(said).toContain(`уголки +${PLACE_FOCUS.armPlusPx}`);
    expect(said).toContain(`контур ${PLACE_FOCUS.strokePx}`);
    expect(said).toContain(
      `свечение ${PLACE_FOCUS.glow.dx} ${PLACE_FOCUS.glow.dy} ${PLACE_FOCUS.glow.blurPx}px ` +
        `акцента при ${String(PLACE_FOCUS.glow.alpha).replace(/^0/u, "")}`,
    );
    // Плечо покоя контракт называет дважды — прибавкой и обеими сторонами
    // перехода; `11` в них обязано быть тем же `visual.corners.armPx`.
    expect(said).toContain(
      `(${placesContract.visual.corners.armPx} → ` +
        `${placesContract.visual.corners.armPx + PLACE_FOCUS.armPlusPx})`,
    );
    // ПОВЕДЕНИЕ НЕ ИЗМЕНИЛОСЬ НИ НА ЕДИНИЦУ — то же, что стояло константами.
    expect(PLACE_FOCUS.armPlusPx).toBe(2);
    expect(PLACE_FOCUS.strokePx).toBe(2);
    expect(PLACE_FOCUS.glow).toEqual({ dx: 0, dy: 0, blurPx: 10, alpha: 0.5 });
    expect(placeFocusGlow()).toBe(
      "drop-shadow(0 0 10px color-mix(in srgb, var(--place-accent) 50%, transparent))",
    );
    // Шесть ключей `behavior.a11y` НЕ ВЕРНУЛИСЬ вместе с числами: отменяли их
    // мы, и место кнопкой не стало. Отмена записана там же, где была.
    expect(placesContract.behavior.a11y.dropped).toContain(
      "наши states.focusVisible для места отменены",
    );
    // «Дыхание на время фокуса останавливается» — новая строка того же ключа.
    // Описывает ровно то, что у нас уже стояло: `animation: none` ниже.
    expect(said).toContain("дыхание на время фокуса останавливается");
    // Место фокус не принимает вовсе: это не кнопка, у него нет tabindex и
    // aria-роли, а `pointer-events: none` не даёт даже нажать.
    expect(stage).not.toMatch(/<button[^>]*s\.place/u);
    expect(stage).not.toMatch(/className=\{[^}]*s\.place[^}]*\}[\s\S]{0,300}(tabIndex|onClick)/u);
    expect(sceneCss).not.toMatch(/\.place[A-Za-z]*:focus/u);
    expect(sceneCss).not.toMatch(/\.place[A-Za-z]*[^{}]*\{[^}]*--zone-focus-outline/u);
    // А ответ на фокус кнопки у места есть — свой: длиннее, толще, со
    // свечением. Числа приезжают переменными, в CSS их нет.
    const focus = /\.hotspotSlot:has\(\.hotspot:focus-visible\) \.place \{([\s\S]*?)\n\}/u.exec(
      sceneCss,
    )?.[1];
    expect(focus, "у места пропал свой вид фокуса").toBeTruthy();
    expect(focus).toContain("--place-stroke: var(--place-focus-stroke);");
    expect(focus).toContain("--place-arm: calc(var(--place-arm-rest) + var(--place-focus-arm));");
    expect(focus).toContain("filter: var(--place-focus-glow);");
    expect(focus).not.toMatch(/dashed|dotted/u);
    // Дыхание на время фокуса стоит — правило контракта уже было правилом CSS.
    expect(focus).toContain("animation: none;");
    expect(stage).toContain('"--place-focus-glow": placeFocusGlow()');
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

  it("СЛОЙ МЕСТ — ПОВЕРХ ЗАТЕМНЕНИЯ И ВУАЛИ ПУСТОЙ КОМНАТЫ", () => {
    // Порядок слоёв записан в контракте (`visual.layer`): кадр →
    // brightness(.42) saturate(.72) → вуаль-градиент → МЕСТА → подпись сцены.
    // Внутри фильтра .55 умножилась бы на .42, и подсказка утонула бы в той
    // самой темноте, ради которой её рисуют.
    expect(placesContract.visual.layer).toContain("ПОВЕРХ затемнения");
    expect(placesContract.visual.layer).toContain(EMPTY_ROOM_FILTER.split(" ")[0]);
    // Фильтр стоит ровно на двух слоях — на фотографиях.
    const filtered = [...sceneCss.matchAll(/([\w.]+) \{[^}]*filter: var\(--grade-filter/gu)];
    expect(filtered.map((m) => m[1]).sort()).toEqual([".frame", ".openFrame"]);
    // Держится порядок ПОСТРОЕНИЕМ, а не z-index: фотографии, грейдинг и вуаль
    // лежат внутри `.panWindow`, слой хотспотов с местами — следующим соседом,
    // подпись сцены — ещё ниже по дереву, то есть поверх мест. С тикета 208 эта
    // подпись — своя пилюля `.promise` В КАДРЕ (прежде обещание делило узел с
    // подсказкой «коснись зоны», а та живёт в жёлобе ПОД кадром).
    const panWindow = stage.indexOf("ref={panWindowRef}");
    const grade = stage.indexOf("className={s.grade}");
    const layer = stage.indexOf("ref={hotspotsLayerRef}");
    const place = stage.indexOf("s.placeCornerTL");
    const promise = stage.indexOf("className={s.promisePill}");
    expect(panWindow).toBeGreaterThan(-1);
    expect(grade, "слой грейдинга уехал из стопки камеры").toBeGreaterThan(panWindow);
    expect(layer, "слой мест уехал ПОД затемнение").toBeGreaterThan(grade);
    expect(place, "место уехало из слоя хотспотов — проверь фильтр").toBeGreaterThan(layer);
    expect(promise, "подпись сцены должна лежать поверх мест").toBeGreaterThan(place);
  });

  it("МЕСТО ГАСНЕТ НА ВРЕМЯ НАЕЗДА: 140 мс туда, 200 обратно", () => {
    // `behavior.onCameraMove` — новая строка раунда 37, и она же снимает наш
    // вопрос о единицах: место рисуется только в покое, где масштаб 1, значит
    // обратного масштаба уголкам не нужно.
    expect(PLACE_CAMERA_FADE.outMs).toBe(140);
    expect(PLACE_CAMERA_FADE.backMs).toBe(200);
    expect(placesContract.behavior.onCameraMove).toContain("гаснут");
    expect(placesContract.visual.units).toContain("ГАСНЕТ");
    expect(stage).toContain('"--place-out-ms": `${PLACE_CAMERA_FADE.outMs}ms`');
    expect(stage).toContain('"--place-in-ms": `${PLACE_CAMERA_FADE.backMs}ms`');
    // Уход — за 140, возврат — переходом самого места за 200.
    expect(sceneCss).toMatch(
      /\.hotspotsHidden \.place \{\s*opacity: 0;\s*animation: none;\s*transition-duration: var\(--place-out-ms\);/u,
    );
    expect(sceneCss).toMatch(/\.place \{[\s\S]*?transition: opacity var\(--place-in-ms\)/u);
    // «без сдвига»: гаснет только прозрачность, transform места не трогаем.
    const place = /\.place \{[\s\S]*?\n\}/u.exec(sceneCss)?.[0] ?? "";
    expect(place).not.toMatch(/transform/u);
  });

  it("тап по месту = наезд на его зону: место прозрачно для пальца", () => {
    expect(sceneCss).toMatch(/\.place \{[^}]*pointer-events: none;/u);
    expect(placesContract.behavior.tap).toContain("наезд на его зону");
  });

  it("КОНФЛИКТ ЗАКРЫТ: место — не кнопка, и теперь так написано в контракте", () => {
    // `places-v3` требовал role="button", имя «Открыть зону: {label}» и обход
    // клавиатурой — прямо против нашей реализации, и мы не переделывали:
    // место лежит ВНУТРИ прямоугольника своей зоны с общим центром, под ним
    // кнопка этой же зоны, и тап проходит сквозь. `places-v3.2` принял наш
    // вариант целиком («ПРИНИМАЕМ ВАШЕ ЦЕЛИКОМ, оно лучше нашего»), а ключей
    // `role`/`name`/`order` в файле больше нет вовсе.
    expect(placesContract.behavior.a11y.verdict).toContain("Место — не кнопка");
    expect(placesContract.behavior.a11y.place).toContain('aria-hidden="true"');
    // Роль и имя переехали С МЕСТА НА ЗОНУ — там они и были у нас всегда.
    expect(placesContract.behavior.a11y.zone).toContain('role="button"');
    for (const gone of ["role", "name", "order", "group", "breathNotAnnounced", "hidden"]) {
      expect(Object.keys(placesContract.behavior.a11y), `${gone}: ключ вернулся`).not.toContain(
        gone,
      );
    }
    // РАУНД 41 ЗАВЁЛ ПСЕВДОНИМ `behavior.a11yPlace` — и это НЕ возврат шести
    // ключей (тикет 168). Отменяли их мы, дизайн отмену принял, и псевдоним
    // говорит то же самое тремя словами: роли нет, имени нет, фокуса нет.
    // Требуем именно этого: появись там роль кнопки — падать здесь.
    expect(placesContract.behavior.a11yPlace.alias).toBe("behavior.a11y");
    expect(placesContract.behavior.a11yPlace.role).toContain("нет");
    expect(placesContract.behavior.a11yPlace.role).not.toContain("button");
    expect(placesContract.behavior.a11yPlace.name).toBe("нет");
    expect(placesContract.behavior.a11yPlace.focus).toBe("нет");
    expect(stage).toMatch(/aria-hidden\s*\n\s*className=\{place\.primary/u);
    expect(stage).not.toMatch(/<button[^>]*s\.place/u);
    expect(sceneCss).toMatch(/\.place \{[^}]*pointer-events: none;/u);
    // У зоны ровно одна цель нажатия, а не две.
    expect(stage.match(/<ZoneHotspot/gu) ?? []).toHaveLength(1);
  });

  it("hover и press — состояния ЗОНЫ, а не места: рисовать их месту нечем", () => {
    // Мелочь письма 42, которую дизайн признал своей ошибкой: место прозрачно
    // для указателя (`pointer-events: none`), вызвать у него hover и press
    // некому. В `places-v3.2` они переименованы в `zoneHover`/`zonePress` и
    // описаны как состояния КНОПКИ ЗОНЫ, за которыми место перерисовывается.
    expect(placesContract.states.zoneHover.what).toContain("КНОПКИ ЗОНЫ");
    expect(placesContract.states.zonePress.what).toContain("кнопку зоны");
    // ЗАПРЕТ НА САМИ СЛОВА `hover`/`press` В `states` СНЯТ (тикет 168). Он
    // требовал, чтобы ключей с такими именами в файле не было вовсе, — и это
    // было лишнее: в `places-v3.3` они ВЕРНУЛИСЬ ПСЕВДОНИМАМИ старых адресов,
    // по тому самому правилу `keyMoves`, которого мы от дизайна и добивались
    // («ключ, который переехал, ГОД живёт псевдонимом на старом месте»).
    // Запрещать надо не имя ключа, а роль: место — не кнопка. Поэтому сторож
    // переписан на СМЫСЛ — оба старых адреса обязаны указывать на состояния
    // ЗОНЫ и вести к новым ключам, а не заводить месту собственные.
    expect(placesContract.states.hover.alias).toBe("states.zoneHover");
    expect(placesContract.states.press.alias).toBe("states.zonePress");
    expect(placesContract.states.focusVisible.alias).toBe("states.zoneFocus");
    for (const alias of ["hover", "press", "focusVisible"] as const) {
      const to = placesContract.states[alias].alias;
      expect(Object.keys(placesContract.states), `${alias}: псевдоним ведёт в никуда`).toContain(
        to.replace("states.", ""),
      );
      expect(placesContract.states[alias].note, `${alias}: значения разъехались`).toContain(
        "значения те же",
      );
    }
    // Исключение из общего «нажимаемое проседает scale(.97)» осталось словом:
    // уголки привязаны к предмету в кадре, масштаб сдвинул бы их с него.
    expect(placesContract.states.zonePress.noScale).toContain("МЕСТО НЕ МАСШТАБИРУЕТСЯ");
    const place = /\.place \{[\s\S]*?\n\}/u.exec(sceneCss)?.[0] ?? "";
    expect(place).not.toMatch(/transform/u);
  });

  it("ПСЕВДОНИМ ОТДАЁТ ТО ЖЕ, ЧТО СТАРЫЙ АДРЕС — два поля доложены (round42)", () => {
    // ЧТО ПРИЕХАЛО. Дельта раунда 42 (`design/round42/places-delta.json`,
    // тикет 178) доложила четыре числа: `states.hover.stroke` и
    // `states.zoneHover.stroke` = 1.5, `states.press.opacity` и
    // `states.zonePress.opacity` = 1. Правило дизайна дословно: «псевдоним
    // обязан отдавать то же, что старый адрес», и обратное тоже — канонический
    // ключ не может быть беднее своего псевдонима.
    //
    // ЧИСЛА НЕ НОВЫЕ, и это здесь главное. 1.5 — базовый `visual.corners.
    // strokePx`: контур на наведении НЕ меняется, поэтому в новых ключах его и
    // не было вовсе. 1 — непрозрачность, которая при нажатии остаётся прежней.
    // Проверяем не «стоит 1.5», а «стоит ТО ЖЕ, ЧТО В КАНОНЕ»: перепиши дизайн
    // базовый контур — упадёт здесь, а не через раунд.
    //
    // ФАЙЛ ЧИТАЕТСЯ НАПРЯМУЮ, а не через `placesContract`: проверяется перенос
    // В ФАЙЛ, и типизированный взгляд на него тут только мешал бы — он описывает
    // то, что мы ЧИТАЕМ, а эти четыре поля мы как раз не читаем (см. ниже).
    const raw = JSON.parse(
      read("../design/package/handoff/places.json"),
    ) as {
      visual: { corners: { strokePx: number } };
      states: Record<string, Record<string, unknown>>;
      keyMoves: { fromV31ToV33: { from: string; to: string; alias: string }[] };
    };
    const canonStroke = raw.visual.corners.strokePx;
    expect(canonStroke).toBe(PLACE_STROKE_PX);
    // ДОЕХАЛИ ВСЕ ЧЕТЫРЕ — и попарно, псевдоним против своего адреса.
    for (const [alias, canonical, field] of [
      ["hover", "zoneHover", "stroke"],
      ["press", "zonePress", "opacity"],
    ] as const) {
      const atAlias = raw.states[alias]?.[field];
      const atCanonical = raw.states[canonical]?.[field];
      expect(atAlias, `states.${alias}.${field} не доехал`).toBeDefined();
      expect(atCanonical, `states.${canonical}.${field} не доехал`).toBeDefined();
      expect(atAlias, `${alias}: псевдоним и адрес разошлись по ${field}`).toBe(atCanonical);
    }
    // ЧИСЛА НЕ НОВЫЕ: контур на наведении — базовый, непрозрачность при нажатии
    // не меняется. Ждём не литерал, а канон и прозу того же ключа.
    expect(raw.states.hover?.stroke, "контур наведения перестал быть базовым").toBe(canonStroke);
    expect(raw.states.press?.opacity).toBe(1);
    expect(raw.states.zoneHover?.place).toContain("непрозрачность 1");
    // А ВОТ КОНТУР ПРИ НАЖАТИИ МЕНЯЕТСЯ, и 1.8 против базовых 1.5 — не
    // расхождение: так написано и прозой канонического ключа.
    expect(raw.states.press?.stroke).toBe(1.8);
    expect(raw.states.zonePress?.place).toContain("контур 1.8");

    // РЕНДЕР ОТ ЭТОГО НЕ МЕНЯЕТСЯ — потому что читаем мы не отсюда. Контур
    // места берётся из `visual.corners.strokePx`, нажатие и наведение
    // рисуются CSS от состояния кнопки зоны. Начни кто-нибудь читать числа из
    // псевдонима — заведётся вторая правда об одном контуре, и упадёт здесь.
    const rules = read("../src/components/scene/empty-places.ts")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    // Проверка «нет строки» зелена и когда стёрли всё. Контроль: адрес, который
    // модуль ЧИТАЕТ, после снятия комментариев на месте.
    expect(rules, "снятие комментариев съело код — проверка ниже стала пустой").toContain(
      "states.zoneFocus.",
    );
    for (const address of ["states.hover", "states.press", "states.zoneHover", "states.zonePress"]) {
      expect(rules, `модуль начал читать ${address} — вторая правда об одном числе`).not.toContain(
        `${address}.`,
      );
    }

    // ИСПРАВЛЕННАЯ ЗАПИСЬ `keyMoves`. Была ложной: «значение изменилось» —
    // а мы сверили побайтно, и все шесть ключей `behavior.a11y` те же, что в
    // v3.2. Дизайн запись переписал, и переписанную мы переносим: ложная
    // запись в `keyMoves` дороже самого переезда, потому что после неё
    // сверяют руками.
    const a11yMove = raw.keyMoves.fromV31ToV33.find((m) => m.from === "behavior.a11y");
    expect(a11yMove, "запись про behavior.a11y пропала из keyMoves").toBeDefined();
    expect(a11yMove?.to).toContain("значение НЕ менялось");
    expect(a11yMove?.to).toContain("добавлен псевдоним");
    expect(a11yMove?.to, "ложная запись вернулась").not.toContain("значение изменилось");
    // Шесть ключей `behavior.a11y` при этом НЕ ВЕРНУЛИСЬ — их отсутствие держит
    // проверка «место — не кнопка» выше, здесь только состав ключа.
    expect(Object.keys(placesContract.behavior.a11y).sort()).toEqual([
      "confirmed",
      "dropped",
      "focus",
      "place",
      "verdict",
      "zone",
    ]);
  });
});
