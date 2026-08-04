// safeFetch — ЕДИНСТВЕННАЯ точка исходящих запросов по чужим URL
// (инвариант №6 CLAUDE.md, ARCHITECTURE §11). Правила:
//   - только http/https; порты только 80/443;
//   - DNS-резолв ДО запроса (все адреса) и запрет приватных/зарезервированных
//     диапазонов — на КАЖДОМ redirect-hop (redirect: "manual", ≤5 хопов);
//   - тело ≤5 МБ (стримом, обрыв при превышении); таймаут 3 с (AbortController);
//   - allowlist content-type: text/html (+xhtml) и image/*;
//   - User-Agent из env PARSER_UA (дефолт WishlistBot/1.0).
// Реализовано на встроенном fetch (undici) без новых зависимостей.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Buffer } from "node:buffer";

export type SafeFetchErrorCode =
  | "invalid-url"
  | "blocked-scheme"
  | "blocked-port"
  | "blocked-host"
  | "dns-error"
  | "too-many-redirects"
  | "timeout"
  | "body-too-large"
  | "content-type"
  | "network";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/** Сигнатура DNS-резолва — подменяется в тестах, чтобы не трогать сеть. */
export type LookupFn = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true });

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  /** Ограничение content-type тела: html | image. Не задано — допустимы оба. */
  accept?: "html" | "image";
  /** Максимум редиректов суммарно; жёсткий потолок 5. */
  maxRedirects?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  headers?: Record<string, string>;
  /** Тестовые швы: в тестах подменяем fetch и DNS, реальную сеть не дёргаем. */
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupFn;
}

export interface SafeFetchResult {
  status: number;
  /** true для 2xx. */
  ok: boolean;
  /** URL после всех редиректов (не нормализован). */
  finalUrl: string;
  contentType: string | null;
  /** Буфер тела для 2xx с допустимым content-type; null для HEAD и не-2xx. */
  body: Buffer | null;
  /** Пройденные redirect-hop'ы (целевые URL) — для учёта общего бюджета. */
  redirects: string[];
}

export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 3_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---------------------------------------------------------------------------
// Блокировка приватных/зарезервированных адресов
// ---------------------------------------------------------------------------

function isBlockedIpv4Octets(a: number, b: number, c: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (метаданные облаков)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24, 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100/24 doc
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113/24 doc
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast
  return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/** Разворачивает IPv6 в 16 байт; поддерживает "::" и IPv4-хвост ("::ffff:127.0.0.1"). */
function expandIpv6(ip: string): number[] | null {
  let value = ip;
  const zoneIndex = value.indexOf("%");
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);

  // IPv4-хвост → два hex-слова.
  const lastColon = value.lastIndexOf(":");
  if (value.includes(".") && lastColon !== -1) {
    const v4 = parseIpv4(value.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4;
    const hexTail =
      ((a << 8) | b).toString(16).padStart(4, "0") +
      ":" +
      ((c << 8) | d).toString(16).padStart(4, "0");
    value = value.slice(0, lastColon + 1) + hexTail;
  }

  const doubleSplit = value.split("::");
  if (doubleSplit.length > 2) return null;
  const head = doubleSplit[0] === "" ? [] : (doubleSplit[0] ?? "").split(":");
  const tail =
    doubleSplit.length === 2 && doubleSplit[1] !== "" ? (doubleSplit[1] ?? "").split(":") : [];
  const groups: string[] =
    doubleSplit.length === 2
      ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => "0"), ...tail]
      : head;
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const word = parseInt(group, 16);
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return bytes;
}

