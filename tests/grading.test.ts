// Свет и время суток (тикет 96, доска Б6 · турн 11e; матрица пересчёта —
// тикет 107, турн 33a; упразднение ночи и смягчение вечера — тикет 133,
// раунд 32).
//
// ЧТО ИЗМЕНИЛОСЬ В ЭТОМ ФАЙЛЕ И ПОЧЕМУ (тикет 133). Файл переписан вместе с
// правилом, а не подогнан числами — этого прямо требует тикет.
//
// 1. УШЛИ ПРОВЕРКИ НОЧИ КАК ПОЛОЖЕНИЯ: «у ночной базы все четыре положения
//    светлее кадра», «ночь — два слоя: синее окно и тёплые лампы», «дневная
//    база в ночь — числа рецепта v2». Проверять больше нечего: ночь как выбор
//    упразднена (владелец 09.08 «вечерний и ночной вариант должен быть один и
//    тот же», дизайн согласился раундом 32), `NIGHT_V2` удалён, синий слой в
//    продукт не возвращается. Вместо них — проверка, что положений ровно три и
//    что ночь ИЗ БАЗЫ читается вечером, а не днём.
// 2. ИЗМЕНИЛИСЬ ЧИСЛА ВЕЧЕРА — но только там, где он РАСЧЁТНЫЙ. Дневная база:
//    `brightness(.8) saturate(1.08)` + multiply .18 → `brightness(.84)
//    saturate(1.05)` + soft-light .14. Ночная база: фильтр тот же 1.24, слой
//    стал пятном ламп. Сумеречная база: identity, и это правило теперь
//    заперто отдельным тестом.
// 3. ГЛАВНОЕ В ПРАВКЕ — РЕЖИМ НАЛОЖЕНИЯ, А НЕ ЧИСЛО, и тест проверяет именно
//    его: `multiply` у вечера дневной базы запрещён поимённо. Дизайн:
//    «multiply глушил сильнее, чем казалось в цифрах» — ровно из-за этого
//    провалилась ночь при верных отчётных числах.
// 4. `TOD_FACTOR.night` ушёл вместе с положением, и проверки весов меток
//    переписаны на вечер.
//
// УРОК, КОТОРЫЙ ЗАПИСАЛИ ОБЕ СТОРОНЫ И КОТОРЫЙ ОТНОСИТСЯ К ЭТОМУ ФАЙЛУ:
// **свет принимается на телефоне, а не числом.** Мы померили ночь в `sharp`,
// получили 0.268 против ожидаемых 0.27 и оба сочли это попаданием — а на
// телефоне с малой яркостью не видно ничего. Всё, что ниже, ловит грубые
// ошибки и расхождение с пакетом; принимать по этим числам работу нельзя.
//
// Что здесь по-прежнему защищается:
// - РОДНОЕ время суток базы даёт ЧИСТУЮ identity: ни фильтра, ни слоя. Кадры
//   неприкосновенны, а родное — своё у каждой базы: дневная только cottage,
//   пять сумеречных, четыре ночных;
// - рецепты перенесены из спецификации дословно;
// - время суток входит в светлоту, по которой считаются веса меток зон;
// - цвет света на веса НЕ влияет, только на тон свечения;
// - мусор из БД читается как родное положение, а не роняет экран.
import { describe, expect, it } from "vitest";
import {
  asLightColor,
  asTimeOfDay,
  bloomTint,
  effectiveLightness,
  gradingFilter,
  gradingLayers,
  EMPTY_ROOM_FILTER,
  EMPTY_ROOM_VEIL,
  sceneFilter,
  sceneLayers,
  LIGHT_COLORS,
  NATIVE_LIGHT_COLOR,
  NATIVE_TIME_OF_DAY,
  NATIVE_TIMES_OF_DAY,
  RETIRED_TIME_OF_DAY,
  TIMES_OF_DAY,
  TOD_FACTOR,
  type NativeTimeOfDay,
} from "../src/components/scene/grading";
import { markerWeights } from "../src/components/scene/zone-marker";
import { rooms } from "../src/config/design";

/** Кусок фильтра пустой ЗОНЫ, по которому его видно в строке (.56, тикет 35b). */
const EMPTY_ZONE_MARK = "brightness(.56)";

