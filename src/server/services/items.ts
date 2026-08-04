// Сервис «Вещь» (Item), пока только чтение: наполнение зоны для сетки
// «Люблю»/«Хочу» (тикет 03). Создание/редактирование придёт тикетом 04.
// Бизнес-логика живёт здесь, роуты/страницы остаются тонкими (CLAUDE.md).
import type { Item } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";

const idSchema = z.string().min(1);

/**
 * Вещи одной зоны комнаты для хозяйки (включая спрятанные — их видит
 * только она; фильтр для гостя — тикет 07).
 *
 * Порядок (контракт тикета 03):
 * - группа «люблю» — по createdAt (новые выше);
 * - группа «хочу» — по desire по убыванию (без desire — в конец), затем
 *   по createdAt (новые выше).
 * Группы отдаются подряд: сначала «люблю», затем «хочу» — как вкладки в UI.
 */
export async function listZoneItems(roomId: string, zoneKey: string): Promise<Item[]> {
  const items = await prisma.item.findMany({
    where: { roomId: idSchema.parse(roomId), zone: idSchema.parse(zoneKey) },
  });
  return items.sort(compareZoneItems);
}

function compareZoneItems(a: Item, b: Item): number {
  if (a.state !== b.state) return a.state === "LOVE" ? -1 : 1;
  if (a.state === "WANT") {
    // desire: 4 → 1, null — в конец (степень желания не указана).
    const desireA = a.desire ?? -1;
    const desireB = b.desire ?? -1;
    if (desireA !== desireB) return desireB - desireA;
  }
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) return byDate;
  // Детерминированный добивочный ключ на случай равных таймстампов.
  return a.id < b.id ? 1 : -1;
}
