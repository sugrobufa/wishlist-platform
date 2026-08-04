import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Сид Phase 0: демо-хозяйка с кремовой комнатой.
// Пресеты комнат НЕ живут в БД — их источник design/package/handoff/rooms.json.
const prisma = new PrismaClient();

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
