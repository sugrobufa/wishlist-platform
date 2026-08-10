// Затемнение сцены при наезде на ПУСТУЮ зону (35b, раунд 23 · турн 25c).
//
// ОТКУДА ЧИСЛА. `task15.json → emptyStates.emptyZone.scene`:
//   filter: "brightness(.56) saturate(.8)"
//   veil:   "linear-gradient(0deg,rgba(11,8,6,.7),rgba(11,8,6,.05) 54%)"
// Раунд 23 (`task19.json → emptyZoneSceneClarify`) назвал МЕСТО слоя, которого
// в task15 не было: это наезд на пустую зону В КОМНАТЕ — панель раскрыта
// поверх кадра, гасится сцена под ней. Экран «зона списком» — отдельный, сцены
// там нет, и его не трогали. Файлы пакета лежат вне репозитория (папка
// владельца), поэтому числа стоят здесь литералами со ссылкой на источник —
// как это уже сделано с пустой комнатой в `grading.test.ts`.
//
// ЧТО ИЗМЕНИЛОСЬ ЗДЕСЬ ТИКЕТОМ 133 И ПОЧЕМУ. Правило дизайна «слой не
// множится на ночь» имело две половины: выбранная ночь и ночная база. Первой
// половины больше не существует — положение «ночь» упразднено целиком
// (владелец 09.08: «вечерний и ночной вариант должен быть один и тот же»,
// дизайн согласился раундом 32), и в типе его нет. Проверки выбранной ночи
// поэтому УДАЛЕНЫ, а не подогнаны; проверки НОЧНОЙ БАЗЫ остались слово в
// слово — четыре базы из десяти сняты ночью, их кадр тёмен сам по себе, и
// умножение на .56 било бы по ним ровно так же. Заодно добавлена проверка
// вечера: он под правило НЕ подпадает (он не «свет не включали»), и это
// решение записано, а не случайность.
//
// ЧТО ЗАЩИЩАЕТСЯ, кроме самих чисел:
//   1) правило «слой не множится на ночной кадр» — иначе средняя светлота
//      ночных баз падает с 0.268 до 0.150, а самая тёмная комната с 0.200 до
//      0.112 (замер по кадрам, Rec. 709, тем же способом, которым считались
//      все числа про ночь);
//   2) две пустоты не складываются: в пустой комнате пусты и все её зоны, и
//      .42 × .56 дало бы 0.075 средней светлоты — чёрный экран, ровно тот
//      случай, который чинил тикет 107;
//   3) слой приходит ВМЕСТЕ с наездом и уходит с ним же — темпом вуали, а не
//      мгновенным появлением узла;
//   4) зона «Просто деньги» пустой не считается никогда: в ней копилка.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EMPTY_ROOM_FILTER,
  EMPTY_ZONE_FILTER,
  EMPTY_ZONE_VEIL,
  gradingFilter,
  sceneFilter,
  TIMES_OF_DAY,
  type NativeTimeOfDay,
} from "@/components/scene/grading";
import { rooms } from "@/config/design";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stageTsx = read("../src/components/scene/SceneStage.tsx");
const ownerPage = read("../src/app/room/page.tsx");
const zoneListPage = read("../src/app/room/zone/[zone]/page.tsx");
const emptyZoneTsx = read("../src/components/zone/empty-zone.tsx");

const DESKTOP_AT = "@media (min-width: 1024px) {";
const REDUCED_AT = "@media (prefers-reduced-motion: reduce) {";
const KEYFRAMES_AT = "/* --- Кейфреймы";
const baseCss = sceneCss.slice(0, sceneCss.indexOf(DESKTOP_AT));
const desktopCss = sceneCss.slice(sceneCss.indexOf(DESKTOP_AT), sceneCss.indexOf(REDUCED_AT));
const reducedCss = sceneCss.slice(sceneCss.indexOf(REDUCED_AT), sceneCss.indexOf(KEYFRAMES_AT));

function bodies(css: string, selector: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((m) =>
      (m[1] ?? "")
        .split(",")
        .map((part) => part.trim())
        .includes(selector),
    )
    .map((m) => m[2] ?? "");
}

function rule(css: string, selector: string): string {
  const found = bodies(css, selector);
  expect(found.length, `ожидалось одно правило ${selector}, найдено ${found.length}`).toBe(1);
  return found[0] as string;
}

/**
 * Родные времена суток баз — их десять, и от них зависит правило ночного
 * кадра. Тип шире, чем у ручки (тикет 133): «ночь» перестала быть положением,
 * но не перестала быть свойством четырёх фотографий.
 */
const NATIVES = [...new Set(rooms.map((room) => room.tod))] as NativeTimeOfDay[];

