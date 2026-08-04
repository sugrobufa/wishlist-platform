// Обработчик image.ingest (тикет 06) — чистая функция processImageIngest
// с реальной тест-БД и подменёнными сетью (fakeFetch/lookup из тестов
// парсера) и хранилищем (мок putObject). Воркер её лишь регистрирует.
//
// Ключевые инварианты: фото уходит в СВОЁ S3 ключом items/{roomId}/…,
// пользовательское фото не перетирается (даже в гонке), SSRF-кейсы и
// не-картинки не роняют джобу в вечный ретрай.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import { SafeFetchError } from "../src/server/parser";
import { processImageIngest } from "../src/worker/image-ingest";
import { fakeFetch, lookupTable, publicLookup } from "./parser/testUtils";

const TEST_EMAIL_DOMAIN = "@image-ingest.test";
const IMAGE_URL = "https://cdn.shop.example/product.jpg";
const JPEG_BYTES = Buffer.from("fake-jpeg-bytes-0123456789");

async function createTestItem(photoKey: string | null = null) {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      zonesOff: [],
      shareSlug: `t-${randomUUID().slice(0, 12)}`,
    },
  });
  const item = await prisma.item.create({
    data: {
      roomId: room.id,
      zone: "jewelry",
      state: "WANT",
      title: "Серьги по ссылке",
      photoKey,
      source: "URL",
    },
  });
  return { user, room, item };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** Дефолтные швы: картинка отдаётся, DNS публичный, S3 записывает молча. */
function happyDeps() {
  const putObject = vi.fn(async () => undefined);
  const net = fakeFetch({
    [IMAGE_URL]: { contentType: "image/jpeg", body: JPEG_BYTES },
  });
  return { fetchImpl: net.impl, lookupImpl: publicLookup, putObject };
}

describe("processImageIngest — хэппи-пас", () => {
  it("скачивает через safeFetch, кладёт items/{roomId}/{random}.jpg и пишет photoKey", async () => {
    const { room, item } = await createTestItem();
    const deps = happyDeps();

    const result = await processImageIngest({ itemId: item.id, imageUrl: IMAGE_URL }, deps);

    if (result.status !== "stored") throw new Error(`ожидали stored, а не ${result.status}`);
    expect(result.photoKey).toMatch(new RegExp(`^items/${room.id}/[0-9a-f]{16}\\.jpg$`));

    // S3 получил оригинал байт-в-байт с тем же ключом и типом (Phase 1: без resize).
    expect(deps.putObject).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = deps.putObject.mock.calls[0] as unknown as [
      string,
      Buffer,
      string,
    ];
    expect(key).toBe(result.photoKey);
    expect(Buffer.compare(body, JPEG_BYTES)).toBe(0);
    expect(contentType).toBe("image/jpeg");

    const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.photoKey).toBe(result.photoKey);
  });

  it("content-type с параметрами (image/png; charset=binary) → ключ .png", async () => {
    const { item } = await createTestItem();
    const net = fakeFetch({
      [IMAGE_URL]: { contentType: "image/png; charset=binary", body: JPEG_BYTES },
    });
    const result = await processImageIngest(
      { itemId: item.id, imageUrl: IMAGE_URL },
      { fetchImpl: net.impl, lookupImpl: publicLookup, putObject: vi.fn(async () => undefined) },
    );
    if (result.status !== "stored") throw new Error("ожидали stored");
    expect(result.photoKey).toMatch(/\.png$/);
  });
});

