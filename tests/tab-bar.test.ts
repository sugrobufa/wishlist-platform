import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import tokensJson from "@design/tokens.json";
import { ADD_HREF, TAB_HREF, TAB_KEYS, TAB_SLOTS } from "../src/components/tab-bar/tabs";

// Таб-бар (тикет 52; переработан тикетом 65) — контракт, записанный числами и
// путями.
//
// Состояний в макете 25a было три: планка 112×4 в жёлобе комнаты, шторка 96 px
// по тяге пальцем и постоянный бар 86 px в списках. Приёмка 07.08 оставила
// одно — постоянный бар, теперь и в комнате тоже. Сама раскладка рисуется
// CSS-модулем; здесь сверяются его числа с доской и с tokens.json — разъедутся,
// упадёт тут, а не на глазах владельца. Тот же приём, что у
// tests/immersive-layout.test.ts с --band-ar-min.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/components/tab-bar/tab-bar.module.css");
const icons = read("../src/components/icons.tsx");

const tokens = tokensJson as unknown as {
  layout: {
    phoneImmersive: { tabBar: number; hitTargetMin: number; railBottom: number };
  };
};

describe("вкладки и маршруты", () => {
  it("маршруты вкладок — существующие, новых не появилось", () => {
    // Правило тикета 52: не плодить маршрутов. Четыре вкладки — четыре давно
    // живущих экрана; «Добавить» — существующая карточка добавления.
    expect(TAB_KEYS).toEqual(["room", "connections", "hall", "settings"]);
    expect(TAB_HREF).toEqual({
      room: "/room",
      connections: "/connections",
      hall: "/room/hall",
      settings: "/settings",
    });
    expect(ADD_HREF).toBe("/room/add");
  });

  it("кружок «Добавить» стоит посередине, как в 25a", () => {
    expect(TAB_SLOTS).toEqual(["room", "connections", "add", "hall", "settings"]);
  });
});

