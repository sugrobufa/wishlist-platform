// Guest-DTO вещи — сериализация Item для комнаты по ссылке /r/{slug} (тикет 07).
// Сериализация — только allowlist (как в dto/items.ts): объект собирается из
// перечисленных полей, случайные relation'ы (booking!) наружу не протекают.
//
// Guest-DTO — структурное подмножество owner-DTO (контракт тикета 03):
// ZoneGrid принимает его как есть. Отличия от owner-формы:
// - ключей hidden и priceVisibility НЕТ ВООБЩЕ — настройки хозяйки гостю
//   не отдаются ни значением, ни самим фактом существования ключа;
// - у WANT ключи price/currency присутствуют ТОЛЬКО при видимой гостю цене
//   (priceVisibility ALL | FRIENDS); ME/NONE не отдают даже ключа (№8);
// - у LOVE ключей price/currency нет, пока хозяйка не открыла цену подарков
//   настройкой зала славы (тикет 35, ADR-0004): дефолт «только друзьям», и
//   в Phase 1 он читается закрыто. Без контекста зала форма ведёт себя как
//   до тикета 35 — цены нет вовсе, даже если она осталась от «хочу»;
// - полей брони нет и не будет: «занято» приедет отдельным лёгким каналом
//   (тикет 08) мимо кэшируемого guest-DTO (инвариант №1 — тихая бронь).
//
// ГДЕ КУПИТЬ (тикет 37, турны 8b/8e доски). До сих пор ключа `url` в этой
// форме не было вовсе — гость выбирал подарок и упирался в тупик. Теперь у
// «хочу» появился ключ `shop` (домен + канонический адрес), и живёт он РОВНО
// ТАМ ЖЕ, ГДЕ ЦЕНА:
// - страница магазина показывает цену, поэтому скрытая цена, открытая
//   ссылкой, — та же самая утечка (инвариант №8). Ключ `shop` появляется в
//   том же `if`, что price/currency, и других условий у него нет;
// - у LOVE ключа `shop` не существует в принципе — как и price. Ссылка вещи
//   «люблю» откроется гостю той же дверью, что и её цена: настройкой зала
//   (ADR-0004, тикет 35), а не отдельным правилом здесь;
// - наружу уходит только `canonicalUrl` — его посчитал сервер при добавлении
//   по ссылке (parser/normalize: https, хост в нижнем регистре, трекинг-
//   параметры выброшены). Сырой `Item.url` — пользовательский ввод, и гостю
//   он не показывается ни адресом, ни доменом (инвариант №6).
import type { Item } from "@prisma/client";
import { itemPhotoUrl, type PriceVisibilityDto } from "@/server/dto/items";
import { guestSeesHallItemPrice } from "@/server/dto/hall";
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
 */
export type GuestShopDto = {
  /** Канонический адрес страницы товара — куда ведёт «Перейти →». */
  url: string;
  /** Хост без «www.»: человеку важно «ozon.ru», а не путь с параметрами. */
  domain: string;
};

/**
 * «Хочу» для гостя: размер/цвет/желание видны всегда, цена — только при
 * priceVisibility ALL | FRIENDS. Скрытая цена = ключей price/currency нет,
 * и ключа shop тоже: ссылка подчиняется тому же правилу (см. шапку файла).
 */
export type GuestWantItemDto = GuestItemBaseDto & {
  state: "WANT";
  /** Decimal строкой (float для денег запрещён). Ключ есть только при видимой цене. */
  price?: string | null;
  /** ISO 4217. Ключ есть только при видимой цене. */
  currency?: string | null;
  /** Где купить. Ключ есть только при видимой цене И разбираемом canonicalUrl. */
  shop?: GuestShopDto;
  size: string | null;
  color: string | null;
  /** «Насколько хочется», 1–4. */
  desire: number | null;
};

/**
 * «Люблю» для гостя: история подарка. Ключа shop нет никогда — эта вещь не
 * для покупки, она рассказывает о хозяйке (турн 8c: «у люблю магазинов нет»).
 *
 * Цена (тикет 35, ADR-0004): ключей price/currency НЕТ, пока хозяйка не
 * открыла их настройкой зала славы. Дверь открывается только настройкой и
 * только для вещи, у которой цена не скрыта отдельно, — без контекста зала
 * форма ведёт себя как раньше: цены нет вовсе.
 */
export type GuestLoveItemDto = GuestItemBaseDto & {
  state: "LOVE";
  giverName: string | null;
  /** ISO-строка — дата «Дошло» или ручного «уже моё». */
  receivedAt: string | null;
  inHall: boolean;
  /** Decimal строкой. Ключ есть только при открытой настройке зала. */
  price?: string | null;
  /** ISO 4217. Ключ есть только при открытой настройке зала. */
  currency?: string | null;
};

