import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Сид Phase 0: демо-хозяйка с кремовой комнатой.
// Пресеты комнат НЕ живут в БД — их источник design/package/handoff/rooms.json.
const prisma = new PrismaClient();

/**
 * ВТОРАЯ КОМНАТА СТЕНДА — ЗАВЕДОМО ПУСТАЯ (тикет 190).
 *
 * У стенда есть комната, и она полна: девять десятков вещей, тринадцать зон,
 * посев при каждом входе. Проверить на ней «первое действие пустой комнаты
 * ведёт в /room/add» нечем — блок первого шага живёт под условием
 * `itemCount === 0` и в полной комнате не рисуется вовсе. Единственная дорога
 * к пустоте была `/dev-login?fresh=1`, но она СНОСИТ комнату владельца: для
 * читающего спека (`e2e/mobile-layout.spec.ts`) это запись, и разрушительная.
 *
 * Поэтому пустая комната у стенда СВОЯ, отдельным человеком. Вещей ей не
 * приносит никто: посев ходит только по `QUICK_LOGIN_EMAIL`, а вход этим
 * пользователем (`/dev-login?empty=1`) не сеет вовсе — в этом весь его смысл.
 *
 * ИМЯ ГОВОРИТ, ЧТО ЭТО. В шапке комнаты стоит `displayName`, и «Пустая
 * комната» там честнее любого выдуманного имени: открыв стенд, владелец сразу
 * видит, на какую из двух комнат смотрит.
 */
const EMPTY_ROOM_EMAIL = "empty@wishlist.local";

async function main() {
  const roomsContract = JSON.parse(
    readFileSync(resolve(__dirname, "../design/package/handoff/rooms.json"), "utf8"),
  ) as { rooms: Array<{ id: string; demo?: { owner?: string } }> };

  const cream = roomsContract.rooms.find((r) => r.id === "cream");
  if (!cream) throw new Error("rooms.json: пресет cream не найден — контракт нарушен");

  const demo = await prisma.user.upsert({
    where: { email: "demo@wishlist.local" },
    update: {},
    create: {
      email: "demo@wishlist.local",
      displayName: cream.demo?.owner ?? "Мила",
      locale: "ru",
      room: {
        create: {
          preset: "cream",
          zoneSet: "F",
          shareSlug: "demo",
        },
      },
    },
  });

  console.log(`seed: демо-пользователь ${demo.email} с комнатой cream (/r/demo)`);

  // Комната заводится ПУСТОЙ и такой остаётся: `update: {}` — посев только
  // добавляет, вещей отсюда не сносит и чужого не трогает (то же правило, что
  // у stand-seed). Если в этой комнате однажды окажется вещь — значит в неё
  // кто-то вошёл руками и что-то завёл; e2e скажет об этом прямым текстом.
  const empty = await prisma.user.upsert({
    where: { email: EMPTY_ROOM_EMAIL },
    update: {},
    create: {
      email: EMPTY_ROOM_EMAIL,
      displayName: "Пустая комната",
      locale: "ru",
      room: {
        create: {
          preset: "cream",
          zoneSet: "F",
          shareSlug: "empty",
        },
      },
    },
  });

  console.log(`seed: пустая комната стенда ${empty.email} (/dev-login?empty=1, тикет 190)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
