// Дрейф комнаты в покое (тикет 72, турн 28b).
//
// ЗАЧЕМ ТЕСТ. У дрейфа четыре условия, и все четыре ломаются молча:
//   1) он идёт ТОЛЬКО у гостя — хозяйке своя комната знакома, ей «вздох»;
//   2) первое касание и открытие зоны гасят его до конца сессии, иначе в зону
//      не прицелиться — зона уезжает из-под пальца;
//   3) он идёт через ТУ ЖЕ переменную пана, что панорама пальцем, иначе
//      указатель зон разъедется с окном;
//   4) при `prefers-reduced-motion` его нет вовсе — это ровно тот случай,
//      ради которого настройка существует.
// Ни одно из четырёх не видно на глаз без сравнения, поэтому читаем источник —
// тем же приёмом, что `zone-wake.test.ts` читает CSS.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { phonePanRange } from "../src/components/scene/immersive-layout";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const pan = read("../src/components/scene/use-scene-pan.ts");
const stage = read("../src/components/scene/SceneStage.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const ownerPage = read("../src/app/room/page.tsx");

/** Скорость проезда с доски (турн 28b): единиц кадра 630×351 в секунду. */
const UNITS_PER_S = 23;

describe("арифметика проезда", () => {
  it("окно едет ровно на ширину кадра за вычетом своей — 200 единиц", () => {
    const { min, max } = phonePanRange();
    // Кадр 630, окно 430, сдвиг −12: путь от −12 до 188.
    expect(min).toBe(-12);
    expect(max).toBe(188);
    expect(max - min).toBe(200);
  });

  it("плечо считается путём ÷ скорость, а не задаётся числом", () => {
    const { min, max } = phonePanRange();
    const legMs = ((max - min) / UNITS_PER_S) * 1000;
    // ≈ 8.7 с на проход — тот же порядок, что у дыхания кадра (15 с, phone).
    expect(legMs).toBeGreaterThan(8000);
    expect(legMs).toBeLessThan(9500);
    // Скорость записана в коде именно так, а не «на глаз» подобранной мс.
    expect(pan).toMatch(/const DRIFT_UNITS_PER_S = 23;/u);
    expect(pan).toMatch(/Math\.abs\(to - from\) \/ DRIFT_UNITS_PER_S/u);
  });
});

describe("условия дрейфа", () => {
  it("выключен при prefers-reduced-motion", () => {
    expect(pan).toMatch(/if \(!enabled \|\| !drift \|\| reducedMotion\) return;/u);
  });

  it("первое касание гасит его насовсем: стоп ставит перехват пальцем", () => {
    // freezeIntro зовётся из pointerdown — там же и ставится флаг.
    expect(pan).toMatch(/const freezeIntro = \(\) => \{\s*\/\/[^\n]*\n\s*driftStoppedRef\.current = true;/u);
    expect(pan).toMatch(/if \(driftStoppedRef\.current\) return;/u);
  });

  it("открытие зоны гасит его насовсем — человек уже выбрал", () => {
    expect(pan).toMatch(/if \(zoomed\) \{[\s\S]{0,200}driftStoppedRef\.current = true;/u);
  });

  it("едет через ту же переменную окна, второго сдвига нет", () => {
    // Единственная запись позиции — applyRef, и она ставит --win-pan.
    expect(pan).toMatch(/setProperty\("--win-pan"/u);
    const writes = [...pan.matchAll(/setProperty\("--win-pan"/gu)];
    expect(writes, "позицию окна пишет ровно одно место").toHaveLength(1);
    // Сам дрейф не трогает DOM мимо него.
    expect(pan).toMatch(/applyRef\.current\(to, ms, "ease-in-out"\);/u);
  });

  it("автопроезд тикета 55 не задвоен: при дрейфе он выключен", () => {
    expect(pan).toMatch(/if \(!enabled \|\| reducedMotion \|\| drift\) return;/u);
  });
});

describe("кому достаётся", () => {
  it("гость — с дрейфом", () => {
    expect(guestPage).toMatch(/<SceneStage[\s\S]{0,300}?\bdrift\b[\s\S]{0,80}?\/>/u);
  });

  it("хозяйка — без дрейфа", () => {
    const tag = ownerPage.match(/<SceneStage[\s\S]{0,300}?\/>/u)?.[0] ?? "";
    expect(tag, "у хозяйки «вздох», а не проезд").not.toMatch(/\bdrift\b/u);
  });

  it("по умолчанию дрейфа нет — включать надо осознанно", () => {
    expect(stage).toMatch(/drift = false,/u);
  });
});
