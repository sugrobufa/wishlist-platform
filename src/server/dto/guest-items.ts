// Guest-DTO вещи — сериализация Item для комнаты по ссылке /r/{slug} (тикет 07).
// Сериализация — только allowlist (как в dto/items.ts): объект собирается из
// перечисленных полей, случайные relation'ы (booking!) наружу не протекают.
//
// Guest-DTO — структурное подмножество owner-DTO (контракт тикета 03):
// ZoneGrid принимает его как есть. Отличия от owner-формы:
// - ключей hidden и priceVisibility НЕТ ВООБЩЕ — настройки хозяйки гостю
//   не отдаются ни значением, ни самим фактом существования ключа;
// - у вещи КОМНАТЫ ключи price/currency присутствуют ТОЛЬКО при видимой гостю
//   цене (priceVisibility ALL | FRIENDS); ME/NONE не отдают даже ключа (№8);
// - у вещи СОКРОВИЩНИЦЫ ключей price/currency нет никогда: цена там не
//   показывается вовсе (тикет 124, модель v2). Настройки, которая могла бы
//   их открыть, больше не существует;
// - полей брони нет и не будет: «занято» приедет отдельным лёгким каналом
//   (тикет 08) мимо кэшируемого guest-DTO (инвариант №1 — тихая бронь).
//
// ФОРМЫ РАЗЛИЧАЕТ МЕСТО (`inHall`), а не состояние: состояний у вещи больше
// нет (тикет 124). В гостевую КОМНАТУ витринная вещь не приезжает вовсе —
// её отсекает сервис (guest-room.ts). Вторая форма здесь не «на всякий
// случай»: сводка зоны и запись перехода в магазин зовут `itemForGuest`
// напрямую, и форма обязана вести себя правильно на любой строке БД.
//
// ГДЕ КУПИТЬ (тикет 37, турны 8b/8e доски). До сих пор ключа `url` в этой
// форме не было вовсе — гость выбирал подарок и упирался в тупик. Теперь у
// вещи комнаты есть ключ `shop` (домен + канонический адрес), и живёт он
// РОВНО ТАМ ЖЕ, ГДЕ ЦЕНА:
// - страница магазина показывает цену, поэтому скрытая цена, открытая
//   ссылкой, — та же самая утечка (инвариант №8). Ключ `shop` появляется в
//   том же `if`, что price/currency, и других условий у него нет;
// - у вещи сокровищницы ключа `shop` не существует в принципе — как и цены:
//   она не для покупки, она рассказывает о хозяйке;
// - наружу уходит только `canonicalUrl` — его посчитал сервер при добавлении
//   по ссылке (parser/normalize: https, хост в нижнем регистре, трекинг-
//   параметры выброшены). Сырой `Item.url` — пользовательский ввод, и гостю
//   он не показывается ни адресом, ни доменом (инвариант №6).
import type { Item } from "@prisma/client";
import { itemPhotoUrl, shopOf, type PriceVisibilityDto, type ShopDto } from "@/server/dto/items";
import { isExpired } from "@/server/dto/experience";
import type { DemoGhostDto } from "@/config/demo-pools";

/** Общие поля обеих форм вещи глазами гостя. */
type GuestItemBaseDto = {
  id: string;
  /** Ключ зоны из zones.json. */
  zone: string;
  title: string;
  note: string | null;
  photoUrl: string | null;
  /** Демо-призрак: бейдж «пример», не бронируется (тикет 08 обязан проверять). */
  isDemo: boolean;
};

/**
 * Магазин вещи глазами гостя — «дарящему не надо искать самому» (турн 8b).
 * Полный блок доски — это несколько магазинов с ценами и наличием; у вещи
 * ссылка одна, поэтому честно отдаём одну (мультимагазинность — каталог за
 * флагом CATALOG_ENABLED, отдельный разговор).
 *
 * ТИП И РАЗБОР ПЕРЕЕХАЛИ В `dto/items.ts` (тикет 159): «где купить» появилось
 * и в карточке хозяйки, а два разбора одного адреса — это два ответа на
 * вопрос «куда ведёт эта вещь». Имена здесь оставлены прежними: гостевая
 * половина продукта зовёт их так с тикета 37, и переименование ничего бы не
 * прояснило. РАЗНИЦА НЕ В РАЗБОРЕ, А В ПРАВИЛЕ ПОКАЗА — и она ниже, в самой
 * форме: гостю ключа `shop` при скрытой цене не достаётся вовсе, хозяйке
 * ссылка видна всегда.
 */
export type GuestShopDto = ShopDto;
export const guestShop = shopOf;

/**
 * Вещь КОМНАТЫ для гостя: размер/цвет/желание видны всегда, цена — только при
 * priceVisibility ALL | FRIENDS. Скрытая цена = ключей price/currency нет,
 * и ключа shop тоже: ссылка подчиняется тому же правилу (см. шапку файла).
 * Бронируется здесь ВСЁ (тикет 124): комната и есть список желаний.
 */
export type GuestRoomItemDto = GuestItemBaseDto & {
  inHall: false;
  /** Decimal строкой (float для денег запрещён). Ключ есть только при видимой цене. */
  price?: string | null;
  /** ISO 4217. Ключ есть только при видимой цене. */
  currency?: string | null;
  /** Где купить. Ключ есть только при видимой цене И разбираемом canonicalUrl. */
  shop?: GuestShopDto;
  size: string | null;
  /** Услуга-впечатление (тикет 97): «Когда · Где · Годен до». */
  eventWhen: string | null;
  eventWhere: string | null;
  /** Календарный день `YYYY-MM-DD` или null. */
  validUntil: string | null;
  /**
   * Срок вышел (наутро после `validUntil`). Гостю вещь остаётся ВИДНОЙ —
   * впечатление никуда не делось, — но уходит из «можно подарить»: бирки нет,
   * карточка приглушена. Прятать её было бы враньём: хозяйка её не убирала.
   */
  expired: boolean;
  color: string | null;
  /** «Насколько хочется», 1–4 — единственная градация вещи (тикет 125). */
  desire: number | null;
};

