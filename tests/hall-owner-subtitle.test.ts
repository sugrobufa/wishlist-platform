// Сокровищница объясняет себя одной строкой (тикет 214, приёмка владельца
// 13.08.2026, замечание 1).
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ. На витрине хозяйки не было ни строки о том, чем это
// место отличается от комнаты: шапка, счётчик — и сразу «+ Добавить вещь».
// Объяснение в продукте было, но только там, куда владелец не попадает:
// `Hall.empty` (пустая витрина) и `Hall.guestSubtitle` — строка ГОСТЯ.
// Теперь над «+ Добавить вещь» стоит `Hall.ownerSubtitle`, и правило у неё
// ровно одно: ПОКАЗЫВАТЬ ТОЛЬКО ПРИ НЕПУСТОЙ ВИТРИНЕ. У пустой это место
// занято `Hall.empty`, где сказано то же самое и названы три дороги сюда, —
// две объяснительные строки подряд читаются уже инструкцией.
//
// СТРАНИЦА РИСУЕТСЯ ПО-НАСТОЯЩЕМУ, а не читается исходником: правило живёт в
// одном условии разметки, и проверка «в файле есть такая строка» зеленела бы и
// у строки, приколоченной над обеими ветками. Стенд — тот же, что у
// tests/auth.magic-link.test.ts: настоящая dev-БД, а подменяются только вещи
// рантайма Next, которых вне запроса не существует.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// Тексты — НАСТОЯЩИЕ строки продукта и настоящий форматтер next-intl (счётчик
// «26 вещей» — ICU-плюрал, на глаз его не собрать). Вне запроса у
// `next-intl/server` нет request-scope, поэтому подменяются два его входа.
vi.mock("next-intl/server", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const messages = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    getTranslations: async (namespace: string) =>
      actual.createTranslator({ locale: "ru", messages, namespace }),
    getLocale: async () => "ru",
  };
});

// Клиентская половина того же словаря — для витрины (`hall-showcase.tsx`).
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const messages = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({ locale: "ru", messages, namespace }),
    useLocale: () => "ru",
  };
});

// Роутер и redirect — рантайм Next. redirect в рисуемых ветках не зовётся:
// сессия и комната у теста настоящие, и если он всё же сработает, тест упадёт
// с внятным «redirect:/signin», а не молча нарисует пустоту.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

// Таб-бар — АСИНХРОННЫЙ серверный компонент, а `renderToStaticMarkup`
// синхронный и такие не умеет. К строке витрины он отношения не имеет, свой
// сторож у него есть (tests/tab-bar.test.ts).
vi.mock("@/components/tab-bar/tab-bar", () => ({ TabBar: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import { auth } from "@/server/auth";
import { prisma } from "../src/server/db";
import HallPage from "../src/app/room/hall/page";

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;

const SUBTITLE = ru.Hall?.ownerSubtitle ?? "";
const EMPTY = ru.Hall?.empty ?? "";
const ADD = ru.Hall?.add ?? "";

const TEST_EMAIL_DOMAIN = "@hall-subtitle.test";

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `hs-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

function createTreasure(
  roomId: string,
  title: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: { roomId, zone: "jewelry", inHall: true, title, ...overrides },
  });
}

/** Витрина глазами её хозяйки — ровно так, как её отдаёт /room/hall. */
async function drawHall(userId: string): Promise<string> {
  authMock.mockResolvedValue({ user: { id: userId } });
  return renderToStaticMarkup(await HallPage());
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("Hall.ownerSubtitle — чем сокровищница отличается от комнаты", () => {
  it("строка словаря существует и не подменена ключом", () => {
    // Пустая строка или имя ключа означали бы, что дальше проверять нечего:
    // `createTranslator` на пропавшем ключе отдаёт «Hall.ownerSubtitle», и обе
    // проверки ниже прошли бы, ничего не проверив.
    expect(SUBTITLE.trim()).not.toBe("");
    expect(SUBTITLE).not.toContain("ownerSubtitle");
    expect(EMPTY.trim()).not.toBe("");
    expect(ADD.trim()).not.toBe("");
  });

  it("НЕПУСТАЯ витрина объясняет себя — строка стоит НАД «+ Добавить вещь»", async () => {
    const owner = await createOwnerWithRoom();
    await createTreasure(owner.room.id, "Бабушкина брошь", {
      receivedAt: new Date("2025-03-14T12:00:00Z"),
      giverName: "мама",
    });
    await createTreasure(owner.room.id, "Часы деда");

    const markup = await drawHall(owner.user.id);
    expect(markup).toContain(SUBTITLE);
    // Вещи на месте — рисовалась именно полная витрина, а не пустая.
    expect(markup).toContain("Бабушкина брошь");
    // Владелец обвёл участок между счётчиком и «+ Добавить вещь»: строка стоит
    // там, а не под кнопкой и не в шапке.
    const at = markup.indexOf(SUBTITLE);
    const addAt = markup.indexOf(ADD);
    expect(addAt, "«+ Добавить вещь» пропала с витрины").toBeGreaterThan(-1);
    expect(at, "объяснение уехало под кнопку добавления").toBeLessThan(addAt);
    // И ровно одна: вторая копия — это уже инструкция.
    expect(markup.split(SUBTITLE)).toHaveLength(2);
  });

  it("ПУСТАЯ витрина её не показывает — там говорит Hall.empty", async () => {
    const owner = await createOwnerWithRoom();

    const markup = await drawHall(owner.user.id);
    expect(markup).toContain(EMPTY);
    expect(markup).not.toContain(SUBTITLE);
  });

  it("вещь ушла с витрины — уходит и строка", async () => {
    // Правило считает ПОКАЗЫВАЕМЫЕ вещи, а не «была ли витрина когда-нибудь
    // полной»: у хозяйки, вернувшей последнюю вещь в комнату, экран обязан
    // стать тем же, что у новенькой.
    const owner = await createOwnerWithRoom();
    const item = await createTreasure(owner.room.id, "Кольцо");
    expect(await drawHall(owner.user.id)).toContain(SUBTITLE);

    await prisma.item.update({ where: { id: item.id }, data: { inHall: false } });
    const back = await drawHall(owner.user.id);
    expect(back).not.toContain(SUBTITLE);
    expect(back).toContain(EMPTY);
  });

  it("гостевая витрина не тронута: у неё своя строка, и она про другое", () => {
    // `guestSubtitle` («всё здесь уже дома») — строка ДИЗАЙНА и про гостя:
    // он сюда не пополняет. Подменить её объяснением для хозяйки нельзя.
    const guestPage = read("../src/app/r/[slug]/hall/page.tsx");
    expect(guestPage).toContain('t("guestSubtitle")');
    expect(guestPage).not.toContain("ownerSubtitle");
  });
});
