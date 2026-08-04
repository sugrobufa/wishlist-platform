// Вид «вещь в сетке зоны» — структурный контракт ZoneGrid.
// Owner-DTO (src/server/dto/items) удовлетворяет ему как есть (зафиксировано
// компайл-проверкой в tests/items.dto.test.ts); guest-DTO тикета 07 — тоже:
// необязательные поля он может не отдавать (цена гостю приходит уже
// отфильтрованной по priceVisibility, для хозяйки видна всегда).

export type ZoneGridItem = {
  id: string;
  state: "LOVE" | "WANT";
  title: string;
  photoUrl: string | null;
  /** Демо-призрак: полупрозрачная плитка, бейдж «пример», не бронируется. */
  isDemo: boolean;
  note?: string | null;
  /** «Хочу»: цена строкой (Decimal), валюта ISO 4217, видимость цены. */
  price?: string | null;
  currency?: string | null;
  priceVisibility?: "ALL" | "FRIENDS" | "ME" | "NONE";
  /** «Люблю»: подпись «Подарен в {год} · {даритель}» вместо цены. */
  giverName?: string | null;
  receivedAt?: string | null;
  hidden?: boolean;
};
