import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `viewport-fit=cover` — КОРЕНЬ, ОТ КОТОРОГО ЗАВИСЯТ ОБА ИНСЕТА (тикет 200).
 *
 * Без него WebKit возвращает `env(safe-area-inset-*) = 0`, и всё, что от них
 * считается, тихо превращается в ноль:
 *
 * - `--imm-tab-bar` = полоса + нижний инсет — тикет 182 закрывал щель под
 *   баром только в эмуляции, на айфоне заливка оставалась 86 px;
 * - `--imm-safe-top` — мёртв с тикета 57: проект считал, что обрабатывает
 *   чёлку, и не обработал её ни разу.
 *
 * ПОЧЕМУ ТЕСТ ЧИТАЕТ ИСХОДНИК, А НЕ БРАУЗЕР. В Chromium инсеты равны нулю и
 * до правки, и после: проверка «под баром чисто» зеленеет в обоих случаях и
 * не доказывает ничего (урок приёмки 11.08). Доказывают два другие способа —
 * тест на устройство, читающий CSS и требующий инсет В ФОРМУЛЕ (он есть,
 * `tab-bar.test.ts`), и вот этот: объявление, без которого формула считает
 * ноль.
 *
 * Сторож нужен потому, что удалить `export const viewport` можно случайно и
 * без единого падения: продукт продолжит собираться, тесты — зеленеть, а на
 * телефоне владельца вернётся ровно то, что он прислал скриншотом.
 */
describe("вьюпорт", () => {
  const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
  const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("корневой layout объявляет viewport-fit=cover", () => {
    expect(layout).toMatch(/export const viewport:\s*Viewport\s*=/u);
    expect(layout).toMatch(/viewportFit:\s*["']cover["']/u);
  });

  it("объявление живёт РОВНО в одном месте — иначе два вьюпорта поспорят", () => {
    expect([...layout.matchAll(/viewportFit/gu)]).toHaveLength(1);
  });

  it("оба инсета и правда кем-то читаются — иначе объявление ничего не включает", () => {
    // Пара к объявлению: без потребителей `cover` был бы косметикой.
    expect(globals).toContain("--imm-safe-bottom: env(safe-area-inset-bottom, 0px);");
    expect(globals).toContain("--imm-safe-top: env(safe-area-inset-top, 0px);");
    // Нижний инсет входит в высоту бара СУММОЙ, а не стоит рядом без дела.
    expect(globals).toContain(
      "--imm-tab-bar: calc(var(--imm-tab-bar-band) + var(--imm-safe-bottom));",
    );
  });
});
