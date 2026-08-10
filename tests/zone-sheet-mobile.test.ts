// Лист открытой зоны на телефоне — приёмка владельца 10.08.2026, тикеты 139–141.
//
// ЗАЧЕМ ТЕСТ. Все три замечания — про одно место экрана и ломаются молча:
// геометрия остаётся верной до пикселя, падать нечему, а на телефоне видно
// чужой список и не видно кнопок. Проверяем правила, а не пиксели.
//
// 139 Действия зоны стоят НАД вещами: под сеткой они уезжали за нижнюю границу
//     прокрутки листа, и «Добавить вещь» в открытой зоне было не достать.
// 140 Под кадром ровно ОДНА поверхность, от кромки кадра до таб-бара: лист
//     кончался на 116, бар начинался на 86, и в щель было видно указатель зон.
// 141 Подсказка «коснись зоны» перестаёт выпирать: у неё больше нет плашки.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokensJson from "@design/tokens.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const railCss = read("../src/components/scene/zone-index.module.css");
const rail = read("../src/components/scene/zone-rail.tsx");
const ownerPage = read("../src/app/room/page.tsx");

const tokens = tokensJson as unknown as {
  layout: { phoneImmersive: { railBottom: number; tabBar: number } };
};

/** Телефонная ветка раскладки — точное дополнение десктопной, порог один. */
const PHONE_BRANCH = /@media not all and \(min-width: 1024px\) \{([\s\S]*?)\n\}/gu;
const phoneBlocks = (css: string) => [...css.matchAll(PHONE_BRANCH)].map((m) => m[1] ?? "");

describe("139 — действия зоны над вещами", () => {
  it("строка пилюль идёт РАНЬШЕ сетки, а не под ней", () => {
    // Проверяем ПОРЯДОК, а не наличие: обе ссылки были на месте и до правки —
    // они просто лежали за нижней кромкой прокрутки.
    const actions = ownerPage.indexOf('<div className="mb-4 flex flex-wrap items-center gap-3">');
    const grid = ownerPage.indexOf("<ZoneGrid");
    expect(actions, "строка действий зоны пропала из листа").toBeGreaterThan(-1);
    expect(grid).toBeGreaterThan(-1);
    expect(actions, "действия снова уехали под сетку").toBeLessThan(grid);
  });

  it("обе дороги на месте: «Показать все / ещё N» и «+ Добавить вещь» в зону", () => {
    expect(ownerPage).toContain("href={`/room/zone/${zone.key}`}");
    expect(ownerPage).toContain("href={`/room/add?zone=${zone.key}`}");
    // Счётчик «ещё N» считает живая сводка зоны, а не длина массива.
    expect(ownerPage).toContain('tScene("summaryMore", { count: beyondSheet })');
  });
});

describe("140 — под кадром одна поверхность, от кадра до бара", () => {
  it("щель между листом и баром была именно 30 px — и её больше нет", () => {
    // Число из контракта, а не из головы: лист равнялся на высоту полосы
    // указателя, стоя над баром другой высоты.
    const gap = tokens.layout.phoneImmersive.railBottom - tokens.layout.phoneImmersive.tabBar;
    expect(gap).toBe(30);
    // На телефоне лист стоит на баре, на десктопе — на полосе (бара там нет).
    // С тикета 143 телефонное число приезжает от страницы, а дефолтом остаётся
    // высота бара — сам дефолт проверяется ниже, в блоке 143.
    expect(sceneCss).toContain("--sheet-bottom: var(--rail-bottom);");
    expect(
      phoneBlocks(sceneCss).some((block) => block.includes("--sheet-bottom: var(--imm-bar-h")),
      "телефонный лист снова стоит на высоте чужой полосы",
    ).toBe(true);
    expect(sceneCss).toMatch(/\.panel \{[^}]*bottom: var\(--sheet-bottom\);/u);
  });

  it("лист не короче расстояния от кромки кадра до бара", () => {
    // Без min-height верх листа гулял от числа вещей в зоне, а вместе с ним
    // прыгала подпись зоны с «Отойти» — она считает место от кромки листа.
    expect(
      phoneBlocks(sceneCss).some((block) =>
        block.includes("min-height: calc(100dvh - var(--imm-scene-h) - var(--sheet-bottom));"),
      ),
      "телефонный лист снова стал ростом с содержимое",
    ).toBe(true);
    // Потолок при этом прежний: выше нижней четверти кадра лист не идёт.
    expect(sceneCss).toContain(
      "max-height: calc(100dvh - var(--band-h) * 0.75 - var(--sheet-bottom));",
    );
  });

  it("подпись зоны считает своё место от того же числа, что низ листа", () => {
    expect(sceneCss).toContain(
      "calc(var(--sheet-bottom) + var(--panel-h, 0px) - 100dvh + var(--imm-scene-h) + 12px)",
    );
  });

  it("полоса уходит при открытой зоне — и только на телефоне", () => {
    // Открытую зону полоса знает от сцены тем же мостом, что подсветку.
    expect(rail).toContain("const { active } = useZoneIndexState();");
    expect(rail).toContain("active ? `${s.stack} ${s.stackAway}` : s.stack");
    // `visibility`, а не `pointer-events: none`: полоса прозрачна для пальца
    // целиком, а её ссылки возвращают себе `pointer-events: auto` — потомок с
    // `auto` остаётся целью и под предком с `none`.
    const away = phoneBlocks(railCss).find((block) => block.includes(".stackAway"));
    expect(away, "правило уехало из телефонной ветки — полоса погаснет и на десктопе").toBeTruthy();
    expect(away).toContain("visibility: hidden;");
    // Числа свои не заводим: те же 260 мс и кривая метки зоны из контракта.
    expect(away).toContain("var(--zone-marker-ms)");
  });
});

