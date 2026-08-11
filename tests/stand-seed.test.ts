// Тикет 61 (посев стенда): комната владельца наполняется настоящими вещами.
//
// Под замком главное:
//   • ЗАЩИТА повторяет сброс стенда дословно: без QUICK_LOGIN_ENABLED=true
//     адрес /dev-login?seed=1 отвечает 404 и НИЧЕГО не создаёт; почта — только
//     из окружения, чужую комнату этим адресом не наполнить;
//   • ПОСЕВ ТОЛЬКО ДОБАВЛЯЕТ: зона, где уже есть вещь, не трогается вовсе;
//   • ИДЕМПОТЕНТНОСТЬ: второй прогон не плодит дубли;
//   • ИСТОЧНИК КАЖДОЙ ПОЛОВИНЫ (тикет 175): вещи КОМНАТЫ — из контракта
//     дизайна, поимённо и по ценам, ровно те же, что достаются живому
//     человеку; вещи СОКРОВИЩНИЦЫ — из демо-пулов и только зёрна «уже своё».
//     Желания демо-пулов в комнату больше не попадают;
//   • СОСТАВ: оба места в каждой зоне; зона с шестью и более вещами (правило
//     тикета 59 иначе негде увидеть); «уже своё» с дарителем и годом — в зале
//     славы;
//   • ФОТО лежат в НАШЕМ S3 ключом items/{roomId}/… — пути дизайн-пакета
//     («refs/p-*.jpg») в БД не попадают ни одной строкой (инвариант №6);
//     кадр, которого нет файлом в пакете, отбрасывается вместе с картинкой,
//     но не с вещью, и считается числом в отчёте.
//
// Стенд как в tests/quick-login.test.ts: настоящая dev-БД, страница
// /dev-login вместо мока роутера. Хранилище — шов (StandSeedStorage): тесты
// БД не должны зависеть от поднятого MinIO, зато видят каждый ключ и каждый
// байт, которые посев туда отправил.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { attemptQuickLogin, type QuickLoginEnv } from "@/server/quick-login";
import { seedStandRoom, type StandSeedResult, type StandSeedStorage } from "@/server/services/stand-seed";
import { listHallItems } from "@/server/services/items";
import {
  livePoolSeeds,
  packagePhotoFor,
  packSeedsPhotosMissing,
  standPoolSeeds,
} from "@/server/services/pack-seeds";
import { demoPools } from "@/config/demo-pools";
import { rooms as roomPresets } from "@/config/design";
import DevLoginPage from "../src/app/dev-login/page";
import { prisma } from "../src/server/db";

// ПОЧЕМУ У ФАЙЛА СВОЙ ТАЙМАУТ. С тикета 175 посев кладёт в комнату 91 вещь
// вместо 55 (комната — контрактом, сокровищница — демо-пулами), и каждая идёт
// продуктовой дверью `createItem`: своя запись, своё событие ленты, своя
// инвалидация кэша. В одиночку файл укладывается в три с половиной секунды,
// но под полным прогоном (четыре форка на одной dev-БД) самый тяжёлый тест
// упёрся в общие 15 с и упал таймаутом — при том что проверка отработала
// верно. Это ровно тот случай, про который написан комментарий к testTimeout
// в vitest.config.ts: узкое место — конкуренция за базу, а не сама проверка.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const TEST_EMAIL_DOMAIN = "@stand-seed.test";
const OWNER_EMAIL = `owner${TEST_EMAIL_DOMAIN}`;
const STRANGER_EMAIL = `stranger${TEST_EMAIL_DOMAIN}`;
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";
const PRESET = "cream";

/** Правило тикета 59: «ещё N» загорается, когда своих вещей больше пяти. */
const SHEET_TILES = 5;

function goodEnv(overrides: QuickLoginEnv = {}): QuickLoginEnv {
  return {
    QUICK_LOGIN_ENABLED: "true",
    QUICK_LOGIN_SECRET: "",
    QUICK_LOGIN_EMAIL: OWNER_EMAIL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    ...overrides,
  };
}

/** Хранилище-шпион: запоминает всё, что посев отправил в S3. */
function spyStorage(): StandSeedStorage & { puts: Array<{ key: string; type: string; body: Uint8Array }> } {
  const puts: Array<{ key: string; type: string; body: Uint8Array }> = [];
  return {
    puts,
    putObject: async (key, contentType, body) => {
      puts.push({ key, type: contentType, body });
    },
  };
}