describe("положений ручки три — ночь упразднена (тикет 133)", () => {
  it("выбрать можно утро, день и вечер, и больше ничего", () => {
    expect([...TIMES_OF_DAY]).toEqual(["morning", "day", "dusk"]);
    expect([...TIMES_OF_DAY]).not.toContain(RETIRED_TIME_OF_DAY);
  });

  it("родные времена суток БАЗ остались всеми четырьмя — ночь снята с выбора, а не с фотографий", () => {
    expect([...NATIVE_TIMES_OF_DAY]).toEqual(["morning", "day", "dusk", "night"]);
    // Каждая из десяти баз обязана попадать в этот словарь: иначе матрица
    // переходов промахнётся мимо своей ветки и вернёт identity молча.
    for (const room of rooms) {
      expect(NATIVE_TIMES_OF_DAY, room.id).toContain(room.tod);
    }
    expect(rooms.some((room) => room.tod === "night"), "ночные базы есть").toBe(true);
  });

  it("вес меток `night` ушёл вместе с положением", () => {
    expect(Object.keys(TOD_FACTOR).sort()).toEqual(["day", "dusk", "morning"]);
    // Комнатам, которым миграция поставила вечер, метки считаются вечером.
    expect(TOD_FACTOR.dusk).toBe(0.78);
  });

  it("уцелевший в БД `night` читается ВЕЧЕРОМ, а не днём — правило стоит одним местом", () => {
    // Миграция `night_is_dusk` прошла по базе, но старый кэш, чужой дамп или
    // ручная правка строки вернули бы комнату в ЧУЖОЕ время суток. Соседнее
    // честнее: ровно к нему её и приравняли.
    expect(asTimeOfDay(RETIRED_TIME_OF_DAY)).toBe("dusk");
    expect(asTimeOfDay("night")).not.toBe(NATIVE_TIME_OF_DAY);
  });
});

describe("родные положения — чистая identity", () => {
  it("выбранное = родное: ни фильтра, ни слоёв, без единого исключения", () => {
    // ИСКЛЮЧЕНИЕ ИСЧЕЗЛО (тикет 133): последним была ночь у ночной базы
    // (тикет 112 отменил для неё «родное = как снято»), и она ушла вместе с
    // положением. Правило снова целое.
    for (const native of TIMES_OF_DAY) {
      expect(gradingFilter(native, "warm", native), native).toBe("none");
      expect(gradingLayers(native, "warm", native), native).toEqual([]);
    }
  });

  it("каждая комната в СВОЁМ родном положении показана как снята", () => {
    // Тикет 107: до него «день» был identity для всех, и ночная база в
    // положении «ночь» получала ночь вторым слоем — замер давал 0.095
    // светлоты у gamer при 0.183 у самого кадра. Ночные базы в этот перебор
    // не входят: их родное положение выбрать больше нельзя.
    for (const room of rooms.filter((candidate) => candidate.tod !== "night")) {
      const tod = room.tod as (typeof TIMES_OF_DAY)[number];
      expect(gradingFilter(tod, "warm", room.tod), room.id).toBe("none");
      expect(gradingLayers(tod, "warm", room.tod), room.id).toEqual([]);
    }
  });

  it("у ночной базы ВСЕ три положения светлее кадра", () => {
    // Ловит возврат к «ночная комната гасится второй раз»: база снята ночью,
    // и любое положение ручки обязано её ПОДНИМАТЬ, а не опускать.
    for (const target of TIMES_OF_DAY) {
      const filter = gradingFilter(target, "warm", "night");
      const brightness = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? "1");
      expect(brightness, `night → ${target}`).toBeGreaterThan(1);
    }
  });

  it("родные положения названы теми же словами, что и дефолты схемы", () => {
    expect(NATIVE_TIME_OF_DAY).toBe("day");
    expect(NATIVE_LIGHT_COLOR).toBe("warm");
  });
});

