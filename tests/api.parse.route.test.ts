// Роут POST /api/v1/parse (тикет 06): auth-only, Zod на вход, rate limit
// 10/мин на userId, маппинг ParserError → 422/429. Сам парсер здесь мок —
// его конвейер покрыт tests/parser/* (тикет 05); роут тонкий, тестируем
// только его собственные ветки.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
