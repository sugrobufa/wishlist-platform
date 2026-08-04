// Сервис «Комната гостя» (тикет 07): чтение /r/{slug} глазами гостя.
// СЕРВЕРНАЯ фильтрация — инвариант №5 (фильтр на чтении, под тестом):
// - спрятанные вещи (hidden) отсекаются прямо в SQL-запросе и не попадают
//   даже в кэш;
// - выключенные зоны (Room.zonesOff) выбрасываются целиком ПОСЛЕ кэша по
//   свежей строке комнаты на каждом чтении — даже устаревший кэш вещей не
//   покажет гостю выключенную зону;
// - демо-призраки достаются зонам, пустым в глазах гостя: выдача — чистая
//   функция видимых гостю данных, наличие спрятанных вещей картинку не
//   меняет (нет побочного канала «в этой зоне что-то спрятано»).
import { unstable_cache } from "next/cache";
import type { Item } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { demoGhostsFor } from "@/config/demo-pools";
import { ghostForGuest, itemForGuest, type GuestItemDto } from "@/server/dto/guest-items";

// Слаг приходит из URL от кого угодно: мусор режем до похода в БД.
const slugSchema = z.string().min(1).max(64);

export type GuestRoomView = {
  /** Внутренний id комнаты — тег кэша `room-{id}`, канал «занято» тикета 08. В HTML не светится. */
  roomId: string;
  /** id пресета из rooms.json (сам объект пресета страница берёт из конфига). */
  preset: string;
  zonesOff: string[];
  /** displayName ?? name; null — страница подставит подпись по локали. */
  ownerName: string | null;
  /**
   * Вещи по видимым зонам (порядок зон — rooms.json). Зона, пустая в глазах
   * гостя, наполнена демо-призраками пула — комната новичка не мёртвая.
   */
  itemsByZone: Record<string, GuestItemDto[]>;
};

/**
 * Комната для публичного маршрута /r/{slug}: пресет, выключенные зоны, имя
 * хозяйки и вещи по зонам — уже отфильтрованные для гостя. Неизвестный слаг
 * (или битый пресет в БД) — null, страница отвечает 404.
 */
export async function getGuestRoom(slug: string): Promise<GuestRoomView | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  // Строка комнаты читается свежей на каждый запрос (дёшево: unique-индекс) —
  // preset/zonesOff/имя не зависят от кэша вещей. Из владельца — только имя.
  const room = await prisma.room.findUnique({
    where: { shareSlug: parsedSlug.data },
    include: { user: { select: { displayName: true, name: true } } },
  });
  if (!room) return null;

  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  if (!preset) return null; // пресета нет в rooms.json — гостю такой комнаты нет

  const ownItemsByZone = await readGuestItemsCached(room.id);

  // Выключенные зоны исчезают целиком (инвариант №5) — фильтр по свежему
  // zonesOff поверх кэша, тем же visibleZones, что прячет мебель в сцене.
  const itemsByZone: Record<string, GuestItemDto[]> = {};
  for (const zone of visibleZones(preset.zones, room.zonesOff)) {
    const own = ownItemsByZone[zone.key] ?? [];
    itemsByZone[zone.key] =
      own.length > 0 ? own : demoGhostsFor(zone.key, zone.pool).map(ghostForGuest);
  }

  return {
    roomId: room.id,
    preset: room.preset,
    zonesOff: room.zonesOff,
    ownerName: room.user.displayName ?? room.user.name ?? null,
    itemsByZone,
  };
}

/**
 * Вещи комнаты глазами гостя, сгруппированные по зонам, — в Next Data Cache
 * с тегом `room-{roomId}`. Мутации хозяйки ревалидируют этот тег (тикет 04 —
 * вещи, тикет 13 — настройки). В кэше лежат только guest-DTO (чистый JSON):
 * спрятанное отфильтровано ещё в запросе и в кэш не попадает.
 */
function readGuestItemsCached(roomId: string): Promise<Record<string, GuestItemDto[]>> {
  return unstable_cache(() => loadGuestItems(roomId), ["guest-room-items", roomId], {
    tags: [`room-${roomId}`],
  })();
}

async function loadGuestItems(roomId: string): Promise<Record<string, GuestItemDto[]>> {
  const items = await prisma.item.findMany({ where: { roomId, hidden: false } });
  items.sort(compareGuestItems);

  const byZone: Record<string, GuestItemDto[]> = {};
  for (const item of items) {
    (byZone[item.zone] ??= []).push(itemForGuest(item));
  }
  return byZone;
}

/**
 * Порядок вещей — контракт тикета 03, как у хозяйки: «люблю» новыми вперёд;
 * «хочу» по desire ↓ (без desire — в конец), затем новые выше. Дубликат
 * compareZoneItems из services/items.ts: он не экспортирован, а чужие сервисы
 * этот тикет не трогает — кандидат на объединение в полировке (тикет 16).
 */
function compareGuestItems(a: Item, b: Item): number {
  if (a.state !== b.state) return a.state === "LOVE" ? -1 : 1;
  if (a.state === "WANT") {
    const desireA = a.desire ?? -1;
    const desireB = b.desire ?? -1;
    if (desireA !== desireB) return desireB - desireA;
  }
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) return byDate;
  return a.id < b.id ? 1 : -1;
}
