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
// - у LOVE ключей price/currency не существует в принципе — даже если в БД
//   цена осталась от прежнего «хочу» (инвариант №8);
// - полей брони нет и не будет: «занято» приедет отдельным лёгким каналом
//   (тикет 08) мимо кэшируемого guest-DTO (инвариант №1 — тихая бронь).
import type { Item } from "@prisma/client";
import { itemPhotoUrl, type PriceVisibilityDto } from "@/server/dto/items";
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
 * «Хочу» для гостя: размер/цвет/желание видны всегда, цена — только при
 * priceVisibility ALL | FRIENDS. Скрытая цена = ключей price/currency нет.
 */
export type GuestWantItemDto = GuestItemBaseDto & {
  state: "WANT";
  /** Decimal строкой (float для денег запрещён). Ключ есть только при видимой цене. */
  price?: string | null;
  /** ISO 4217. Ключ есть только при видимой цене. */
  currency?: string | null;
  size: string | null;
  color: string | null;
  /** «Насколько хочется», 1–4. */
  desire: number | null;
};

/** «Люблю» для гостя: история подарка без цены — ключей price/currency нет. */
export type GuestLoveItemDto = GuestItemBaseDto & {
  state: "LOVE";
  giverName: string | null;
  /** ISO-строка — дата «Дошло» или ручного «уже моё». */
  receivedAt: string | null;
  inHall: boolean;
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
    }
    return want;
  }

  return {
    ...base,
    state: "LOVE",
    giverName: item.giverName,
    receivedAt: item.receivedAt === null ? null : item.receivedAt.toISOString(),
    inHall: item.inHall,
  };
}

/**
 * Демо-призрак (owner-форма из src/config/demo-pools) → guest-форма.
 * Призраки проходят тот же шлюз цены и теряют те же ключи (hidden,
 * priceVisibility), что и настоящие вещи, — у гостя ровно один словарь форм.
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
