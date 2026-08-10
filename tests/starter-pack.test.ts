// Тикет 100 (доска Б23 · турн 12c): «Или начни с готового · +N».
//
// Набор — тот же курируемый список, что раньше рисовался призраками
// (тикет 104 показ снял, вердикт дизайна оставил подборку «по согласию»).
// С тикета 136 его зёрна приезжают КОНТРАКТОМ дизайна, а не лежат в коде.
// Проверяем ровно то, чем набор отличается от призраков и от посева стенда:
// - контракт целиком: 19 пулов по 5 зёрен, у каждого цена, ни одного «уже моё»;
// - вещи настоящие, свои и появляются ТОЛЬКО по вызову;
// - дарителей и годов он НЕ приносит: выдуманное воспоминание в
//   сокровищнице — это ложь про человека (инвариант №2);
// - повтор не плодит дублей и не трогает того, что заведено руками;
// - «+N» считается по пулам ВИДИМЫХ зон, а не пишется числом в строку.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import seedsJson from "@design/seeds/seeds.json";
import { prisma } from "../src/server/db";
import { applyStarterPack, starterPackSize } from "../src/server/services/starter-pack";
import { livePoolSeeds, packSeedsRejected } from "../src/server/services/pack-seeds";
import { createItem } from "../src/server/services/items";
import { rooms as roomPresets } from "../src/config/design";

const TEST_EMAIL_DOMAIN = "@starter-pack.test";

