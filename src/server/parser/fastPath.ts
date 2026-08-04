// fastPath — извлечение данных товара из HTML без рендера и DOM-библиотек:
// (а) JSON-LD Product/Offer (@graph, массивы, вложенные offers),
// (б) OpenGraph/Twitter meta,
// (в) эвристики: <title>, самая крупная картинка, ценоподобные паттерны.
// Линейный разбор регулярками; поля заполняются каскадом «только если пусто».

import type { ExtractedData, ExtractionSource } from "./types";

// ---------------------------------------------------------------------------
// Мелкие утилиты
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

function fromCodePointSafe(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => fromCodePointSafe(parseInt(dec, 10)))
    .replace(/&([a-z]{2,8});/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Значение атрибута из текста открывающего тега (порядок атрибутов любой). */
function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = re.exec(tag);
  if (!match) return undefined;
  const raw = match[2] ?? match[3] ?? match[4];
  return raw === undefined ? undefined : decodeEntities(raw).trim();
}

function resolveMaybeRelative(raw: string | undefined, baseUrl?: string): string | undefined {
  if (!raw) return undefined;
  try {
    return baseUrl ? new URL(raw, baseUrl).toString() : new URL(raw).toString();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Цена и валюта
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₽": "RUB",
  "руб.": "RUB",
  руб: "RUB",
  rub: "RUB",
  rur: "RUB",
  $: "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
};

/** Валюта → ISO 4217 (символы и RUR приводим, мусор отбрасываем). */
export function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const mapped = CURRENCY_SYMBOLS[trimmed.toLowerCase()];
  if (mapped) return mapped;
  const upper = trimmed.toUpperCase();
  if (upper === "RUR") return "RUB";
  return /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

/**
 * Цена → строка-Decimal ("49990", "12499.00"). Числа не считаем — только
 * чистим представление: пробелы-разряды, запятая-десятичная, символы валюты.
 */
export function normalizePriceValue(value: unknown): string | undefined {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    text = String(value);
  } else if (typeof value === "string") {
    text = value;
  } else {
    return undefined;
  }
  let cleaned = text.replace(/\s/g, "").replace(/[^\d.,]/g, "");
  if (/^\d+,\d{1,2}$/.test(cleaned)) cleaned = cleaned.replace(",", ".");
  else cleaned = cleaned.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  if (cleaned.replace(/\D/g, "").length > 12) return undefined;
  if (Number(cleaned) <= 0) return undefined;
  return cleaned;
}

// ---------------------------------------------------------------------------
// (а) JSON-LD
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function typeNames(node: UnknownRecord): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const segment = entry.split(/[/:#]/).pop();
    if (segment) names.push(segment.toLowerCase());
  }
  return names;
}

function hasType(node: UnknownRecord, wanted: string): boolean {
  return typeNames(node).includes(wanted);
}

/** Все JSON-объекты из всех валидных ld+json блоков (deep walk с бюджетом). */
function collectJsonLdNodes(html: string): UnknownRecord[] {
  const nodes: UnknownRecord[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  let blocks = 0;
  while ((match = scriptRe.exec(html)) !== null && blocks < 30) {
    const attrs = match[1] ?? "";
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) continue;
    blocks += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse((match[2] ?? "").trim());
    } catch {
      continue; // битый JSON-LD — молча пропускаем блок
    }
    const stack: unknown[] = [parsed];
    let budget = 500;
    while (stack.length > 0 && budget > 0) {
      budget -= 1;
      const current = stack.pop();
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
        continue;
      }
      const record = asRecord(current);
      if (!record) continue;
      nodes.push(record);
      for (const value of Object.values(record)) {
        if (typeof value === "object" && value !== null) stack.push(value);
      }
    }
  }
  return nodes;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return collapseWs(decodeEntities(value));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return undefined;
}

function imageFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageFrom(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (record) return imageFrom(record["url"] ?? record["contentUrl"]);
  return undefined;
}

interface OfferPrice {
  price: string;
  currency?: string;
}

function priceFromOfferNode(offer: UnknownRecord): OfferPrice | undefined {
  const direct =
    normalizePriceValue(offer["price"]) ??
    normalizePriceValue(offer["lowPrice"]) ??
    normalizePriceValue(offer["highPrice"]);
  const currency = normalizeCurrency(
    typeof offer["priceCurrency"] === "string" ? offer["priceCurrency"] : undefined,
  );
  if (direct) return { price: direct, currency };

  const specs = offer["priceSpecification"];
  const specList = Array.isArray(specs) ? specs : [specs];
  for (const spec of specList) {
    const record = asRecord(spec);
    if (!record) continue;
    const specPrice = normalizePriceValue(record["price"]);
    if (specPrice) {
      return {
        price: specPrice,
        currency:
          normalizeCurrency(
            typeof record["priceCurrency"] === "string" ? record["priceCurrency"] : undefined,
          ) ?? currency,
      };
    }
  }
  return undefined;
}

