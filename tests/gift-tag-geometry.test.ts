import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(process.cwd(), "src/app/r/[slug]/booking/gift-tag.module.css"),
  "utf8",
);
const TAG = readFileSync(
  resolve(process.cwd(), "src/app/r/[slug]/booking/gift-tag.tsx"),
  "utf8",
);

/**
 * 248 — БИРКА ОДНОГО РАЗМЕРА И НЕ ТЯНЕТСЯ.
 *
 * Приёмка 14.08.2026: «бирка на главной вещи становится большой и на весь
 * экран, выглядит уродливо… должна выглядеть меньше раза в два… не как кнопка,
 * а как бирка». Пакет 55 (турн 61b) ответил числами: 124×44 вместо 218×66, и
 * ширину задаёт СОДЕРЖИМОЕ, не контейнер.
 */
describe("248 — геометрия бирки", () => {
  it("НЕ ТЯНЕТСЯ ПО КОНТЕЙНЕРУ — это и была жалоба", () => {
    // `width: 100%` у плиточного варианта и разъезжался на широкой карточке.
    expect(CSS).not.toMatch(/\.tile\s*\{[^}]*width:\s*100%/u);
    expect(CSS).toMatch(/\.tile,\s*\n\.sheet\s*\{[\s\S]{0,80}width:\s*124px/u);
  });

  it("одна геометрия на обе карточки: 124 × 44", () => {
    expect(CSS).toContain("width: 124px;");
    expect(CSS).toContain("height: 44px;");
    // Высота 44 — пол цели нажатия, ниже нельзя; уменьшено шириной.
    expect(CSS).not.toContain("height: 46px;");
    expect(CSS).not.toContain("width: 218px;");
  });

  it("строки «для {имя}» на бирке нет — имя уже в шапке комнаты", () => {
    // Проверяем ПРОП и его отрисовку, а не слово: имя ключа стоит в разборе
    // над пропсами, и запрет на слово запрещал бы объяснять решение.
    expect(TAG).not.toMatch(/forName[:=]/u);
    expect(TAG).not.toMatch(/\{forName\}/u);
    // Ключ при этом жив — он остаётся в диалоге брони, где имя к месту.
    expect(TAG).not.toMatch(/t\w*\("tagFor"/u);
  });

  it("кегль на одну ступень тише, а не на две", () => {
    expect(CSS).toContain("font: 700 13px/1 var(--font-ui);");
    expect(CSS).not.toContain("font: 700 15px/1 var(--font-ui);");
  });

  it("тень ближе к карточке — на бирке 44 прежняя читалась отрывом", () => {
    expect(CSS).toContain("drop-shadow(0 4px 7px rgba(0, 0, 0, 0.6))");
    expect(CSS).not.toContain("drop-shadow(0 7px 11px");
  });

  it("ось поворота стоит в отверстии — бумага висит на нити", () => {
    expect(CSS).toContain("transform-origin: 16.5px 22px;");
    expect(CSS).toMatch(/\.hole\s*\{[\s\S]{0,120}width:\s*11px/u);
  });
});