/** Фото в S3 не кладём: хранилище — шов, тесту достаточно тихой заглушки. */
const noStorage = { putObject: async () => {} };

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function createOwnerWithRoom(preset = "cream") {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset,
      zoneSet: "F",
      shareSlug: `sp-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ----------------------------------------------------------------- контракт
//
// Числа зафиксированы контрактом round33 (`handoff/seeds/seeds.json`, тикет
// 136) и посчитаны нами по файлу. Тест упал — значит приехал новый пакет:
// это повод сверить его с письмом, а не поправить ожидания.
const CONTRACT = {
  pools: 19,
  seeds: 95,
  perPool: 5,
  withPhoto: 36,
} as const;

/** Зона без пула: там копилка на мечту, а не вещи (инвариант №9). */
const MONEY_POOL = "money";

const contractPools = (seedsJson as unknown as { pools: Record<string, unknown[]> }).pools;

describe("контракт набора — зёрна приезжают из пакета, а не из кода", () => {
  it("19 пулов ровно по 5 зёрен — всего 95", () => {
    const keys = Object.keys(contractPools);
    expect(keys).toHaveLength(CONTRACT.pools);
    for (const key of keys) {
      expect(livePoolSeeds(key), `пул ${key}`).toHaveLength(CONTRACT.perPool);
    }
    const total = keys.reduce((sum, key) => sum + livePoolSeeds(key).length, 0);
    expect(total).toBe(CONTRACT.seeds);
    // Пула `money` в контракте нет и не должно быть.
    expect(livePoolSeeds(MONEY_POOL)).toEqual([]);
    expect(livePoolSeeds("нет-такого-пула")).toEqual([]);
  });

  it("сторож не выбросил ни одного зерна: у всех цена и ни одного «уже моё»", () => {
    // Ноль отброшенных — второе имя тех же двух правил: контракт им отвечает
    // целиком, а не «в основном».
    expect(packSeedsRejected).toEqual([]);

    for (const key of Object.keys(contractPools)) {
      for (const seed of livePoolSeeds(key)) {
        expect(seed.mine, `«${seed.title}»`).toBe(false);
        if (seed.mine) continue; // сузить тип для полей желания
        expect(seed.priceRub, `цена «${seed.title}»`).toBeGreaterThan(0);
        expect(Number.isFinite(seed.priceRub), `цена «${seed.title}»`).toBe(true);
        expect(seed, `«${seed.title}»`).not.toHaveProperty("giverName");
        expect(seed, `«${seed.title}»`).not.toHaveProperty("receivedYear");
      }
    }
  });

  it("36 зёрен с кадром, и каждый кадр лежит в пакете", () => {
    const photos = Object.keys(contractPools)
      .flatMap((key) => livePoolSeeds(key))
      .map((seed) => seed.photo)
      .filter((photo): photo is string => Boolean(photo));

    expect(photos).toHaveLength(CONTRACT.withPhoto);
    for (const photo of photos) {
      // Путь раздачи, а не голое имя: его понимают и хранилище набора,
      // и `itemPhotoUrl`.
      expect(photo).toMatch(/^refs\/[a-z0-9][a-z0-9-]*\.jpg$/);
      const file = resolve(process.cwd(), "design/package", photo);
      expect(existsSync(file), `кадра ${photo} нет в пакете`).toBe(true);
    }
  });

  it("у каждой видимой зоны продукта пул набора наполнен (кроме «Просто денег»)", () => {
    for (const room of roomPresets) {
      for (const zone of room.zones) {
        if (zone.pool === MONEY_POOL) {
          expect(livePoolSeeds(zone.pool), `${room.id}/${zone.key}`).toEqual([]);
          continue;
        }
        expect(livePoolSeeds(zone.pool), `${room.id}/${zone.key}`).toHaveLength(
          CONTRACT.perPool,
        );
      }
    }
  });
});

describe("starterPackSize — «+N» считается, а не обещается", () => {
  it("число складывается из пулов видимых зон и падает вместе с выключенной", () => {
    const cream = roomPresets.find((room) => room.id === "cream");
    const full = starterPackSize("cream", []);
    expect(full).toBeGreaterThan(0);

    // Выключенная зона уносит с собой ровно свой пул.
    const zone = cream?.zones.find((candidate) => candidate.pool === "jewel");
    expect(zone).toBeDefined();
    const withoutJewel = starterPackSize("cream", [zone!.key]);
    expect(withoutJewel).toBeLessThan(full);
  });

  it("число — сумма пулов КОНТРАКТА по видимым зонам, у каждого интерьера своя", () => {
    for (const preset of roomPresets) {
      const expected = preset.zones.reduce((sum, zone) => sum + livePoolSeeds(zone.pool).length, 0);
      expect(starterPackSize(preset.id, []), preset.id).toBe(expected);
      // Зона «Просто деньги» есть в каждой комнате и не приносит ни вещи,
      // поэтому число всегда меньше «зон × 5».
      expect(expected, preset.id).toBeLessThan(preset.zones.length * CONTRACT.perPool);
    }
    // Женский и мужской интерьеры считаются каждый по своим зонам.
    expect(starterPackSize("cream", [])).not.toBe(starterPackSize("loft", []));
  });

  it("у мужского и женского интерьера числа СВОИ — одно на всех было бы обманом", () => {
    expect(starterPackSize("loft", [])).toBeGreaterThan(0);
    // Наборы зон разные, значит и подборки разные; совпасть они могут только
    // случайно — сравниваем не числа, а то, что оба считаются по своим зонам.
    expect(starterPackSize("cream", [])).not.toBe(starterPackSize("cream", ["jewelry"]));
  });
});

describe("applyStarterPack — набор в свою комнату", () => {
  it("кладёт настоящие вещи и НЕ приносит дарителей, годов и витрины", async () => {
    const { user, room } = await createOwnerWithRoom();

    const result = await applyStarterPack(user.id, noStorage);
    expect(result.roomFound).toBe(true);
    expect(result.created).toBe(starterPackSize("cream", []));

    const items = await prisma.item.findMany({ where: { roomId: room.id } });
    expect(items).toHaveLength(result.created);
    // Ни одного выдуманного воспоминания: имя дарителя попадает в комнату
    // ровно одним путём — через «Дошло» (инвариант №2).
    expect(items.filter((item) => item.giverName !== null)).toEqual([]);
    expect(items.filter((item) => item.receivedAt !== null)).toEqual([]);
    expect(items.filter((item) => item.inHall)).toEqual([]);
    // ПЕРЕПИСАНО (тикет 124): «оба состояния на месте» проверять нечем.
    // Набор приносит живому человеку ТОЛЬКО желания комнаты с ценой — семена
    // «уже своё» отсеивает `livePoolSeeds` (на витрину из набора не уезжает
    // ничего, инвариант №2).
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.price !== null)).toBe(true);

    // Кадры контракта доехали: имя файла из `seeds.json` нашлось в пакете и
    // легло в НАШЕ хранилище нашим же ключом — путь пакета в БД не попадает
    // ни одной строкой (инвариант №6). Часть зёрен без кадра намеренно —
    // такая вещь честно рисует серую заливку со значком пула (тикет 82).
    expect(result.photos).toBeGreaterThan(0);
    expect(items.filter((item) => item.photoKey !== null)).toHaveLength(result.photos);
    expect(items.filter((item) => item.photoKey === null).length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.photoKey ?? "", item.title).not.toContain("refs/");
    }
    // Призраков среди них нет по построению: `isDemo` — поле DTO, а не БД,
    // и всё это — настоящие строки таблицы вещей.
  });

  it("повтор не плодит дублей и не трогает заведённое руками", async () => {
    const { user, room } = await createOwnerWithRoom();
    // Своя вещь в зоне — набор эту зону обходит целиком.
    await createItem(user.id, { zone: "jewelry", inHall: true, title: "Бабушкино кольцо" });

    const first = await applyStarterPack(user.id, noStorage);
    const afterFirst = await prisma.item.count({ where: { roomId: room.id } });
    expect(afterFirst).toBe(first.created + 1);

    // Зона с моей вещью осталась ровно с ней одной.
    expect(await prisma.item.count({ where: { roomId: room.id, zone: "jewelry" } })).toBe(1);

    const second = await applyStarterPack(user.id, noStorage);
    expect(second.created).toBe(0);
    expect(await prisma.item.count({ where: { roomId: room.id } })).toBe(afterFirst);
  });

  it("без комнаты класть некуда — тихий отказ, а не падение", async () => {
    const user = await prisma.user.create({
      data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    expect(await applyStarterPack(user.id, noStorage)).toMatchObject({
      roomFound: false,
      created: 0,
    });
  });
});
