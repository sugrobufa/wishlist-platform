// Роут POST /api/v1/parse (тикет 06): auth-only, Zod на вход, rate limit
// 10/мин на userId, маппинг ParserError → 422/429. Сам парсер здесь мок —
// его конвейер покрыт tests/parser/* (тикет 05); роут тонкий, тестируем
// только его собственные ветки.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/parser")>()),
  parseUrl: vi.fn(),
}));

import { auth } from "@/server/auth";
import { ParserError, parseUrl, type ParsedProduct } from "@/server/parser";
import { POST } from "../src/app/api/v1/parse/route";

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const parseUrlMock = vi.mocked(parseUrl);

/** Свежий userId на каждый тест: корзина лимитера всегда полная. */
function signInAs(): string {
  const userId = `parse-route-${randomUUID()}`;
  authMock.mockResolvedValue({ user: { id: userId } });
  return userId;
}

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const product: ParsedProduct = {
  title: "Серьги-кольца",
  imageUrl: "https://cdn.shop.example/rings.jpg",
  price: "14900",
  currency: "RUB",
  zoneHint: "jewelry",
  domain: "shop.example",
  canonicalUrl: "https://shop.example/rings",
  confidence: 0.9,
};

beforeEach(() => {
  authMock.mockReset();
  parseUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/parse", () => {
  it("хэппи-пас: {url} → 200 {data: ParsedProduct}, парсер получил url как есть", async () => {
    signInAs();
    parseUrlMock.mockResolvedValue(product);

    const response = await POST(postRequest({ url: "https://shop.example/rings?utm_source=x" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: product });
    expect(parseUrlMock).toHaveBeenCalledWith("https://shop.example/rings?utm_source=x");
  });

  it("без сессии — 401, парсер не дёргается", async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(postRequest({ url: "https://shop.example/rings" }));
    expect(response.status).toBe(401);
    expect(parseUrlMock).not.toHaveBeenCalled();
  });

  it("не-JSON тело и тело без url — 400 VALIDATION", async () => {
    signInAs();
    expect((await POST(postRequest("{oops"))).status).toBe(400);
    expect((await POST(postRequest({}))).status).toBe(400);
    expect((await POST(postRequest({ url: "" }))).status).toBe(400);
    expect(parseUrlMock).not.toHaveBeenCalled();
  });

  it("ParserError('invalid-url') → 422 (мусор вместо ссылки)", async () => {
    signInAs();
    parseUrlMock.mockRejectedValue(new ParserError("invalid-url", "мусор"));

    const response = await POST(postRequest({ url: "просто текст" }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("ParserError('rate-limited') парсера (per-domain bucket) → 429", async () => {
    signInAs();
    parseUrlMock.mockRejectedValue(new ParserError("rate-limited", "домен устал"));

    const response = await POST(postRequest({ url: "https://shop.example/rings" }));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("лимит на userId: 10/мин проходят, одиннадцатый — 429 без похода в парсер", async () => {
    signInAs(); // одна сессия на все 11 запросов
    parseUrlMock.mockResolvedValue(product);

    for (let i = 0; i < 10; i += 1) {
      const ok = await POST(postRequest({ url: "https://shop.example/rings" }));
      expect(ok.status, `запрос №${i + 1}`).toBe(200);
    }

    const blocked = await POST(postRequest({ url: "https://shop.example/rings" }));
    expect(blocked.status).toBe(429);
    expect(parseUrlMock).toHaveBeenCalledTimes(10);
  });

  it("лимит персональный: сосед со своим userId не упирается в чужую корзину", async () => {
    signInAs();
    parseUrlMock.mockResolvedValue(product);
    for (let i = 0; i < 10; i += 1) await POST(postRequest({ url: "https://shop.example/a" }));

    signInAs(); // другой пользователь
    const response = await POST(postRequest({ url: "https://shop.example/a" }));
    expect(response.status).toBe(200);
  });
});

// Шов e2e (тикет 15): фикстурный магазин e2e-shop.test за флагом
// E2E_FIXTURE_SHOP. Ключевое — флаг выключен = поведение прежнее байт-в-байт.
describe("POST /api/v1/parse — фикстурный магазин e2e (E2E_FIXTURE_SHOP)", () => {
  const FIXTURE_URL = "https://e2e-shop.test/product";

  it("флаг выключен: URL фикстурного магазина уходит в обычный parseUrl (прежнее поведение)", async () => {
    signInAs();
    parseUrlMock.mockResolvedValue(product);

    const response = await POST(postRequest({ url: FIXTURE_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: product }); // ответ парсера, не фикстуры
    expect(parseUrlMock).toHaveBeenCalledWith(FIXTURE_URL);
  });

  it("флаг включён + hostname e2e-shop.test → разбор фикстуры ozon.html без сети", async () => {
    vi.stubEnv("E2E_FIXTURE_SHOP", "1");
    signInAs();

    const response = await POST(postRequest({ url: FIXTURE_URL }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    // Настоящий каскад parseHtml: JSON-LD фикстуры Ozon (тесты парсера 05).
    expect(body.data.title).toBe("Смартфон Samsung Galaxy S24 8/256 ГБ графитовый");
    expect(body.data.price).toBe("74990");
    expect(body.data.currency).toBe("RUB");
    expect(body.data.zoneHint).toBe("tech");
    expect(body.data.confidence).toBe(0.9);
    // canonical/domain — от ЗАПРОШЕННОГО url, не от фикстуры.
    expect(body.data.domain).toBe("e2e-shop.test");
    expect(body.data.canonicalUrl).toBe(FIXTURE_URL);
    expect(parseUrlMock).not.toHaveBeenCalled(); // сеть не тронута
  });

  it("флаг включён, но hostname чужой → обычный parseUrl, перехвата нет", async () => {
    vi.stubEnv("E2E_FIXTURE_SHOP", "1");
    signInAs();
    parseUrlMock.mockResolvedValue(product);

    const response = await POST(postRequest({ url: "https://shop.example/rings" }));

    expect(response.status).toBe(200);
    expect(parseUrlMock).toHaveBeenCalledWith("https://shop.example/rings");
  });

  it("флаг включён не отменяет auth: без сессии — 401 и никакой фикстуры", async () => {
    vi.stubEnv("E2E_FIXTURE_SHOP", "1");
    authMock.mockResolvedValue(null);

    const response = await POST(postRequest({ url: FIXTURE_URL }));

    expect(response.status).toBe(401);
    expect(parseUrlMock).not.toHaveBeenCalled();
  });
});
