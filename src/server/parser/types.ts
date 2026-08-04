// Общие типы парсера. Контракт для тикета 06 (services/parser → API):
// ParsedProduct — единственное, что парсер отдаёт наружу.

/** Результат разбора товарной ссылки. Цена — строка-Decimal, float запрещён (CLAUDE.md). */
export interface ParsedProduct {
  title?: string;
  description?: string;
  imageUrl?: string;
  /** Строка вида "49990" или "1234.50" — готова к new Prisma.Decimal(...). */
  price?: string;
  /** ISO 4217, например "RUB". */
  currency?: string;
  /** Ключ зоны из design/package/handoff/zones.json — подсказка, не истина. */
  zoneHint?: string;
  /** Хост без "www.", в punycode, нижний регистр. */
  domain: string;
  /** Нормализованный финальный URL (после редиректов) — ключ кэша и дедупликации. */
  canonicalUrl: string;
  /** 0..1 — уверенность извлечения: ~0.9 JSON-LD, ~0.7 OG, ~0.5 эвристики, 0.1 «пустая карточка». */
  confidence: number;
}

/** Откуда взято поле — определяет confidence. */
export type ExtractionSource = "json-ld" | "og" | "heuristics";

/** Промежуточный результат fastPath до сборки ParsedProduct. */
export interface ExtractedData {
  title?: string;
  titleSource?: ExtractionSource;
  description?: string;
  imageUrl?: string;
  imageSource?: ExtractionSource;
  price?: string;
  priceSource?: ExtractionSource;
  currency?: string;
  /** Тексты хлебных крошек из JSON-LD BreadcrumbList — сырьё для zoneHint. */
  breadcrumbs: string[];
  /** На странице встречались ₽ / руб — сигнал для дефолта RUB на .ru/.рф. */
  hasRubleSigns: boolean;
}

export type ParserErrorCode = "invalid-url" | "rate-limited";

/** Ошибки уровня конвейера. Сетевые/SSRF-ошибки — отдельный SafeFetchError. */
export class ParserError extends Error {
  readonly code: ParserErrorCode;

  constructor(code: ParserErrorCode, message: string) {
    super(message);
    this.name = "ParserError";
    this.code = code;
  }
}
