// Сокровищница объясняет себя ДВУМЯ строками (тикет 220, пакет 48 →
// `design/package/handoff/round48/hall-owner.json`; прежняя одна — тикет 214).
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ. На витрине хозяйки не было ни строки о том, чем это
// место отличается от комнаты: шапка, счётчик — и сразу «+ Добавить вещь».
// Объяснение в продукте было, но только там, куда владелец не попадает:
// `Hall.empty` (пустая витрина) и `Hall.guestSubtitle` — строка ГОСТЯ.
// Дизайн исключение памятки тона расширил, а нашу строку переписал на две, и
// каждая работает в СВОЁМ месте:
//   `Hall.ownerSubtitle` («уже твои») — В СТРОКЕ СЧЁТЧИКА: «26 вещей · уже
//     твои», пара к гостевой `guestSubtitle` («всё здесь уже дома»);
//   `Hall.ownerHint` — под счётчиком, над сеткой: объясняет ЧЕРЕЗ КОМНАТУ
//     («сокровищница — единственное место продукта, которое определяется
//     через другое место»).
// Правило показа у обеих одно и с тикета 214 не менялось: ТОЛЬКО ПРИ НЕПУСТОЙ
// ВИТРИНЕ. У пустой это место занято `Hall.empty`, где сказано то же самое и
// названы три дороги сюда, — две объяснительные строки подряд читаются уже
// инструкцией.
//
// СТРАНИЦА РИСУЕТСЯ ПО-НАСТОЯЩЕМУ, а не читается исходником: правило живёт в
// одном условии разметки, и проверка «в файле есть такая строка» зеленела бы и
// у строки, приколоченной над обеими ветками. Отсюда же и способ проверить
// МЕСТО подписи: «в строке счётчика» — это один и тот же элемент `<p>` в
// готовой разметке, а не соседство в исходнике. Стенд — тот же, что у
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
// синхронный и такие не умеет. К строкам витрины он отношения не имеет, свой
// сторож у него есть (tests/tab-bar.test.ts).
vi.mock("@/components/tab-bar/tab-bar", () => ({ TabBar: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { auth } from "@/server/auth";
import { prisma } from "../src/server/db";
import HallPage from "../src/app/room/hall/page";
// Имена классов модуля — из самого модуля: vitest отдаёт их со своим хэшем
// (`_counter_ab12cd`), и записывать их в тест строкой нельзя.
import hallCss from "../src/components/hall/hall.module.css";

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;

const SUBTITLE = ru.Hall?.ownerSubtitle ?? "";
const HINT = ru.Hall?.ownerHint ?? "";
const EMPTY = ru.Hall?.empty ?? "";
const ADD = ru.Hall?.add ?? "";

// Набор строки счётчика (тикет 222): класс — из модуля, правила — из текста
// обоих файлов. `globals.css` здесь только ЧИТАЕТСЯ: общий `.overline` верен.
const COUNTER_CLASS = hallCss.counter ?? "";
const hallModuleCss = read("../src/components/hall/hall.module.css");
const globalsCss = read("../src/app/globals.css");

/** Счётчик — ICU-плюрал, поэтому «2 вещи» собирает форматтер, а не тест. */
const t = createTranslator({ locale: "ru", messages: ru, namespace: "Hall" });
const counted = (count: number) => t("count", { count });

const TEST_EMAIL_DOMAIN = "@hall-subtitle.test";

/** Абзац готовой разметки, внутри которого стоит `needle`. */
function paragraphWith(markup: string, needle: string): string | undefined {
  return (markup.match(/<p\b[^>]*>[\s\S]*?<\/p>/gu) ?? []).find((p) => p.includes(needle));
}

/** Классы элемента списком: `class="overline mt-2.5"` → ["overline", "mt-2.5"]. */
function classesOf(element: string): string[] {
  const attr = /\bclass="([^"]*)"/u.exec(element)?.[1] ?? "";
  return attr.split(/\s+/u).filter(Boolean);
}

/** Тело правила `.name { … }` из текста CSS; null — правила нет. */
function ruleOf(css: string, name: string): string | null {
  return new RegExp(String.raw`^\.${name}\s*\{([^}]*)\}`, "mu").exec(css)?.[1] ?? null;
}

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

describe("Hall.ownerSubtitle и Hall.ownerHint — чем сокровищница отличается от комнаты", () => {
  it("обе строки словаря существуют и не подменены ключами", () => {
    // Пустая строка или имя ключа означали бы, что дальше проверять нечего:
    // `createTranslator` на пропавшем ключе отдаёт «Hall.ownerHint», и все
    // проверки ниже прошли бы, ничего не проверив.
    expect(SUBTITLE.trim()).not.toBe("");
    expect(SUBTITLE).not.toContain("ownerSubtitle");
    expect(HINT.trim()).not.toBe("");
    expect(HINT).not.toContain("ownerHint");
    expect(SUBTITLE).not.toBe(HINT);
    expect(EMPTY.trim()).not.toBe("");
    expect(ADD.trim()).not.toBe("");
  });

  it("подпись стоит В СТРОКЕ СЧЁТЧИКА: «2 вещи · уже твои»", async () => {
    const owner = await createOwnerWithRoom();
    await createTreasure(owner.room.id, "Бабушкина брошь", {
      receivedAt: new Date("2025-03-14T12:00:00Z"),
      giverName: "мама",
    });
    await createTreasure(owner.room.id, "Часы деда");

    const markup = await drawHall(owner.user.id);
    // Вещи на месте — рисовалась именно полная витрина, а не пустая.
    expect(markup).toContain("Бабушкина брошь");

    // Тот же элемент разметки, а не соседняя строка: контракт пакета 48 ставит
    // подпись В СТРОКУ счётчика, парой к гостевой `guestSubtitle`.
    const counter = paragraphWith(markup, counted(2));
    expect(counter, "счётчик пропал с витрины").toBeDefined();
    expect(counter).toContain(`${counted(2)} · ${SUBTITLE}`);
    // И ровно одна: вторая копия — это уже инструкция.
    expect(markup.split(SUBTITLE)).toHaveLength(2);
  });

  it("подсказка стоит МЕЖДУ СЧЁТЧИКОМ И СЕТКОЙ", async () => {
    const owner = await createOwnerWithRoom();
    await createTreasure(owner.room.id, "Кольцо");

    const markup = await drawHall(owner.user.id);
    const counterAt = markup.indexOf(counted(1));
    const hintAt = markup.indexOf(HINT);
    const gridAt = markup.indexOf("<ul");
    expect(counterAt, "счётчик пропал с витрины").toBeGreaterThan(-1);
    expect(gridAt, "сетка вещей пропала с витрины").toBeGreaterThan(-1);
    expect(hintAt, "подсказка уехала в шапку, к счётчику").toBeGreaterThan(counterAt);
    expect(hintAt, "подсказка уехала под сетку вещей").toBeLessThan(gridAt);
    // Своей строкой, а не хвостом счётчика: у неё своя ступень тона и ширина.
    expect(paragraphWith(markup, HINT)).not.toContain(counted(1));
    expect(markup.split(HINT)).toHaveLength(2);
    // «+ Добавить вещь» на месте — объяснение её не вытеснило.
    expect(markup).toContain(ADD);
  });

  it("ПУСТАЯ витрина не показывает ни одной из них — там говорит Hall.empty", async () => {
    const owner = await createOwnerWithRoom();

    const markup = await drawHall(owner.user.id);
    expect(markup).toContain(EMPTY);
    expect(markup).not.toContain(SUBTITLE);
    expect(markup).not.toContain(HINT);
  });

  it("вещь ушла с витрины — уходят обе строки", async () => {
    // Правило считает ПОКАЗЫВАЕМЫЕ вещи, а не «была ли витрина когда-нибудь
    // полной»: у хозяйки, вернувшей последнюю вещь в комнату, экран обязан
    // стать тем же, что у новенькой.
    const owner = await createOwnerWithRoom();
    const item = await createTreasure(owner.room.id, "Кольцо");
    const full = await drawHall(owner.user.id);
    expect(full).toContain(SUBTITLE);
    expect(full).toContain(HINT);

    await prisma.item.update({ where: { id: item.id }, data: { inHall: false } });
    const back = await drawHall(owner.user.id);
    expect(back).not.toContain(SUBTITLE);
    expect(back).not.toContain(HINT);
    expect(back).toContain(EMPTY);
  });

  // ---------- Тикет 222: набор строки счётчика ----------
  //
  // Строка счётчика была набрана классом `.overline` — приёмом НАДСТРОЧНЫХ
  // («ЧТО ПОДАРИЛИ», «ПРАЗДНИКИ»): 9 px, капс, разрядка .2em. Контракт 48
  // (`round48/hall-owner.json` → тон `Hall.ownerSubtitle`) даёт «11.5 Onest 500
  // при .6», и доска рисует эти строки без капса. Приём `.overline` при этом
  // верен и не тронут — правится место, где он выбран не тот.
  //
  // Проверяется РАЗМЕТКА и ПРАВИЛО CSS, а не текст: «26 ВЕЩЕЙ» приезжает не из
  // словаря, а из `text-transform`, и по строке ru.json капса не видно.
  // Половина этой проверки для витрины ГОСТЯ живёт в tests/guest-hall.test.ts:
  // класс общий, но набор обязан быть проверен на обеих — контракт зовёт
  // `ownerSubtitle`/`guestSubtitle` парой.

  it("счётчик несёт свой класс и НЕ несёт .overline", async () => {
    const owner = await createOwnerWithRoom();
    await createTreasure(owner.room.id, "Бабушкина брошь");
    await createTreasure(owner.room.id, "Часы деда");

    const markup = await drawHall(owner.user.id);
    const counter = paragraphWith(markup, counted(2));
    expect(counter, "счётчик пропал с витрины").toBeDefined();

    const classes = classesOf(counter ?? "");
    expect(classes, "счётчик снова набран приёмом надстрочных").not.toContain("overline");
    expect(COUNTER_CLASS, "в hall.module.css пропал класс счётчика").not.toBe("");
    expect(classes).toContain(COUNTER_CLASS);
    // Тон .6 контракта — это токен `text-muted`, поэтому цвета в модуле нет:
    // если утилита уедет из разметки, число контракта уедет вместе с ней.
    expect(classes).toContain("text-text-muted");
  });

  it("правило счётчика — 11.5/500 без капса и без разрядки", () => {
    const rule = ruleOf(hallModuleCss, "counter");
    expect(rule, "в hall.module.css нет правила .counter").not.toBeNull();
    expect(rule).toMatch(/font-size:\s*11\.5px/u);
    expect(rule).toMatch(/font-weight:\s*500/u);
    expect(rule, "капс вернулся в счётчик").not.toMatch(/text-transform/u);
    expect(rule, "разрядка вернулась в счётчик").not.toMatch(/letter-spacing/u);
  });

  it("`.overline` остался прежним — это его приём, а не наш", () => {
    // Ради этого правила счётчик и переехал: общий приём продукта (комната
    // списком, «Мои подарки», онбординг) воплощает `tokens.json → type.overline`
    // верно, и трогать его тикет 222 запрещает. Если 9 px и капс отсюда уйдут,
    // «переехали не туда» окажется правдой уже про надстрочные всех экранов.
    const rule = ruleOf(globalsCss, "overline");
    expect(rule, "в globals.css нет правила .overline").not.toBeNull();
    expect(rule).toMatch(/font-size:\s*9px/u);
    expect(rule).toMatch(/text-transform:\s*uppercase/u);
  });

  it("гостевая витрина не тронута: у неё своя строка, и она про другое", () => {
    // `guestSubtitle` («всё здесь уже дома») — строка ДИЗАЙНА и про гостя:
    // он сюда не пополняет. Подменить её строками хозяйки нельзя ни одной.
    const guestPage = read("../src/app/r/[slug]/hall/page.tsx");
    expect(guestPage).toContain('t("guestSubtitle")');
    expect(guestPage).not.toContain("ownerSubtitle");
    expect(guestPage).not.toContain("ownerHint");
  });
});