const ENV_KEYS = ["QUICK_LOGIN_ENABLED", "QUICK_LOGIN_SECRET", "QUICK_LOGIN_EMAIL"] as const;
const savedEnv = new Map<string, string | undefined>();

function setProcessEnv(env: QuickLoginEnv): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreProcessEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
}

async function openPage(params: Record<string, string | string[]> = {}) {
  return DevLoginPage({ searchParams: Promise.resolve(params) });
}

async function expectNotFound(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(String((error as { digest?: string }).digest ?? "")).toBe(NOT_FOUND_DIGEST);
    return;
  }
  throw new Error("ожидался 404, но страница отрисовалась");
}

async function expectRedirect(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(String((error as { digest?: string }).digest ?? "")).toContain("NEXT_REDIRECT");
    return;
  }
  throw new Error("ожидался редирект, но страница отрисовалась");
}

async function createUserWithRoom(email: string, preset: string = PRESET) {
  const user = await prisma.user.create({ data: { email, displayName: "Мила" } });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset,
      zoneSet: "F",
      shareSlug: `ss${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    },
  });
  return { user, room };
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((entry) => entry.id);
  await prisma.verificationToken.deleteMany({
    where: { identifier: { endsWith: TEST_EMAIL_DOMAIN } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** Зоны пресета, как их видит продукт (пресет уже без скрытых зон). */
function presetZones(preset: string = PRESET) {
  const room = roomPresets.find((candidate) => candidate.id === preset);
  if (!room) throw new Error(`пресета ${preset} нет в rooms.json`);
  return room.zones;
}

/** Сколько вещей даёт пул посеву — обе половины вместе (тикет 175). */
function poolSize(poolKey: string): number {
  return standPoolSeeds(poolKey).length;
}

/** Названия желаний пула — контракт дизайна, как у живого человека. */
function contractTitles(poolKey: string): string[] {
  return livePoolSeeds(poolKey).map((seed) => seed.title);
}

/** Названия «уже своё» пула — демо-пулы, вторая половина посева. */
function hallTitles(poolKey: string): string[] {
  const pool = Object.hasOwn(demoPools, poolKey) ? demoPools[poolKey]! : [];
  return pool.filter((seed) => seed.mine).map((seed) => seed.title);
}

afterEach(() => {
  restoreProcessEnv();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ------------------------------------------------------------------ защита

describe("защита посева — ровно та же, что у сброса стенда", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("без QUICK_LOGIN_ENABLED адрес ?seed=1 отвечает 404 и НИЧЕГО не создаёт", async () => {
    const owner = await createUserWithRoom(OWNER_EMAIL);
    setProcessEnv({});

    await expectNotFound(openPage({ seed: "1" }));

    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(0);
  });

  it("флаг выключен — не помогает и верный ключ в адресе", async () => {
    const owner = await createUserWithRoom(OWNER_EMAIL);
    setProcessEnv({ QUICK_LOGIN_ENABLED: "false", QUICK_LOGIN_EMAIL: OWNER_EMAIL });

    await expectNotFound(openPage({ seed: "1", key: "какой-угодно" }));

    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(0);
  });

  it("почта из env: чужую комнату этим адресом не наполнить", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const stranger = await createUserWithRoom(STRANGER_EMAIL);
    setProcessEnv(goodEnv());

    // Почта соседа В ПАРАМЕТРАХ запроса — на выбор комнаты она не влияет никак.
    await expectRedirect(openPage({ seed: "1", email: STRANGER_EMAIL, identifier: STRANGER_EMAIL }));

    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBeGreaterThan(0);
    expect(await prisma.item.count({ where: { roomId: stranger.room.id } })).toBe(0);
  });

  it("сервис без флага не сеет — выключатель на месте", async () => {
    // Решение «сеять» принимает страница входа (тикет 70), сервис остаётся
    // механизмом с явным флагом: позвать его без посева можно, и это нужно
    // всем, кому незачем ходить в S3 на каждом входе.
    const owner = await createUserWithRoom(OWNER_EMAIL);

    const result = await attemptQuickLogin({ env: goodEnv() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed).toBeNull();
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(0);
  });

  it("голый /dev-login наполняет комнату — без всякого параметра (тикет 70)", async () => {
    // Причина замечания 4 приёмки 07.08: посев ждал `?seed=1`, владелец входил
    // обычной ссылкой, и на стенде все тринадцать зон стояли пустыми —
    // с демо-призраками вместо вещей.
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    setProcessEnv(goodEnv());

    await expectRedirect(openPage());

    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBeGreaterThan(0);
  });

  it("повторный вход в наполненную комнату дублей не плодит", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    setProcessEnv(goodEnv());

    await expectRedirect(openPage());
    const afterFirst = await prisma.item.count({ where: { roomId: owner.room.id } });
    await expectRedirect(openPage());

    expect(afterFirst).toBeGreaterThan(0);
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(afterFirst);
  });

  it("пользователя ещё нет — не отказ, а честное «нечего наполнять»", async () => {
    const result = await seedStandRoom(OWNER_EMAIL, spyStorage());

    expect(result).toMatchObject({ userFound: false, roomFound: false, itemsCreated: 0 });
  });

  it("комнаты ещё нет (онбординг не пройден) — тоже ничего не создаётся", async () => {
    const user = await prisma.user.create({ data: { email: OWNER_EMAIL } });

    const result = await seedStandRoom(OWNER_EMAIL, spyStorage());

    expect(result).toMatchObject({ userFound: true, roomFound: false, itemsCreated: 0 });
    // Комнаты нет — значит вещам не к чему привязаться, и появиться им негде.
    // Прежде здесь стоял ГЛОБАЛЬНЫЙ `item.count()`, сравниваемый сам с собой:
    // проверка ничего не утверждала и при этом шаталась — соседние файлы тестов
    // идут по той же БД параллельно и меняли число между двумя запросами
    // (упало 07.08 на 37 против 38). Считаем то, что относится к делу.
    expect(await prisma.room.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.item.count({ where: { room: { userId: user.id } } })).toBe(0);
  });
});

// -------------------------------------------------------- состав посева

describe("состав посева", () => {
  let roomId: string;
  let result: StandSeedResult;
  let storage: ReturnType<typeof spyStorage>;

  beforeAll(async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await cleanup();
    const owner = await createUserWithRoom(OWNER_EMAIL);
    roomId = owner.room.id;
    storage = spyStorage();
    result = await seedStandRoom(OWNER_EMAIL, storage);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("в комнате появились настоящие вещи — по пулу на каждую зону", async () => {
    expect(result).toMatchObject({ userFound: true, roomFound: true });
    expect(result.itemsCreated).toBeGreaterThan(0);
    expect(await prisma.item.count({ where: { roomId } })).toBe(result.itemsCreated);

    for (const zone of presetZones()) {
      const created = await prisma.item.count({ where: { roomId, zone: zone.key } });
      const expected = poolSize(zone.pool) + (zone.key === "anything" ? poolSize(result.spilloverPool ?? "") : 0);
      expect(created, `зона ${zone.key}`).toBe(expected);
    }
  });

  it("зона без пула («Просто деньги») остаётся пустой, а не выдумывает вещи", async () => {
    const money = result.zones.find((zone) => zone.zone === "money");
    expect(money).toMatchObject({ skipped: "no-pool", created: 0 });
    expect(await prisma.item.count({ where: { roomId, zone: "money" } })).toBe(0);
  });

  // ПЕРЕПИСАНО (тикет 124): «оба состояния в каждой зоне» проверять нечем.
  // Стенду по-прежнему нужны ОБА МЕСТА — иначе показывать нечего ни комнате,
  // ни сокровищнице. С тикета 175 половины приезжают из РАЗНЫХ источников
  // (комната — контракт, сокровищница — демо-пулы), и обе обязаны доехать в
  // каждую засеянную зону: пустая половина здесь значит оборванный источник.
  it("на стенде есть и вещи комнаты, и вещи сокровищницы", async () => {
    expect(await prisma.item.count({ where: { roomId, inHall: true } })).toBeGreaterThan(0);
    expect(await prisma.item.count({ where: { roomId, inHall: false } })).toBeGreaterThan(0);

    for (const zone of result.zones.filter((entry) => entry.created > 0)) {
      expect(zone.hall, `сокровищница в ${zone.zone}`).toBeGreaterThan(0);
      expect(zone.room, `комната в ${zone.zone}`).toBeGreaterThan(0);
    }
  });

  it("у «хочу» есть цена и валюта, у «люблю» цены нет вовсе (инвариант №8)", async () => {
    const wants = await prisma.item.findMany({ where: { roomId, inHall: false } });
    expect(wants.length).toBeGreaterThan(0);
    for (const item of wants) {
      expect(item.price, item.title).not.toBeNull();
      expect(Number(item.price), item.title).toBeGreaterThan(0);
      expect(item.currency).toBe("RUB");
    }

    const loves = await prisma.item.findMany({ where: { roomId, inHall: true } });
    for (const item of loves) {
      expect(item.price, item.title).toBeNull();
      expect(item.currency, item.title).toBeNull();
    }
  });

  it("есть зона с ШЕСТЬЮ и более вещами — иначе правило тикета 59 негде увидеть", async () => {
    expect(result.showcaseZone).not.toBeNull();
    const big = result.zones.filter((zone) => zone.created > SHEET_TILES);
    expect(big.length).toBeGreaterThan(0);
    expect(big.map((zone) => zone.zone)).toContain(result.showcaseZone);

    const inShowcase = await prisma.item.count({ where: { roomId, zone: result.showcaseZone! } });
    expect(inShowcase).toBeGreaterThanOrEqual(6);

    // ДОБОР ЖИВ и после тикета 175: витрина полнее КАЖДОЙ соседней зоны — а
    // это возможно только если в неё приехал второй пул. Одного «больше пяти»
    // для этого уже мало: столько даёт теперь любая зона.
    for (const zone of result.zones.filter((entry) => entry.zone !== result.showcaseZone)) {
      expect(zone.created, `витрина против ${zone.zone}`).toBeLessThan(inShowcase);
    }
  });

  it("доборный пул — тот, которому в этой комнате не досталось полки", () => {
    expect(result.spilloverPool).not.toBeNull();
    const pools = new Set(presetZones().map((zone) => zone.pool));
    expect(pools.has(result.spilloverPool!)).toBe(false);
    // Пул живой в обеих половинах: и желания контракта, и «уже своё».
    expect(contractTitles(result.spilloverPool!).length).toBeGreaterThan(0);
    expect(hallTitles(result.spilloverPool!).length).toBeGreaterThan(0);
  });

  // ------------------------------------------- откуда взялась каждая половина

  it("вещи КОМНАТЫ — из контракта дизайна, поимённо и по ценам (тикет 175)", async () => {
    for (const zone of presetZones()) {
      const wants = await prisma.item.findMany({
        where: { roomId, zone: zone.key, inHall: false },
        select: { title: true, price: true },
      });
      const seeds = [
        ...livePoolSeeds(zone.pool),
        ...(zone.key === "anything" ? livePoolSeeds(result.spilloverPool ?? "") : []),
      ];

      expect(wants.map((item) => item.title).sort(), `зона ${zone.key}`).toEqual(
        seeds.map((seed) => seed.title).sort(),
      );
      // Цена — тоже контрактная: разбор «96 000 ₽» → 96000 живёт в сторожа.
      for (const seed of seeds) {
        if (seed.mine) continue;
        const item = wants.find((entry) => entry.title === seed.title);
        expect(Number(item?.price), `цена «${seed.title}»`).toBe(seed.priceRub);
      }
    }
  });

  it("вещи СОКРОВИЩНИЦЫ — из демо-пулов, и только зёрна «уже своё»", async () => {
    for (const zone of presetZones()) {
      const hall = await prisma.item.findMany({
        where: { roomId, zone: zone.key, inHall: true },
        select: { title: true },
      });
      const expected = [
        ...hallTitles(zone.pool),
        ...(zone.key === "anything" ? hallTitles(result.spilloverPool ?? "") : []),
      ];
      expect(hall.map((item) => item.title).sort(), `зона ${zone.key}`).toEqual(expected.sort());
    }
  });

  it("желания демо-пулов в комнату больше не попадают", async () => {
    // Именно они и были «нашим черновиком»: их придумали мы, а живой человек
    // по кнопке «начни с готового» получал вещи из пакета — две разные комнаты.
    const seeded = new Set(
      presetZones()
        .flatMap((zone) => [
          ...standPoolSeeds(zone.pool),
          ...(zone.key === "anything" ? standPoolSeeds(result.spilloverPool ?? "") : []),
        ])
        .map((seed) => seed.title),
    );
    const demoOnlyWishes = new Set<string>();
    for (const zone of presetZones()) {
      for (const seed of demoPools[zone.pool] ?? []) {
        if (!seed.mine && !seeded.has(seed.title)) demoOnlyWishes.add(seed.title);
      }
    }
    expect(
      demoOnlyWishes.size,
      "в демо-пулах не осталось своих желаний — тест перестал что-либо утверждать",
    ).toBeGreaterThan(0);

    const found = await prisma.item.findMany({
      where: { roomId, title: { in: [...demoOnlyWishes] } },
      select: { title: true, zone: true },
    });
    expect(found).toEqual([]);
  });

  it("«люблю» с дарителем и годом уехали в зал славы — витрина не пустая", async () => {
    const gifts = await prisma.item.findMany({
      where: { roomId, inHall: true, giverName: { not: null } },
    });
    expect(gifts.length).toBeGreaterThanOrEqual(2);
    for (const gift of gifts) {
      expect(gift.receivedAt, gift.title).not.toBeNull();
      expect(gift.inHall, gift.title).toBe(true);
    }

    const hall = await listHallItems(roomId);
    expect(hall.length).toBe(result.hallItems);
    expect(hall.length).toBeGreaterThanOrEqual(2);
  });

  it("вещи созданы обычным путём: source=MANUAL, без ссылок и снимков цены", async () => {
    const items = await prisma.item.findMany({ where: { roomId } });
    for (const item of items) {
      expect(item.source, item.title).toBe("MANUAL");
      expect(item.url, item.title).toBeNull();
      expect(item.canonicalUrl, item.title).toBeNull();
      expect(item.hidden, item.title).toBe(false);
      expect(item.priceVisibility, item.title).toBe("ALL");
    }
    expect(await prisma.booking.count({ where: { item: { roomId } } })).toBe(0);
  });

  // ---------------------------------------------------------------- фото

  it("фото легли в НАШЕ S3, а в БД записан наш ключ — не путь пакета", async () => {
    const withPhoto = await prisma.item.findMany({
      where: { roomId, photoKey: { not: null } },
      select: { photoKey: true },
    });
    expect(withPhoto.length).toBe(result.photosStored);
    expect(result.photosStored).toBeGreaterThan(0);
    expect(result.photosFailed).toBe(0);

    const keys = withPhoto.map((item) => item.photoKey!);
    for (const key of keys) {
      // Ровно та форма ключа, какую выдаёт обычная загрузка из браузера.
      expect(key).toMatch(new RegExp(`^items/${roomId}/[0-9a-f]{16}\\.jpg$`));
      expect(key).not.toContain("refs/");
      expect(key).not.toContain("/rooms/");
    }
    // Ключи уникальны: каждое фото — свой объект, как при обычной загрузке.
    expect(new Set(keys).size).toBe(keys.length);

    // И ровно эти ключи ушли в хранилище — с телом настоящего JPEG пакета.
    expect(storage.puts.map((put) => put.key).sort()).toEqual([...keys].sort());
    for (const put of storage.puts) {
      expect(put.type).toBe("image/jpeg");
      expect(put.body.byteLength).toBeGreaterThan(1000);
      expect([put.body[0], put.body[1]]).toEqual([0xff, 0xd8]); // SOI настоящего JPEG
    }
  });

  it("вещь без фото в пуле так и остаётся без фото (инвариант №3)", async () => {
    const withoutPhoto = await prisma.item.count({ where: { roomId, photoKey: null } });
    expect(withoutPhoto).toBeGreaterThan(0);
    expect(withoutPhoto + result.photosStored).toBe(result.itemsCreated);
  });

  it("каждый кадр контракта лежит файлом в пакете — и это число в отчёте", () => {
    // Контракт называет кадр ИМЕНЕМ ФАЙЛА, а лежит файл у нас: разъехаться
    // этому ничего не мешает. Список пуст — сверка сошлась; отчёт
    // /dev-login?report=1 показывает то же число, а не молчит.
    expect(packSeedsPhotosMissing).toEqual([]);
    expect(result.contractPhotosMissing).toBe(0);
  });

  it("кадра нет в пакете — зерно едет БЕЗ кадра, а не роняет посев", () => {
    // Имя правильной формы, файла нет: кадр отбрасывается один, вещь остаётся.
    expect(packagePhotoFor("p-no-such-frame.jpg")).toBeNull();
    // Имя не той формы (обход каталога) — то же самое, и до диска не доходит.
    expect(packagePhotoFor("../refs/p-watch.jpg")).toBeNull();
    // А существующий кадр превращается в путь раздачи, понятный хранилищу.
    expect(packagePhotoFor("p-watch.jpg")).toBe("refs/p-watch.jpg");
  });
});

// ------------------------------------------------- идемпотентность и «не удалять»

describe("посев только добавляет", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("повторный прогон не плодит дубли — все зоны пропущены как «уже с вещами»", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);

    const first = await seedStandRoom(OWNER_EMAIL, spyStorage());
    const afterFirst = await prisma.item.count({ where: { roomId: owner.room.id } });
    const storage = spyStorage();
    const second = await seedStandRoom(OWNER_EMAIL, storage);

    expect(second.itemsCreated).toBe(0);
    expect(second.photosStored).toBe(0);
    expect(storage.puts).toHaveLength(0); // и в S3 второй раз ничего не полетело
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(afterFirst);
    expect(afterFirst).toBe(first.itemsCreated);

    // Пропуск честно назван причиной — «в зоне уже есть вещи».
    const seeded = second.zones.filter((zone) => zone.pool !== "money");
    expect(seeded.every((zone) => zone.skipped === "has-items")).toBe(true);
  });

  it("зона со своей вещью не трогается, соседние наполняются", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const mine = await prisma.item.create({
      data: { roomId: owner.room.id, zone: "books", inHall: true, title: "Моя книга" },
    });

    const result = await seedStandRoom(OWNER_EMAIL, spyStorage());

    // Своя вещь на месте, и она в зоне единственная — пул сюда не приехал.
    expect(await prisma.item.findUnique({ where: { id: mine.id } })).not.toBeNull();
    expect(await prisma.item.count({ where: { roomId: owner.room.id, zone: "books" } })).toBe(1);
    expect(result.zones.find((zone) => zone.zone === "books")?.skipped).toBe("has-items");
    // Соседняя зона наполнена как обычно.
    expect(await prisma.item.count({ where: { roomId: owner.room.id, zone: "home" } })).toBe(
      poolSize("home"),
    );
  });

  it("ничего не удаляет: чужая комната и чужие вещи целы", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const stranger = await createUserWithRoom(STRANGER_EMAIL);
    const strangerItem = await prisma.item.create({
      data: { roomId: stranger.room.id, zone: "home", inHall: false, title: "Чужая ваза", price: "100", currency: "RUB" },
    });

    await seedStandRoom(OWNER_EMAIL, spyStorage());

    expect(await prisma.item.findUnique({ where: { id: strangerItem.id } })).not.toBeNull();
    expect(await prisma.item.count({ where: { roomId: stranger.room.id } })).toBe(1);
    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(1);
  });

  it("отказ хранилища не валит посев: вещь создаётся без фото", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);

    const result = await seedStandRoom(OWNER_EMAIL, {
      putObject: async () => {
        throw new Error("S3 недоступен");
      },
    });

    expect(result.itemsCreated).toBeGreaterThan(0);
    expect(result.photosStored).toBe(0);
    expect(result.photosFailed).toBeGreaterThan(0);
    expect(consoleError).toHaveBeenCalled();
    expect(await prisma.item.count({ where: { roomId: owner.room.id, photoKey: { not: null } } })).toBe(0);
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(result.itemsCreated);
  });

  it("выключенная зона (zonesOff) посевом не наполняется", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    await prisma.room.update({ where: { id: owner.room.id }, data: { zonesOff: ["home"] } });

    const result = await seedStandRoom(OWNER_EMAIL, spyStorage());

    expect(await prisma.item.count({ where: { roomId: owner.room.id, zone: "home" } })).toBe(0);
    expect(result.zones.some((zone) => zone.zone === "home")).toBe(false);
  });
});
