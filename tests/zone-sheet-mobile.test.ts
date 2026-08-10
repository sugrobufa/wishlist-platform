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
    expect(sceneCss).toContain("--sheet-bottom: var(--rail-bottom);");
    expect(
      phoneBlocks(sceneCss).some((block) => block.includes("--sheet-bottom: var(--imm-tab-bar);")),
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

describe("141 — подсказка «коснись зоны» не выпирает", () => {
  it("на телефоне у неё нет плашки и кегль мельче десктопного", () => {
    const phone = phoneBlocks(sceneCss).find((block) => block.includes(".hintPill"));
    expect(phone, "телефонная ветка подсказки пропала").toBeTruthy();
    expect(phone).toContain("font-size: 8px;");
    expect(phone, "плашка вернулась — подсказка снова читается кнопкой").toContain(
      "background: none;",
    );
    expect(phone).toContain("color: rgba(255, 249, 242, 0.42);");
  });

  it("десктопная подсказка плашку сохраняет: там она лежит НА фотографии", () => {
    const base = /\.hintPill \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(base).toContain("background: rgba(11, 8, 6, 0.72);");
    expect(base).toContain("font: 500 10px/1 var(--font-ui);");
  });
});