describe("числа 25a в CSS", () => {
  it("постоянное состояние берёт высоту из контракта: 86 (phoneImmersive.tabBar)", () => {
    // Число одно и живёт в пакете; CSS обязан ссылаться на переменную токена
    // (--imm-tab-bar из tokens.css), а не переписывать его руками.
    expect(tokens.layout.phoneImmersive.tabBar).toBe(86);
    expect(css).toContain("height: var(--imm-tab-bar, 86px);");
  });

  it("планки, шторки и жеста тяги в модуле не осталось (тикет 65)", () => {
    // Владелец просил всегда видимый бар, а вытянутая шторка на его же
    // скриншоте наезжала на кнопку добавления, значок «поделиться» и указатель
    // зон. Держать жест выключенным нельзя: он стоил тикету 55 отдельной
    // правки прицела. Ловим и числа, и имена классов — вернётся любое,
    // упадёт здесь.
    for (const dead of [
      "--tb-strip-w",
      "--tb-strip-h",
      "--tb-strip-bottom",
      "--tb-strip-tap",
      "--tb-sheet-h",
      "--tb-sheet-row-h",
      "--tb-sheet-handle-w",
      "--tb-pull-open-ms",
      "--tb-pull-close-ms",
      ".strip",
      ".sheet",
      ".handle",
      ".backdrop",
    ]) {
      expect(css, dead).not.toContain(dead);
    }
    // Кривая остаётся: интерфейсный out из motion.json, не самодельная.
    expect(css).toContain("--tb-ease: cubic-bezier(0.23, 1, 0.32, 1);");
  });

  it("нижняя полоса комнаты стоит НАД баром, жёлоб возвращён указателю (тикет 65)", () => {
    // Бар fixed высотой 86 и контента не двигает — полоса поднимается сама.
    // Прежде она отдавала планке нижние 18 px (тикет 55); планки нет —
    // отступа тоже.
    //
    // Бюджет нижней полосы (116, tokens.json → phoneImmersive.railBottom):
    //   44 действия + 4 шаг + 1 линия + 4 воздух + 44 пункты = 97,
    //   свободные 19 уходят воздухом наверх (стопка прижата к низу).
    const zoneIndexCss = read("../src/components/scene/zone-index.module.css");
    const globalsCss = read("../src/app/globals.css");

    expect(globalsCss).toMatch(/\.imm-rail-bottom \{\s*bottom: var\(--imm-tab-bar\);/u);
    expect(globalsCss).toMatch(/\.imm-rail-bottom \{[^}]*align-items: flex-end;/u);
    expect(zoneIndexCss).not.toContain("margin-bottom: 18px;");
    expect(zoneIndexCss).toContain("gap: 4px;");
    expect(zoneIndexCss).toContain("padding-top: 4px;");

    // Арифметика полосы: две цели по 44, шаг, линия и воздух — в 116.
    const railBottom = 116;
    const stack = 44 + 4 + 1 + 4 + 44;
    expect(stack).toBeLessThanOrEqual(railBottom);
    expect(railBottom).toBe(tokens.layout.phoneImmersive.railBottom);
  });

  it("порог «только телефон» — тот же 1024, что у всей раскладки комнаты", () => {
    // Второго порога в продукте не заводится: правило бара — точное
    // дополнение десктопной ветки globals.css.
    const globalsCss = read("../src/app/globals.css");
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.barPhoneOnly \{\s*display: none;/u);
    expect(globalsCss).toContain("@media not all and (min-width: 1024px)");
    expect(globalsCss).toMatch(/\.imm-rail \.imm-desktop-only \{\s*display: none;/u);
  });

  it("цель нажатия вкладки — не меньше контрактных 44", () => {
    expect(tokens.layout.phoneImmersive.hitTargetMin).toBe(44);
    expect(css).toContain("min-height: var(--hit-target-min, 44px);");
  });

  it("prefers-reduced-motion сокращает переходы, а не выключает смену состояния", () => {
    // motion.json → reducedMotion: transitions → 120ms.
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?transition-duration: 120ms;/u);
  });

  it("активная вкладка — только цветом: подчёркиваний в модуле нет", () => {
    // «Активная вкладка только цветом: подчёркивание спорило бы с полосой
    // света» (25a). border-top есть у самой полосы, у вкладок — ничего.
    expect(css).not.toContain("text-decoration: underline");
    expect(css).not.toContain("border-bottom");
  });
});

describe("иконки — канон 25a, не рукописные", () => {
  it("пути таб-бара и замен сняты с доски посимвольно", () => {
    // По одному опорному пути на знак; полный набор — src/components/icons.tsx.
    const canonical: Array<[string, string]> = [
      ["Комната (арка)", 'd="M4 20.5V11a8 8 0 0 1 16 0v9.5"'],
      ["Комната (тёплая точка)", '<circle cx="8" cy="14" r="1.1" fill="currentColor"'],
      ["Друзья", 'd="M17.6 14.4c2.1.8 3.5 2.7 3.5 5.1"'],
      ["Добавить", 'd="M12 5.5v13"'],
      ["Профиль", 'd="M5.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"'],
      ["Зал славы (двойная звезда)", 'd="M5.5 17.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"'],
      ["Поделиться (лоток)", 'd="M4.5 14v5.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V14"'],
      ["Скрыть (перечёркнутый глаз)", 'd="M10 10.1a2.7 2.7 0 0 0 3.8 3.8"'],
      ["Приватность (замок)", 'd="M8 11V7.5a4 4 0 0 1 8 0V11"'],
      ["Дошло (галочка)", 'd="M4.5 12.5l5 5 10-11"'],
      ["Из галереи (турн 24)", 'd="M4 15l4.5-4 4 3.5 3-2.5L20 16"'],
    ];
    for (const [name, path] of canonical) {
      expect(icons, name).toContain(path);
    }
  });

  it("прежний рукописный шер (три узла с рёбрами) не вернулся", () => {
    // Единственная замена «другой метафоры» из списка тикета 51.
    const src = srcFiles();
    for (const file of src) {
      expect(readFileSync(file, "utf8"), file).not.toContain('cx="18" cy="5.5" r="2.8"');
    }
  });

  it("глифов из шрифта в интерфейсе нет", () => {
    // Инвариант пакета (tokens.json → icons.note). Типографика строк —
    // стрелки «→»/«←», «·», «…» — знаком не считается (канон турна 12a);
    // ловим именно пиктограммы, которые легко вставить «символом».
    const glyphs = /[✓✔✕✖✗✘★☆⚙♥♡✎✏➕✚▲▼◀▶⭐❤]|[\u{1F512}\u{1F513}\u{1F5D1}\u{2699}]/u;
    for (const file of srcFiles()) {
      const text = readFileSync(file, "utf8");
      expect(glyphs.test(text), `${file}: глиф-пиктограмма из шрифта`).toBe(false);
    }
  });
});

// Все исходники интерфейса: каждый .ts/.tsx под src (node_modules в src нет).
function srcFiles(): string[] {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|tsx)$/u.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}
