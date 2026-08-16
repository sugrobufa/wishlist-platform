// Положение «ночь» уходит из продукта целиком (тикет 133).
//
// ОТКУДА. Приёмка владельца 09.08.2026 по живому стенду: «с ночным вариантом
// мы всё-таки сильно перебрали, почти ничего не видно. Я думаю, вечерний и
// ночной вариант должен быть один и тот же». Дизайн согласился раундом 32
// (`design/package/handoff/round32-task34.json`): довода за отдельную ночь у
// него нет — «„праздник вечером" покрывается вечером, а будущему экрану свет
// добавляется слоем, а не положением».
//
// РЕЦЕПТЫ проверяет `grading.test.ts`. ЗДЕСЬ — продуктовая половина решения,
// то есть всё, что ломается НЕ в grading.ts:
//   1) в настройках три плитки, а не четыре, и ряд под них перестроен;
//   2) сервер не принимает `night` на запись;
//   3) существующим комнатам поставлен вечер — миграцией, а не молча в коде;
//   4) строки «Ночь» в словаре не осталось: сирота без употребления рано или
//      поздно вернулась бы в UI как «готовая строка»;
//   5) числа дизайна перенесены из машинного пакета, а не набраны на слух.
//
// ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: приёмки самого света. **Свет принимается на
// телефоне, а не числом** — урок этого же тикета. Мы померили ночь в `sharp`,
// получили 0.268 против ожидаемых 0.27 и оба сочли это попаданием, а на
// телефоне с малой яркостью не видно ничего. Всё, что ниже, ловит грубые
// ошибки и расхождение с пакетом.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TIMES_OF_DAY } from "../src/components/scene/grading";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const settings = read("../src/app/settings/settings-sections.tsx");
// Кадр настроек уехал из файла секций в свои два (тикет 181): ряд положений
// набран классом общего CSS-модуля, а родное время суток базы живёт в чистом
// `room-preview.ts`. Проверки те же — читают теперь оттуда.
const studioCss = read("../src/app/settings/room-studio.module.css");
const preview = read("../src/app/settings/room-preview.ts");
const roomsService = read("../src/server/services/rooms.ts");
const schema = read("../prisma/schema.prisma");
const grading = read("../src/components/scene/grading.ts");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;
const en = JSON.parse(read("../messages/en.json")) as Record<string, Record<string, string>>;

const MIGRATION = path.join("prisma", "migrations", "20260810090000_night_is_dusk", "migration.sql");
const migration = readFileSync(MIGRATION, "utf8");

/** Машинный пакет дизайна — источник чисел вечера (раунд 32, письмо 34). */
const task34 = JSON.parse(
  readFileSync(path.join("design", "package", "handoff", "round32-task34.json"), "utf8"),
) as {
  eveningNumbers: Record<string, { filter?: string; overlay?: string; blend?: string }>;
};

