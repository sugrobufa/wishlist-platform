import { describe, expect, it } from "vitest";
import { rooms } from "@/config/design";
import { NATIVE_TIMES_OF_DAY, type NativeTimeOfDay } from "@/components/scene/grading";

/**
 * РОДНОЕ ВРЕМЯ СУТОК БАЗ — СЧЁТ, А НЕ ПАМЯТЬ.
 *
 * Заведено тикетом 185 после находки дизайна (пакет 43). Три файла подряд
 * двенадцать дней утверждали, что ночью снято ЧЕТЫРЕ базы из десяти:
 * `config/design.ts`, `components/scene/grading.ts`, `settings/room-studio.tsx`.
 * Ночных пять — emerald, bold, gamer, study, loft.
 *
 * ПОВЕДЕНИЕ ВСЁ ЭТО ВРЕМЯ БЫЛО ВЕРНЫМ: `tod` читается из контракта, а не из
 * комментария, и грейдинг считал от настоящего родного времени. Врали ровно
 * слова — но слова здесь объясняют число, и объясняли они чужое.
 *
 * Отсюда и форма проверки: она держит не «пять», а СВЯЗЬ между контрактом и
 * тем, что о нём написано. Поменяется контракт — тест назовёт новые числа, и
 * комментарии придётся поправить вместе с ним.
 */
describe("родное время суток десяти баз", () => {
  const byTod = new Map<NativeTimeOfDay, string[]>();
  for (const room of rooms) {
    byTod.set(room.tod, [...(byTod.get(room.tod) ?? []), room.id].sort());
  }

  it("баз ровно десять, и у каждой время суток из контракта", () => {
    expect(rooms).toHaveLength(10);
    for (const room of rooms) {
      expect(NATIVE_TIMES_OF_DAY).toContain(room.tod);
    }
  });

  it("ночных пять, сумеречных четыре, дневная одна — поимённо", () => {
    expect(byTod.get("night")).toEqual(["bold", "emerald", "gamer", "loft", "study"]);
    expect(byTod.get("dusk")).toEqual(["cream", "lux", "sport", "warm"]);
    expect(byTod.get("day")).toEqual(["cottage"]);
    // Утренних баз нет ни одной: положение ручки «утро» существует, снятой в
    // нём базы — нет. Это не пропуск, а факт съёмки.
    expect(byTod.get("morning")).toBeUndefined();
  });

  it("«ночь» осталась свойством фотографии, хотя положением ручки быть перестала", () => {
    // Тикет 133 упразднил ночь как ВЫБОР. Если однажды кто-то заодно вычистит
    // её и из родных времён, вся матрица переходов у пяти баз поедет молча:
    // они станут считаться от чужого времени, и превью начнёт врать.
    expect(NATIVE_TIMES_OF_DAY).toContain("night");
    expect(byTod.get("night")?.length).toBe(5);
  });
});
