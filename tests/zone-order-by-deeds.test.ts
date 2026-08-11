// ПОРЯДОК ЗОН В ФОРМЕ ДОБАВЛЕНИЯ СЧИТАЕТСЯ ПО ДЕЛАМ (тикет 189).
//
// Приёмка владельца 11.08.2026: «не ясно, зачем выбор, что хочется больше
// всего… ничего не происходит и непонятно, на что это влияет». Вопрос красил
// ровно две вещи: порядок наполнения стартовым набором (набор выпилен целиком,
// тикет 191) и вот этот порядок — видимый только на другом экране через
// несколько шагов. Анкета снята, порядок остался и считается сам.
//
// ТЕСТ НА СЕРВИСЕ, А НЕ НА РАЗМЕТКЕ — это условие тикета, и оно не формальность:
// в разметке правило видно только глазами, а сортировка — ровно тот код, что
// тихо разъезжается с требованием при следующей правке страницы.
//
// Половина файла ходит в БД (правило целиком, живой комнатой), половина —
// чистая: у чистой проверяются крайние случаи, которые в БД пришлось бы
// подстраивать вещами.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Создание вещи тянет очереди (фото в S3) — тесту они не нужны.
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { createItem, toggleHall } from "../src/server/services/items";
import { createRoomForUser } from "../src/server/services/rooms";
import { orderZonesByDeeds, zonesByDeeds } from "../src/server/services/zone-order";
import { visibleZones } from "../src/components/scene/zones";
import { rooms as roomPresets } from "../src/config/design";

const TEST_EMAIL_DOMAIN = "@zone-order.test";

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function ownerWithRoom(preset = "cream") {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await createRoomForUser(user.id, { preset, zoneSet: "F" });
  return { user, room };
}

/**
 * Вещь КОМНАТЫ: у неё цена и валюта обязательны (тикет 124 §3 — «у всего в
 * комнате есть цена»). Тесту цена безразлична, но схема без неё не пропустит.
 */
function putThing(userId: string, zone: string, title: string) {
  return createItem(userId, { zone, title, price: "4900", currency: "RUB" });
}

/** Зоны комнаты в КОНТРАКТНОМ порядке — то, с чем сравнивается результат. */
function contractZones(preset: string, zonesOff: readonly string[] = []) {
  const found = roomPresets.find((candidate) => candidate.id === preset);
  return visibleZones(found?.zones ?? [], zonesOff);
}