/**
 * Что гостю известно о зале славы этой комнаты (тикет 35). Отсутствие
 * контекста = закрыто: вызвать `itemForGuest(item)` без него безопасно.
 */
export type GuestHallContext = {
  /** Room.hallPriceVisibility — четыре положения, дефолт FRIENDS. */
  priceVisibility: PriceVisibilityDto;
};

export type GuestItemDto = GuestWantItemDto | GuestLoveItemDto;

/**
 * Видна ли гостю цена «хочу». FRIENDS в Phase 1 читается как ALL:
 * TODO(Phase 2, градация связей): когда Connection научится отличать «своих»
 * (взаимно/слежу/смотрели, тикет 11+), FRIENDS должен сверяться со связью
 * гостя и хозяйки, а не сводиться к ALL.
 */
export function guestSeesPrice(visibility: PriceVisibilityDto): boolean {
  return visibility === "ALL" || visibility === "FRIENDS";
}

/**
 * Ссылка на магазин из канонического адреса вещи. На вход — только
 * `Item.canonicalUrl`: его посчитал сервер (services/items → normalizeUrl),
 * а `Item.url` вводит человек, и наружу он не идёт (инвариант №6). Домен
 * берётся из разобранного адреса, а не из колонки `Item.domain`: колонка
 * могла отстать от адреса, а показываем мы именно то, куда уводим.
 *
 * Всё, что не разбирается в http(s)-адрес, ссылки не даёт вовсе: у вещи,
 * добавленной руками, магазина просто нет, и это честнее пустой кнопки.
 */
export function guestShop(canonicalUrl: string | null): GuestShopDto | null {
  if (canonicalUrl === null || canonicalUrl === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(canonicalUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const domain = parsed.hostname.replace(/^www\./, "");
  if (domain === "") return null;
  return { url: parsed.toString(), domain };
}

/**
 * Сериализация вещи из БД для гостя. Фильтр спрятанных вещей и выключенных
 * зон живёт в сервисе (guest-room.ts) — сюда спрятанное приходить не должно,
 * но и придя, флага hidden наружу не унесёт: ключа в форме нет.
 *
 * `hall` — настройка зала славы комнаты (тикет 35). Не передали — цена
 * «люблю» наружу не идёт, как и до тикета 35.
 */
export function itemForGuest(item: Item, hall?: GuestHallContext): GuestItemDto {
  const base: GuestItemBaseDto = {
    id: item.id,
    zone: item.zone,
    title: item.title,
    note: item.note,
    photoUrl: itemPhotoUrl(item.photoKey),
    isDemo: false,
  };

  if (item.state === "WANT") {
    const want: GuestWantItemDto = {
      ...base,
      state: "WANT",
      size: item.size,
      color: item.color,
      desire: item.desire,
    };
    if (guestSeesPrice(item.priceVisibility)) {
      want.price = item.price === null ? null : item.price.toString();
      want.currency = item.currency;
      // Тот же `if`, что у цены, — и никакого второго условия: страница
      // магазина показывает цену, значит ссылка при скрытой цене обошла бы
      // настройку хозяйки (инвариант №8).
      const shop = guestShop(item.canonicalUrl);
      if (shop) want.shop = shop;
    }
    return want;
  }

  const love: GuestLoveItemDto = {
    ...base,
    state: "LOVE",
    giverName: item.giverName,
    receivedAt: item.receivedAt === null ? null : item.receivedAt.toISOString(),
    inHall: item.inHall,
  };
  // Цена подарка — только по настройке зала славы и только у вещи, которой
  // цену не скрыли отдельно (ADR-0004). Ключей нет вовсе, когда нельзя.
  if (hall !== undefined && guestSeesHallItemPrice(hall.priceVisibility, item.priceVisibility)) {
    love.price = item.price === null ? null : item.price.toString();
    love.currency = item.currency;
  }
  return love;
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

  if (ghost.state === "WANT") {
    const want: GuestWantItemDto = {
      ...base,
      state: "WANT",
      size: ghost.size,
      color: ghost.color,
      desire: ghost.desire,
    };
    if (guestSeesPrice(ghost.priceVisibility)) {
      want.price = ghost.price;
      want.currency = ghost.currency;
    }
    return want;
  }

  return {
    ...base,
    state: "LOVE",
    giverName: ghost.giverName,
    receivedAt: ghost.receivedAt,
    inHall: ghost.inHall,
  };
}
