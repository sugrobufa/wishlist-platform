// SSRF-инвариант №6 (CLAUDE.md, ARCHITECTURE §11): safeFetch обязан резать
// приватные адреса, чужие схемы и порты, редиректы в приват, гигантские тела
// и зависшие ответы. Сеть и DNS замоканы — реальных запросов нет.

import { afterEach, describe, expect, it } from "vitest";
import { isBlockedAddress, safeFetch, SafeFetchError } from "../../src/server/parser/safeFetch";
import { fakeFetch, hangingFetch, lookupTable, publicLookup } from "./testUtils";

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error, "ожидалась ошибка SafeFetchError").toBeInstanceOf(SafeFetchError);
  expect((error as SafeFetchError).code).toBe(code);
}

const OLD_UA = process.env.PARSER_UA;
afterEach(() => {
  if (OLD_UA === undefined) delete process.env.PARSER_UA;
  else process.env.PARSER_UA = OLD_UA;
});

describe("safeFetch: схемы и порты", () => {
  it("ftp:// отклоняется без запроса", async () => {
    const { impl, calls } = fakeFetch({});
    await expectCode(
      safeFetch("ftp://files.example.com/catalog.xml", { fetchImpl: impl, lookupImpl: publicLookup }),
      "blocked-scheme",
    );
    expect(calls).toHaveLength(0);
  });

  it("порт 8080 отклоняется, явный порт 80 — допустим", async () => {
    // Явный дефолтный порт WHATWG URL срезает сам: :80 у http исчезает из URL.
    const { impl } = fakeFetch({
      "http://shop.example/a": { contentType: "text/html", body: "<title>ок</title>" },
    });
    await expectCode(
      safeFetch("http://shop.example:8080/a", { fetchImpl: impl, lookupImpl: publicLookup }),
      "blocked-port",
    );
    const on80 = await safeFetch("http://shop.example:80/a", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(on80.ok).toBe(true);
  });

  it("URL с credentials отклоняется", async () => {
    const { impl } = fakeFetch({});
    await expectCode(
      safeFetch("https://admin:hunter2@shop.example/", { fetchImpl: impl, lookupImpl: publicLookup }),
      "invalid-url",
    );
  });
});

describe("safeFetch: приватные и зарезервированные адреса", () => {
  const blockedUrls = [
    "http://localhost/health",
    "http://127.0.0.1/",
    "http://0.0.0.0/",
    "http://10.0.0.8/secret",
    "http://100.64.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.5.5/",
    "http://192.168.1.10/router",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:10.0.0.1]/",
  ];

  for (const url of blockedUrls) {
    it(`${url} → blocked-host, fetch не вызывается`, async () => {
      const { impl, calls } = fakeFetch({});
      await expectCode(safeFetch(url, { fetchImpl: impl, lookupImpl: publicLookup }), "blocked-host");
      expect(calls).toHaveLength(0);
    });
  }

  it("хост, резолвящийся в приватный адрес, отклоняется ДО запроса", async () => {
    const { impl, calls } = fakeFetch({});
    const lookupImpl = lookupTable({ "evil.example.com": ["93.184.216.34", "10.1.2.3"] });
    await expectCode(
      safeFetch("https://evil.example.com/product", { fetchImpl: impl, lookupImpl }),
      "blocked-host",
    );
    expect(calls).toHaveLength(0);
  });

  it("несуществующий хост → dns-error", async () => {
    const { impl } = fakeFetch({});
    await expectCode(
      safeFetch("https://no-such.example.com/", { fetchImpl: impl, lookupImpl: lookupTable({}) }),
      "dns-error",
    );
  });
});