describe("ручка в настройках: три положения, не четыре", () => {
  it("положений ровно столько, сколько в словаре ручки", () => {
    // Число колонок в ряду — не украшение: с четырьмя в нём осталась бы пустая
    // клетка на месте снятой ночи.
    //
    // РЯД ПЕРЕЕХАЛ ИЗ УТИЛИТ В МОДУЛЬ (тикет 181): плитки в 56 px заменены
    // именованными положениями, и сетка задаётся классом `.knobRow`.
    //
    // ЧИСЛА КОЛОНОК В CSS БОЛЬШЕ НЕТ ВОВСЕ (тикет 256). Класс `.knobRow` один
    // на оба ряда, а длины у рядов разошлись: у времени суток три положения, у
    // цвета света два — «свечной» упразднён тем же доводом, что и ночь. Пока в
    // правиле стояло `repeat(3, …)`, пустая клетка вернулась бы в ряд света, то
    // есть капкан этого теста сработал бы на соседней ручке. Считает теперь
    // сам grid по числу детей, и проверка стала сильнее: захардкоженного числа
    // не должно быть НИКАКОГО — ни трёх, ни четырёх.
    expect(TIMES_OF_DAY).toHaveLength(3);
    expect(studioCss).toMatch(/\.knobRow\s*\{[^}]*grid-auto-flow:\s*column/u);
    expect(studioCss).not.toMatch(/grid-template-columns:\s*repeat\(\d/u);
    expect(settings).toContain("<div className={studio.knobRow}>");
    // Положения рисуются перебором словаря, а не списком руками — иначе
    // четвёртое однажды вернулось бы отдельной строкой.
    expect(settings).toContain("{TIMES_OF_DAY.map((option) => (");
  });

  it("родное время суток базы у превью — СВОЙ тип, шире ручки", () => {
    // Четыре базы из десяти сняты ночью. Превью обязано считать от родного
    // времени базы, иначе выбор «по картинке» покажет одно, а комната станет
    // другой — у ночных баз это расхождение вдвое (тикет 107).
    //
    // Значение переехало из пропа секции в карточку кадра (тикет 181): крупный
    // кадр показывает ВЫБРАННЫЙ интерьер, и считать грейдинг он обязан от его
    // фотографии, а не от той, что стоит в комнате.
    expect(preview).toContain("tod: NativeTimeOfDay;");
    expect(preview).toContain('import type { NativeTimeOfDay } from "@/components/scene/grading"');
  });
});

describe("сервер не принимает упразднённое положение", () => {
  it("схема записи берёт словарь ручки, а не свой список строк", () => {
    expect(roomsService).toContain("timeOfDay: z.enum(TIMES_OF_DAY).optional()");
    expect(roomsService).toContain('from "@/components/scene/grading"');
    // Ни одной собственной строки «night» в сервисе комнаты.
    expect(roomsService).not.toContain('"night"');
  });

  it("чтение недоверчиво и переводит уцелевшее `night` в вечер ОДНИМ местом", () => {
    // Условие тикета: «правило night → dusk ставить ОДНИМ местом в разрешении
    // рецепта, а не копировать значения в три ветки». Место — `asTimeOfDay`.
    expect(grading).toContain('if (value === RETIRED_TIME_OF_DAY) return "dusk";');
    // В матрице переходов ночь осталась ровно ветвью РОДНОГО времени базы
    // (отступ 2) и нигде не встречается ЦЕЛЬЮ (отступ 4).
    const matrix = grading.slice(
      grading.indexOf("const TRANSITION"),
      grading.indexOf("function todRecipe"),
    );
    expect(matrix.match(/^ {2}night: \{/gmu) ?? [], "ветка ночной базы одна").toHaveLength(1);
    expect(matrix).not.toMatch(/^ {4}night:/mu);
    expect(matrix).not.toContain("NIGHT_V2");
    // Синее окно ночи не возвращается ни к одной базе — цвета в файле нет.
    expect(grading).not.toContain("52,72,118");
  });
});

describe("существующие комнаты переведены миграцией", () => {
  it("миграция ставит вечер и трогает только строку `night`", () => {
    expect(migration).toContain(
      `UPDATE "Room" SET "timeOfDay" = 'dusk' WHERE "timeOfDay" = 'night';`,
    );
    // Ни удаления колонки, ни ограничений: поле строковое, риска нет.
    expect(migration).not.toMatch(/DROP COLUMN|ALTER TABLE|DROP TYPE/u);
  });

  it("схема больше не обещает четвёртого значения", () => {
    expect(schema).toContain('timeOfDay  String @default("day") // morning | day | dusk');
    expect(schema).not.toContain("morning | day | dusk | night");
  });
});

describe("строка «Ночь» ушла из словаря вместе с положением", () => {
  it("ключа нет ни в русском, ни в английском каркасе", () => {
    expect(ru.Settings).toBeDefined();
    expect(ru.Settings).not.toHaveProperty("tod_night");
    expect(en.Settings).not.toHaveProperty("tod_night");
  });

  it("у каждого живого положения подпись на месте", () => {
    for (const tod of TIMES_OF_DAY) {
      expect(ru.Settings?.[`tod_${tod}`], tod).toBeTruthy();
      expect(en.Settings?.[`tod_${tod}`], tod).toBeTruthy();
    }
  });
});

describe("числа вечера — из машинного пакета дизайна, а не на слух", () => {
  it("дневная база: фильтр, слой и режим наложения совпадают с round32-task34", () => {
    const spec = task34.eveningNumbers.nativeDay_dusk;
    expect(spec?.filter).toBe("brightness(.84) saturate(1.05)");
    expect(grading).toContain(`filter: "${spec?.filter}"`);
    expect(grading).toContain(`overlay: "${spec?.overlay}"`);
    // Режим — главное в правке: `multiply` глушил сильнее, чем казалось в
    // цифрах, и ровно из-за него провалилась ночь при верных числах.
    expect(spec?.blend).toBe("soft-light");
  });

  it("ночная база: фильтр тот же, слой — пятно ламп на screen", () => {
    const spec = task34.eveningNumbers.nativeNight_dusk;
    expect(spec?.filter).toBe("brightness(1.24) saturate(1.02)");
    expect(grading).toContain(`filter: "${spec?.filter}"`);
    expect(grading).toContain(spec?.overlay ?? "нет строки в пакете");
    expect(spec?.blend).toBe("screen");
  });

  it("сумеречная база: пакет прямо говорит identity — и слоёв у неё нет", () => {
    expect(String(task34.eveningNumbers.nativeDusk_dusk)).toContain("identity");
  });
});
