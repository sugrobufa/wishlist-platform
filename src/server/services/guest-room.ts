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
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { demoGhostsFor } from "@/config/demo-pools";
import {
  ghostForGuest,
  itemForGuest,
  type GuestHallContext,
  type GuestItemDto,
} from "@/server/dto/guest-items";
import { itemPhotoUrl } from "@/server/dto/items";
import {
  emptyZoneSummary,
  guestSummaryItem,
  zoneSummaryForGuest,
  type ZoneSummaryDto,
} from "@/server/dto/zone-summary";
import { compareZoneItems } from "@/server/services/items";

// Слаг приходит из URL от кого угодно: мусор режем до похода в БД.
const slugSchema = z.string().min(1).max(64);

// Из владельца гостю — только имя и аватар, ничего больше.
const ownerSelect = {
  user: { select: { displayName: true, name: true, avatarKey: true } },
} satisfies Prisma.RoomInclude;

export type GuestRoomView = {
  /** Внутренний id комнаты — тег кэша `room-{id}`, канал «занято» тикета 08. В HTML не светится. */
  roomId: string;
  /** id пресета из rooms.json (сам объект пресета страница берёт из конфига). */
  preset: string;
  zonesOff: string[];
  /** Короткий код комнаты; работает всегда, даже когда занят ник. */
  shareSlug: string;
  /** Красивый ник (тикет 13) — канонический адрес /r/{nick}, когда занят. */
  nick: string | null;
  /** displayName ?? name; null — страница подставит подпись по локали. */
  ownerName: string | null;
  /** Маленький аватар хозяйки в шапке (раздача /media) — если загружен. */
  ownerAvatarUrl: string | null;
  /**
   * Вещи по видимым зонам (порядок зон — rooms.json). Зона, пустая в глазах
   * гостя, наполнена демо-призраками пула — комната новичка не мёртвая
   * (если хозяйка не выключила примеры: Room.demoGhostsOff).
   */
  itemsByZone: Record<string, GuestItemDto[]>;
  /**
   * Сводка по каждой видимой зоне для указателя зон (тикет 34): счётчики,
   * миниатюры, вилка цен и марки — уже по правилам dto/zone-summary.ts.
   * Демо-призраки в неё не входят: пустая зона в сводке честно пуста.
   */
  summariesByZone: Record<string, ZoneSummaryDto>;
  /**
   * Дата праздника комнаты календарным днём `YYYY-MM-DD`; null — не задана
   * (тикет 38, приветственный блок «Праздник через 12 дней»). Дата и так
   * уезжает гостю в приглашении и в письме-напоминании — тайны в ней нет.
   * Отсчёт «через сколько дней» считает страница (app/r/[slug]/welcome.ts):
   * он зависит от «сегодня», а не от комнаты.
   */
  occasionDate: string | null;
  /**
   * Сколько подарков комнаты ЕЩЁ СВОБОДНЫ — «7 подарков ещё свободны»
   * (турн 12b). Считается по вещам «хочу» БЕЗ брони среди тех, что гость и
   * так видит. Обратного числа — сколько уже забрали — в этой форме нет и
   * быть не может; почему это безопасно, написано у `countFreeGifts`.
   */
  freeGiftCount: number;
};

/**
 * Комната для публичного маршрута /r/{slug}: пресет, выключенные зоны, имя
 * хозяйки и вещи по зонам — уже отфильтрованные для гостя. Неизвестный слаг
 * (или битый пресет в БД) — null, страница отвечает 404.
 *
 * Адрес резолвится как ник ИЛИ короткий код (тикет 13): сначала ник —
 * красивый адрес канонический; затем shareSlug — старые ссылки живут вечно
 * (страница сама делает permanentRedirect на /r/{nick}, если он занят).
 * Ник, совпадающий с чужим кодом, не выдаётся (services/rooms.setRoomNick),
 * поэтому порядок безопасен.
 */
