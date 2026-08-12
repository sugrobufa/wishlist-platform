import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ОБЛОЖКА ССЫЛКИ — СОБРАННАЯ, А НЕ НАРИСОВАННАЯ (тикет 205).
 *
 * Логотип приехал раундом 25 (09.08.2026) и трое суток лежал без дела: в
 * `layout.tsx` стоял комментарий «картинки OG ждут логотип», и никто его не
 * перечитывал. Третий случай того же класса за два дня — после
 * `handoff/README.md` (тикет 197) и списка Phase 2. Отсюда этот тест: пусть
 * теперь ждёт не комментарий, а проверка.
 *
 * Обложка обязана оставаться ФУНКЦИЕЙ канона, а не его копией. Скрипт
 * `scripts/build-og-cover.mjs` собирает её из `handoff/logo/`; если однажды
 * файл подменят руками, тест этого не увидит — зато увидит, если исчезнет сам
 * рецепт или связь с каноническим локапом.
 */
describe("обложка ссылки", () => {
  const root = process.cwd();
  const cover = join(root, "public/og-cover.png");
  const script = readFileSync(join(root, "scripts/build-og-cover.mjs"), "utf8");
  const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");

  it("файл лежит в раздаче и он настоящий PNG канонического размера", () => {
    const bytes = readFileSync(cover);
    expect(statSync(cover).size).toBeGreaterThan(1024);
    // Сигнатура PNG — иначе «файл есть» значило бы «что-то есть».
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // Размеры лежат в заголовке IHDR: ширина 16..20, высота 20..24.
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });

  it("рецепт берёт КАНОНИЧЕСКИЙ локап, а не мёртвые файлы раунда 13", () => {
    expect(script).toContain("design/package/handoff/logo/grace-lockup-outlined.svg");
    // В `design/round13/logo/` лежат два файла с живым `<text>` и семейством,
    // которого нет на чужой машине; README пакета их прямо запрещает.
    expect(script).not.toMatch(/round13/u);
  });

  it("продукт отдаёт её карточке ссылки, и адрес разрешается в абсолютный", () => {
    expect(layout).toMatch(/images:\s*\[\{\s*url:\s*"\/og-cover\.png"/u);
    // Без `metadataBase` относительный адрес роняет сборку (дока Next), а в
    // мессенджер уехал бы путь без хоста.
    expect(layout).toMatch(/metadataBase:\s*new URL\(/u);
  });

  it("комнате она не навязана — там свой кадр", () => {
    // У `r/[slug]` карточка показывает САМУ комнату, и это лучше локапа.
    // Проверяем, что корневой layout не перебивает её жёстким абсолютным
    // адресом: у сегмента ниже своя картинка, и она обязана побеждать.
    const guest = readFileSync(join(root, "src/app/r/[slug]/page.tsx"), "utf8");
    expect(guest).toMatch(/roomImageUrl/u);
    expect(layout).not.toMatch(/og-cover\.png".*absolute/u);
  });
});