describe("рецепт пустой зоны — дословно из пакета", () => {
  it("фильтр .56 и вуаль — те самые строки", () => {
    expect(EMPTY_ZONE_FILTER).toBe("brightness(.56) saturate(.8)");
    expect(EMPTY_ZONE_VEIL).toEqual({
      overlay: "linear-gradient(0deg,rgba(11,8,6,.7),rgba(11,8,6,.05) 54%)",
      blend: "multiply",
    });
  });

  it("это НЕ рецепт пустой комнаты: зона мягче, потому что говорит меньше", () => {
    expect(EMPTY_ZONE_FILTER).not.toBe(EMPTY_ROOM_FILTER);
    const value = (filter: string) => Number(/brightness\(([\d.]*)\)/u.exec(filter)?.[1]);
    expect(value(EMPTY_ZONE_FILTER)).toBeGreaterThan(value(EMPTY_ROOM_FILTER));
    expect(value(EMPTY_ZONE_FILTER)).toBeCloseTo(0.56, 10);
  });

  it("к родному свету затемнение приходит одно, без «none» в строке", () => {
    expect(sceneFilter("day", "warm", false, "day", true)).toBe(EMPTY_ZONE_FILTER);
    expect(sceneFilter("day", "warm", false, "day", false)).toBe("none");
  });

  it("к выбранному свету затемнение ДОБАВЛЯЕТСЯ, а не заменяет его", () => {
    // Числа вечера обновлены тикетом 133 (было `brightness(.8) saturate(1.08)`
    // на multiply): смягчение и смена режима наложения — правка дизайна
    // раунда 32, разбор в grading.ts. Само сложение не изменилось.
    expect(sceneFilter("dusk", "warm", false, "day", true)).toBe(
      `brightness(.84) saturate(1.05) ${EMPTY_ZONE_FILTER}`,
    );
  });
});

describe("слой не множится на ночной кадр (правило дизайна, task19 → emptyZoneSceneClarify)", () => {
  it("выбранной ночи больше нет — правило держится одной половиной (тикет 133)", () => {
    // Прежде здесь стояло «выбрана ночь — второго затемнения нет». Положение
    // упразднено, и проверять нечего: ночь в ручке не выбирается. Осталось
    // единственное условие — родное время суток базы.
    expect([...TIMES_OF_DAY]).not.toContain("night");
    // Комната, которой миграция поставила вечер, ведёт себя как любой вечер:
    // затемнение зоны к ней ПРИХОДИТ — вечер не «свет не включали».
    expect(sceneFilter("dusk", "warm", false, "day", true)).toContain(EMPTY_ZONE_FILTER);
    expect(sceneFilter("dusk", "warm", false, "dusk", true)).toBe(EMPTY_ZONE_FILTER);
  });

  it("база снята ночью — второго затемнения нет ни в одном положении ручки", () => {
    for (const tod of TIMES_OF_DAY) {
      expect(sceneFilter(tod, "warm", false, "night", true), tod).toBe(
        gradingFilter(tod, "warm", "night"),
      );
    }
  });

  it("все десять комнат × три положения: ночной кадр остаётся ровно собой", () => {
    // Замеры ночных баз (0.268 средняя, 0.200 самая тёмная) держатся ровно на
    // том, что к их кадру ничего не домножается. Умножение вернуло бы 0.150
    // и 0.112 — темнее, чем было ДО починки ночи.
    for (const room of rooms) {
      for (const tod of TIMES_OF_DAY) {
        const withZone = sceneFilter(tod, "warm", false, room.tod, true);
        const without = sceneFilter(tod, "warm", false, room.tod, false);
        if (room.tod === "night") {
          expect(withZone, `${room.id} ${tod}`).toBe(without);
          expect(withZone, `${room.id} ${tod}`).not.toContain("brightness(.56)");
        } else {
          expect(withZone, `${room.id} ${tod}`).toContain(EMPTY_ZONE_FILTER);
        }
      }
    }
  });

  it("правило то же самое, что у пустой комнаты, — одно на оба слоя", () => {
    for (const native of NATIVES) {
      for (const tod of TIMES_OF_DAY) {
        const roomDims = sceneFilter(tod, "warm", true, native).includes(EMPTY_ROOM_FILTER);
        const zoneDims = sceneFilter(tod, "warm", false, native, true).includes(EMPTY_ZONE_FILTER);
        expect(zoneDims, `${native} → ${tod}`).toBe(roomDims);
      }
    }
  });

  it("две пустоты не складываются: в пустой комнате зона не гасит второй раз", () => {
    // .42 × .56 = 0.235 от кадра, средняя светлота по десяти комнатам 0.075.
    expect(sceneFilter("day", "warm", true, "day", true)).toBe(EMPTY_ROOM_FILTER);
    expect(sceneFilter("day", "warm", true, "day", true)).not.toContain("brightness(.56)");
    // И то же самое при выбранном свете: остаётся ровно комнатная пустота.
    expect(sceneFilter("dusk", "warm", true, "day", true)).toBe(
      sceneFilter("dusk", "warm", true, "day", false),
    );
  });
});