export async function getGuestRoom(slug: string): Promise<GuestRoomView | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  // Строка комнаты читается свежей на каждый ВЫЗОВ сервиса (дёшево:
  // unique-индексы) — preset/zonesOff/demoGhostsOff/имя не зависят от кэша
  // вещей. С полностраничным ISR (полировка 16) вызов случается при каждой
  // регенерации /r/{slug}, а регенерацию мутации хозяйки заказывают сами —
  // revalidateTag(room-{id}); свежесть для гостя от этого не страдает.
  const room =
    (await prisma.room.findUnique({
      where: { nick: parsedSlug.data },
      include: ownerSelect,
    })) ??
    (await prisma.room.findUnique({
      where: { shareSlug: parsedSlug.data },
      include: ownerSelect,
    }));
  if (!room) return null;

  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  if (!preset) return null; // пресета нет в rooms.json — гостю такой комнаты нет

  const cached = await readGuestItemsCached(room.id);

  // Выключенные зоны исчезают целиком (инвариант №5) — фильтр по свежему
  // zonesOff поверх кэша, тем же visibleZones, что прячет мебель в сцене.
  // Демо-призраки — по свежему demoGhostsOff (тикет 13): «Убрать примеры»
  // действует немедленно, кэш вещей тут ни при чём.
  const itemsByZone: Record<string, GuestItemDto[]> = {};
  const summariesByZone: Record<string, ZoneSummaryDto> = {};
  const visible = visibleZones(preset.zones, room.zonesOff);
  for (const zone of visible) {
    const own = cached.itemsByZone[zone.key] ?? [];
    itemsByZone[zone.key] =
      own.length > 0 || room.demoGhostsOff
        ? own
        : demoGhostsFor(zone.key, zone.pool).map(ghostForGuest);
    // Сводка считается по СВОИМ вещам: призраки в неё не входят, поэтому у
    // пустой зоны она пуста — числа по выдуманным вещам читались бы как свои.
    summariesByZone[zone.key] = cached.summariesByZone[zone.key] ?? emptyZoneSummary(zone.key);
  }

  return {
    roomId: room.id,
    preset: room.preset,
    zonesOff: room.zonesOff,
    shareSlug: room.shareSlug,
    nick: room.nick,
    ownerName: room.user.displayName ?? room.user.name ?? null,
    ownerAvatarUrl: itemPhotoUrl(room.user.avatarKey),
    itemsByZone,
    summariesByZone,
    // Календарный день, а не момент: Room.occasionDate пишется полночью UTC
    // (services/rooms.setOccasionDate — единственное место), и обратно читаем
    // тем же поясом, иначе день уедет на сутки на машине восточнее Гринвича.
    occasionDate: room.occasionDate === null ? null : room.occasionDate.toISOString().slice(0, 10),
    freeGiftCount: await countFreeGifts(
      room.id,
      visible.map((zone) => zone.key),
    ),
  };
}

/**
 * «7 подарков ещё свободны» (турн 12b): вещи «хочу», которые гость может взять
 * прямо сейчас, — не спрятанные, в видимой зоне и без брони.
 *
 * ПОЧЕМУ ЭТО НЕ ЛОМАЕТ ТИХУЮ БРОНЬ (инвариант №1) — три отдельные причины,
 * и держится оно на всех трёх сразу:
 *
 * 1. Число про ЖЕЛАНИЯ, а не про брони. Обратного — «сколько уже забрали» —
 *    в `GuestRoomView` нет ни ключом, ни слагаемым: тип возврата `number`
 *    здесь один, и он про свободное. Закреплено тестом.
 * 2. Гостю оно ничего не открывает. Он и так видит каждую вещь комнаты и
 *    тихую пометку «занято» на занятых (канал тикета 08) — пересчитать
 *    свободные он может пальцем. Мы экономим ему счёт, а не рассказываем
 *    новое.
 * 3. Хозяйке, открывшей СВОЮ ЖЕ ссылку (тикет 41), оно не открывает ничего
 *    сверх того, что инвариант №1 ей прямо разрешает: счётчик «N вещей уже
 *    забрали» по КОМНАТЕ она видит у себя на /room (тикет 09). Наше число —
 *    ровно той же крупности: по комнате, без указания вещей и зон.
 *
 * Крупность здесь и есть предохранитель. По ЗОНАМ такого числа нет и не
 * появится: ответ дизайна раунда 6 (тикет 41) прямо разобрал случай — «7
 * свободно» при восьми положенных вещах сказало бы хозяйке, из какой полки
 * забрали. Поэтому свободное считается один раз на комнату и в
 * `dto/zone-summary.ts` не переезжает (там это закрыто своим тестом).
 *
 * Считается ВНЕ кэша вещей (`readGuestItemsCached`) сознательно: тег
 * `room-{id}` ревалидируют только мутации хозяйки, а бронь кэш комнаты не
 * трогает по построению (services/bookings, инвариант №1). Положи мы число
 * внутрь — кэш обещал бы свежесть, которой у него нет. Снаружи оно свежее на
 * каждый вызов сервиса; окно устаревания у гостя остаётся ровно одно и уже
 * описанное — полностраничный ISR самой /r/{slug} (revalidate 300).
 */