const keysOf = (zones: readonly { key: string }[]) => zones.map((zone) => zone.key);

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("правило: зона, куда уже клали вещь, идёт первой", () => {
  it("одна вещь поднимает свою зону наверх, остальные идут контрактом", async () => {
    const { user, room } = await ownerWithRoom();
    const contract = contractZones("cream");
    // Берём зону ЗАВЕДОМО НЕ ПЕРВУЮ: иначе тест прошёл бы и без правила.
    const target = contract[3];
    expect(target, "у кремовой комнаты меньше четырёх зон — проверь пресет").toBeDefined();
    expect(keysOf(contract)[0]).not.toBe(target!.key);

    await putThing(user.id, target!.key, "Шёлковый шарф");

    const ordered = await zonesByDeeds(room.id, contract);
    expect(keysOf(ordered)[0]).toBe(target!.key);
    // Остальные — ровно контрактным порядком, без перестановок между собой.
    expect(keysOf(ordered).slice(1)).toEqual(
      keysOf(contract).filter((key) => key !== target!.key),
    );
  });

  it("у комнаты без единой вещи порядок КОНТРАКТНЫЙ", async () => {
    const { room } = await ownerWithRoom();
    const contract = contractZones("cream");
    expect(keysOf(await zonesByDeeds(room.id, contract))).toEqual(keysOf(contract));
  });

  it("несколько зон с вещами держат контрактный порядок между собой", async () => {
    // «Первыми» — не «в порядке добавления»: иначе список прыгал бы у человека
    // от каждой новой вещи, а он его уже запомнил.
    const { user, room } = await ownerWithRoom();
    const contract = contractZones("cream");
    const [, second, , fourth] = contract;
    expect(second && fourth).toBeTruthy();

    // Кладём В ОБРАТНОМ порядке — четвёртую зону раньше второй.
    await putThing(user.id, fourth!.key, "Вторая вещь");
    await putThing(user.id, second!.key, "Первая вещь");

    const ordered = keysOf(await zonesByDeeds(room.id, contract));
    expect(ordered.slice(0, 2)).toEqual([second!.key, fourth!.key]);
  });

  it("вещь, уехавшая в сокровищницу, дело не отменяет", async () => {
    // Место вещи обратимо (инвариант №2), и `zone` за ней сохраняется. Вопрос
    // здесь — «клал ли человек сюда хоть раз», а он клал.
    const { user, room } = await ownerWithRoom();
    const contract = contractZones("cream");
    const target = contract[2];
    const item = await putThing(user.id, target!.key, "Бабушкино кольцо");
    await toggleHall(user.id, item.id, true);

    expect(keysOf(await zonesByDeeds(room.id, contract))[0]).toBe(target!.key);
  });

  it("это ТОЛЬКО сортировка: ни одна зона не пропала и не появилась", async () => {
    // Граница тикета. Набор зон комнаты решают пресет и `zonesOff` (инвариант
    // №5), а не эта функция; заготовки полок (`ZoneSet`) — тем более не она.
    const { user, room } = await ownerWithRoom();
    const contract = contractZones("cream");
    await putThing(user.id, contract[1]!.key, "Духи");

    const ordered = await zonesByDeeds(room.id, contract);
    expect(ordered).toHaveLength(contract.length);
    expect([...keysOf(ordered)].sort()).toEqual([...keysOf(contract)].sort());
  });

  it("выключенная зона в очередь не попадает — её отсеяли раньше", async () => {
    const { user, room } = await ownerWithRoom();
    const contract = contractZones("cream");
    const off = contract[1]!.key;
    // Вещь в зоне есть, а сама зона выключена: очередь считается по ВИДИМЫМ.
    await putThing(user.id, off, "Духи");

    const visible = contractZones("cream", [off]);
    const ordered = keysOf(await zonesByDeeds(room.id, visible));
    expect(ordered).not.toContain(off);
    expect(ordered).toEqual(keysOf(visible));
  });
});

describe("чистая половина: крайние случаи без базы", () => {
  const zones = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }] as const;

  it("нули и отсутствующие ключи — это «не клали»", () => {
    const counts = new Map([
      ["b", 0],
      ["c", 3],
    ]);
    expect(keysOf(orderZonesByDeeds(zones, counts))).toEqual(["c", "a", "b", "d"]);
  });

  it("клали во все — порядок не меняется вовсе", () => {
    const counts = new Map(zones.map((zone) => [zone.key, 1] as const));
    expect(keysOf(orderZonesByDeeds(zones, counts))).toEqual(["a", "b", "c", "d"]);
  });

  it("чужой ключ в счёте ничего не двигает и ничего не добавляет", () => {
    const counts = new Map([["gaming", 9]]);
    expect(keysOf(orderZonesByDeeds(zones, counts))).toEqual(["a", "b", "c", "d"]);
  });

  it("пустой список зон — пустой ответ, а не падение", () => {
    expect(orderZonesByDeeds([], new Map([["a", 1]]))).toEqual([]);
  });
});

describe("анкеты в этом расчёте больше нет", () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

  it("страница добавления не читает `room.wants` ни строкой", () => {
    // Поле осталось в базе и мёртво (тикет 189, пункт 3): данные живых комнат
    // не стираем, читателя у них нет. Вернётся чтение — вернётся и анкета,
    // которую владелец снял.
    //
    // Комментарии не в счёт: они и должны объяснять, почему поле мёртвое. Иначе
    // сторож запрещал бы рассказывать о том, что сторожит.
    const code = read("../src/app/room/add/page.tsx")
      .split(/\r?\n/u)
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line));
    expect(code.filter((line) => /room\.wants/u.test(line))).toEqual([]);
    expect(code.join("\n")).toContain("zonesByDeeds");
  });

  it("сортировщик про анкету не знает — у него нет и входа для неё", () => {
    const service = read("../src/server/services/zone-order.ts");
    expect(service).not.toMatch(/^(?!\s*(?:\/\/|\*)).*\bwants\b/mu);
  });
});