describe("вечер смягчён — но только там, где он РАСЧЁТНЫЙ (тикет 133)", () => {
  it("дневная база: числа и режим наложения — дословно из round32-task34", () => {
    expect(gradingFilter("dusk", "warm", "day")).toBe("brightness(.84) saturate(1.05)");
    const layers = gradingLayers("dusk", "warm", "day");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.overlay).toBe(
      "linear-gradient(180deg,rgba(214,118,74,.14),rgba(214,118,74,.04))",
    );
    expect(layers[0]?.blend).toBe("soft-light");
  });

  it("`multiply` у этого слоя запрещён поимённо — в нём и была поломка", () => {
    // «Multiply глушил сильнее, чем казалось в цифрах»: тёплый слой отнимал
    // света больше, чем показывала средняя светлота. Главное в правке — режим,
    // а не число, и вернуть его обратно тихо нельзя.
    expect(gradingLayers("dusk", "warm", "day")[0]?.blend).not.toBe("multiply");
  });

  it("ночная база: фильтр тот же 1.24, слой стал пятном ламп, синий не вернулся", () => {
    expect(gradingFilter("dusk", "warm", "night")).toBe("brightness(1.24) saturate(1.02)");
    const layers = gradingLayers("dusk", "warm", "night");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.overlay).toBe(
      "radial-gradient(120% 85% at 50% 100%,rgba(255,186,112,.16),rgba(255,186,112,0) 58%)",
    );
    expect(layers[0]?.blend).toBe("screen");
    // Синий слой ночи не возвращается ни к одной базе, ни в одном положении.
    for (const native of NATIVE_TIMES_OF_DAY) {
      for (const tod of TIMES_OF_DAY) {
        for (const layer of gradingLayers(tod, "warm", native)) {
          expect(layer.overlay, `${native} → ${tod}`).not.toContain("52,72,118");
        }
      }
    }
  });

  it("сумеречная база: вечер — её родной кадр, identity без слоёв", () => {
    // Принцип дизайна: «identity не трогаем». Пять баз из десяти сняты в
    // сумерках, и светлить им нечего.
    expect(gradingFilter("dusk", "warm", "dusk")).toBe("none");
    expect(gradingLayers("dusk", "warm", "dusk")).toEqual([]);
    for (const room of rooms.filter((candidate) => candidate.tod === "dusk")) {
      expect(gradingFilter("dusk", "warm", room.tod), room.id).toBe("none");
    }
  });
});

describe("рецепты — дословно из спецификации", () => {
  it("две ручки складываются: фильтры в одну строку, слои по одному на ручку", () => {
    expect(gradingFilter("dusk", "candle", "day")).toBe(
      "brightness(.84) saturate(1.05) saturate(1.06)",
    );
    const layers = gradingLayers("dusk", "candle", "day");
    expect(layers).toHaveLength(2);
    expect(layers[0]?.blend).toBe("soft-light");
    expect(layers[1]?.blend).toBe("soft-light");
  });

  it("родная ручка своего слоя не добавляет", () => {
    expect(gradingLayers("morning", "warm", "day")).toHaveLength(1);
    expect(gradingLayers("day", "white", "day")).toHaveLength(1);
  });

  it("расчётных рецептов ровно семь: три базы × два неродных положения плюс пустая утренняя ветка", () => {
    // Утренних баз нет ни одной (проверено дизайном глазами, раунд 21) — её
    // ветка пуста, и это не забытая работа.
    const recipes = NATIVE_TIMES_OF_DAY.flatMap((native) =>
      TIMES_OF_DAY.filter((tod) => gradingFilter(tod, "warm", native) !== "none"),
    );
    expect(recipes).toHaveLength(7);
    for (const tod of TIMES_OF_DAY) {
      expect(gradingFilter(tod, "warm", "morning"), `morning → ${tod}`).toBe("none");
    }
  });
});

describe("светлота и метки зон", () => {
  it("время суток гасит светлоту по своему множителю", () => {
    const cream = rooms.find((room) => room.id === "cream");
    if (!cream) throw new Error("нет пресета cream");
    expect(effectiveLightness(cream.roomLightness, "day")).toBe(cream.roomLightness);
    expect(effectiveLightness(cream.roomLightness, "dusk")).toBeCloseTo(
      cream.roomLightness * TOD_FACTOR.dusk,
      10,
    );
  });

  it("кламп держит края: тёмная комната вечером не проваливается ниже .08", () => {
    expect(effectiveLightness(0.09, "dusk")).toBe(0.08);
    expect(effectiveLightness(0.95, "morning")).toBe(0.95);
  });

  it("вечером метка светит СИЛЬНЕЕ, чем днём, в каждой из десяти комнат", () => {
    for (const room of rooms) {
      const day = markerWeights(effectiveLightness(room.roomLightness, "day"));
      const dusk = markerWeights(effectiveLightness(room.roomLightness, "dusk"));
      expect(dusk.bloom, room.id).toBeGreaterThanOrEqual(day.bloom);
    }
  });

  it("цвет света на веса не влияет — только на тон свечения", () => {
    const cream = rooms.find((room) => room.id === "cream");
    if (!cream) throw new Error("нет пресета cream");
    expect(bloomTint("warm", cream.accent)).toBe(cream.accent);
    expect(bloomTint("white", cream.accent)).toBe("#EDEAE4");
    expect(bloomTint("candle", cream.accent)).toBe("#E8A96B");
  });
});