async function countFreeGifts(roomId: string, visibleZoneKeys: string[]): Promise<number> {
  if (visibleZoneKeys.length === 0) return 0;
  return prisma.item.count({
    where: {
      roomId,
      state: "WANT",
      // Те же два фильтра, что прячут вещь от гостя (инвариант №5): считаем
      // только то, что он видит своими глазами, — иначе число обещало бы
      // подарки, которых на экране нет.
      hidden: false,
      zone: { in: visibleZoneKeys },
      // Демо-призраки в БД не живут — в счёт не попадают и выдуманных
      // подарков не обещают.
      booking: { is: null },
    },
  });
}

/** Что лежит в кэше комнаты: вещи по зонам и сводка по каждой зоне. */
type GuestRoomCache = {
  itemsByZone: Record<string, GuestItemDto[]>;
  summariesByZone: Record<string, ZoneSummaryDto>;
};

/**
 * Вещи комнаты глазами гостя, сгруппированные по зонам, — в Next Data Cache
 * с тегом `room-{roomId}`. Мутации хозяйки ревалидируют этот тег (тикет 04 —
 * вещи, тикет 13 — настройки); тот же тег через рендер приклеивается к
 * полностраничному кэшу /r/{slug} (ISR — полировка 16). В кэше лежат только
 * guest-DTO и сводки (чистый JSON): спрятанное отфильтровано ещё в запросе и
 * в кэш не попадает. revalidate — страховочное окно для записей, которые до
 * кэша не достают (photoKey из воркера image.ingest — Comments тикета 06).
 *
 * Ключ кэша сменился вместе с формой значения (тикет 34): в старых записях
 * сводок нет, и читать их этой формой нельзя.
 */
function readGuestItemsCached(roomId: string): Promise<GuestRoomCache> {
  return unstable_cache(() => loadGuestItems(roomId), ["guest-room-view", roomId], {
    tags: [`room-${roomId}`],
    revalidate: 300,
  })();
}

async function loadGuestItems(roomId: string): Promise<GuestRoomCache> {
  // Настройка зала славы (тикет 35) читается ВНУТРИ кэша: от неё зависит сам
  // состав guest-DTO — при закрытой настройке цены подарка в кэше нет вовсе,
  // как и у спрятанных вещей. Смена настройки ревалидирует тот же тег
  // room-{id} (services/rooms.setHallSettings), поэтому кэш не отстанет.
  const hallRoom = await prisma.room.findUnique({
    where: { id: roomId },
    select: { hallPriceVisibility: true },
  });
  const hall: GuestHallContext = {
    priceVisibility: hallRoom?.hallPriceVisibility ?? "NONE",
  };

  const items = await prisma.item.findMany({ where: { roomId, hidden: false } });
  // Порядок — контракт тикета 03, ТОТ ЖЕ компаратор, что у хозяйки
  // (дубль compareGuestItems объединён в полировке — тикет 16).
  items.sort(compareZoneItems);

  const itemsByZone: Record<string, GuestItemDto[]> = {};
  // Сводка считается по тем же вещам и в том же порядке, но через свою форму:
  // ей нужен ещё домен магазина (марки), а гостю поштучно он не отдаётся.
  const sourcesByZone: Record<string, ReturnType<typeof guestSummaryItem>[]> = {};
  for (const item of items) {
    (itemsByZone[item.zone] ??= []).push(itemForGuest(item, hall));
    (sourcesByZone[item.zone] ??= []).push(guestSummaryItem(item));
  }

  const summariesByZone: Record<string, ZoneSummaryDto> = {};
  for (const [zoneKey, sources] of Object.entries(sourcesByZone)) {
    summariesByZone[zoneKey] = zoneSummaryForGuest(zoneKey, sources);
  }

  return { itemsByZone, summariesByZone };
}