describe("141 + 145 — подсказка «коснись зоны» не выпирает", () => {
  it("плашки нет, но кегль и цвет — системные (раунд 35)", () => {
    // Дизайн диагноз принял, а два наших числа отклонил, и оба по делу:
    // кегля 8 в системе нет нигде, а .42 ниже пола контраста 4.5:1 над
    // #0B0806 — самая тихая ступень системы .48. Ловим оба, чтобы «сделать
    // ещё тише» в следующий раз не увело за этот пол.
    const phone = phoneBlocks(sceneCss).find((block) => block.includes(".hintPill"));
    expect(phone, "телефонная ветка подсказки пропала").toBeTruthy();
    expect(phone, "плашка вернулась — подсказка снова читается кнопкой").toContain(
      "background: none;",
    );
    expect(phone).toContain("font-size: 9px;");
    expect(phone, "цвет ушёл ниже пола контраста").toContain("color: rgba(255, 249, 242, 0.48);");
    expect(phone, "кегля 8 в системе нет").not.toContain("font-size: 8px;");
  });

  it("десктопная подсказка плашку сохраняет: там она лежит НА фотографии", () => {
    const base = /\.hintPill \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(base).toContain("background: rgba(11, 8, 6, 0.72);");
    expect(base).toContain("font: 500 10px/1 var(--font-ui);");
  });
});

describe("143 — низ поверхности задаёт страница, а не раскладка", () => {
  // У гостя таб-бара нет и быть не должно: он не вошёл, вкладкам некуда
  // вести. А место под бар раскладка резервировала всем, у кого класс `.imm`,
  // и нижние 86 px гостевого экрана оставались пустыми — на последнем экране
  // воронки, где человек решает, собрать ли свою комнату.
  const globalsCss = read("../src/app/globals.css");
  const guestPage = read("../src/app/r/[slug]/page.tsx");

  it("оба потребителя читают число страницы с ПРЕЖНИМ дефолтом", () => {
    // Дефолт обязателен: страница, не объявившая своего числа, обязана вести
    // себя ровно как раньше — иначе правка тихо уронит комнату хозяйки.
    expect(globalsCss).toContain("bottom: var(--imm-bar-h, var(--imm-tab-bar));");
    expect(
      phoneBlocks(sceneCss).some((block) =>
        block.includes("--sheet-bottom: var(--imm-bar-h, var(--imm-tab-bar));"),
      ),
      "лист зоны перестал читать число страницы",
    ).toBe(true);
  });

  it("бар рисует ровно одна страница — она же и держит прежнее число", () => {
    // Связь, ради которой всё затевалось: место под бар резервирует тот, кто
    // бар рисует. Появится бар у гостя — этот тест обязан упасть.
    expect(ownerPage, "комната хозяйки перестала рисовать бар").toMatch(/<TabBar[\s\S]*?phoneOnly/u);
    expect(guestPage, "у гостя появился таб-бар — правило 143 больше не верно").not.toContain(
      "<TabBar",
    );
    expect(guestPage).toContain('"--imm-bar-h": "env(safe-area-inset-bottom, 0px)"');
    expect(ownerPage, "хозяйка объявила своё число — дефолт стал мёртвым").not.toContain(
      "--imm-bar-h",
    );
  });
});
