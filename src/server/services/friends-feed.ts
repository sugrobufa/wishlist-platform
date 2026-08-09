// Лента «Что происходит» (тикет 114, часть 2) — ЧТЕНИЕ. Соседний
// `room-events.ts` пишет события, этот модуль их показывает.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ВТОРАЯ ПОЛОВИНА `room-events.ts`. Запись зовут
// из середины «добавить вещь» и «сменить интерьер» (`items.ts`, `rooms.ts`),
// а чтение обязано спросить, кто кому друг (`connections.ts`) — а тот, в свою
// очередь, читает гостевую комнату и вещи. Слей их в один модуль, и получится
// круг импортов items → room-events → connections → guest-room → items. Он бы
// даже работал (все обращения внутри функций), но круг в графе модулей — это
// мина: первый же импорт на верхнем уровне отдаст `undefined`.
//
// ЧТО ЗДЕСЬ РЕШАЕТСЯ, А ЧТО НЕТ. Здесь — только «чьи события человек имеет
// право увидеть» и «что из них вообще существует сегодня». Правила формы
// строки (свежесть, склейка дня, приоритет, кап 30) живут в `dto/feed.ts`,
// потому что это правила сериализации и проверяются они без базы.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets, zoneInfo } from "@/config/design";
import { listConnectionsForFeed } from "@/server/services/connections";
import {
  FEED_MILESTONE_DAYS,
  buildFeed,
  type FeedRowDto,
  type FeedSourceEvent,
} from "@/server/dto/feed";

const idSchema = z.string().min(1).max(64);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Сколько событий вообще поднимаем из базы за один заход. Строк на экране
 * тридцать, а событий за ними может быть сколько угодно: один друг за день
 * добавляет и сорок вещей. Кап здесь — не правило продукта, а предохранитель
 * от неограниченного запроса; склейка после него может только сократить.
 */
const FEED_EVENT_SCAN = 500;

/** Строка payload события: недоверенный JSON, поэтому с проверкой типа. */
function payloadText(payload: Prisma.JsonValue | null, key: "zone" | "preset"): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Зоны комнаты, которые в ней ЕСТЬ сейчас: интерьер минус выключенные. */
function visibleZoneKeys(preset: string | null, zonesOff: readonly string[]): Set<string> {
  const room = roomPresets.find((candidate) => candidate.id === preset);
  const off = new Set(zonesOff);
  return new Set((room?.zones ?? []).map((zone) => zone.key).filter((key) => !off.has(key)));
}

/**
 * Лента друзей смотрящего.
 *
 * Порядок шагов важен: сначала ДРУЗЬЯ (кто имеет право быть увиденным),
 * потом их события, и только потом форма строк. Чужие события человеку, не
 * состоящему в связи, не доезжают даже как отброшенные — фильтр стоит в
 * запросе, а не после него.
 *
 * `now` приходит параметром: «сегодня» — свойство запроса, а не данных, и
 * в кэше оно протухло бы на смене суток.
 */
export async function listFriendsFeed(userId: string, now: Date = new Date()): Promise<FeedRowDto[]> {
  const id = idSchema.parse(userId);
  const friends = await listConnectionsForFeed(id);
  if (friends.length === 0) return [];

  const byRoom = new Map(
    friends.flatMap((friend) => (friend.roomId === null ? [] : [[friend.roomId, friend] as const])),
  );
  // Зоны каждой комнаты считаем один раз на запрос, а не на каждую полку.
  const zonesByRoom = new Map(
    [...byRoom].map(([roomId, friend]) => [
      roomId,
      visibleZoneKeys(friend.roomPreset, friend.zonesOff),
    ]),
  );

  // Самое старое, что вообще может дожить до экрана, — веха тридцатидневной
  // давности. Точную свежесть по видам считает dto/feed.
  const oldest = new Date(now.getTime() - FEED_MILESTONE_DAYS * DAY_MS);
  const events =
    byRoom.size === 0
      ? []
      : await prisma.roomEvent.findMany({
          where: { roomId: { in: [...byRoom.keys()] }, createdAt: { gte: oldest } },
          orderBy: { createdAt: "desc" },
          take: FEED_EVENT_SCAN,
        });

  const source: FeedSourceEvent[] = [];

  for (const event of events) {
    const friend = byRoom.get(event.roomId);
    if (friend === undefined) continue;

    const row: FeedSourceEvent = {
      friendId: friend.userId,
      friendName: friend.displayName,
      roomSlug: friend.roomSlug,
      roomPreset: friend.roomPreset,
      kind: event.kind,
      at: event.createdAt,
    };

    if (event.kind === "SHELF_OPENED") {
      const zone = payloadText(event.payload, "zone");
      // Полка показывается ровно тогда, когда зона в комнате ЕСТЬ СЕЙЧАС:
      // стоит в её интерьере и не выключена (инвариант №5 — выключенная зона
      // исчезает вместе с мебелью). «У Милы появилась полка „Путешествия"»
      // про зону, которой в комнате больше нет, рассказывает ровно то, что
      // она убрала. Заодно это отсекает мусорный ключ payload до справочника.
      if (zone === null || zonesByRoom.get(event.roomId)?.has(zone) !== true) continue;
      // Зона без записи в zones.json не показывается вовсе (ADR-0003) — и
      // подписать строку нечем: ключ вместо имени читался бы как поломка.
      if (zoneInfo(zone) === null) continue;
      row.zone = zone;
    }

    if (event.kind === "TREASURY_OPENED") {
      // Строка живёт тридцать дней, а запереть витрину обратно можно за
      // секунду (тикет 116). Спрашиваем состояние СЕЙЧАС, а не в момент
      // события: «Сокровищница Милы теперь открыта», ведущая в 404, хуже
      // отсутствия строки. Взаимность уже известна из самой связи — второго
      // запроса не нужно.
      const open =
        friend.hallVisibility === "ALL" ||
        (friend.hallVisibility === "MUTUAL" && friend.mutualAt !== null);
      if (!open) continue;
    }

    if (event.kind === "ROOM_CHANGED") {
      const preset = payloadText(event.payload, "preset");
      if (preset === null || !roomPresets.some((candidate) => candidate.id === preset)) continue;
      row.preset = preset;
    }

    source.push(row);
  }

  // Пятое событие — про СВЯЗЬ, а не про комнату, и живёт оно не в RoomEvent,
  // а моментом `Connection.mutualAt` (у него две стороны и ни одной комнаты).
  // Отсюда и синтез: в ленту оно приходит здесь.
  for (const friend of friends) {
    if (friend.mutualAt === null) continue;
    source.push({
      friendId: friend.userId,
      friendName: friend.displayName,
      roomSlug: friend.roomSlug,
      roomPreset: friend.roomPreset,
      kind: "BECAME_MUTUAL",
      at: friend.mutualAt,
    });
  }

  return buildFeed(source, now);
}
