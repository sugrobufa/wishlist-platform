// Укрепление аккаунта перед первым шером (тикет 94, доска Б8 · турн 13b).
//
// Что здесь защищается:
// - просим РОВНО ОДИН раз и только когда есть что предложить: просьба без
//   кнопки «привязать» — разговор ни о чём, вторая просьба — уговоры;
// - отказ это ответ: он пишется той же датой, что и согласие;
// - `User.secondAuth` наконец читается — и читается недоверчиво: в Json-колонке
//   может лежать что угодно.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db";
import {
  availableSecondAuth,
  getHardenState,
  markHardenAsked,
  readSecondAuth,
  shouldAskToHarden,
} from "../src/server/services/harden";

const TEST_EMAIL_DOMAIN = "@harden.test";

async function createUser(overrides: { secondAuth?: unknown; emailVerified?: Date } = {}) {
  return prisma.user.create({
    data: {
      email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      displayName: "Ирина",
      ...(overrides.secondAuth === undefined
        ? {}
        : { secondAuth: overrides.secondAuth as never }),
      ...(overrides.emailVerified === undefined ? {} : { emailVerified: overrides.emailVerified }),
    },
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("shouldAskToHarden — политика просьбы", () => {
  const linked = { provider: "google", sub: "123" };

  it("просим, когда есть что предложить, ещё не привязано и не спрашивали", () => {
    expect(shouldAskToHarden({ providers: ["google"], secondAuth: null, askedAt: null })).toBe(true);
  });

  it("нечего предложить — не просим (просьба без кнопки была бы разговором ни о чём)", () => {
    expect(shouldAskToHarden({ providers: [], secondAuth: null, askedAt: null })).toBe(false);
  });

  it("уже привязано — укреплять нечего", () => {
    expect(shouldAskToHarden({ providers: ["google"], secondAuth: linked, askedAt: null })).toBe(
      false,
    );
  });

  it("уже спрашивали — второй раз это уже уговоры (отказ разрешён доской)", () => {
    expect(
      shouldAskToHarden({ providers: ["google"], secondAuth: null, askedAt: new Date() }),
    ).toBe(false);
  });
});

describe("availableSecondAuth — только реально подключённое", () => {
  it("без ключей список пуст; с ключами Google появляется", () => {
    expect(availableSecondAuth({})).toEqual([]);
    expect(availableSecondAuth({ AUTH_GOOGLE_ID: "x" })).toEqual([]);
    expect(availableSecondAuth({ AUTH_GOOGLE_ID: "x", AUTH_GOOGLE_SECRET: "y" })).toEqual([
      "google",
    ]);
  });
});

describe("readSecondAuth — Json-колонке не верим", () => {
  it("мусор читается как «не привязано»", () => {
    for (const bad of [null, undefined, 42, "google", {}, { provider: "" }, { sub: "1" }, []]) {
      expect(readSecondAuth(bad), JSON.stringify(bad) ?? "undefined").toBeNull();
    }
  });

  it("нормальная запись читается целиком; без sub — пустой строкой, но не null", () => {
    expect(readSecondAuth({ provider: "google", sub: "42" })).toEqual({
      provider: "google",
      sub: "42",
    });
    expect(readSecondAuth({ provider: "telegram" })).toEqual({ provider: "telegram", sub: "" });
  });
});

describe("getHardenState / markHardenAsked", () => {
  it("новый пользователь: почта не подтверждена, второго способа нет, не спрашивали", async () => {
    const user = await createUser();
    const state = await getHardenState(user.id);
    expect(state?.email).toBe(user.email);
    expect(state?.emailConfirmed).toBe(false);
    expect(state?.secondAuth).toBeNull();
    expect(state?.asked).toBe(false);
  });

  it("подтверждённая почта и привязанный способ доезжают до раздела настроек", async () => {
    const user = await createUser({
      emailVerified: new Date("2026-08-01T10:00:00Z"),
      secondAuth: { provider: "google", sub: "42" },
    });
    const state = await getHardenState(user.id);
    expect(state?.emailConfirmed).toBe(true);
    expect(state?.secondAuth).toEqual({ provider: "google", sub: "42" });
  });

  it("отметка ставится один раз и повтором не переписывается", async () => {
    const user = await createUser();
    await markHardenAsked(user.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(first.hardenAskedAt).not.toBeNull();

    await markHardenAsked(user.id);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(second.hardenAskedAt?.getTime()).toBe(first.hardenAskedAt?.getTime());
    expect((await getHardenState(user.id))?.asked).toBe(true);
  });

  it("нет такого пользователя — null, а не выдуманное состояние", async () => {
    expect(await getHardenState("нет-такого")).toBeNull();
  });
});
