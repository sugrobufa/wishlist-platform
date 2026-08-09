// Сервис «Комната гостя» (тикет 07): чтение /r/{slug} глазами гостя.
// СЕРВЕРНАЯ фильтрация — инвариант №5 (фильтр на чтении, под тестом):
// - спрятанные вещи (hidden) отсекаются прямо в SQL-запросе и не попадают
//   даже в кэш;
// - выключенные зоны (Room.zonesOff) выбрасываются целиком ПОСЛЕ кэша по
//   свежей строке комнаты на каждом чтении — даже устаревший кэш вещей не
//   покажет гостю выключенную зону;
// - демо-призраков больше нет (тикет 104): пустая зона стоит пустой, пустоту
//   держит темнота. Выдача остаётся чистой функцией видимых гостю данных —
//   побочного канала «в этой зоне что-то спрятано» не появилось.
import { unstable_cache } from "next/cache";
import type { HallVisibility, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { MONEY_ZONE_KEY, rooms as roomPresets } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import {
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
   * Вещи по видимым зонам (порядок зон — rooms.json). Пустая зона так и
   * приезжает пустой (тикет 104).
   */
  itemsByZone: Record<string, GuestItemDto[]>;
  /**
   * Сводка по каждой видимой зоне для указателя зон (тикет 34): счётчики,
   * миниатюры, вилка цен и марки — уже по правилам dto/zone-summary.ts.
   * У пустой зоны сводка пуста.
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
  /**
   * Свет комнаты, который выбрала ХОЗЯЙКА (тикет 96). Своей ручки у гостя нет
   * и не будет: он смотрит её комнату, а не настраивает свою.
   */
  timeOfDay: string;
  lightColor: string;
  /**
   * «Кто видит сокровищницу» (тикет 116, ADR-0011) — по этому положению
   * страница решает, как рисовать вход на витрину: `ALL` — сразу на сервере,
   * `NONE` — не рисовать вовсе, `MUTUAL` — маленьким клиентским компонентом,
   * который спросит ответ у некэшируемого канала «занято».
   *
   * КЭШУ НЕ МЕШАЕТ: это свойство КОМНАТЫ, одинаковое для всех зрителей, а не
   * ответ про конкретного гостя — /r/{slug} остаётся полностраничным ISR и
   * сессии по-прежнему не читает (её шапка). Смена настройки ревалидирует
   * тег room-{id} вместе с остальными настройками зала.
   */
  hallVisibility: HallVisibility;
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
  const room = await findRoomBySlug(slug);
  if (!room) return null;

  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  if (!preset) return null; // пресета нет в rooms.json — гостю такой комнаты нет

  const cached = await readGuestItemsCached(room.id);

  // Выключенные зоны исчезают целиком (инвариант №5) — фильтр по свежему
  // zonesOff поверх кэша, тем же visibleZones, что прячет мебель в сцене.
  const itemsByZone: Record<string, GuestItemDto[]> = {};
  const summariesByZone: Record<string, ZoneSummaryDto> = {};
  const visible = visibleZones(preset.zones, room.zonesOff);
  for (const zone of visible) {
    const own = cached.itemsByZone[zone.key] ?? [];
    // Зона «Просто деньги» без своих вещей ключа не получает вовсе (тикет 44):
    // пула демо-вещей у неё нет и не будет — призрак «пример: 3 000 ₽» обещал
    // бы перевод, которого в продукте не существует (PRD §12а). Её пустоту
    // заполняет карточка копилки на мечту, и пустая сетка вкладок «Люблю ·
    // 0 / Хочу · 0» под этой карточкой была бы просто шумом. Свои вещи в этой
    // зоне никто не запрещает — появятся, и сетка вернётся сама.
    if (zone.key === MONEY_ZONE_KEY && own.length === 0) {
      summariesByZone[zone.key] = cached.summariesByZone[zone.key] ?? emptyZoneSummary(zone.key);
      continue;
    }
    // Демо-призраков больше нет (тикет 104): пустая зона стоит пустой, и
    // пустоту держит темнота, а не чужие вещи с пометкой «пример».
    itemsByZone[zone.key] = own;
    // Сводка считается по СВОИМ вещам — у пустой зоны она пуста.
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
    timeOfDay: room.timeOfDay,
    lightColor: room.lightColor,
    hallVisibility: room.hallVisibility,
  };
}

/**
 * Комната по адресу из ссылки — общий вход обоих гостевых чтений (комната и
 * витрина, тикет 93). Строка читается свежей на каждый ВЫЗОВ сервиса (дёшево:
 * unique-индексы) — preset/zonesOff/имя не зависят от кэша
 * вещей. С полностраничным ISR (полировка 16) вызов случается при каждой
 * регенерации /r/{slug}, а регенерацию мутации хозяйки заказывают сами —
 * revalidateTag(room-{id}); свежесть для гостя от этого не страдает.
 *
 * Порядок «сначала ник, потом код» значим и безопасен: ник, совпадающий с
 * чужим кодом, не выдаётся (services/rooms.setRoomNick).
 */
export async function findRoomBySlug(slug: string) {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  return (
    (await prisma.room.findUnique({
      where: { nick: parsedSlug.data },
      include: ownerSelect,
    })) ??
    (await prisma.room.findUnique({
      where: { shareSlug: parsedSlug.data },
      include: ownerSelect,
    }))
  );
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
  const byRoom = await countFreeGiftsByRoom([{ roomId, zoneKeys: visibleZoneKeys }]);
  return byRoom.get(roomId) ?? 0;
}

/**
 * То же «свободно», но сразу по нескольким комнатам и ОДНИМ запросом — лента
 * друзей (тикет 95) показывает это число у каждой карточки.
 *
 * Определение «свободного» живёт здесь и только здесь: разъедься оно на два
 * места, и первая же забытая проверка сделала бы из числа обещание подарков,
 * которых на экране нет. Комната без видимых зон в запрос не попадает вовсе.
 */
export async function countFreeGiftsByRoom(
  rooms: ReadonlyArray<{ roomId: string; zoneKeys: readonly string[] }>,
): Promise<Map<string, number>> {
  const asked = rooms.filter((room) => room.zoneKeys.length > 0);
  const counts = new Map<string, number>(rooms.map((room) => [room.roomId, 0]));
  if (asked.length === 0) return counts;

  const free = await prisma.item.groupBy({
    by: ["roomId"],
    where: {
      // Те же два фильтра, что прячут вещь от гостя (инвариант №5): считаем
      // только то, что он видит своими глазами. Зоны — по каждой комнате свои,
      // поэтому пары «комната + её видимые зоны» идут через OR.
      state: "WANT",
      hidden: false,
      // Демо-призраки в БД не живут — в счёт не попадают и выдуманных
      // подарков не обещают.
      booking: { is: null },
      // Просроченное впечатление (тикет 97) уходит из «можно подарить»:
      // обещать подарок, который уже нельзя вручить, — то же враньё, что
      // считать занятую вещь свободной. `validUntil` = null у всего
      // остального, поэтому условие не задевает предметы.
      AND: [
        { OR: [{ validUntil: null }, { validUntil: { gte: startOfTodayUtc() } }] },
        { OR: asked.map((room) => ({ roomId: room.roomId, zone: { in: [...room.zoneKeys] } })) },
      ],
    },
    _count: { _all: true },
  });

  for (const row of free) counts.set(row.roomId, row._count._all);
  return counts;
}

/**
 * Полночь СЕГОДНЯШНЕГО дня в UTC. Срок «годен до 14 марта» держится весь день
 * 14-го и выходит наутро 15-го (dto/experience.isExpired) — в SQL это
 * `validUntil >= сегодня`.
 */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