function priceFromOffers(offers: unknown): OfferPrice | undefined {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    const found = priceFromOfferNode(record);
    if (found) return found;
    const nested = record["offers"];
    if (nested) {
      const deep = priceFromOffers(nested);
      if (deep) return deep;
    }
  }
  return undefined;
}

interface JsonLdExtraction {
  title?: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  currency?: string;
  breadcrumbs: string[];
}

function extractJsonLd(html: string): JsonLdExtraction {
  const nodes = collectJsonLdNodes(html);
  const result: JsonLdExtraction = { breadcrumbs: [] };

  const products = nodes.filter((node) => hasType(node, "product"));
  for (const product of products) {
    result.title = result.title ?? firstString(product["name"]);
    result.description = result.description ?? firstString(product["description"]);
    result.imageUrl = result.imageUrl ?? imageFrom(product["image"]);
    if (!result.price) {
      const offer = product["offers"] ? priceFromOffers(product["offers"]) : undefined;
      if (offer) {
        result.price = offer.price;
        result.currency = result.currency ?? offer.currency;
      }
    }
    if (result.title && result.price) break;
  }

  // Product не нашёлся, но есть одиночный Offer/AggregateOffer — берём цену.
  if (!result.price) {
    for (const node of nodes) {
      if (!hasType(node, "offer") && !hasType(node, "aggregateoffer")) continue;
      const offer = priceFromOfferNode(node);
      if (offer) {
        result.price = offer.price;
        result.currency = result.currency ?? offer.currency;
        break;
      }
    }
  }

  for (const node of nodes) {
    if (!hasType(node, "breadcrumblist")) continue;
    const items = node["itemListElement"];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const name = firstString(record["name"]) ?? firstString(asRecord(record["item"])?.["name"]);
      if (name) result.breadcrumbs.push(name);
    }
    if (result.breadcrumbs.length > 0) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// (б) OpenGraph / Twitter
// ---------------------------------------------------------------------------

/** property|name → content (первое вхождение побеждает), itemprop — с префиксом. */
function collectMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = metaRe.exec(html)) !== null && count < 500) {
    count += 1;
    const tag = match[0];
    const content = getAttr(tag, "content");
    if (content === undefined) continue;
    const property = getAttr(tag, "property") ?? getAttr(tag, "name");
    if (property) {
      const key = property.toLowerCase();
      if (!map.has(key)) map.set(key, content);
    }
    const itemprop = getAttr(tag, "itemprop");
    if (itemprop) {
      const key = `itemprop:${itemprop.toLowerCase()}`;
      if (!map.has(key)) map.set(key, content);
    }
  }
  return map;
}

interface OgExtraction {
  title?: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  currency?: string;
}

function extractOg(meta: Map<string, string>): OgExtraction {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value !== undefined && value.trim() !== "") return collapseWs(value);
    }
    return undefined;
  };
  return {
    title: pick("og:title", "twitter:title"),
    description: pick("og:description", "twitter:description"),
    imageUrl: pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"),
    price: normalizePriceValue(pick("product:price:amount", "og:price:amount", "product:price")),
    currency: normalizeCurrency(pick("product:price:currency", "og:price:currency")),
  };
}

// ---------------------------------------------------------------------------
// (в) Эвристики
// ---------------------------------------------------------------------------

const TITLE_TAIL_RE =
  /\s*[—–|-]\s*(купить|цена|цены|отзывы|характеристики|доставка|интернет-магазин|официальный)[^|—–]*$/i;

function extractTitleTag(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return undefined;
  let title = collapseWs(decodeEntities(match[1] ?? ""));
  for (let i = 0; i < 2; i += 1) title = title.replace(TITLE_TAIL_RE, "").trim();
  return title === "" ? undefined : title;
}

const IMG_JUNK_RE = /(sprite|logo|icon|placeholder|pixel|captcha|avatar|banner)/i;

function extractLargestImage(html: string, baseUrl?: string): string | undefined {
  const linkRe = /<link\b[^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const tag = linkMatch[0];
    if (/rel\s*=\s*["']?image_src/i.test(tag)) {
      const href = resolveMaybeRelative(getAttr(tag, "href"), baseUrl);
      if (href) return href;
    }
  }

  const imgRe = /<img\b[^>]*>/gi;
  let best: { area: number; src: string } | undefined;
  let fallback: string | undefined;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = imgRe.exec(html)) !== null && count < 300) {
    count += 1;
    const tag = match[0];
    const raw = getAttr(tag, "src") ?? getAttr(tag, "data-src") ?? getAttr(tag, "data-original");
    if (!raw || raw.startsWith("data:") || /\.svg(\?|$)/i.test(raw) || IMG_JUNK_RE.test(raw)) {
      continue;
    }
    const src = resolveMaybeRelative(raw, baseUrl);
    if (!src) continue;
    const width = Number(getAttr(tag, "width") ?? "");
    const height = Number(getAttr(tag, "height") ?? "");
    if (Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1) {
      const area = width * height;
      if (area >= 10_000 && (!best || area > best.area)) best = { area, src };
    } else {
      fallback = fallback ?? src;
    }
  }
  return best?.src ?? fallback;
}