describe("safeFetch: редиректы", () => {
  it("каждый hop проверяется: редирект на приватный адрес обрубается", async () => {
    const { impl, calls } = fakeFetch({
      "https://shop.example/go": {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      },
    });
    await expectCode(
      safeFetch("https://shop.example/go", { fetchImpl: impl, lookupImpl: publicLookup }),
      "blocked-host",
    );
    expect(calls).toHaveLength(1); // до приватного адреса запрос не дошёл
  });

  it("редирект на нестандартный порт обрубается", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/go": { status: 301, headers: { location: "https://shop.example:8443/x" } },
    });
    await expectCode(
      safeFetch("https://shop.example/go", { fetchImpl: impl, lookupImpl: publicLookup }),
      "blocked-port",
    );
  });

  it("больше 5 редиректов → too-many-redirects", async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let i = 0; i < 7; i += 1) {
      routes[`https://shop.example/r${i}`] = {
        status: 301,
        headers: { location: `https://shop.example/r${i + 1}` },
      };
    }
    const { impl } = fakeFetch(routes);
    await expectCode(
      safeFetch("https://shop.example/r0", { fetchImpl: impl, lookupImpl: publicLookup }),
      "too-many-redirects",
    );
  });

  it("цепочка в пределах лимита проходит, finalUrl — последний hop", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/old": { status: 301, headers: { location: "/new" } },
      "https://shop.example/new": { contentType: "text/html", body: "<title>Новый</title>" },
    });
    const result = await safeFetch("https://shop.example/old", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(result.finalUrl).toBe("https://shop.example/new");
    expect(result.redirects).toEqual(["https://shop.example/new"]);
    expect(result.body?.toString("utf8")).toContain("Новый");
  });
});

describe("safeFetch: тело, content-type, таймаут, UA", () => {
  it("content-type вне allowlist → ошибка", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/api": { contentType: "application/json", body: "{}" },
    });
    await expectCode(
      safeFetch("https://shop.example/api", { fetchImpl: impl, lookupImpl: publicLookup }),
      "content-type",
    );
  });

  it("accept: html режет image/* и наоборот", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/pic.jpg": { contentType: "image/jpeg", body: "xx" },
    });
    await expectCode(
      safeFetch("https://shop.example/pic.jpg", {
        accept: "html",
        fetchImpl: impl,
        lookupImpl: publicLookup,
      }),
      "content-type",
    );
    const asImage = await safeFetch("https://shop.example/pic.jpg", {
      accept: "image",
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(asImage.ok).toBe(true);
  });

  it("тело больше лимита обрывается стримом", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/huge": {
        contentType: "text/html",
        body: new Uint8Array(64 * 1024).fill(97),
      },
    });
    await expectCode(
      safeFetch("https://shop.example/huge", {
        maxBodyBytes: 16 * 1024,
        fetchImpl: impl,
        lookupImpl: publicLookup,
      }),
      "body-too-large",
    );
  });

  it("заявленный Content-Length больше лимита → отказ без чтения", async () => {
    const { impl } = fakeFetch({
      "https://shop.example/huge": {
        contentType: "text/html",
        headers: { "content-length": String(50 * 1024 * 1024) },
        body: "мелочь",
      },
    });
    await expectCode(
      safeFetch("https://shop.example/huge", { fetchImpl: impl, lookupImpl: publicLookup }),
      "body-too-large",
    );
  });

  it("зависший ответ обрывается таймаутом", async () => {
    await expectCode(
      safeFetch("https://slow.example/", {
        timeoutMs: 25,
        fetchImpl: hangingFetch,
        lookupImpl: publicLookup,
      }),
      "timeout",
    );
  });

  it("User-Agent берётся из PARSER_UA", async () => {
    process.env.PARSER_UA = "WishlistBot/1.0 (+https://wishlist.example/bot)";
    const { impl, calls } = fakeFetch({
      "https://shop.example/": { contentType: "text/html", body: "<title>x</title>" },
    });
    await safeFetch("https://shop.example/", { fetchImpl: impl, lookupImpl: publicLookup });
    expect(calls[0]?.headers["user-agent"]).toBe("WishlistBot/1.0 (+https://wishlist.example/bot)");
  });

  it("HEAD не читает тело и отдаёт статус", async () => {
    const { impl, calls } = fakeFetch({
      "https://shop.example/": { contentType: "text/html", body: "<title>x</title>" },
    });
    const result = await safeFetch("https://shop.example/", {
      method: "HEAD",
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(result.ok).toBe(true);
    expect(result.body).toBeNull();
    expect(calls[0]?.method).toBe("HEAD");
  });
});

describe("isBlockedAddress: диапазоны из тикета", () => {
  const blocked = [
    "0.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.53",
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "febf::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
    "64:ff9b::a00:1", // NAT64 → 10.0.0.1
  ];
  const allowed = ["8.8.8.8", "93.184.216.34", "213.180.204.11", "2606:4700::1111", "100.63.0.1", "172.32.0.1"];

  for (const address of blocked) {
    it(`${address} блокируется`, () => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  }
  for (const address of allowed) {
    it(`${address} публичный`, () => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  }
});
