// DTO вещи — ЕДИНСТВЕННОЕ место сериализации Item (CLAUDE.md «Конвенции»).
// Сериализация — только allowlist: объект собирается из перечисленных полей,
// поэтому случайно подцепленные relation'ы (booking!) наружу не протекают.
//
// Критичный инвариант №1 (тихая бронь): owner-DTO НИКОГДА не содержит
// booking-полей — ни имени, ни факта брони. Покрыто строгим снапшотом ключей
// в tests/items.dto.test.ts.
import type { Item } from "@prisma/client";
import { roomImageUrl } from "@/app/rooms/room-image";

export type PriceVisibilityDto = "ALL" | "FRIENDS" | "ME" | "NONE";

/** Общие поля обеих форм вещи. */
type OwnerItemBaseDto = {
  id: string;
  /** Ключ зоны из zones.json. */
  zone: string;
  title: string;
  note: string | null;
  photoUrl: string | null;
  /** Спрятана хозяйкой — видит только она (гостю не отдаётся, тикет 07). */
  hidden: boolean;
  /** false у настоящих вещей; true — только у демо-призраков (src/config/demo-pools). */
  isDemo: boolean;
  /**
   * Когда вещь появилась в комнате, ISO-строкой — строка «В комнате с {год}»
   * в карточке вещи хозяйки (турн 8c, тикет 39). У «люблю» с известной датой
   * подарка карточка предпочитает receivedAt, здесь — запасной путь для
   * вещей «уже моё» и всех «хочу». Гостю это поле не отдаётся.
   */
  createdAt: string;
};

/**
 * «Хочу»: цена обязательна по продукту (показ — по priceVisibility,
 * хозяйке всегда), плюс размер/цвет/степень желания (items.json extraFields).
 */
export type OwnerWantItemDto = OwnerItemBaseDto & {
  state: "WANT";
  /** Decimal сериализуем строкой — float для денег запрещён (CLAUDE.md). */
  price: string | null;
  /** ISO 4217. */
  currency: string | null;
  /** ME/NONE прячут цену у гостя; для хозяйки цена видна всегда (тикет 07). */
  priceVisibility: PriceVisibilityDto;
  size: string | null;
  color: string | null;
  /** «Насколько хочется», 1–4. */
  desire: number | null;
};

/**
 * «Люблю»: цены НЕТ ВООБЩЕ — ключи price/currency у этой формы отсутствуют,
 * даже если в БД значение осталось от прежнего «хочу» (инвариант §8, тест).
 */
export type OwnerLoveItemDto = OwnerItemBaseDto & {
  state: "LOVE";
  giverName: string | null;
  /** ISO-строка — дата «Дошло» или ручного «уже моё». */
  receivedAt: string | null;
  inHall: boolean;
};

export type OwnerItemDto = OwnerWantItemDto | OwnerLoveItemDto;

/**
 * photoKey → URL. Поддержаны: путь дизайн-пакета ("refs/p-vinyl.jpg" — демо),
 * готовый URL (абсолютный или корневой), голый S3-ключ ("items/{roomId}/….jpg")
 * → маршрут раздачи `/media/{key}` (стрим из MinIO/S3, тикет 04).
 */
export function itemPhotoUrl(photoKey: string | null): string | null {
  if (!photoKey) return null;
  if (photoKey.startsWith("refs/")) return roomImageUrl(photoKey);
  if (/^https?:\/\//.test(photoKey) || photoKey.startsWith("/")) return photoKey;
  return `/media/${photoKey.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Сериализация вещи для хозяйки. Форма зависит от состояния (items.json:
 * два состояния — два словаря полей), ключи за пределами формы не попадают
 * в объект вовсе.
 */
export function itemForOwner(item: Item): OwnerItemDto {
  const base: OwnerItemBaseDto = {
    id: item.id,
    zone: item.zone,
    title: item.title,
    note: item.note,
    photoUrl: itemPhotoUrl(item.photoKey),
    hidden: item.hidden,
    isDemo: false,
    createdAt: item.createdAt.toISOString(),
  };

  if (item.state === "WANT") {
    return {
      ...base,
      state: "WANT",
      price: item.price === null ? null : item.price.toString(),
      currency: item.currency,
      priceVisibility: item.priceVisibility,
      size: item.size,
      color: item.color,
      desire: item.desire,
    };
  }

  return {
    ...base,
    state: "LOVE",
    giverName: item.giverName,
    receivedAt: item.receivedAt === null ? null : item.receivedAt.toISOString(),
    inHall: item.inHall,
  };
}