describe("слой стоит под панелью зоны и едет с камерой", () => {
  it("геометрия — та же, что у кадра, на обоих видах", () => {
    const dim = rule(baseCss, ".zoneDim");
    expect(dim).toContain("left: var(--frame-l)");
    expect(dim).toContain("width: var(--frame-w)");
    expect(dim).toContain("opacity: 0");
    // Десктоп: слой стоит в том же списке, что кадр, — своей геометрии у него
    // нет и разъехаться с фотографией негде.
    expect(bodies(desktopCss, ".zoneDim")).toContain(rule(desktopCss, ".frame"));
  });

  it("лежит ВНУТРИ дыхания, рядом с кадром, а не поверх вьюпорта", () => {
    // Гаснуть должна фотография под панелью — значит слой едет с камерой и
    // дышит с кадром. Проверяем порядок узлов: .drift → … → .zoneDim → конец
    // блока дыхания (там же, где грейдинг и отклик света).
    const drift = stageTsx.indexOf("className={s.drift}");
    const grade = stageTsx.indexOf("className={s.grade}");
    const dim = stageTsx.indexOf("s.zoneDim");
    const wake = stageTsx.indexOf("className={s.wakeLayer}");
    expect(drift).toBeGreaterThan(-1);
    expect(dim).toBeGreaterThan(grade);
    expect(dim).toBeLessThan(wake);
  });

  it("темп — вуали: приходит с наездом, уходит с выходом", () => {
    expect(rule(baseCss, ".zoneDim")).toMatch(
      /transition:\s*opacity var\(--veil-out-ms\) var\(--veil-out-ease\) var\(--veil-out-at\)/u,
    );
    expect(rule(baseCss, ".zoneDimOn")).toMatch(
      /transition:\s*opacity var\(--veil-ms\) var\(--ease-out\) var\(--veil-at\)/u,
    );
    // Своих миллисекунд у слоя нет — как и у всего остального в этом файле.
    expect(`${rule(baseCss, ".zoneDim")}${rule(baseCss, ".zoneDimOn")}`).not.toMatch(/\d+ms/u);
  });

  it("узел стоит всегда, видимость решает класс — иначе вместо наплыва щелчок", () => {
    expect(stageTsx).toMatch(/zoneDimOn \? `\$\{s\.zoneDim\} \$\{s\.zoneDimOn\}` : s\.zoneDim/u);
    // Ровно один такой узел в разметке.
    expect(stageTsx.match(/s\.zoneDim\b/gu)).toHaveLength(2);
  });

  it("prefers-reduced-motion: схлопывается вместе со всеми — 120 мс без задержки", () => {
    expect(bodies(reducedCss, ".zoneDim").join("")).toContain(
      "transition-duration: var(--reduced-ms)",
    );
    expect(bodies(reducedCss, ".zoneDim").join("")).toContain("transition-delay: 0ms");
    expect(bodies(reducedCss, ".zoneDimOn").join("")).toContain("transition-delay: 0ms");
  });
});

describe("кому достаётся затемнение", () => {
  it("только наезду в комнате: гейт — камера в зоне И зона в списке пустых", () => {
    expect(stageTsx).toMatch(
      /const zoneDimOn = zoomedIn && !empty && \(emptyZones\?\.includes\(activeZone\.key\) \?\? false\);/u,
    );
    // Яркость идёт фильтром на кадр, вуаль — слоем; оба питаются одним флагом.
    expect(stageTsx).toMatch(/sceneFilter\(timeOfDay, lightColor, empty, preset\.tod, zoneDimOn\)/u);
  });

  it("в ПУСТОЙ комнате слоя нет вовсе — иначе перемножились бы и вуали", () => {
    // `!empty` в гейте выше гасит и вуаль, и фильтр разом. Без него две
    // `multiply`-вуали (.78 комнаты и .7 зоны) оставили бы у нижней кромки
    // 6.6% кадра — темнее, чем каждая из них по отдельности обещает.
    expect(stageTsx).toMatch(/В ПУСТОЙ КОМНАТЕ СЛОЯ НЕТ ВОВСЕ/u);
    // И фильтр держит то же правило сам, независимо от разметки.
    expect(sceneFilter("day", "warm", true, "day", true)).toBe(EMPTY_ROOM_FILTER);
  });

  it("список пустых зон приходит с сервера, а не считается сценой", () => {
    expect(ownerPage).toContain("emptyZones={zones?.emptyKeys}");
    expect(ownerPage).toMatch(/count === 0 && key !== MONEY_ZONE_KEY/u);
    expect(stageTsx).not.toMatch(/items\.length === 0/u);
  });

  it("зона «Просто деньги» пустой не бывает — в ней копилка, а не пустая полка", () => {
    expect(ownerPage).toMatch(/emptyKeys[\s\S]{0,200}MONEY_ZONE_KEY/u);
  });

  it("экран «зона списком» не тронут: сцены там нет, гасить нечего", () => {
    // Ровно то недоразумение, которое дизайн снял раундом 23. Если затемнение
    // однажды приедет и туда, эти проверки скажут об этом вслух.
    for (const [name, source] of [
      ["зона списком", zoneListPage],
      ["пустая зона (три места)", emptyZoneTsx],
    ] as const) {
      expect(source, name).not.toContain("EMPTY_ZONE_FILTER");
      expect(source, name).not.toContain("zoneDim");
      expect(source, name).not.toContain("brightness(.56)");
    }
  });
});
