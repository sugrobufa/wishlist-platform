// Нормализация URL: https, нижний регистр хоста, чистка трекинг-параметров,
// стабильный порядок query (канонический вид — ключ кэша и дедупликации),
// разворот коротких ссылок через safeFetch (HEAD → GET, ≤5 редиректов суммарно).

import { ParserError } from "./types";
import { safeFetch, SafeFetchError, type LookupFn } from "./safeFetch";

/** Точные имена трекинг-параметров (сравнение по нижнему регистру). */
const TRACKING_PARAMS = new Set([
  "ref",
  "refrid", // Amazon refRID
  "fbclid",
  "gclid",
  "dclid",
  "gclsrc",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "ysclid",
  "_openstat",
  "spm",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "mkt_tok",
  "erid",
  "admitad_uid",
  "utm_referrer",
]);

/** Префиксы трекинг-параметров. */
const TRACKING_PREFIXES = ["utm_"];

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Чистая нормализация без сети:
 * trim → https (схема добавляется, http поднимается) → host в нижний регистр,
 * без завершающей точки → выброс трекинг-параметров → сортировка остальных →
 * без fragment. Бросает ParserError("invalid-url") на мусоре и не-http(s) схемах.
 */
export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed === "") throw new ParserError("invalid-url", "Пустой URL");
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ParserError("invalid-url", `Не удалось разобрать URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ParserError("invalid-url", `Не товарная ссылка (схема ${url.protocol})`);
  }

  const explicitDefaultPort =
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443");
  url.protocol = "https:";
  if (explicitDefaultPort || url.port === "80" || url.port === "443") url.port = "";

  url.hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (url.hostname === "") throw new ParserError("invalid-url", `Пустой хост: ${rawUrl}`);
  url.hash = "";

  const kept: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (!isTrackingParam(name)) kept.push([name, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);

  return url.toString();
}

/** Хост без ведущего "www.", в punycode и нижнем регистре. */
export function domainOf(normalizedUrl: string): string {
  const host = new URL(normalizedUrl).hostname;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Домен российской зоны (.ru / .su / .рф в punycode) — участвует в дефолте валюты. */
export function isRussianTld(domain: string): boolean {
  return (
    domain.endsWith(".ru") ||
    domain.endsWith(".su") ||
    domain.endsWith(".xn--p1ai") ||
    domain.endsWith(".рф")
  );
}

/** Известные сокращатели — только для них делаем предварительный разворот. */
const SHORTENER_HOSTS = new Set([
  "clck.ru",
  "cutt.ly",
  "goo.gl",
  "bit.ly",
  "bitly.com",
  "is.gd",
  "l.wl.ru",
  "ozon.onelink.me",
  "redirect.appmetrica.yandex.com",
  "s.click.aliexpress.com",
  "t.co",
  "tiny.cc",
  "tinyurl.com",
  "u.to",
  "vk.cc",
  "wb.ru",
  "ya.cc",
]);

export function isShortUrl(normalizedUrl: string): boolean {
  try {
    return SHORTENER_HOSTS.has(domainOf(normalizedUrl));
  } catch {
    return false;
  }
}

export interface ExpandOptions {
  /** Общий бюджет редиректов (≤5). */
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupFn;
}

export interface ExpandResult {
  /** Нормализованный финальный URL. */
  url: string;
  /** Сколько редиректов потрачено — вычитается из общего бюджета конвейера. */
  redirectsUsed: number;
}

/**
 * Разворачивает короткую ссылку HEAD-запросом через safeFetch (SSRF-проверка
 * на каждом hop'е внутри); если сервис не отвечает на HEAD (405/501/сеть) —
 * одна попытка GET. Возвращает нормализованный финальный URL.
 */
export async function expandUrl(
  normalizedUrl: string,
  options: ExpandOptions = {},
): Promise<ExpandResult> {
  const shared = {
    maxRedirects: options.maxRedirects,
    fetchImpl: options.fetchImpl,
    lookupImpl: options.lookupImpl,
  };
  try {
    const head = await safeFetch(normalizedUrl, { ...shared, method: "HEAD" });
    if (head.status !== 405 && head.status !== 501) {
      return { url: normalizeUrl(head.finalUrl), redirectsUsed: head.redirects.length };
    }
  } catch (error) {
    // HEAD не поддержан или оборван — пробуем GET ниже. SSRF-ошибки
    // (blocked-*, dns-error, too-many-redirects, timeout) не глотаем.
    if (error instanceof SafeFetchError && error.code !== "network") throw error;
  }
  const got = await safeFetch(normalizedUrl, { ...shared, method: "GET", accept: "html" });
  return { url: normalizeUrl(got.finalUrl), redirectsUsed: got.redirects.length };
}