describe("пустая комната — темнота (тикет 104)", () => {
  it("к родным положениям темнота приходит одна, без «none» в строке", () => {
    expect(sceneFilter("day", "warm", true, "day")).toBe(EMPTY_ROOM_FILTER);
    expect(sceneFilter("day", "warm", false, "day")).toBe("none");
  });

  it("к выбранному свету темнота ДОБАВЛЯЕТСЯ, а не заменяет его", () => {
    expect(sceneFilter("dusk", "warm", true, "day")).toBe(
      `brightness(.84) saturate(1.05) ${EMPTY_ROOM_FILTER}`,
    );
  });

  it("на НОЧНОМ КАДРЕ пустота не гасит второй раз — только вуаль (тикет 107)", () => {
    // ПРАВИЛО СУЖЕНО ВМЕСТЕ С ПОЛОЖЕНИЕМ (тикет 133). Было два условия:
    // выбранная ночь и ночная база. Первого больше не существует; второе
    // осталось и осталось нужным — четыре базы из десяти сняты ночью, и их
    // кадр тёмен сам по себе в любом положении ручки. Замер: gamer при 0.183
    // уходил с пустотой в 0.040, то есть почти в чёрный экран.
    for (const tod of TIMES_OF_DAY) {
      expect(sceneFilter(tod, "warm", true, "night"), tod).toBe(
        gradingFilter(tod, "warm", "night"),
      );
    }
    // Вуаль при этом на месте — она и несёт «свет ещё не включали».
    expect(sceneLayers("dusk", "warm", true, "night").at(-1)).toEqual(EMPTY_ROOM_VEIL);
  });

  it("ВЕЧЕР под это правило не подпадает, и это осознанно", () => {
    // Вечер — не «свет не включали»: у дневной базы это мягкое .84, у ночной
    // вовсе 1.24, то есть СВЕТЛЕЕ родного кадра. .84 × .42 = 0.353 против 0.42
    // у дня — разница в 16%, а не провал, который чинил тикет 107.
    expect(sceneFilter("dusk", "warm", true, "day")).toContain(EMPTY_ROOM_FILTER);
    expect(sceneFilter("dusk", "warm", true, "dusk")).toBe(EMPTY_ROOM_FILTER);
  });

  it("затемнений в строке НИКОГДА не больше двух: грейдинг плюс одна пустота", () => {
    // Три затемнения продукта — пустая сцена (.42), пустая зона (.56) и вечер.
    // Перемножаться им нельзя: на этом обжигались тикетами 107 и 35b.
    for (const native of NATIVE_TIMES_OF_DAY) {
      for (const tod of TIMES_OF_DAY) {
        for (const empty of [true, false]) {
          for (const emptyZone of [true, false]) {
            const filter = sceneFilter(tod, "warm", empty, native as NativeTimeOfDay, emptyZone);
            const dims = [EMPTY_ROOM_FILTER, EMPTY_ZONE_MARK].filter((mark) =>
              filter.includes(mark),
            );
            expect(dims.length, `${native} → ${tod} empty=${empty} zone=${emptyZone}`).toBeLessThan(
              2,
            );
            expect(
              (filter.match(/brightness\(/gu) ?? []).length,
              `${native} → ${tod} empty=${empty} zone=${emptyZone}`,
            ).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it("вуаль пустоты кладётся ПОСЛЕДНИМ слоем — поверх грейдинга", () => {
    // Вечер несёт один слой, свеча — второй, вуаль пустоты — третья.
    const layers = sceneLayers("dusk", "candle", true, "day");
    expect(layers).toHaveLength(3);
    expect(layers[2]).toEqual(EMPTY_ROOM_VEIL);
    expect(sceneLayers("dusk", "candle", false, "day")).toHaveLength(2);
  });
});

describe("чтение из БД — недоверчивое", () => {
  it("мусор и старые значения читаются как родное положение", () => {
    for (const bad of [null, undefined, "", "полдень", 42, {}, "DAY"]) {
      expect(asTimeOfDay(bad), JSON.stringify(bad) ?? "undefined").toBe(NATIVE_TIME_OF_DAY);
      expect(asLightColor(bad), JSON.stringify(bad) ?? "undefined").toBe(NATIVE_LIGHT_COLOR);
    }
    // Упразднённая ночь — не мусор: у неё своё, названное правило (см. выше).
    expect(asLightColor(RETIRED_TIME_OF_DAY)).toBe(NATIVE_LIGHT_COLOR);
  });

  it("каждое словарное положение читается собой", () => {
    for (const tod of TIMES_OF_DAY) expect(asTimeOfDay(tod)).toBe(tod);
    for (const color of LIGHT_COLORS) expect(asLightColor(color)).toBe(color);
  });
});
