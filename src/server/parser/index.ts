// Публичный вход парсера (контракт для тикета 06 — services/parser и API):
//   parseUrl(url)        — весь конвейер: normalize → кэш → rate limit →
//                          safeFetch → fastPath → zoneHint → кэш;
//   parseHtml(html, url) — чистая функция без сети (тесты, fallback-пути).
// Ошибки: ParserError("invalid-url") на мусорном входе,
// ParserError("rate-limited") при исчерпании бюджета домена; всё остальное
// (SSRF-блок, таймаут, не-HTML, 404) — честная карточка с domain+canonicalUrl
// и confidence 0.1 (user story 9: вещь сохраняется, хозяйка дозаполняет).

import { extractFromHtml } from "./fastPath";
import { domainOf, expandUrl, isRussianTld, isShortUrl, normalizeUrl } from "./normalize";
import { MAX_REDIRECTS, safeFetch } from "./safeFetch";
import type { LookupFn } from "./safeFetch";
import { getDefaultCache, type ParserCache } from "./cache";
import { ParserError } from "./types";
import type { ExtractedData, ExtractionSource, ParsedProduct } from "./types";
import { zoneHintFor } from "./zoneHint";

export { normalizeUrl, domainOf, isRussianTld } from "./normalize";
export { safeFetch, SafeFetchError, isBlockedAddress } from "./safeFetch";
export type { SafeFetchOptions, SafeFetchResult, SafeFetchErrorCode, LookupFn } from "./safeFetch";
export { ParserCache, getDefaultCache } from "./cache";
export type { RedisLike } from "./cache";
export { zoneHintFor } from "./zoneHint";
export type { ZoneHint, ZoneHintInput } from "./zoneHint";
export { ParserError } from "./types";
export type { ParsedProduct, ParserErrorCode } from "./types";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 1000;

const SOURCE_WEIGHT: Record<ExtractionSource, number> = {
  "json-ld": 0.9,
  og: 0.7,
  heuristics: 0.5,
};

function clampConfidence(value: number): number {
  return Math.round(Math.min(0.95, Math.max(0.05, value)) * 100) / 100;
}

/** JSON-LD ≈ 0.9, OG ≈ 0.7, эвристики ≈ 0.5; −0.2 без цены, −0.05 без картинки. */
function computeConfidence(data: ExtractedData): number {
  if (!data.title || !data.titleSource) return 0.1;
  const titleWeight = SOURCE_WEIGHT[data.titleSource];
  let confidence =
    data.price && data.priceSource
      ? Math.min(titleWeight, SOURCE_WEIGHT[data.priceSource])
      : titleWeight - 0.2;
  if (!data.imageUrl) confidence -= 0.05;
  return clampConfidence(confidence);
}

/**
 * Чистый разбор HTML (без сети, кэша и rate limit) — для тестов на фикстурах
 * и повторного использования из fallback-путей (Phase 2: parse.browser).
 */
export function parseHtml(html: string, url: string): ParsedProduct {
  const canonicalUrl = normalizeUrl(url);
  const domain = domainOf(canonicalUrl);
  const data = extractFromHtml(html, canonicalUrl);

  let currency = data.currency;
  if (!currency && data.price && isRussianTld(domain) && data.hasRubleSigns) {
    currency = "RUB"; // .ru/.рф + ₽/руб на странице → рубль (решение тикета)
  }

  const zone = zoneHintFor({
    url: canonicalUrl,
    title: data.title,
    breadcrumbs: data.breadcrumbs,
  });

  return {
    domain,
    canonicalUrl,
    confidence: computeConfidence(data),
    ...(data.title ? { title: data.title.slice(0, TITLE_MAX) } : {}),
    ...(data.description ? { description: data.description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    ...(data.price ? { price: data.price } : {}),
    ...(currency ? { currency } : {}),
    ...(zone ? { zoneHint: zone.zone } : {}),
  };
}

/** «Честная карточка»: только домен и канонический URL, дозаполняется руками. */
function fallbackProduct(url: string): ParsedProduct {
  let canonicalUrl = url;
  let domain = "";
  try {
    canonicalUrl = normalizeUrl(url);
    domain = domainOf(canonicalUrl);
  } catch {
    // оставляем как есть — сюда попадает уже нормализованный URL
  }
  return { domain, canonicalUrl, confidence: 0.1 };
}

function charsetFromContentType(contentType: string | null): string | undefined {
  const match = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? "");
  return match?.[1];
}

/** Буфер → строка с учётом charset из заголовка или <meta> (RU-магазины бывают в cp1251). */
function decodeHtmlBody(body: Buffer, contentType: string | null): string {
  let charset = charsetFromContentType(contentType);
  if (!charset) {
    const head = body.subarray(0, 2048).toString("latin1");
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset ?? "utf-8").toLowerCase()).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

export interface ParseUrlOptions {
  /** Тестовые швы: сеть и Redis подменяются, реальные соединения не создаются. */
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupFn;
  cache?: ParserCache;
}

/** Кэшируем только осмысленные результаты, чтобы таймаут не залипал на 24 ч. */
const CACHEABLE_CONFIDENCE = 0.4;

/**
 * Полный конвейер: URL товара → ParsedProduct.
 * Бросает ParserError("invalid-url") и ParserError("rate-limited");
 * любые сетевые/SSRF/контентные проблемы превращаются в карточку с confidence 0.1.
 */
export async function parseUrl(
  rawUrl: string,
  options: ParseUrlOptions = {},
): Promise<ParsedProduct> {
  const normalized = normalizeUrl(rawUrl); // ParserError("invalid-url") — наружу
  const cache = options.cache ?? (await getDefaultCache());

  const cached = await cache.getProduct(normalized);
  if (cached) return cached;

  const requestDomain = domainOf(normalized);
  if (!(await cache.takeToken(requestDomain))) {
    throw new ParserError("rate-limited", `Лимит запросов к ${requestDomain} исчерпан (10/мин)`);
  }

  const net = { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl };

  try {
    let target = normalized;
    let redirectBudget = MAX_REDIRECTS; // ≤5 редиректов СУММАРНО на разворот+страницу

    if (isShortUrl(normalized)) {
      const expanded = await expandUrl(normalized, { ...net, maxRedirects: redirectBudget });
      redirectBudget = Math.max(0, redirectBudget - expanded.redirectsUsed);
      target = expanded.url;
      const cachedFinal = await cache.getProduct(target);
      if (cachedFinal) return cachedFinal;
    }

    const response = await safeFetch(target, {
      ...net,
      method: "GET",
      accept: "html",
      maxRedirects: redirectBudget,
    });
    if (!response.ok || response.body === null) {
      return fallbackProduct(response.finalUrl);
    }

    const html = decodeHtmlBody(response.body, response.contentType);
    const product = parseHtml(html, response.finalUrl);
    if (product.confidence >= CACHEABLE_CONFIDENCE) {
      await cache.setProduct(product, normalized);
    }
    return product;
  } catch (error) {
    if (error instanceof ParserError && error.code === "rate-limited") throw error;
    return fallbackProduct(normalized);
  }
}
