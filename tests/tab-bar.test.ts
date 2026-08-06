import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import tokensJson from "@design/tokens.json";
import { ADD_HREF, TAB_HREF, TAB_KEYS, TAB_SLOTS } from "../src/components/tab-bar/tabs";

// Таб-бар (тикет 52) — контракт турна 25a, записанный числами и путями.
//
// Три состояния из макета: планка 112×4 в жёлобе (в комнате), шторка 96 px
// с рядом вкладок 78 px (по тяге), постоянный 86 px (в списках). Сама
// раскладка рисуется CSS-модулем; здесь сверяются его числа с доской и
// с tokens.json — разъедутся, упадёт тут, а не на глазах владельца.
// Тот же приём, что у tests/immersive-layout.test.ts с --band-ar-min.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/components/tab-bar/tab-bar.module.css");
const icons = read("../src/components/icons.tsx");

const tokens = tokensJson as unknown as {
  layout: { phoneImmersive: { tabBar: number; hitTargetMin: number } };
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

  it("планка, шторка и тяга — дословно с доски", () => {
    // «Одна планка 112×4… Тянуть вверх» · «Высота 86, иконка 22. В шторке 78
    // и 21» · «Тяга 96 px за 240 ms, обратно 200».
    for (const line of [
      "--tb-strip-w: 112px;",
      "--tb-strip-h: 4px;",
      "--tb-strip-bottom: 14px;",
      "--tb-sheet-h: 96px;",
      "--tb-sheet-row-h: 78px;",
      "--tb-sheet-handle-w: 36px;",
      "--tb-pull-open-ms: 240ms;",
      "--tb-pull-close-ms: 200ms;",
    ]) {
      expect(css, line).toContain(line);
    }
    // Кривая — интерфейсный out из motion.json, не самодельная.
    expect(css).toContain("--tb-ease: cubic-bezier(0.23, 1, 0.32, 1);");
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