function isBlockedIpv6Bytes(bytes: number[]): boolean {
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  if (b0 === 0xff) return true; // ff00::/8 multicast
  if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32

  const leadingZeros = (count: number) => bytes.slice(0, count).every((byte) => byte === 0);
  const embeddedV4 = () =>
    isBlockedIpv4Octets(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0);

  // ::ffff:a.b.c.d — IPv4-mapped
  if (leadingZeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embeddedV4();
  // 64:ff9b::/96 — NAT64
  if (
    b0 === 0 &&
    b1 === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return embeddedV4();
  }
  if (leadingZeros(12)) {
    // ::, ::1, ::a.b.c.d (IPv4-compatible, deprecated)
    const tail = bytes.slice(12);
    if (tail.every((byte) => byte === 0)) return true; // ::
    if (tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && tail[3] === 1) return true; // ::1
    return embeddedV4();
  }
  return false;
}

/** true, если адрес приватный/зарезервированный и запросы к нему запрещены. Неразборчивое — блокируем. */
export function isBlockedAddress(address: string): boolean {
  const bare =
    address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = isIP(bare);
  if (family === 4) {
    const octets = parseIpv4(bare);
    if (!octets) return true;
    return isBlockedIpv4Octets(octets[0], octets[1], octets[2]);
  }
  if (family === 6) {
    const bytes = expandIpv6(bare);
    if (!bytes) return true;
    return isBlockedIpv6Bytes(bytes);
  }
  return true; // не IP — эта функция вызывается только для адресов
}

// ---------------------------------------------------------------------------
// Проверка URL перед каждым hop'ом
// ---------------------------------------------------------------------------

function assertUrlShape(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("blocked-scheme", `Запрещённая схема: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new SafeFetchError("invalid-url", "URL с credentials запрещён");
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new SafeFetchError("blocked-port", `Запрещённый порт: ${url.port}`);
  }
}

async function assertPublicHost(url: URL, lookupImpl: LookupFn): Promise<void> {
  const rawHost = url.hostname;
  const host = (
    rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost
  )
    .replace(/\.$/, "")
    .toLowerCase();

  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    throw new SafeFetchError("blocked-host", `Запрещённый хост: ${rawHost}`);
  }

  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new SafeFetchError("blocked-host", `Приватный адрес запрещён: ${host}`);
    }
    return;
  }

  let addresses: ReadonlyArray<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(host);
  } catch {
    throw new SafeFetchError("dns-error", `DNS не резолвится: ${host}`);
  }
  if (addresses.length === 0) {
    throw new SafeFetchError("dns-error", `DNS вернул пустой ответ: ${host}`);
  }
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new SafeFetchError(
        "blocked-host",
        `Хост ${host} резолвится в запрещённый адрес ${entry.address}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// content-type allowlist
// ---------------------------------------------------------------------------

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function isAllowedContentType(contentType: string | null, accept?: "html" | "image"): boolean {
  if (!contentType) return false;
  const mime = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  const isHtml = HTML_TYPES.has(mime);
  const isImage = mime.startsWith("image/");
  if (accept === "html") return isHtml;
  if (accept === "image") return isImage;
  return isHtml || isImage;
}

function parserUserAgent(): string {
  const raw = (process.env.PARSER_UA ?? "").trim().replace(/^"(.*)"$/, "$1");
  return raw || "WishlistBot/1.0";
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

export async function safeFetch(
  targetUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const method = options.method ?? "GET";
  const maxRedirects = Math.min(options.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl ?? defaultLookup;

  let current: URL;
  try {
    current = new URL(targetUrl);
  } catch {
    throw new SafeFetchError("invalid-url", `Некорректный URL: ${targetUrl}`);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // в Node таймер держит event loop; тип зависит от lib (dom/node), поэтому через cast
  (timer as unknown as { unref?: () => void }).unref?.();

  const redirects: string[] = [];

  const discardBody = (response: Response) => {
    void response.body?.cancel().catch(() => undefined);
  };

  try {
    for (;;) {
      assertUrlShape(current);
      await assertPublicHost(current, lookupImpl);

      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": parserUserAgent(),
            accept:
              options.accept === "image"
                ? "image/avif,image/webp,image/*"
                : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "accept-language": "ru,en;q=0.8",
            ...options.headers,
          },
        });
      } catch (error) {
        if (timedOut) throw new SafeFetchError("timeout", `Таймаут ${timeoutMs} мс: ${current}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new SafeFetchError("network", `Сетевая ошибка (${current.hostname}): ${message}`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        discardBody(response);
        if (!location) {
          return {
            status: response.status,
            ok: false,
            finalUrl: current.toString(),
            contentType: response.headers.get("content-type"),
            body: null,
            redirects,
          };
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SafeFetchError("invalid-url", `Некорректный redirect: ${location}`);
        }
        redirects.push(next.toString());
        if (redirects.length > maxRedirects) {
          throw new SafeFetchError(
            "too-many-redirects",
            `Больше ${maxRedirects} редиректов: ${targetUrl}`,
          );
        }
        current = next;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const base = {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        finalUrl: current.toString(),
        contentType,
        redirects,
      };

      if (method === "HEAD" || !base.ok) {
        discardBody(response);
        return { ...base, body: null };
      }

      if (!isAllowedContentType(contentType, options.accept)) {
        discardBody(response);
        throw new SafeFetchError(
          "content-type",
          `Недопустимый content-type: ${contentType ?? "(нет)"}`,
        );
      }

      const declaredLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
        discardBody(response);
        throw new SafeFetchError("body-too-large", `Content-Length ${declaredLength} > лимита`);
      }

      if (!response.body) return { ...base, body: Buffer.alloc(0) };

      const chunks: Uint8Array[] = [];
      let received = 0;
      let overflow = false;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          received += value.byteLength;
          if (received > maxBodyBytes) {
            overflow = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(value);
        }
      } catch (error) {
        if (timedOut) throw new SafeFetchError("timeout", `Таймаут ${timeoutMs} мс: ${current}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new SafeFetchError("network", `Обрыв чтения тела: ${message}`);
      }
      if (overflow) {
        throw new SafeFetchError("body-too-large", `Тело больше ${maxBodyBytes} байт: ${current}`);
      }

      return { ...base, body: Buffer.concat(chunks) };
    }
  } finally {
    clearTimeout(timer);
  }
}
