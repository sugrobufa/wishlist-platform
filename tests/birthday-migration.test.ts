// Миграция `room_birthday` не теряет ни одной существующей даты (тикет 187).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ТЕСТ. Колонка `Room.occasionDate` разложена на день, месяц и
// год и снесена — после этого сравнивать «до» и «с чем» уже не с чем: старого
// столбца в базе нет. Поэтому тест не смотрит на сегодняшнюю базу, а ЧИТАЕТ
// САМ ФАЙЛ МИГРАЦИИ и прогоняет её оператор переноса на временной таблице,
// набитой данными стенда и краями года. Ошибись оператор на сутки или на
// часовой пояс — тест увидит это ровно так же, как увидела бы прод-база.
//
// БЕЗОПАСНОСТЬ. Временная таблица называется `Room` и в search_path стоит
// раньше настоящей — оператор миграции идёт в неё дословно, без правок «под
// тест». Вся работа живёт в одной интерактивной транзакции, которая в конце
// СОЗНАТЕЛЬНО откатывается: даже если временная таблица однажды не создастся,
// до строк настоящей комнаты изменения не доедут.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";

const MIGRATION = new URL(
  "../prisma/migrations/20260811120000_room_birthday/migration.sql",
  import.meta.url,
);

/** Оператор переноса из файла миграции — между двумя пометками, дословно. */
function backfillStatement(): string {
  // Переводы строк нормализуем: файл может лежать с CRLF, а пометка — строка.
  const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/gu, "\n");
  const marker = sql.indexOf("-- migration:backfill\n");
  const end = sql.indexOf("-- migration:backfill-end");
  expect(marker, "пометки оператора переноса в миграции больше нет").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(marker);
  const statement = sql.slice(sql.indexOf("\n", marker) + 1, end).trim();
  expect(statement.startsWith('UPDATE "Room"')).toBe(true);
  return statement;
}

/** Даты стенда на момент миграции плюс края, на которых ошибаются чаще всего. */
const STAND_DATES = [
  "2026-12-31", // край года
  "2027-01-01", // и обратный край
  "2028-02-29", // високосный день
  "1990-03-08", // настоящий год рождения
  "2026-08-11", // сегодняшний день стенда
];

type Row = {
  id: string;
  day: number | null;
  month: number | null;
  year: number | null;
  same: boolean | null;
};

/** Сигнал «работа сделана, транзакцию откатить» — не отказ теста. */
class Rollback extends Error {
  constructor(readonly rows: Row[]) {
    super("rollback");
  }
}

async function runMigrationOnFixture(): Promise<Row[]> {
  try {
    await prisma.$transaction(async (tx) => {
      // Временная таблица той же формы, что настоящая до миграции.
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "Room" (
          id text PRIMARY KEY,
          "occasionDate" timestamp(3),
          "birthdayDay" integer,
          "birthdayMonth" integer,
          "birthdayYear" integer
        ) ON COMMIT DROP
      `);

      // Даты стенда, комната без даты — и ГОД ПОДРЯД: каждая дата 2026-08-11 …
      // 2028-08-10 обязана пережить перенос, включая 29 февраля 2028-го.
      const values = STAND_DATES.map(
        (date, index) => `('stand-${index}', TIMESTAMP '${date} 00:00:00')`,
      ).join(", ");
      await tx.$executeRawUnsafe(
        `INSERT INTO "Room" (id, "occasionDate") VALUES ${values}, ('no-date', NULL)`,
      );
      await tx.$executeRawUnsafe(`
        INSERT INTO "Room" (id, "occasionDate")
        SELECT 'sweep-' || n, TIMESTAMP '2026-08-11 00:00:00' + (n || ' days')::interval
        FROM generate_series(0, 730) AS n
      `);

      await tx.$executeRawUnsafe(backfillStatement());

      const rows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT id,
               "birthdayDay" AS day,
               "birthdayMonth" AS month,
               "birthdayYear" AS year,
               CASE
                 WHEN "occasionDate" IS NULL THEN NULL
                 ELSE make_date("birthdayYear", "birthdayMonth", "birthdayDay")
                      = "occasionDate"::date
               END AS same
        FROM "Room"
        ORDER BY id
      `);
      throw new Rollback(rows);
    });
  } catch (error) {
    if (error instanceof Rollback) return error.rows;
    throw error;
  }
  throw new Error("транзакция не откатилась — так быть не должно");
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("миграция room_birthday — ни одной потерянной даты", () => {
  it("каждая дата раскладывается в тот же самый день (стенд + два года подряд)", async () => {
    const rows = await runMigrationOnFixture();
    const dated = rows.filter((row) => row.same !== null);

    // 5 дат стенда + 731 день подряд: если оператор ошибётся на сутки хоть на
    // одной (край года, високосный день, переход месяца) — здесь будет строка.
    expect(dated).toHaveLength(STAND_DATES.length + 731);
    expect(dated.filter((row) => row.same !== true)).toEqual([]);
  });

  it("комната без даты остаётся без даты — перенос не выдумывает праздник", async () => {
    const rows = await runMigrationOnFixture();
    const empty = rows.find((row) => row.id === "no-date");
    expect(empty).toMatchObject({ day: null, month: null, year: null, same: null });
  });

  it("год переносится вместе с датой, а не теряется по дороге", async () => {
    // Год продукту не нужен ни для чего и нигде не показывается, но выбросить
    // то, что человек ввёл, миграция не вправе.
    const rows = await runMigrationOnFixture();
    expect(rows.find((row) => row.id === "stand-3")).toMatchObject({
      day: 8,
      month: 3,
      year: 1990,
    });
    expect(rows.find((row) => row.id === "stand-2")).toMatchObject({
      day: 29,
      month: 2,
      year: 2028,
    });
  });

  it("настоящая таблица комнат этим прогоном не тронута", async () => {
    // Транзакция откатывается сознательно — но проверить это стоит: тест
    // работает под именем настоящей таблицы.
    const before = await prisma.room.count();
    await runMigrationOnFixture();
    expect(await prisma.room.count()).toBe(before);
  });
});
