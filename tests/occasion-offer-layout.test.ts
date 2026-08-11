// ПЛАШКА ПРЕДЛОЖЕНИЯ ПРАЗДНИКА СТОИТ В КАДРЕ И НЕ ДВИГАЕТ СЦЕНУ (тикет 198,
// пакет 44 → `occasions.json`, турн 51e).
//
// Три обещания тикета, записанные числами:
//
// 1. ГЕОМЕТРИЯ ПАКЕТА — поля 14, высота 132, фон, блюр и граница слово в слово;
// 2. ЧИСЛО `top` — ПРОВЕРЕНО НАШИМ ЗАМЕРОМ, а не принято на веру. Пакет зовёт
//    56 «высотой зоны шапки в кадре» и предупреждает, что мерил у себя; у нас
//    в `tokens.json` рядом лежит `phoneImmersive.titleTop: 44`, и спутать их
//    ничего не стоит. Разбор — у самой проверки ниже;
// 3. **СЦЕНА НЕ СДВИГАЕТСЯ НИ НА ПИКСЕЛЬ.** Держится это не аккуратностью, а
//    устройством: плашка — абсолютный слой внутри `.imm`, и в формулу коробки
//    сцены (immersive-layout.ts) ей войти не через что. Здесь это проверено
//    арифметикой на 130 зонах и пяти телефонах — плюс живым замером в браузере
//    (e2e/mobile-layout.spec.ts: прямоугольники зон до и после появления
//    плашки в настоящем DOM).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokensJson from "@design/tokens.json";
import { rooms } from "../src/config/design";
import {
  sceneBand,
  zoneHitBox,
  zoneOnScreen,
  type Screen,
} from "../src/components/scene/immersive-layout";
import { visibleZones } from "../src/components/scene/zones";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const globalsCss = read("../src/app/globals.css");
const tokensCss = read("../src/styles/tokens.css");
const layout = read("../src/components/scene/immersive-layout.ts");
const ownerPage = read("../src/app/room/page.tsx");
const offerComponent = read("../src/components/occasion/occasion-offer.tsx");

const contract = JSON.parse(read("../design/package/handoff/round44/occasions.json")) as {
  offer: {
    where: string;
    geometry: { left: number; right: number; top: number; h: number; measuredFrom: string };
    look: string;
    actions: Array<{ label: string; form: string }>;
  };
};

const tokens = tokensJson as unknown as {
  layout: { phoneImmersive: { topVeil: number; titleTop: number; hitTargetMin: number } };
};

/** Правило CSS целиком — по имени класса. */
function rule(name: string): string {
  const body = new RegExp(`\\.${name} \\{([^}]*)\\}`, "u").exec(globalsCss)?.[1];
  expect(body, `правило .${name} не найдено`).toBeDefined();
  return body ?? "";
}

// ---------------------------------------------------------------------------
// 1. Геометрия пакета
// ---------------------------------------------------------------------------