describe("processImageIngest — пользовательское фото приоритетнее", () => {
  it("photoKey уже стоит → skip до всякой сети", async () => {
    const { item } = await createTestItem("items/someroom/0123456789abcdef.jpg");
    const deps = happyDeps();

    const result = await processImageIngest({ itemId: item.id, imageUrl: IMAGE_URL }, deps);
    expect(result).toEqual({ status: "skipped", reason: "photo-exists" });
    expect(deps.putObject).not.toHaveBeenCalled();
  });

  it("гонка: своё фото появилось ВО ВРЕМЯ скачивания — не перетирается", async () => {
    const { room, item } = await createTestItem();
    const userKey = `items/${room.id}/aaaaaaaaaaaaaaaa.jpg`;
    const net = fakeFetch({ [IMAGE_URL]: { contentType: "image/jpeg", body: JPEG_BYTES } });
    // Шов хранилища срабатывает ПОСЛЕ чтения вещи — имитируем пользователя,
    // успевшего загрузить своё фото, пока воркер ходил за магазинным.
    const putObject = vi.fn(async () => {
      await prisma.item.update({ where: { id: item.id }, data: { photoKey: userKey } });
    });

    const result = await processImageIngest(
      { itemId: item.id, imageUrl: IMAGE_URL },
      { fetchImpl: net.impl, lookupImpl: publicLookup, putObject },
    );

    expect(result).toEqual({ status: "skipped", reason: "photo-exists" });
    const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.photoKey).toBe(userKey); // пользовательское фото победило
  });
});

describe("processImageIngest — отказы без вечного ретрая", () => {
  it("вещь удалили, пока джоба ждала → item-missing", async () => {
    const deps = happyDeps();
    const result = await processImageIngest(
      { itemId: "no-such-item", imageUrl: IMAGE_URL },
      deps,
    );
    expect(result).toEqual({ status: "skipped", reason: "item-missing" });
  });

  it("SVG проходит safeFetch (image/*), но ключа не получает — XSS-заслон", async () => {
    const { item } = await createTestItem();
    const net = fakeFetch({
      [IMAGE_URL]: { contentType: "image/svg+xml", body: "<svg onload=alert(1)/>" },
    });
    const putObject = vi.fn(async () => undefined);

    const result = await processImageIngest(
      { itemId: item.id, imageUrl: IMAGE_URL },
      { fetchImpl: net.impl, lookupImpl: publicLookup, putObject },
    );
    expect(result).toEqual({ status: "skipped", reason: "not-image" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("магазин отвечает 404 → fetch-failed (повтор не поможет)", async () => {
    const { item } = await createTestItem();
    const net = fakeFetch({ [IMAGE_URL]: { status: 404 } });
    const result = await processImageIngest(
      { itemId: item.id, imageUrl: IMAGE_URL },
      { fetchImpl: net.impl, lookupImpl: publicLookup, putObject: vi.fn(async () => undefined) },
    );
    expect(result).toEqual({ status: "skipped", reason: "fetch-failed" });
  });

  it("imageUrl в приватную сеть режется safeFetch'ем → fetch-failed, S3 не тронут", async () => {
    const { item } = await createTestItem();
    const deps = {
      fetchImpl: fakeFetch({}).impl,
      lookupImpl: lookupTable({ "cdn.shop.example": ["127.0.0.1"] }),
      putObject: vi.fn(async () => undefined),
    };
    const result = await processImageIngest({ itemId: item.id, imageUrl: IMAGE_URL }, deps);
    expect(result).toEqual({ status: "skipped", reason: "fetch-failed" });
    expect(deps.putObject).not.toHaveBeenCalled();

    const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.photoKey).toBeNull();
  });

  it("мусор вместо {itemId, imageUrl} → bad-data", async () => {
    expect(await processImageIngest(null, happyDeps())).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
    expect(await processImageIngest({ itemId: "x", imageUrl: "не url" }, happyDeps())).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
  });
});

describe("processImageIngest — переходные ошибки уходят в ретрай BullMQ", () => {
  it("сетевая ошибка — исключение (SafeFetchError), джоба упадёт и повторится", async () => {
    const { item } = await createTestItem();
    await expect(
      processImageIngest(
        { itemId: item.id, imageUrl: IMAGE_URL },
        // пустая таблица маршрутов: fetch кидает TypeError → network
        { fetchImpl: fakeFetch({}).impl, lookupImpl: publicLookup },
      ),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("5xx магазина — исключение (мог быть икнувший CDN)", async () => {
    const { item } = await createTestItem();
    const net = fakeFetch({ [IMAGE_URL]: { status: 503 } });
    await expect(
      processImageIngest(
        { itemId: item.id, imageUrl: IMAGE_URL },
        { fetchImpl: net.impl, lookupImpl: publicLookup },
      ),
    ).rejects.toThrow(/503/);
  });
});
