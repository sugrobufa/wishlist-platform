// Тикет 06: createItem с source=URL (url/canonicalUrl/domain + очередь
// image.ingest) и дедуп findDuplicateByUrl — через публичные функции сервиса
// с реальной тест-БД (самый высокий шов, spec Phase 1). Очередь замокана:
// контракт «поставили джобу {itemId, imageUrl}» проверяем без Redis;
// сам обработчик — tests/worker.image-ingest.test.ts.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

vi.mock("@/server/queues", () => ({
  enqueueImageIngest: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { enqueueImageIngest } from "../src/server/queues";
import { createItem, findDuplicateByUrl } from "../src/server/services/items";

const enqueueMock = vi.mocked(enqueueImageIngest);

const TEST_EMAIL_DOMAIN = "@items-create-url.test";

async function createTestUser() {
  return prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
}

async function createTestRoom() {
  const user = await createTestUser();
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      zonesOff: [],
      shareSlug: `t-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  enqueueMock.mockClear();
});

const urlInput = (overrides: Record<string, unknown> = {}) => ({
  inHall: false,
  zone: "jewelry",
  title: "Серьги-кольца",
  price: "14900",
  currency: "RUB",
  source: "URL",
  url: "https://WWW.Ozon.ru/product/sergi-123/?utm_source=share&spm=abc&size=17",
  ...overrides,
});

describe("createItem — source=URL", () => {
  it("пишет source, url как дан, canonicalUrl нормализованным и domain без www", async () => {
    const { user } = await createTestRoom();
    const item = await createItem(user.id, urlInput());

    expect(item.source).toBe("URL");
    expect(item.url).toBe("https://WWW.Ozon.ru/product/sergi-123/?utm_source=share&spm=abc&size=17");
    // normalize: хост в нижний регистр, utm/spm выброшены, остальное отсортировано.
    expect(item.canonicalUrl).toBe("https://www.ozon.ru/product/sergi-123/?size=17");
    expect(item.domain).toBe("ozon.ru");
  });

  it("контракт тикета 04 не тронут: без source — MANUAL, canonicalUrl/domain пусты", async () => {
    const { user } = await createTestRoom();
    const item = await createItem(user.id, {
      inHall: false,
      zone: "jewelry",
      title: "Браслет",
      price: "9900",
      currency: "RUB",
      url: "https://shop.example/bracelet?utm_source=x",
    });

    expect(item.source).toBe("MANUAL");
    expect(item.canonicalUrl).toBeNull();
    expect(item.domain).toBeNull();
  });

  it("source=URL без url — ZodError («родилась из ссылки» без ссылки не бывает)", async () => {
    const { user } = await createTestRoom();
    await expect(createItem(user.id, urlInput({ url: undefined }))).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it("LOVE по ссылке тоже работает: source=URL, цены нет даже в инпуте после strip", async () => {
    const { user } = await createTestRoom();
    const item = await createItem(user.id, {
      inHall: true,
      zone: "jewelry",
      title: "Колье",
      source: "URL",
      url: "https://shop.example/necklace",
      price: "9900", // лишнее для LOVE — отбрасывается схемой (инвариант §8)
    });
    expect(item.source).toBe("URL");
    expect(item.canonicalUrl).toBe("https://shop.example/necklace");
    expect(item.price).toBeNull();
  });

  it("чужие значения source (PHOTO/CATALOG/…) в форме не проходят", async () => {
    const { user } = await createTestRoom();
    await expect(createItem(user.id, urlInput({ source: "CATALOG" }))).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});

describe("createItem — очередь image.ingest", () => {
  it("source=URL + imageUrl без своего фото → джоба {itemId, imageUrl}", async () => {
    const { user } = await createTestRoom();
    const item = await createItem(
      user.id,
      urlInput({ imageUrl: "https://cdn.ozon.example/sergi.jpg" }),
    );

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      itemId: item.id,
      imageUrl: "https://cdn.ozon.example/sergi.jpg",
    });
  });

  it("своё фото приоритетнее: при photoKey джоба не ставится", async () => {
    const { user, room } = await createTestRoom();
    await createItem(
      user.id,
      urlInput({
        imageUrl: "https://cdn.ozon.example/sergi.jpg",
        photoKey: `items/${room.id}/0123456789abcdef.jpg`,
      }),
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("без imageUrl и при source=MANUAL джобы нет", async () => {
    const { user } = await createTestRoom();
    await createItem(user.id, urlInput());
    await createItem(user.id, {
      inHall: false,
      zone: "jewelry",
      title: "Ручная",
      price: "100",
      currency: "RUB",
      imageUrl: "https://cdn.ozon.example/manual.jpg", // MANUAL: поле игнорируется
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("findDuplicateByUrl — дедуп по canonicalUrl", () => {
  it("находит вещь своей комнаты по эквивалентной ссылке (трекинг-мусор не мешает)", async () => {
    const { user } = await createTestRoom();
    const item = await createItem(user.id, urlInput({ title: "Оригинал" }));

    // Тот же товар: другой регистр хоста, другой порядок параметров, свои utm.
    const found = await findDuplicateByUrl(
      user.id,
      "https://www.ozon.ru/product/sergi-123/?size=17&utm_campaign=repeat",
    );
    expect(found).toEqual({ id: item.id, title: "Оригинал", zone: "jewelry" });
  });

  it("чужая комната не видна: у соседа с той же ссылкой дубликата нет", async () => {
    const a = await createTestRoom();
    const b = await createTestRoom();
    await createItem(a.user.id, urlInput());

    expect(await findDuplicateByUrl(b.user.id, urlInput().url)).toBeNull();
  });

  it("MANUAL-вещь с url, но без canonicalUrl, дубликатом не считается", async () => {
    const { user } = await createTestRoom();
    await createItem(user.id, {
      inHall: false,
      zone: "jewelry",
      title: "Ручная с url",
      price: "100",
      currency: "RUB",
      url: "https://shop.example/manual-thing",
    });
    expect(await findDuplicateByUrl(user.id, "https://shop.example/manual-thing")).toBeNull();
  });

  it("мусорный URL и пользователь без комнаты — честный null, не исключение", async () => {
    const { user } = await createTestRoom();
    expect(await findDuplicateByUrl(user.id, "не ссылка вовсе")).toBeNull();

    const homeless = await createTestUser();
    expect(await findDuplicateByUrl(homeless.id, urlInput().url)).toBeNull();
  });
});