/** «1 234 ₽», «12 499,00 руб.», «1234.00 RUB» в видимом тексте страницы. */
const TEXT_PRICE_RE =
  /(\d{1,3}(?:[ \u00a0\u202f\u2009]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(₽|руб\.?|rub|usd|eur|\$|€)/giu;

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).slice(0, 500_000);
}

function extractTextPrice(html: string): { price: string; currency?: string } | undefined {
  const text = htmlToText(html);
  const counts = new Map<string, { hits: number; order: number }>();
  let match: RegExpExecArray | null;
  let order = 0;
  TEXT_PRICE_RE.lastIndex = 0;
  while ((match = TEXT_PRICE_RE.exec(text)) !== null && order < 200) {
    const whole = (match[1] ?? "").replace(/\s/g, "");
    const decimals = match[2];
    const symbol = (match[3] ?? "").toLowerCase();
    const price = normalizePriceValue(decimals ? `${whole}.${decimals}` : whole);
    if (!price) continue;
    const currency = normalizeCurrency(symbol) ?? "RUB";
    const key = `${price}|${currency}`;
    const entry = counts.get(key);
    if (entry) entry.hits += 1;
    else counts.set(key, { hits: 1, order });
    order += 1;
  }
  let bestKey: string | undefined;
  let bestHits = 0;
  let bestOrder = Number.MAX_SAFE_INTEGER;
  for (const [key, { hits, order: firstSeen }] of counts) {
    if (hits > bestHits || (hits === bestHits && firstSeen < bestOrder)) {
      bestKey = key;
      bestHits = hits;
      bestOrder = firstSeen;
    }
  }
  if (!bestKey) return undefined;
  const [price, currency] = bestKey.split("|");
  if (!price) return undefined;
  return { price, currency: currency || undefined };
}

// ---------------------------------------------------------------------------
// Каскад
// ---------------------------------------------------------------------------

/**
 * Чистое извлечение из HTML: JSON-LD → OG/Twitter → эвристики.
 * Поле заполняется первым сработавшим источником; источники запоминаются
 * для расчёта confidence в index.ts.
 */
export function extractFromHtml(html: string, baseUrl?: string): ExtractedData {
  const data: ExtractedData = {
    breadcrumbs: [],
    hasRubleSigns: /₽|руб/i.test(html),
  };

  const setTitle = (value: string | undefined, source: ExtractionSource) => {
    if (!data.title && value) {
      data.title = value;
      data.titleSource = source;
    }
  };
  const setImage = (value: string | undefined, source: ExtractionSource) => {
    if (!data.imageUrl && value) {
      data.imageUrl = value;
      data.imageSource = source;
    }
  };
  const setPrice = (value: string | undefined, currency: string | undefined, source: ExtractionSource) => {
    if (!data.price && value) {
      data.price = value;
      data.priceSource = source;
      if (!data.currency && currency) data.currency = currency;
    }
  };

  // (а) JSON-LD
  const ld = extractJsonLd(html);
  setTitle(ld.title, "json-ld");
  data.description = ld.description;
  setImage(resolveMaybeRelative(ld.imageUrl, baseUrl), "json-ld");
  setPrice(ld.price, ld.currency, "json-ld");
  data.breadcrumbs = ld.breadcrumbs;

  // (б) OpenGraph / Twitter
  const meta = collectMetaTags(html);
  const og = extractOg(meta);
  setTitle(og.title, "og");
  data.description = data.description ?? og.description;
  setImage(resolveMaybeRelative(og.imageUrl, baseUrl), "og");
  setPrice(og.price, og.currency, "og");

  // (в) Эвристики: microdata-meta → <title> → link/img → текстовые паттерны
  setPrice(
    normalizePriceValue(meta.get("itemprop:price")),
    normalizeCurrency(meta.get("itemprop:pricecurrency")),
    "heuristics",
  );
  setTitle(extractTitleTag(html), "heuristics");
  data.description = data.description ?? (meta.get("description") ?? undefined);
  setImage(extractLargestImage(html, baseUrl), "heuristics");
  if (!data.price) {
    const textPrice = extractTextPrice(html);
    if (textPrice) setPrice(textPrice.price, textPrice.currency, "heuristics");
  }

  if (data.description) data.description = collapseWs(decodeEntities(data.description));
  return data;
}