/**
 * Вещь СОКРОВИЩНИЦЫ для гостя: история, а не покупка. Ключей shop, price и
 * currency нет никогда — эта вещь не для покупки, она рассказывает о хозяйке
 * (турн 8c), а цену на витрине гость не видит вовсе (тикет 124).
 *
 * ИМЕНИ ДАРИТЕЛЯ ЗДЕСЬ ТОЖЕ НЕТ (то же правило, что в dto/hall.ts,
 * HallGuestItemDto): даритель открывается ровно один раз и ровно одной
 * хозяйке — экран «что подарили» (инвариант №2). Год остаётся: он про вещь,
 * а не про человека.
 */
export type GuestHallItemDto = GuestItemBaseDto & {
  /**
   * Место вещи, и только оно. До тикета 124 здесь стоял ответ «видна ли вещь
   * в сокровищнице» (`hallItemShownToObservers`) — им гостевая страница
   * решала, рисовать ли вход на витрину. Теперь на этот вопрос отвечает
   * `GuestRoomView.hasHall`, посчитанный сервисом по своим правилам, а в
   * комнату гостя витринная вещь не приезжает вовсе.
   */
  inHall: true;
  /** ISO-строка — дата подарка или ручного переезда на витрину. */
  receivedAt: string | null;
};

export type GuestItemDto = GuestRoomItemDto | GuestHallItemDto;

/**
 * Видна ли гостю цена вещи КОМНАТЫ. FRIENDS в Phase 1 читается как ALL:
 * TODO(Phase 2, градация связей): когда Connection научится отличать «своих»
 * (взаимно/слежу/смотрели, тикет 11+), FRIENDS должен сверяться со связью
 * гостя и хозяйки, а не сводиться к ALL.
 */
export function guestSeesPrice(visibility: PriceVisibilityDto): boolean {
  return visibility === "ALL" || visibility === "FRIENDS";
}

/**
 * Сериализация вещи из БД для гостя. Фильтр спрятанных вещей и выключенных
 * зон живёт в сервисе (guest-room.ts) — сюда спрятанное приходить не должно,
 * но и придя, флага hidden наружу не унесёт: ключа в форме нет.
 */
export function itemForGuest(item: Item): GuestItemDto {
  const base: GuestItemBaseDto = {
    id: item.id,
    zone: item.zone,
    title: item.title,
    note: item.note,
    photoUrl: itemPhotoUrl(item.photoKey),
    isDemo: false,
  };

  if (item.inHall) {
    return {
      ...base,
      inHall: true,
      receivedAt: item.receivedAt === null ? null : item.receivedAt.toISOString(),
    };
  }

  const room: GuestRoomItemDto = {
    ...base,
    inHall: false,
    size: item.size,
    color: item.color,
    desire: item.desire,
    eventWhen: item.eventWhen,
    eventWhere: item.eventWhere,
    validUntil: item.validUntil === null ? null : item.validUntil.toISOString().slice(0, 10),
    // «Наутро после срока» считается ОТ ТЕКУЩЕГО дня, а не от кэша: DTO
    // складывается при сборке кэша комнаты, и вещь протухнет в нём на сутки.
    // Окно устаревания — то же, что у всей гостевой комнаты (ISR 300 +
    // ревалидация тегом), и это честнее, чем считать срок на клиенте.
    expired: isExpired(item.validUntil, new Date()),
  };
  if (guestSeesPrice(item.priceVisibility)) {
    room.price = item.price === null ? null : item.price.toString();
    room.currency = item.currency;
    // Тот же `if`, что у цены, — и никакого второго условия: страница
    // магазина показывает цену, значит ссылка при скрытой цене обошла бы
    // настройку хозяйки (инвариант №8).
    const shop = guestShop(item.canonicalUrl);
    if (shop) room.shop = shop;
  }
  return room;
}

/**
 * Демо-призрак (owner-форма из src/config/demo-pools) → guest-форма.
 * Призраки проходят тот же шлюз цены и теряют те же ключи (hidden,
 * priceVisibility), что и настоящие вещи, — у гостя ровно один словарь форм.
 * Ключа shop у призрака нет и быть не может: он выдуман, у него нет адреса —
 * значит и «Перейти →» на его плитке не появится (и переход не запишется).
 */
export function ghostForGuest(ghost: DemoGhostDto): GuestItemDto {
  const base: GuestItemBaseDto = {
    id: ghost.id,
    zone: ghost.zone,
    title: ghost.title,
    note: ghost.note,
    photoUrl: ghost.photoUrl,
    isDemo: true,
  };

  if (ghost.inHall) {
    return { ...base, inHall: true, receivedAt: ghost.receivedAt };
  }

  const room: GuestRoomItemDto = {
    ...base,
    inHall: false,
    size: ghost.size,
    eventWhen: null,
    eventWhere: null,
    validUntil: null,
    expired: false,
    color: ghost.color,
    desire: ghost.desire,
  };
  if (guestSeesPrice(ghost.priceVisibility)) {
    room.price = ghost.price;
    room.currency = ghost.currency;
  }
  return room;
}
