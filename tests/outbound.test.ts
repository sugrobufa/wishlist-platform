// Учёт переходов в магазин (тикет 37) — сервис и роут с реальной тест-БД.
// Проверяется одно правило и его следствия: переход записывается ровно тогда,
// когда ссылку МОЖНО БЫЛО отдать гостю (dto/guest-items → ключ shop).
// Спрятанная вещь (инвариант №5), «люблю» и «хочу» со скрытой ценой
// (инвариант №8) перехода не порождают — и роут отвечает на них так же, как
// на удачный, чтобы по коду ответа нельзя было узнать, что вещь существует.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { allowOutboundClick, recordOutboundClick } from "../src/server/services/outbound";
import { POST as outboundRoute } from "../src/app/api/v1/items/[id]/outbound/route";

const TEST_EMAIL_DOMAIN = "@outbound.test";

const SHOP_URL = "https://www.goldapple.ru/19000175823";

async function createTestRoom() {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  return prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `o-${randomUUID().slice(0, 12)}`,
    },
  });
}

/** Вещь «хочу», пришедшая по ссылке из магазина, — ссылку гостю отдаём. */
async function createShopItem(
  roomId: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: {
      roomId,
      zone: "perfume",
      inHall: false,
      title: "Nº7 Eau de Parfum",
      price: "14900",
      currency: "RUB",
      source: "URL",
      url: SHOP_URL,
      canonicalUrl: SHOP_URL,
      domain: "goldapple.ru",
      ...overrides,
    },
  });
}

const clicksFor = (itemId: string) => prisma.outboundClick.count({ where: { itemId } });

/** Уникальный IP на тест: буксует только своя корзина rate limit'а. */
const uniqueIp = () => `test-${randomUUID()}`;

function outboundRequest(itemId: string, body: unknown, ip = uniqueIp()) {
  const request = new NextRequest(`http://localhost/api/v1/items/${itemId}/outbound`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return outboundRoute(request, { params: Promise.resolve({ id: itemId }) });
}

// У OutboundClick нет relation'а на вещь (itemId — просто колонка), каскад её
// строки не уносит: чистим их сами, до удаления пользователей.
async function cleanup() {
  const items = await prisma.item.findMany({
    where: { room: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } },
    select: { id: true },
  });
  if (items.length > 0) {
    await prisma.outboundClick.deleteMany({
      where: { itemId: { in: items.map((item) => item.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("recordOutboundClick", () => {
  it("«хочу» с открытой ценой и ссылкой: строка в OutboundClick", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id);

    expect(await recordOutboundClick({ itemId: item.id, context: "ZONE" })).toBe(true);

    const rows = await prisma.outboundClick.findMany({ where: { itemId: item.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.context).toBe("ZONE");
    // В строке нет ни гостя, ни комнаты — только вещь, место и время.
    expect(rows[0]?.catalogProductId).toBeNull();
    expect(rows[0]?.subId).toBeNull();
  });

  it("спрятанная вещь: перехода нет (инвариант №5)", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id, { hidden: true });

    expect(await recordOutboundClick({ itemId: item.id, context: "ZONE" })).toBe(false);
    expect(await clicksFor(item.id)).toBe(0);
  });

  it.each(["ME", "NONE"] as const)(
    "«хочу» со скрытой ценой (%s): ссылки не давали — перехода нет",
    async (priceVisibility) => {
      const room = await createTestRoom();
      const item = await createShopItem(room.id, { priceVisibility });

      expect(await recordOutboundClick({ itemId: item.id, context: "ZONE" })).toBe(false);
      expect(await clicksFor(item.id)).toBe(0);
    },
  );

  it("«люблю»: перехода нет — у этой вещи магазина не бывает", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id, { inHall: true, price: null, currency: null });

    expect(await recordOutboundClick({ itemId: item.id, context: "RESERVE_PAGE" })).toBe(false);
    expect(await clicksFor(item.id)).toBe(0);
  });

  it("вещь без канонического адреса: переходить некуда", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id, {
      source: "MANUAL",
      canonicalUrl: null,
      domain: null,
    });

    expect(await recordOutboundClick({ itemId: item.id, context: "ZONE" })).toBe(false);
    expect(await clicksFor(item.id)).toBe(0);
  });

  it("несуществующей вещи — false, без падения", async () => {
    expect(await recordOutboundClick({ itemId: "no-such-item", context: "ZONE" })).toBe(false);
  });
});

describe("POST /api/v1/items/{id}/outbound", () => {
  it("записывает переход и отвечает 204 без тела", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id);

    const response = await outboundRequest(item.id, { context: "RESERVE_PAGE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const rows = await prisma.outboundClick.findMany({ where: { itemId: item.id } });
    expect(rows.map((row) => row.context)).toEqual(["RESERVE_PAGE"]);
  });

  it("id вещи берётся из адреса, телу он не доверяется", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id);
    const other = await createShopItem(room.id, { title: "Дорожный флакон" });

    expect((await outboundRequest(item.id, { context: "ZONE", itemId: other.id })).status).toBe(
      204,
    );
    expect(await clicksFor(item.id)).toBe(1);
    expect(await clicksFor(other.id)).toBe(0);
  });

  it("спрятанная вещь отвечает тем же 204 — по коду её не нащупать", async () => {
    const room = await createTestRoom();
    const hidden = await createShopItem(room.id, { hidden: true });

    const onHidden = await outboundRequest(hidden.id, { context: "ZONE" });
    const onNothing = await outboundRequest(`item-${randomUUID()}`, { context: "ZONE" });

    expect(onHidden.status).toBe(204);
    expect(onNothing.status).toBe(204);
    expect(await clicksFor(hidden.id)).toBe(0);
  });

  it("незнакомое место перехода — 400 и ни одной строки", async () => {
    const room = await createTestRoom();
    const item = await createShopItem(room.id);

    const response = await outboundRequest(item.id, { context: "WHEREVER" });
    expect(response.status).toBe(400);
    expect(await clicksFor(item.id)).toBe(0);
  });
});

describe("бюджет переходов", () => {
  it("30 нажатий на IP, дальше отказ — корзина своя, не бронная", async () => {
    // Проверяем сам лимитер, а не роут: 30 запросов в БД заняли бы секунды, за
    // которые корзина успела бы пополниться, и тест начал бы мигать.
    const ip = uniqueIp();
    for (let i = 0; i < 30; i += 1) {
      expect(await allowOutboundClick(ip)).toBe(true);
    }
    expect(await allowOutboundClick(ip)).toBe(false);
  });
});
