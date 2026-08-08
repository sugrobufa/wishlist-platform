// Сервис «Сокровищница гостя» (тикет 93): чтение /r/{slug}/hall.
//
// Раздел заведён ради фразы доски «объясняет гостю вкус хозяйки лучше любого
// списка» (А5), а маршрута у гостя не было вовсе: настройки показа —
// четыре положения цены, «Кто подарил», «Округлять цены», сумма в шапке —
// существовали только для страницы хозяйки.
//
// СЕРВЕРНАЯ фильтрация, три условия и все на чтении:
// - `hidden` — спрятанная вещь гостю не отдаётся (инвариант №5);
// - видимая зона — выключенная зона уносит вещь вместе с мебелью (там же);
// - `hallItemShownToObservers` — вещь, спрятанная глазком (тикет 89).
// Демо-призраков здесь нет по построению: выборка идёт по БД.
import { unstable_cache } from "next/cache";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { itemPhotoUrl } from "@/server/dto/items";
import {
  hallGuestPriced,
  hallItemForGuest,
  hallSettingsOf,
  hallTotals,
  type HallGuestItemDto,
  type HallTotalDto,
} from "@/server/dto/hall";
import { findRoomBySlug } from "@/server/services/guest-room";

export type GuestHallView = {
  /** id пресета — акцент и подпись берёт страница из конфига. */
  preset: string;
  shareSlug: string;
  nick: string | null;
  /** displayName ?? name; null — страница подставит подпись по локали. */
  ownerName: string | null;
  items: HallGuestItemDto[];
  /**
   * Сумма витрины по валютам — пусто, когда хозяйка выключила тумблер или
   * когда гость не видит ни одной цены. Считается по ТОЧНЫМ значениям тех
   * вещей, цену которых он видит: сумма по закрытым ценам выдала бы их.
   */
  totals: HallTotalDto[];
};

/**
 * Витрина комнаты глазами гостя. Неизвестный слаг или битый пресет — null,
 * страница отвечает 404. Пустая витрина — это НЕ null: комната есть, витрина
 * пуста, и сказать об этом честнее, чем отдать «страница не найдена».
 */
export async function getGuestHall(slug: string): Promise<GuestHallView | null> {
  const room = await findRoomBySlug(slug);
  if (!room) return null;

  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  if (!preset) return null;

  // Видимые зоны считаются по СВЕЖЕЙ строке комнаты, а не по кэшу вещей:
  // выключенная только что зона обязана унести свои вещи немедленно, как и
  // в комнате (инвариант №5).
  const zoneKeys = visibleZones(preset.zones, room.zonesOff).map((zone) => zone.key);
  const cached = await readGuestHallCached(room.id, zoneKeys);

  return {
    preset: room.preset,
    shareSlug: room.shareSlug,
    nick: room.nick,
    ownerName: room.user.displayName ?? room.user.name ?? null,
    items: cached.items,
    totals: cached.totals,
  };
}

/** Что лежит в кэше витрины: готовые формы гостя и сумма. */
type GuestHallCache = { items: HallGuestItemDto[]; totals: HallTotalDto[] };

/**
 * Витрина в Next Data Cache с тем же тегом `room-{roomId}`, что и комната:
 * мутации хозяйки (положить на витрину, спрятать глазком, удалить, сменить
 * настройки зала) ревалидируют его и так.
 *
 * В КЭШЕ ЛЕЖАТ ТОЛЬКО ГОТОВЫЕ DTO — чистый JSON, как и в guest-room. Строки
 * БД сюда класть нельзя: кэш их сериализует, `receivedAt` возвращается
 * СТРОКОЙ, и `getUTCFullYear` падает на первом же попадании в кэш. Юнит-тест
 * этого не ловит (там `unstable_cache` сквозной) — поймал живой стенд.
 *
 * Ключ включает состав видимых зон: выключение зоны меняет выдачу, а промах
 * лучше зависимости от порядка ревалидации.
 */
function readGuestHallCached(roomId: string, zoneKeys: string[]): Promise<GuestHallCache> {
  const key = [...zoneKeys].sort().join(",");
  return unstable_cache(() => loadGuestHall(roomId, zoneKeys), ["guest-hall", roomId, key], {
    tags: [`room-${roomId}`],
    revalidate: 300,
  })();
}

async function loadGuestHall(roomId: string, zoneKeys: string[]): Promise<GuestHallCache> {
  if (zoneKeys.length === 0) return { items: [], totals: [] };

  // Настройки зала читаются ВНУТРИ кэша: от них зависит сам состав форм —
  // при закрытой настройке цены в кэше нет вовсе. Смена настроек
  // ревалидирует тот же тег room-{id} (services/rooms.setHallSettings),
  // поэтому кэш не отстанет. Тот же приём, что в guest-room.
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return { items: [], totals: [] };
  const settings = hallSettingsOf(room);

  const items = await prisma.item.findMany({
    where: {
      roomId,
      state: "LOVE",
      inHall: true,
      // Три фильтра гостя разом; порядок в SQL значения не имеет, значение
      // имеет то, что ни один из них не живёт в разметке.
      hiddenFromHall: false,
      hidden: false,
      zone: { in: zoneKeys },
    },
  });

  // Порядок витрины — тот же, что у хозяйки: свежеподаренные выше, без даты
  // в конец, дальше по времени заведения. Дубля сортировки не избежать:
  // listHallItems отдаёт строки БД целиком и знать про гостя не должна.
  items.sort((a, b) => {
    const at = a.receivedAt?.getTime() ?? -1;
    const bt = b.receivedAt?.getTime() ?? -1;
    if (at !== bt) return bt - at;
    const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    return a.id < b.id ? 1 : -1;
  });

  return {
    items: items.map((item) => hallItemForGuest(item, settings, itemPhotoUrl(item.photoKey))),
    totals: settings.totalShown
      ? hallTotals(hallGuestPriced(items, settings), { round: settings.roundPrices })
      : [],
  };
}
