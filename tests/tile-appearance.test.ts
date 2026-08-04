// Классификатор вида плитки (тикет 03). Главный тест — инвариант №3 CLAUDE.md:
// пунктир кодирует состояние «хочу», а НЕ отсутствие фото. В первой версии
// прототипа это перепутали (items.json → commonMistake) — тест не даёт
// ошибке вернуться.
import { describe, expect, it } from "vitest";
import { tileAppearance, type TileItemLike } from "../src/components/zone/tile-appearance";

const PHOTO = "/rooms/p-vinyl.jpg";

function make(overrides: Partial<TileItemLike>): TileItemLike {
  return { state: "WANT", photoUrl: null, isDemo: false, ...overrides };
}

describe("tileAppearance", () => {
  it("«хочу» с фото → пунктир и полоса, без серой заливки", () => {
    const look = tileAppearance(make({ state: "WANT", photoUrl: PHOTO }));
    expect(look.dashed).toBe(true);
    expect(look.accentBar).toBe(true);
    expect(look.greyFill).toBe(false);
  });

  it("«хочу» без фото → пунктир + серая заливка", () => {
    const look = tileAppearance(make({ state: "WANT", photoUrl: null }));
    expect(look.dashed).toBe(true);
    expect(look.greyFill).toBe(true);
  });

  it("«люблю» без фото → серая заливка БЕЗ пунктира (историческая ошибка прототипа)", () => {
    const look = tileAppearance(make({ state: "LOVE", photoUrl: null }));
    expect(look.greyFill).toBe(true);
    expect(look.dashed).toBe(false);
    expect(look.accentBar).toBe(false);
  });

  it("«люблю» с фото → ни пунктира, ни заливки", () => {
    const look = tileAppearance(make({ state: "LOVE", photoUrl: PHOTO }));
    expect(look.dashed).toBe(false);
    expect(look.greyFill).toBe(false);
    expect(look.accentBar).toBe(false);
  });

  it("демо-призрак → ghost, настоящая вещь → нет", () => {
    expect(tileAppearance(make({ isDemo: true })).ghost).toBe(true);
    expect(tileAppearance(make({ isDemo: false })).ghost).toBe(false);
  });

  it("полоса 2px — строгий спутник пунктира, а ghost не влияет на код состояния", () => {
    for (const state of ["LOVE", "WANT"] as const) {
      for (const photoUrl of [null, PHOTO]) {
        for (const isDemo of [false, true]) {
          const look = tileAppearance({ state, photoUrl, isDemo });
          expect(look.accentBar).toBe(look.dashed);
          expect(look.dashed).toBe(state === "WANT");
          expect(look.ghost).toBe(isDemo);
        }
      }
    }
  });
});
