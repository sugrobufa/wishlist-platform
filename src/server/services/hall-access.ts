// Кто видит сокровищницу (тикет 116, ADR-0011).
//
// Настройка про ЭКРАН витрины, а не про цену на ней. Цена управляется своей,
// соседней и независимой (`Room.hallPriceVisibility`, четыре положения,
// ADR-0004): открытая витрина с закрытой ценой — законное сочетание, а
// закрытая витрина настройку цены не сбрасывает.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ВЕТКА В guest-hall.ts. Ответ «пускать ли
// этого зрителя» нужен ДВАЖДЫ и в разных местах: на самом чтении витрины
// (`getGuestHall` → 404) и в некэшируемом канале «занято», откуда гостевая
// страница узнаёт, рисовать ли вход «Сокровищница» (ссылки, ведущей в 404,
// быть не должно — требование ADR). Разъедься правило на два места, и первая
// же правка сделала бы дверь и ссылку разными.
//
// ИНВАРИАНТ №4 (друзья не добавляются) цел: здесь связь только ЧИТАЕТСЯ.
// Взаимность — уже существующее состояние строки, поставленное согласием
// обеих сторон (тикет 98b/114), и создать её отсюда нечем.
import type { HallVisibility } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";

const idSchema = z.string().min(1).max(64);

/**
 * Есть ли между двумя людьми ВЗАИМНАЯ связь.
 *
 * Строка Connection одна на пару и живёт в ЛЮБОЙ ориентации (`aUserId`/
 * `bUserId` — кто оказался первым, зависит от того, кто кому подарил или чью
 * комнату посмотрел), поэтому спрашиваем обе разом. Взаимность — это ровно
 * `mutualAt !== null`: момент, когда согласились обе стороны
 * (services/connections.stampMutual). `kind` здесь не спрашивается сознательно
 * — он отвечает на «какая это связь», а не на «состоялась ли она».
 */
export async function isMutualPair(userA: string, userB: string): Promise<boolean> {
  const a = idSchema.parse(userA);
  const b = idSchema.parse(userB);
  if (a === b) return false; // связи с самим собой не существует

  const row = await prisma.connection.findFirst({
    where: {
      mutualAt: { not: null },
      OR: [
        { aUserId: a, bUserId: b },
        { aUserId: b, bUserId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/** Комната глазами этой проверки: чья она и как открыта. */
export type HallAccessRoom = {
  userId: string;
  hallVisibility: HallVisibility;
};

/**
 * Открыта ли сокровищница этой комнаты ЭТОМУ зрителю.
 *
 * - хозяйке своей комнаты — всегда: она смотрит витрину на /room/hall, но
 *   открыв собственную гостевую ссылку, запертой двери увидеть не должна;
 * - `ALL` — открыто любому, у кого есть ссылка (сегодняшнее поведение и
 *   дефолт: холодный гость приходит ДО праздника и связи ещё не имеет);
 * - `MUTUAL` — только вошедшему гостю со взаимной связью. Аноним взаимным
 *   быть не может по определению, и отдельного экрана «войди, чтобы увидеть»
 *   мы не рисуем (ADR-0011, «что осталось открытым»);
 * - `NONE` — закрыто всем, кроме хозяйки.
 */
export async function hallOpenToViewer(
  room: HallAccessRoom,
  viewerUserId: string | null,
): Promise<boolean> {
  const viewer = viewerUserId === null ? null : idSchema.parse(viewerUserId);
  if (viewer !== null && viewer === room.userId) return true;

  switch (room.hallVisibility) {
    case "ALL":
      return true;
    case "MUTUAL":
      return viewer !== null && (await isMutualPair(viewer, room.userId));
    case "NONE":
      return false;
  }
}
