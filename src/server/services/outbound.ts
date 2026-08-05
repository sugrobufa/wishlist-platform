// Учёт переходов в магазин (тикет 37). Гость нажал «Перейти →» — пишем строку
// в OutboundClick. Модель в схеме была с самого начала и не использовалась
// ни разу: ссылку мы гостю не отдавали, а значит и переходить было некуда.
//
// Что это НЕ: не аналитика поведения человека и не след «кто смотрел». В
// строке нет ни гостя, ни комнаты, ни IP — только вещь, место нажатия и
// время. Хозяйке эти строки не показываются нигде: «сколько раз кликнули по
// моему колье» — соседняя дверь к «кто-то его уже берёт», а тихая бронь
// (инвариант №1) обещает обратное.
//
// Правило записи одно и заимствованное: переход существует ровно тогда, когда
// ссылку МОЖНО БЫЛО отдать гостю. Проверяем это не своим набором условий, а
// той же формой вещи, что рисует плитку (dto/guest-items → itemForGuest):
// спрятана (инвариант №5), «люблю», цена скрыта, ссылки нет — во всех этих
// случаях у формы нет ключа shop, и перехода быть не могло.
import { z } from "zod";
import { prisma } from "@/server/db";
import { itemForGuest } from "@/server/dto/guest-items";
import { RateLimiter } from "@/server/rate-limit";

/** Где нажали. Словарь колонки `OutboundClick.context` из схемы. */
export const OUTBOUND_CONTEXTS = ["SPACE", "ZONE", "LIST", "RESERVE_PAGE"] as const;
export type OutboundContext = (typeof OUTBOUND_CONTEXTS)[number];

export const outboundClickSchema = z.object({
  itemId: z.string().min(1).max(64),
  context: z.enum(OUTBOUND_CONTEXTS),
  /** Место внутри контекста (номер карточки и т.п.) — Phase 1 не заполняет. */
  subId: z.string().min(1).max(120).optional(),
});

export type OutboundClickInput = z.infer<typeof outboundClickSchema>;

/**
 * Своя корзина на IP, не бронная: клик по ссылке не вправе съедать право
 * занять подарок (у брони бюджет 10/мин на всё вместе — rate-limit.ts).
 * Redis сюда не подключён намеренно: это счётчик интереса, а не заслон, и
 * корзина, потерянная при рестарте процесса, ничего не стоит.
 */
const outboundLimiter = new RateLimiter({
  redis: null,
  capacity: 30,
  refillPerMinute: 30,
  prefix: "rl:v1:outbound",
});

export function allowOutboundClick(ip: string): Promise<boolean> {
  return outboundLimiter.allow(ip);
}

/**
 * Записывает переход. `false` — вещи нет или ссылки на неё гостю не давали;
 * вызывающая сторона на этом различии ничего не строит и отвечает одинаково
 * (иначе роут стал бы способом узнать, существует ли спрятанная вещь).
 */
export async function recordOutboundClick(input: OutboundClickInput): Promise<boolean> {
  const { itemId, context, subId } = outboundClickSchema.parse(input);

  // Спрятанное отсекается здесь, в сервисе, как во всём гостевом чтении
  // (инвариант №5): форма вещи про hidden не знает — ключа у неё нет вовсе.
  const item = await prisma.item.findFirst({ where: { id: itemId, hidden: false } });
  if (!item) return false;

  // Та же развилка, что у плитки: ключ shop есть — ссылку гостю отдавали.
  const asGuestSees = itemForGuest(item);
  if (asGuestSees.state !== "WANT" || !asGuestSees.shop) return false;

  await prisma.outboundClick.create({
    data: { itemId: item.id, context, subId: subId ?? null },
  });
  return true;
}
