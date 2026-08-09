// DTO вещи — ЕДИНСТВЕННОЕ место сериализации Item (CLAUDE.md «Конвенции»).
// Сериализация — только allowlist: объект собирается из перечисленных полей,
// поэтому случайно подцепленные relation'ы (booking!) наружу не протекают.
//
// Критичный инвариант №1 (тихая бронь): owner-DTO НИКОГДА не содержит
// booking-полей — ни имени, ни факта брони. Покрыто строгим снапшотом ключей
// в tests/items.dto.test.ts.
//
// ФОРМ ДВЕ, И РАЗЛИЧАЕТ ИХ МЕСТО, А НЕ СОСТОЯНИЕ (items.json v2, тикет 124):
// вещь комнаты (`inHall: false`) и вещь сокровищницы (`inHall: true`).
import type { Item } from "@prisma/client";
import { roomImageUrl } from "@/app/rooms/room-image";

export type PriceVisibilityDto = "ALL" | "FRIENDS" | "ME" | "NONE";

/** Общие поля обеих форм вещи. */
type OwnerItemBaseDto = {
  id: string;
  /** Ключ зоны из zones.json. Есть и у витринной вещи — «Вернуть в комнату»
   * возвращает именно на эту полку. */
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
   * в карточке вещи хозяйки (турн 8c, тикет 39). У вещи сокровищницы с
   * известной датой подарка карточка предпочитает receivedAt, здесь —
   * запасной путь. Гостю это поле не отдаётся.
   */
  createdAt: string;
};

/**
 * Вещь КОМНАТЫ: цена обязательна по продукту (показ — по priceVisibility,
 * хозяйке всегда), плюс размер/цвет/степень желания (items.json extraFields).
 * Комната и есть список желаний — бронируется здесь всё.
 */
export type OwnerRoomItemDto = OwnerItemBaseDto & {
  inHall: false;
  /** Decimal сериализуем строкой — float для денег запрещён (CLAUDE.md). */
  price: string | null;
  /** ISO 4217. */
  currency: string | null;
  /** ME/NONE прячут цену у гостя; для хозяйки цена видна всегда (тикет 07). */
  priceVisibility: PriceVisibilityDto;
  size: string | null;
  color: string | null;
  /** «Насколько хочется», 1–4 — единственная градация вещи (тикет 125). */
  desire: number | null;
  /** Услуга-впечатление (тикет 97): «Когда · Где · Годен до». */
  eventWhen: string | null;
  eventWhere: string | null;
  /** Календарный день `YYYY-MM-DD` или null. */
  validUntil: string | null;
};

/**
 * Вещь СОКРОВИЩНИЦЫ: цены НЕТ ВООБЩЕ — ключи price/currency у этой формы
 * отсутствуют, даже если значение осталось в БД от жизни вещи в комнате
 * (инвариант №8, тест). Возврат в комнату покажет цену снова: в базе она
 * никуда не девалась, её просто не сериализуют здесь.
 */
export type OwnerHallItemDto = OwnerItemBaseDto & {
  inHall: true;
  giverName: string | null;
  /** ISO-строка — дата «Дошло» или ручного переезда на витрину. */
  receivedAt: string | null;
};

export type OwnerItemDto = OwnerRoomItemDto | OwnerHallItemDto;

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
 * Сериализация вещи для хозяйки. Форма зависит от МЕСТА (items.json v2: два
 * места — два словаря полей), ключи за пределами формы не попадают в объект
 * вовсе.
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

  if (item.inHall) {
    return {
      ...base,
      inHall: true,
      giverName: item.giverName,
      receivedAt: item.receivedAt === null ? null : item.receivedAt.toISOString(),
    };
  }

  return {
    ...base,
    inHall: false,
    price: item.price === null ? null : item.price.toString(),
    currency: item.currency,
    priceVisibility: item.priceVisibility,
    size: item.size,
    color: item.color,
    desire: item.desire,
    eventWhen: item.eventWhen,
    eventWhere: item.eventWhere,
    validUntil: item.validUntil === null ? null : item.validUntil.toISOString().slice(0, 10),
  };
}
