// Фейки сетевого края для тестов парсера: fetch и DNS-lookup подменяются
// полностью, реальная сеть в тестах не дёргается (Testing Decisions спеки).

import type { LookupFn } from "../../src/server/parser/safeFetch";

export interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
  body?: string | Uint8Array;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface FakeFetch {
  impl: typeof fetch;
  calls: RecordedCall[];
}

/** fetch по таблице маршрутов «точный URL → ответ»; неизвестный URL — сетевая ошибка. */
export function fakeFetch(routes: Record<string, FakeRoute>): FakeFetch {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: нет маршрута для ${url}`);
    const status = route.status ?? 200;
    const headers: Record<string, string> = { ...(route.headers ?? {}) };
    if (route.contentType) headers["content-type"] = route.contentType;
    const noBody = method === "HEAD" || status === 204 || status === 304 || route.body === undefined;
    // Uint8Array<ArrayBufferLike> формально не BodyInit в свежих lib.dom — сужаем
    return new Response(noBody ? null : (route.body as BodyInit), { status, headers });
  }) as typeof fetch;
  return { impl, calls };
}

/** Все хосты резолвятся в публичный адрес (example.com). */
export const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

/** DNS-таблица «хост → адреса»; неизвестный хост — ENOTFOUND. */
export function lookupTable(table: Record<string, string[]>): LookupFn {
  return async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  };
}

/** fetch, который висит до отмены сигнала (для теста таймаута). */
export const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted", "AbortError")),
    );
  })) as typeof fetch;