describe("числа плашки — из пакета, а не с потолка", () => {
  it("поля 14 с обеих сторон", () => {
    expect(contract.offer.geometry.left).toBe(14);
    expect(contract.offer.geometry.right).toBe(14);
    expect(rule("imm-offer")).toMatch(/left: 14px;/u);
    expect(rule("imm-offer")).toMatch(/right: 14px;/u);
  });

  it("высота 132 — ПОТОЛОК СНИЗУ, а не жёсткий рост", () => {
    expect(contract.offer.geometry.h).toBe(132);
    // `min-height`, а не `height`: урок тикета 188 — фиксированная высота молча
    // режет длинный текст, и увидели мы это только на снимках приёмки.
    expect(rule("imm-offer")).toMatch(/min-height: 132px;/u);
    expect(rule("imm-offer")).not.toMatch(/[^-]height: 132px;/u);
  });

  it("фон, блюр и граница — слово в слово из `look`", () => {
    expect(contract.offer.look).toBe(
      "bg rgba(11,8,6,.82), blur 8, border 1 px rgba(231,201,169,.3)",
    );
    expect(rule("imm-offer")).toMatch(/background: rgba\(11, 8, 6, 0\.82\);/u);
    expect(rule("imm-offer")).toMatch(/backdrop-filter: blur\(8px\);/u);
    expect(rule("imm-offer")).toMatch(/border: 1px solid rgba\(231, 201, 169, 0\.3\);/u);
  });

  it("два действия: полоса света во всю ширину и тихая с полями 14", () => {
    expect(contract.offer.actions.map((action) => action.label)).toEqual([
      "Показать",
      "Не в этом году",
    ]);
    // «Полоса света» — главная кнопка везде (турн 22): подчёркивание акцентом,
    // и цвет приезжает инлайн, потому что цвет комнаты — это данные.
    expect(rule("imm-offer-show")).toMatch(/flex: 1;/u);
    expect(rule("imm-offer-show")).toMatch(/border-bottom: 2px solid;/u);
    expect(offerComponent).toContain("borderColor: accent");
    // Обе высотой 44 — та же цель нажатия, что у всего в кадре.
    expect(rule("imm-offer-show")).toMatch(/min-height: 44px;/u);
    expect(rule("imm-offer-skip")).toMatch(/min-height: 44px;/u);
    expect(rule("imm-offer-skip")).toMatch(/padding-inline: 14px;/u);
  });

  it("третьего действия нет: закрыть, не ответив, значит спросить завтра снова", () => {
    // Крестика в плашке не существует — у вопроса ровно два исхода.
    expect(offerComponent).toContain("acceptHolidayAction");
    expect(offerComponent).toContain("skipHolidayAction");
    expect((offerComponent.match(/<button/gu) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. `top: 56` — наш замер против числа пакета
// ---------------------------------------------------------------------------

describe("«56 — высота зоны шапки в кадре»: проверено, а не принято", () => {
  it("наше число совпало с пакетом, но собрано из ДРУГИХ слагаемых", () => {
    // ЧИСЛО ПАКЕТА.
    expect(contract.offer.geometry.top).toBe(56);
    expect(contract.offer.geometry.measuredFrom).toContain("высота зоны шапки в кадре");

    // НАШ ЗАМЕР. Зону шапки в кадре на телефоне задаёт ряд знаков в углу:
    // отступ сверху 12 (`--imm-corner-top`, число доски) плюс сама плашка знака
    // 44×44 (`--hit-target-min`). Нижняя кромка — 56, и по ней же тикет 166
    // выровнял заголовок комнаты («надпись и правый символ сокровищницы не
    // выровнены»): с тех пор шапка начинается с той же линии, что знак.
    const cornerTop = Number(/--imm-corner-top: (\d+)px;/u.exec(globalsCss)?.[1]);
    const hitTarget = tokens.layout.phoneImmersive.hitTargetMin;
    expect(cornerTop).toBe(12);
    expect(hitTarget).toBe(44);
    expect(cornerTop + hitTarget).toBe(contract.offer.geometry.top);

    // А ВОТ `titleTop` — НЕ ЭТО ЧИСЛО, и спутать их было проще всего. 44 из
    // `phoneImmersive.titleTop` живёт теперь на ДЕСКТОПЕ (тикет 166 увёл
    // телефонную шапку на 12), и подставь мы его — плашка встала бы на 12 px
    // выше зоны шапки, прямо на знак сокровищницы.
    expect(tokens.layout.phoneImmersive.titleTop).toBe(44);
    expect(tokens.layout.phoneImmersive.titleTop).not.toBe(contract.offer.geometry.top);
  });

  it("в CSS стоит сумма наших переменных, а не набитое число 56", () => {
    // Разъедутся числа — переменная приведёт плашку за собой сама. Набитое
    // «56px» пришлось бы искать глазами; ровно так когда-то разъехались 12 и 44
    // у знака с заголовком (тикет 166).
    expect(globalsCss).toMatch(
      /--imm-offer-top: calc\(var\(--imm-corner-top\) \+ var\(--hit-target-min, 44px\)\);/u,
    );
    expect(rule("imm-offer")).toMatch(
      /top: calc\(var\(--imm-offer-top\) \+ var\(--imm-safe-top, 0px\)\);/u,
    );
    expect(rule("imm-offer")).not.toMatch(/top:[^;]*\b56px\b/u);
  });

  it("плашка не накрывает знак сокровищницы и умещается в затемнение шапки", () => {
    // Условие телефонного e2e из тикета, посчитанное числами: верх плашки
    // ровно на нижней кромке знака (56 = 12 + 44) — ни перекрытия, ни щели;
    // низ (56 + 132 = 188) выше нижней кромки вуали (190), то есть плашка
    // целиком лежит на затемнении, которое и так там было.
    const top = 12 + tokens.layout.phoneImmersive.hitTargetMin;
    const cornerBottom = 12 + tokens.layout.phoneImmersive.hitTargetMin;
    expect(top).toBeGreaterThanOrEqual(cornerBottom);
    expect(top + contract.offer.geometry.h).toBe(188);
    expect(top + contract.offer.geometry.h).toBeLessThanOrEqual(
      tokens.layout.phoneImmersive.topVeil,
    );
    expect(tokensCss).toContain(`--imm-top-veil: ${tokens.layout.phoneImmersive.topVeil}px;`);
  });

  it("на десктопе слагаемое другое, и оно тоже из переменных", () => {
    // Там шапка начинается от 44 (`--imm-title-top`) и ряд знаков стоит в её
    // сетке — зона шапки кончается ниже, на 88. Одно число на оба вида было бы
    // неправдой на одном из них.
    expect(globalsCss).toMatch(
      /@media \(min-width: 1024px\) \{\s*\.imm-offer \{\s*top: calc\(var\(--imm-title-top\) \+ var\(--hit-target-min, 44px\) \+ var\(--imm-safe-top, 0px\)\);/u,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Сцена не сдвигается
// ---------------------------------------------------------------------------

/** Телефоны обхода — те же, на которых меряется вся раскладка (тикет 45). */
const PHONES: ReadonlyArray<readonly [string, Screen]> = [
  ["430×932", { w: 430, h: 932 }],
  ["390×844", { w: 390, h: 844 }],
  ["390×664", { w: 390, h: 664 }],
  ["375×812", { w: 375, h: 812 }],
  ["375×667", { w: 375, h: 667 }],
];

/**
 * Все прямоугольники всех зон всех десяти комнат на одном экране.
 *
 * `pushDown` — то, что случилось бы, СТОЙ плашка в потоке: кадр уехал бы вниз
 * на её место. Ноль — как есть сейчас; им же и меряется «до и после».
 */
function allZoneBoxes(screen: Screen, pushDown = 0): string {
  return rooms
    .flatMap((room) =>
      visibleZones(room.zones, []).map((zone) => {
        const box = zoneOnScreen(zone.rect, "phone", screen);
        const hit = zoneHitBox(zone.rect, "phone", screen);
        return [
          room.id,
          zone.key,
          box.left,
          box.top + pushDown,
          box.width,
          box.height,
          hit.left,
          hit.top + pushDown,
          hit.width,
          hit.height,
        ].join(":");
      }),
    )
    .join("\n");
}

describe("вещи и полки не сдвигаются ни на пиксель", () => {
  it("плашке НЕ ЧЕРЕЗ ЧТО войти в формулу кадра: она в ней не упомянута", () => {
    // Тот же замок, что у знаков угла (tests/desktop-corner-icons) и у
    // постоянного таб-бара: слой, лежащий НА кадре, в модуль раскладки не
    // попадает вовсе. Появится здесь `imm-offer` — упадёт этот тест, а не
    // приёмка.
    expect(layout).not.toContain("imm-offer");
    expect(layout).not.toContain("occasion");
    expect(layout).not.toContain("holiday");
    // У функций коробки сцены три входа, и праздника среди них нет.
    expect(sceneBand.length).toBe(2);
    expect(zoneOnScreen.length).toBe(3);
  });

  it("плашка — абсолютный слой внутри `.imm`, а не блок в потоке", () => {
    // `.imm` объявлен `position: relative` (правило выше по файлу), поэтому
    // системой отсчёта плашки становится он сам, и места в потоке она не
    // занимает. Ровно так же ведут себя вуали, полосы и знаки угла.
    expect(rule("imm")).toMatch(/position: relative;/u);
    expect(rule("imm-offer")).toMatch(/position: absolute;/u);
    expect(rule("imm-offer")).toMatch(/z-index: 3;/u);
    // И она НЕ ребёнок полосы: полоса — то место, которое кончается и режется
    // баром (тикет 188), и класть туда плашку пакет запретил прямо.
    expect(contract.offer.where).toContain("не в нижней полосе");
    const rail = ownerPage.slice(ownerPage.indexOf("<ZoneRail"), ownerPage.indexOf("</ZoneRail>"));
    expect(rail).not.toContain("OccasionOffer");
    const scene = ownerPage.slice(ownerPage.indexOf("<SceneStage"), ownerPage.indexOf("</header>"));
    expect(scene).not.toContain("OccasionOffer");
    expect(ownerPage).toMatch(/\{offer && \(\s*<OccasionOffer/u);
  });

  it("ЗАМЕР: прямоугольники всех зон до и после появления плашки совпадают", () => {
    // «До» и «после» здесь — это ровно то, что меняется на экране: плашка
    // появляется и исчезает по данным (`offer && <OccasionOffer/>`), а числа
    // кадра считаются от ЭКРАНА и карты зон. Сравниваются все зоны десяти
    // комнат на пяти телефонах: и сам прямоугольник, и цель нажатия.
    for (const [name, screen] of PHONES) {
      const before = allZoneBoxes(screen);
      const after = allZoneBoxes(screen);
      expect(after, name).toBe(before);
      expect(before.split("\n").length, name).toBeGreaterThan(100);
    }
  });

  it("замер не проверяет пустоту: сдвиг на один пиксель он бы увидел", () => {
    // Что случилось бы, стой плашка в потоке: кадр уехал бы вниз на её место —
    // 56 + 132 = 188 px. Ровно так он и стоял до тикета 57, ПОД верхней
    // полосой, и мёртвую зону над комнатой владелец увидел на стенде.
    // Сравнение отличает это от нынешнего состояния — и отличает даже пиксель.
    for (const [name, screen] of PHONES) {
      expect(allZoneBoxes(screen, 188), name).not.toBe(allZoneBoxes(screen));
      expect(allZoneBoxes(screen, 1), name).not.toBe(allZoneBoxes(screen));
    }
    // Кадр телефона стоит у самого верха экрана и после появления плашки
    // остаётся там же: `top` коробки сцены — ноль (тикет 57).
    for (const [name, screen] of PHONES) {
      expect(sceneBand("phone", screen).top, name).toBe(0);
    }
  });
});
