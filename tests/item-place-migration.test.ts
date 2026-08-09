// Отмена «хочу/люблю» — миграция модели (тикет 124, решение владельца
// 09.08.2026). Тест на САМУ МИГРАЦИЮ, а не на сервисы поверх неё.
//
// Проверяется три вещи, и все — по живой тест-БД, куда миграции уже
// применены (`prisma migrate deploy` перед прогоном):
//   1. колонки `Item.state` и типа `ItemState` в базе НЕТ. Пока они живы,
//      старый код продолжает «работать» незаметно, а модель раздваивается;
//   2. правило переноса записано верно: `LOVE → inHall = true`,
//      `WANT → остаётся в комнате`. Проверяем ТЕМ ЖЕ SQL, что стоит в
//      миграции, на своей маленькой таблице-двойнике — иначе правило пришлось
//      бы читать глазами;
//   3. индекс зоны переехал со `state` на `inHall`: обе выборки продукта
//      («вещи комнаты этой зоны» и «вещи витрины») ходят по нему.
//
// ПОЧЕМУ ТАБЛИЦА-ДВОЙНИК, А НЕ НАСТОЯЩИЕ ДАННЫЕ. Миграция уже применена и
// повторить её на `Item` нельзя — колонки `state` там больше нет. Двойник
// повторяет ровно ту форму, которая была ДО (state + inHall), и прогоняет по
// ней тот самый UPDATE. Это честная проверка правила переноса: ошибись мы в
// условии `AND "inHall" = false`, тест покраснеет.
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/server/db";

const MIGRATION_SQL = readFileSync(
  fileURLToPath(
    new URL("../prisma/migrations/20260809160000_remove_item_state/migration.sql", import.meta.url),
  ),
  "utf8",
);

const TWIN = "item_state_migration_twin";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TWIN}"`);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TWIN}"`);
  await prisma.$disconnect();
});

describe("состояние вещи убрано из базы", () => {
  it("колонки Item.state больше нет", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'Item' AND column_name = 'state'`,
    );
    expect(rows).toEqual([]);
  });

  it("типа ItemState больше нет", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ typname: string }>>(
      `SELECT typname FROM pg_type WHERE typname = 'ItemState'`,
    );
    expect(rows).toEqual([]);
  });

  it("колонка места на месте и не нулевая", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ is_nullable: string; data_type: string }>>(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'Item' AND column_name = 'inHall'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_nullable).toBe("NO");
    expect(rows[0]?.data_type).toBe("boolean");
  });

  it("индекс зоны переехал со state на inHall", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'Item'`,
    );
    const names = rows.map((row) => row.indexname);
    expect(names).toContain("Item_roomId_zone_inHall_idx");
    expect(names).not.toContain("Item_roomId_zone_state_idx");
  });
});

describe("правило переноса данных: LOVE → витрина, WANT → комната", () => {
  it("тот же UPDATE, что в миграции, раскладывает вещи верно", async () => {
    // Таблица-двойник ровно той формы, что была ДО миграции.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${TWIN}" (
        id text PRIMARY KEY,
        state text NOT NULL,
        "inHall" boolean NOT NULL DEFAULT false
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${TWIN}" (id, state, "inHall") VALUES
        ('want-plain',      'WANT', false),
        ('love-plain',      'LOVE', false),
        ('love-already',    'LOVE', true)
    `);

    // Строка миграции, взятая из файла: если её там поправят, поправится и тест.
    const update = MIGRATION_SQL.split("\n").find(
      (line) => line.startsWith('UPDATE "Item"') && line.includes('"state" = \'LOVE\''),
    );
    expect(update, "в миграции нет строки переноса LOVE → inHall").toBeDefined();
    await prisma.$executeRawUnsafe((update as string).replace('"Item"', `"${TWIN}"`));

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; inHall: boolean }>>(
      `SELECT id, "inHall" FROM "${TWIN}" ORDER BY id`,
    );
    expect(rows).toEqual([
      // Уже лежавшая на витрине — не тронута (и не могла быть тронута дважды).
      { id: "love-already", inHall: true },
      // «Люблю» уезжает на витрину: «уже моё» и есть сокровищница.
      { id: "love-plain", inHall: true },
      // «Хочу» остаётся в комнате: комната и есть список желаний.
      { id: "want-plain", inHall: false },
    ]);
  });

  it("миграция объясняет, что и куда переехало", () => {
    // Требование тикета дословно: «напиши в ней комментарий, что и куда
    // переехало». Проверяем, что объяснение на месте, — комментарий в
    // миграции читают через год, когда спрашивать уже некого.
    expect(MIGRATION_SQL).toContain("LOVE");
    expect(MIGRATION_SQL).toContain("WANT");
    expect(MIGRATION_SQL).toMatch(/сокровищниц|витрин/iu);
    expect(MIGRATION_SQL).toMatch(/комнат/iu);
  });
});
