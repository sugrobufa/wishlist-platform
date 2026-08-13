// ЭКРАН «ЧТО ПОДАРИЛИ»: ЧЕТЫРЕ СОСТОЯНИЯ И ИХ НАПОЛНЕНИЕ (тикеты 216 и 217 —
// приёмка владельца 13.08.2026; тикет 219 — те же четыре состояния словами и
// составом пакета 48, турны 54a и 54b).
//
// ЗАМЕЧАНИЕ ДОСЛОВНО: «Написано праздник еще впереди и кнопка праздник прошел…
// на этой форме я оказался когда нажал кнопку на главном экране что праздник
// прошел, но он еще оказывается впереди». Две поверхности отвечали на ОДИН
// вопрос по разным данным: комната считала наступивший день рождения, экран
// смотрел только на существование итога.
//
// Здесь шесть проверок, и главные — третья и четвёртая:
//
// 1. таблица состояний (`screen-state`) — чем говорит каждое из четырёх, и
//    КАЖДЫЙ её ключ существует в словаре (снятый ключ роняет next-intl);
// 2. кнопка (тикет 217, слово 54b) — действие, а не состояние, три тона;
// 3. **НАСТОЯЩИЙ ЭКРАН В НАСТОЯЩЕЙ БАЗЕ**: на пороге при живых бронях нет ни
//    одного имени и ни одного названия вещи — только счётчик забранного
//    (инвариант №1). Проверка не вакуумная: та же комната, закрыв итог, имя
//    печатает;
// 4. **СВОДКА ДВУХ ПОВЕРХНОСТЕЙ**: там, где `occasionBannerVisible` даёт true,
//    экран НЕ имеет права говорить «Итог появится после праздника». Это и есть
//    замечание владельца, и оно обязано быть под тестом, а не под глазами;
// 5. кадр собственной комнаты в шапке (пакет 49, тикет 224): прозрачность по
//    каждому из четырёх состояний — числами САМОГО контракта, — и на пороге
//    кадр не приносит с собой ни одного имени;
// 6. «Сказать спасибо» — строка есть у дарителя с почтой и её нет ВОВСЕ у
//    дарителя без почты; громкой «спасибо всем» у открытого итога нет.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import ru from "../messages/ru.json";

// Очереди мокируются целиком (паттерн tests/occasions): Redis не нужен.
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

// ТЕКСТЫ — НАСТОЯЩИЕ, И ФОРМАТТЕР НАСТОЯЩИЙ (паттерн tests/hall-owner-subtitle):
// «2 вещи из комнаты забрали» — ICU-плюрал, на глаз его не собрать, а весь
// смысл проверки в том, что на пороге стоит ИМЕННО ЭТО число. Вне запроса у
// `next-intl/server` нет request-scope, поэтому подменяются три его входа.
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
    getFormatter: async () => actual.createFormatter({ locale: "ru" }),
  };
});

// Клиентская половина того же словаря — для кнопки итога.
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

// Рантайм Next. `redirect` в рисуемых ветках не зовётся: сессия и комната
// настоящие, а сработай он — тест упадёт с внятным «redirect:/signin».
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("../src/app/room/occasion/actions", () => ({
  closeOccasionAction: vi.fn(async () => undefined),
  receiveGiftAction: vi.fn(async () => undefined),
}));

import { createFormatter, createTranslator } from "next-intl";
import contract from "@design/round49/occasion-open.json";
import { auth } from "@/server/auth";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { prisma } from "../src/server/db";
import { birthdayColumns, parseBirthday } from "../src/server/birthday";
import {
  closeOccasion,
  getOccasionView,
  occasionBannerVisible,
  receiveGift,
} from "../src/server/services/occasions";
import { ownerTakenTotal } from "../src/server/services/goal";
import { bookItem } from "../src/server/services/bookings";
import {
  OCCASION_SCREEN,
  occasionScreenState,
  type OccasionScreenShape,
  type OccasionScreenState,
} from "../src/app/room/occasion/screen-state";
import { CloseOccasionButton } from "../src/app/room/occasion/occasion-client";
import OccasionPage from "../src/app/room/occasion/page";

const TEST_EMAIL_DOMAIN = "@occasion-states.test";
const words = ru.Occasion as Record<string, string>;
const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

/** Плюралы и даты собирает форматтер продукта, а не тест руками. */
const t = createTranslator({
  locale: "ru",
  messages: ru as unknown as Record<string, Record<string, string>>,
  namespace: "Occasion",
});
const format = createFormatter({ locale: "ru" });
const onDate = (iso: string) =>
  format.dateTime(new Date(iso), { day: "numeric", month: "long", timeZone: "UTC" });

/** Исходник модуля — для проверки «разметка читает таблицу». */
const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const DAY_MS = 24 * 60 * 60 * 1000;
function utcMidnightDaysAgo(days: number): Date {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * DAY_MS);
}

async function createOwnerWithRoom(occasionDate: Date | null) {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `os-${randomUUID().slice(0, 12)}`,
      ...birthdayColumns(
        occasionDate === null ? null : parseBirthday(occasionDate.toISOString().slice(0, 10)),
      ),
    },
  });
  return { user, room };
}

async function createItem(roomId: string, title = `Вещь-${randomUUID().slice(0, 8)}`) {
  return prisma.item.create({
    data: {
      roomId,
      zone: "jewelry",
      inHall: false,
      title,
      price: "5000",
      currency: "RUB",
    },
  });
}

/** Экран глазами его хозяйки — ровно так, как его отдаёт /room/occasion. */
async function drawOccasion(userId: string): Promise<string> {
  authMock.mockResolvedValue({ user: { id: userId } });
  return renderToStaticMarkup(await OccasionPage());
}

// OccasionSummary не связан с Room FK — чистим его явно, остальное каскадом.
async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { room: { select: { id: true } } },
  });
  const roomIds = users.flatMap((user) => (user.room ? [user.room.id] : []));
  if (roomIds.length > 0) {
    await prisma.occasionSummary.deleteMany({ where: { roomId: { in: roomIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** Заголовок, который экран покажет в этом состоянии, — СЛОВАМИ, как у владельца. */
function titleOf(state: OccasionScreenState): string | null {
  const key = OCCASION_SCREEN[state].title;
  return key === null ? null : (words[key] ?? `нет ключа ${key}`);
}

// ---------------------------------------------------------------------------
// 1. Таблица состояний
// ---------------------------------------------------------------------------

describe("состояний четыре, и каждое говорит своё (тикеты 216 и 219)", () => {
  it("выбор состояния: итог старше наступившего праздника, наступивший — будущего", () => {
    const summary = { id: "s", date: "2026-08-12T00:00:00.000Z", revealedAt: null };
    expect(occasionScreenState({ summary, due: null, next: null })).toBe("summary");
    // Итог закрыт, а праздник наступил снова (следующий год до автозакрытия):
    // экран показывает итог — но «впереди» не говорит ни при каком раскладе.
    expect(occasionScreenState({ summary, due: "2026-08-12", next: null })).toBe("summary");
    expect(occasionScreenState({ summary: null, due: "2026-08-12", next: null })).toBe("due");
    expect(occasionScreenState({ summary: null, due: null, next: "2026-09-14" })).toBe("next");
    expect(occasionScreenState({ summary: null, due: null, next: null })).toBe("noDate");
  });

  it("DUE — ПОРОГ: счётчик в лиде, блок «что случится» из трёх строк, полоса света", () => {
    const due = OCCASION_SCREEN.due;
    expect(titleOf("due")).toBe("Пора узнать, кто что подарил");
    expect(due.lead).toBe("dueLead");
    // Единственное число до раскрытия стоит ВНУТРИ лида (инвариант №1).
    expect(due.taken).toBe("lead");
    // Предупреждение — блоком ДО нажатия, тремя строками, а не диалогом.
    expect(due.whatHappens).toEqual(["dueNames", "dueDone", "dueUnclaimed"]);
    expect(due.loud).toEqual({ key: "openButton", hint: "openOnceHint", action: "open" });
    // Тихий выход есть, тихой дороги к ручному итогу нет: она и есть полоса.
    expect(due.notNow).toBe(true);
    expect(due.manual).toBeNull();
    // Дату ближайшего здесь не показываем: ближайший — через год, а разговор
    // про тот, что уже прошёл.
    expect(due.nearest).toBe(false);
    expect(due.dateLink).toBe(false);
  });

  it("AHEAD — ОЖИДАНИЕ: счётчик блоком, две тихие ссылки, БЕЗ громкой кнопки", () => {
    const next = OCCASION_SCREEN.next;
    expect(titleOf("next")).toBe("Итог появится после праздника");
    expect(next.lead).toBe("aheadHint");
    expect(next.taken).toBe("box");
    // Громкой кнопки нет — и экран сам объясняет, почему (с датой).
    expect(next.loud).toBeNull();
    // Дорогу не убираем (решение гриллинга №6), но гореть год она не должна.
    expect(next.manual).toBe("quiet");
    expect(next.dateLink).toBe(true);
    // Дата строкой — тем же видом, что в комнате: «День рождения · 14 сентября».
    expect(next.nearest).toBe(true);
    expect(next.whatHappens).toBeNull();
  });

  it("NO_DATE — комната без даты: громкое зовёт к ДАТЕ, тихая дорога тише", () => {
    const noDate = OCCASION_SCREEN.noDate;
    expect(titleOf("noDate")).toBe("Дата ещё не названа");
    expect(noDate.lead).toBe("noDateHint");
    expect(noDate.aside).toBe("noDateWorks");
    // Единственный случай, где полоса света ведёт не к итогу.
    expect(noDate.loud).toEqual({
      key: "noDateButton",
      hint: "noDateButtonHint",
      action: "date",
    });
    // Громкое занято датой — значит тихая дорога здесь тише, чем в ожидании.
    expect(noDate.manual).toBe("quieter");
    expect(noDate.taken).toBe("box"); // комната работает и без даты
    // «Когда он пройдёт» такой комнате сказать нечем — даты нет.
    expect(noDate.nearest).toBe(false);
  });

  it("OPEN: громкого действия нет — и теперь это решение, а не пауза (round49)", () => {
    // Контракт 48 спорил сам с собой: `buttonLife` говорил «OPEN — ни кнопки,
    // ни ссылки», а `states.OPEN.loud` называл полосу света `Occasion.thanksAll`.
    // Спросили письмом 53 — пакет 49 ответил: прав `buttonLife`. «Спасибо
    // всем» продукт отправить НЕ МОЖЕТ (почта гостя необязательна), и ключа
    // по-прежнему нет нигде. Благодарность живёт адресно, строкой в подарке.
    expect(words.thanksAll).toBeUndefined();
    expect(words.thanksGuest).toBe("Сказать спасибо");
    expect(OCCASION_SCREEN.summary).toEqual({
      title: null,
      lead: null,
      aside: null,
      whatHappens: null,
      taken: null,
      loud: null,
      manual: null,
      notNow: false,
      dateLink: false,
      nearest: false,
      // Кадр шапки — единственное, чем таблица говорит об открытом итоге.
      photo: 1,
      photoHeight: 236,
    });
  });

  it("КАЖДЫЙ ключ таблицы есть в словаре: на пропавшем next-intl падает", () => {
    // Пакет 48 снял `notClosedTitle`, `notClosedHint`, `closeButton`,
    // `closeQuiet`, `notClosedNoDate`, `toSettings` и прежний `dueHint` — а
    // ведущий убрал их из словаря. Ключ, оставшийся в таблице или в разметке,
    // роняет экран целиком, а не портит одну строку.
    const keys = Object.values(OCCASION_SCREEN).flatMap((shape: OccasionScreenShape) =>
      (
        [
          shape.title,
          shape.lead,
          shape.aside,
          shape.loud?.key ?? null,
          shape.loud?.hint ?? null,
          ...(shape.whatHappens ?? []),
        ] as Array<string | null>
      ).filter((key): key is string => key !== null),
    );
    // Проверка не пустая: ключей в таблице действительно много.
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const key of keys) {
      expect(words[key], `ключа Occasion.${key} нет в словаре`).toBeDefined();
      expect(words[key]?.trim()).not.toBe("");
    }
    // И слова, которые таблица не называет, но экран печатает рядом.
    for (const key of ["dueWhatOverline", "notNow", "manualOverline", "manualHint", "dateLink"]) {
      expect(words[key], `ключа Occasion.${key} нет в словаре`).toBeDefined();
    }
  });

  it("разметка берёт слова ИЗ таблицы, а снятых ключей не знает", () => {
    // Иначе таблица стала бы вторым описанием экрана — и разъехалась бы с ним
    // ровно так же, как разъехались комната и экран (тикет 216).
    const page = readSource("../src/app/room/occasion/page.tsx");
    expect(page).toContain("OCCASION_SCREEN[occasionScreenState(view)]");
    expect(page).toContain("screen.loud");
    expect(page).toContain("screen.taken");
    expect(page).toContain("screen.manual");
    expect(page).toContain("screen.whatHappens");
    expect(page).not.toMatch(/t\("(dueTitle|aheadTitle|noDateTitle|dueLead|aheadHint)"\)/u);
    // Снятые ключи не должны остаться ни в разметке, ни в кнопке.
    const gone =
      /notClosedTitle|notClosedHint|notClosedNoDate|closeButton|closeQuiet|toSettings|dueHint/u;
    expect(page).not.toMatch(gone);
    expect(readSource("../src/app/room/occasion/occasion-client.tsx")).not.toMatch(gone);
    expect(readSource("../src/app/room/occasion/screen-state.ts")).not.toMatch(gone);
  });
});

// ---------------------------------------------------------------------------
// 2. Кнопка — действие, а не состояние (тикет 217, слово 54b)
// ---------------------------------------------------------------------------

/** Настоящая разметка кнопки — тем же React, что в браузере. */
function renderClose(tone: "loud" | "quiet" | "quieter"): string {
  return renderToStaticMarkup(createElement(CloseOccasionButton, { accent: "#E7C9A9", tone }));
}

describe("кнопка итога: слово-действие, без стрелки, три тона (тикеты 217 и 219)", () => {
  it("главная кнопка называет ДЕЙСТВИЕ и говорит «открыть», а не «показать»", () => {
    const html = renderClose("loud");
    expect(html).toContain("Открыть, кто что подарил");
    // «Показать» обратимо — так говорят про фильтр, а действие необратимо
    // (пакет 48, `wording.openButton`).
    expect(html).not.toContain("Показать, кто что подарил");
    // Заголовок порога кнопка не повторяет.
    expect(html).not.toContain(titleOf("due"));
  });

  it("необратимость подписана ПОД полосой, до нажатия", () => {
    // Раньше про «один раз» говорила строка `hint` — то есть уже после
    // раскрытия. Теперь она стоит у самой кнопки.
    expect(renderClose("loud")).toContain(words.openOnceHint);
    expect(renderClose("quiet")).not.toContain(words.openOnceHint);
  });

  it("СТРЕЛКИ НЕТ: её приписывал код строкой, а не контракт", () => {
    expect(renderClose("loud")).not.toContain("→");
    expect(renderClose("quiet")).not.toContain("→");
    expect(renderClose("quieter")).not.toContain("→");
  });

  it("«полоса света» осталась полосой света: пол 2 px, свечение и знак 18", () => {
    const html = renderClose("loud");
    expect(html).toContain("border-b-2");
    expect(html).toMatch(/border-color:\s*#E7C9A9/iu);
    expect(html).toMatch(/box-shadow/iu);
    // Знак раскрытия 18, stroke 1.7 — по контракту у полосы он есть.
    expect(html).toMatch(/<svg[^>]*width="18"[^>]*stroke-width="1\.7"/u);
  });

  it("тихая дорога — теми же словами в обоих тонах, но громкость разная", () => {
    const quiet = renderClose("quiet");
    const quieter = renderClose("quieter");
    expect(quiet).toContain("Праздник уже был — открыть итог");
    expect(quieter).toContain("Праздник уже был — открыть итог");
    for (const html of [quiet, quieter]) {
      expect(html).not.toContain("border-b-2");
      expect(html).not.toMatch(/box-shadow/iu);
    }
    // В ожидании ссылка идёт акцентом комнаты, у комнаты без даты — тише:
    // громкое там уже занято датой.
    expect(quiet).toMatch(/color:\s*#E7C9A9/iu);
    expect(quieter).not.toMatch(/color:\s*#E7C9A9/iu);
    expect(quieter).toContain("text-text-muted");
  });

  it("проверка не пустая: разметка кнопки вообще-то содержит слова", () => {
    // Сторож на самого себя: пустая строка прошла бы все `not.toContain` выше.
    expect(renderClose("loud")).toMatch(/<button[^>]*>/u);
    expect(renderClose("quiet")).toMatch(/<button[^>]*>/u);
    expect(renderClose("loud")).not.toBe(renderClose("quiet"));
    expect(renderClose("quiet")).not.toBe(renderClose("quieter"));
  });
});

// ---------------------------------------------------------------------------
// 3. ГЛАВНОЕ: настоящий экран в настоящей базе (инвариант №1)
// ---------------------------------------------------------------------------

describe("порог: единственное число — счётчик забранного (инвариант №1, тикет 219)", () => {
  it("живые брони: на экране есть число и НЕТ ни имён, ни названий вещей", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const ring = await createItem(owner.room.id, "Кольцо-секрет");
    const bag = await createItem(owner.room.id, "Сумка-секрет");
    await createItem(owner.room.id, "Духи-незанятые"); // без брони — в другое число
    await bookItem({ itemId: ring.id, name: "Секретная Гостья", email: "top-secret@mail.test" });
    await bookItem({ itemId: bag.id, name: "Тайный Даритель", mode: "SIGNED" });

    const view = await getOccasionView(owner.user.id);
    expect(occasionScreenState(view)).toBe("due");
    // Счётчик — ТОТ ЖЕ, что в комнате: считает его одна функция на три
    // поверхности (комната, роут, этот экран).
    expect(view.takenTotal).toBe(2);
    expect(view.takenTotal).toBe(await ownerTakenTotal(owner.user.id));

    const markup = await drawOccasion(owner.user.id);

    // Порог собран: заголовок, лид с числом, блок из трёх строк, полоса,
    // подпись необратимости и тихий выход.
    expect(markup).toContain(words.dueTitle);
    expect(markup).toContain(t("dueLead", { count: 2 }));
    expect(markup).toContain(words.dueWhatOverline);
    for (const line of ["dueNames", "dueDone", "dueUnclaimed"] as const) {
      expect(markup, `строка ${line} пропала с порога`).toContain(words[line]);
    }
    expect(markup).toContain(words.openButton);
    expect(markup).toContain(words.openOnceHint);
    expect(markup).toContain(words.notNow);
    // Тихой дороги на пороге нет: она и есть эта полоса.
    expect(markup).not.toContain(words.manualLink);

    // ИНВАРИАНТ №1: ни имени, ни почты, ни названия занятой вещи — экран их
    // и не может напечатать, потому что сервис их не отдаёт вовсе.
    expect(markup).not.toMatch(/Секретная|Тайный|top-secret|mail\.test/u);
    expect(markup).not.toContain("Кольцо-секрет");
    expect(markup).not.toContain("Сумка-секрет");
    expect(markup).not.toContain("Духи-незанятые");
    expect(markup).not.toContain(ring.id);

    // ПРОВЕРКА НЕ ПУСТАЯ, ЧАСТЬ ПЕРВАЯ: число на экране именно то, а не
    // соседнее (незанятых вещей здесь как раз одна — перепутать легко).
    expect(markup).not.toContain(t("dueLead", { count: 1 }));
    expect(markup).not.toContain(t("dueLead", { count: 0 }));

    // ПРОВЕРКА НЕ ПУСТАЯ, ЧАСТЬ ВТОРАЯ: та же комната и та же разметка после
    // раскрытия имя ПЕЧАТАЕТ. Значит «имён нет» выше — про порог, а не про
    // сломанный рендер.
    await closeOccasion(owner.room.id, { manual: true });
    const opened = await drawOccasion(owner.user.id);
    expect(opened).toContain("Секретная Гостья");
    expect(opened).toContain("Кольцо-секрет");
    expect(opened).not.toContain(words.dueTitle);
  });

  it("ожидание: счётчик блоком, обе тихие ссылки и объяснение без громкой кнопки", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(-30));
    const item = await createItem(owner.room.id, "Плед-секрет");
    await bookItem({ itemId: item.id, name: "Ранняя Гостья", email: "early@mail.test" });

    const view = await getOccasionView(owner.user.id);
    expect(occasionScreenState(view)).toBe("next");
    expect(view.takenTotal).toBe(1);

    const markup = await drawOccasion(owner.user.id);
    expect(markup).toContain(words.aheadTitle);
    expect(markup).toContain(words.aheadHint);
    // Блок счётчика: число, подпись и примечание «больше не покажем».
    expect(markup).toContain(t("takenNumber", { count: 1 }));
    expect(markup).toContain(words.takenCaption);
    expect(markup).toContain(words.takenOnly);
    // Тихая дорога и дата — обе на месте.
    expect(markup).toContain(words.manualOverline);
    expect(markup).toContain(words.manualLink);
    expect(markup).toContain(words.manualHint);
    expect(markup).toContain(words.dateLink);
    // ДАТА НА ЭКРАНЕ ТА ЖЕ, ЧТО В КОМНАТЕ — «День рождения · 14 сентября»
    // (тикет 216: две поверхности отвечают на один вопрос одними словами).
    // Проверка встала сюда, когда пакет 49 снял `aheadNoLoud`: дату несла и
    // та строка, и без неё экран мог бы остаться без даты незамеченным.
    expect(markup).toContain(
      t("nearestLine", { holiday: t("birthdayLabel"), date: onDate(view.next!) }),
    );
    // ПОДПИСИ «ПОЧЕМУ КНОПКИ НЕТ» ЗДЕСЬ БОЛЬШЕ НЕТ (пакет 49 снял
    // `Occasion.aheadNoLoud`, тикет 223): строка объясняла хозяйке наше
    // проектное решение, а её работу делает `aheadHint` выше. Ключа нет и в
    // словаре — сторож словаря упадёт, если он вернётся без разговора.
    // ГРОМКОЙ КНОПКИ НЕТ: полоса света — единственный `border-b-2` экрана.
    expect(markup).not.toContain("border-b-2");
    // И ни слова о том, кто именно занял.
    expect(markup).not.toMatch(/Ранняя|early@|Плед-секрет/u);
  });

  it("комната без даты: громкая полоса ведёт к дате, тихая дорога — к итогу", async () => {
    const owner = await createOwnerWithRoom(null);
    const item = await createItem(owner.room.id, "Ваза-секрет");
    await bookItem({ itemId: item.id, name: "Гостья Без Даты" });

    const view = await getOccasionView(owner.user.id);
    expect(occasionScreenState(view)).toBe("noDate");
    expect(view.takenTotal).toBe(1);

    const markup = await drawOccasion(owner.user.id);
    expect(markup).toContain(words.noDateTitle);
    expect(markup).toContain(words.noDateHint);
    expect(markup).toContain(words.noDateWorks);
    // Полоса света здесь одна и ведёт в настройки — к дате.
    expect(markup).toContain(words.noDateButton);
    expect(markup).toContain(words.noDateButtonHint);
    // Полоса — ссылкой, а не кнопкой: настройки это МЕСТО, туда переходят.
    expect(markup).toMatch(/<a[^>]*border-b-2[^>]*href="\/settings"/u);
    // Дорога к ручному итогу осталась (решение гриллинга №6).
    expect(markup).toContain(words.manualLink);
    // Ожиданию принадлежащих строк здесь нет: даты нет — и обещать нечего.
    expect(markup).not.toContain(words.dateLink);
    expect(markup).not.toContain(words.manualOverline);
    // Счётчик работает и без даты — комната-то работает.
    expect(markup).toContain(t("takenNumber", { count: 1 }));
    expect(markup).not.toMatch(/Без Даты|Ваза-секрет/u);
  });
});

// ---------------------------------------------------------------------------
// 4. Две поверхности сводятся вместе, в настоящей базе
// ---------------------------------------------------------------------------

describe("комната и экран отвечают на «праздник прошёл?» одинаково (тикет 216)", () => {
  it("день рождения вчера, итога нет: комната зовёт — экран зовёт узнать", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));

    // Ровно стенд владельца: день рождения 12-го, приёмка 13-го.
    expect(await occasionBannerVisible(owner.user.id)).toBe(true);
    const view = await getOccasionView(owner.user.id);
    const state = occasionScreenState(view);

    expect(state).toBe("due");
    expect(titleOf(state)).toBe(words.dueTitle);
    expect(titleOf(state)).not.toBe(words.aheadTitle);
    // И дело, за которым он сюда пришёл, стоит на экране громким действием.
    expect(OCCASION_SCREEN[state].loud?.key).toBe("openButton");

    // ПРОВЕРКА НЕ ПУСТАЯ. Старое правило экрана («нет итога → впереди») на
    // этой же комнате дало бы ровно то, что увидел владелец.
    const oldRule = view.summary ? "summary" : "next";
    expect(titleOf(oldRule)).toBe(words.aheadTitle);
  });

  it("обход состояний: где строка в комнате горит, «впереди» на экране не бывает", async () => {
    // Шесть комнат, покрывающих обе причины строки (наступивший праздник без
    // итога и неотмеченные подарки) и обе причины тишины.
    const dueNoSummary = await createOwnerWithRoom(utcMidnightDaysAgo(1));

    const closedWithPending = await createOwnerWithRoom(utcMidnightDaysAgo(2));
    const pendingItem = await createItem(closedWithPending.room.id);
    await bookItem({ itemId: pendingItem.id, name: "Гостья Тихая" });
    await closeOccasion(closedWithPending.room.id);

    const closedClean = await createOwnerWithRoom(utcMidnightDaysAgo(3));
    await closeOccasion(closedClean.room.id);

    const ahead = await createOwnerWithRoom(utcMidnightDaysAgo(-30));
    const dateless = await createOwnerWithRoom(null);

    // Прошлогодний итог рядом с наступившим праздником: итог есть, но он не про
    // этот праздник. Строка в комнате горит — экран показывает прошлый итог и
    // «впереди» всё равно не говорит.
    const staleSummary = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    await prisma.occasionSummary.create({
      data: { roomId: staleSummary.room.id, date: utcMidnightDaysAgo(400) },
    });

    const rooms = [dueNoSummary, closedWithPending, closedClean, ahead, dateless, staleSummary];
    const seen: Array<{ banner: boolean; state: OccasionScreenState }> = [];
    for (const owner of rooms) {
      const banner = await occasionBannerVisible(owner.user.id);
      const state = occasionScreenState(await getOccasionView(owner.user.id));
      seen.push({ banner, state });
      if (banner) {
        expect(titleOf(state), `комната зовёт, а экран отвечает «${titleOf(state)}»`).not.toBe(
          words.aheadTitle,
        );
      }
    }

    // Обход прошёл по обеим сторонам вопроса: и по горящей строке, и по тихой.
    //
    // ЕСЛИ ЭТА ПРОВЕРКА УПАЛА «2 вместо 3» — сначала посмотри, не гонял ли
    // тесты второй процесс. Файл чистит за собой ВСЕХ пользователей своего
    // домена (`@occasion-states.test`), а не только своих: два прогона этого
    // файла разом — и `beforeAll` соседа сносит комнаты, которые этот тест уже
    // засеял. Пропадает ровно бронь, и гореть перестаёт `closedWithPending`.
    // Так это и случилось 13.08: одиночный прогон зелёный, полный тоже, красным
    // был только тот, что шёл рядом с чужим. Логика тут ни при чём.
    expect(seen.filter((row) => row.banner).length).toBeGreaterThanOrEqual(3);
    expect(seen.filter((row) => !row.banner).length).toBeGreaterThanOrEqual(2);
    expect(seen.map((row) => row.state)).toEqual([
      "due",
      "summary",
      "summary",
      "next",
      "noDate",
      "summary",
    ]);
  });

  it("праздник впереди: комната молчит, и громкой кнопки на экране нет", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(-30));

    expect(await occasionBannerVisible(owner.user.id)).toBe(false);
    const view = await getOccasionView(owner.user.id);
    const state = occasionScreenState(view);

    expect(state).toBe("next");
    // Здесь «Итог появится после праздника» — правда, и он стоит с датой.
    expect(titleOf(state)).toBe(words.aheadTitle);
    expect(view.next).not.toBeNull();
    expect(OCCASION_SCREEN[state].nearest).toBe(true);
    // Гореть год до следующего праздника кнопке нечем.
    expect(OCCASION_SCREEN[state].loud).toBeNull();
    expect(OCCASION_SCREEN[state].manual).toBe("quiet");
  });

  it("комната без даты: дорога к итогу осталась, и она работает", async () => {
    const owner = await createOwnerWithRoom(null);

    const state = occasionScreenState(await getOccasionView(owner.user.id));
    expect(state).toBe("noDate");
    expect(OCCASION_SCREEN[state].manual).toBe("quieter");
    expect(OCCASION_SCREEN[state].loud?.action).toBe("date");

    // Решение гриллинга №6 в силе: ручное закрытие без даты закрывает «сегодня».
    const closed = await closeOccasion(owner.room.id, { manual: true });
    expect(closed?.created).toBe(true);
    expect(occasionScreenState(await getOccasionView(owner.user.id))).toBe("summary");
  });
});

// ---------------------------------------------------------------------------
// 5. Кадр комнаты в шапке и адресное «спасибо» (пакет 49, тикет 224)
// ---------------------------------------------------------------------------

/** Кадр комнаты пресета — ровно тот путь, который берёт главный экран. */
const PRESET_FRAME = roomImageUrl(rooms.find((room) => room.id === "cream")!.base);

/** Шапка отдельно от списка: всё до `</header>`. */
function headerOf(markup: string): string {
  const end = markup.indexOf("</header>");
  expect(end, "шапки в разметке нет вовсе").toBeGreaterThan(0);
  return markup.slice(0, end);
}

const countOf = (markup: string, needle: string) => markup.split(needle).length - 1;

/** Слово благодарности — из словаря, а не из теста: ведущий закрыл его пакетом 49. */
const THANKS = words.thanksGuest!;

/** Комната в нужном состоянии — и проверка, что фикстура действительно та. */
async function drawInState(state: OccasionScreenState): Promise<string> {
  const birthday =
    state === "noDate" ? null : utcMidnightDaysAgo(state === "next" ? -30 : 1);
  const owner = await createOwnerWithRoom(birthday);
  if (state === "summary") await closeOccasion(owner.room.id, { manual: true });
  expect(occasionScreenState(await getOccasionView(owner.user.id))).toBe(state);
  return drawOccasion(owner.user.id);
}

describe("шапка итога — кадр СОБСТВЕННОЙ комнаты (пакет 49, тикет 224)", () => {
  it("прозрачность по состоянию — числа контракта, а не наши", () => {
    // Таблица сверяется с самим пакетом: разойдись она с ним — тест покраснеет
    // здесь, а не глазами владельца на стенде.
    const byState = contract.headerPhoto.opacityByState;
    expect(OCCASION_SCREEN.due.photo).toBe(byState.DUE);
    expect(OCCASION_SCREEN.summary.photo).toBe(byState.OPEN);
    expect(OCCASION_SCREEN.next.photo).toBe(byState.AHEAD);
    expect(OCCASION_SCREEN.noDate.photo).toBe(byState.NO_DATE);
    // Проверка не пустая: приглушение действительно разное, а не одно на всех.
    expect(new Set(Object.values(byState)).size).toBe(3);
    // Окно порога выше остальных на 14 px (`crop430.window`: 236, в DUE — 250).
    expect(OCCASION_SCREEN.due.photoHeight).toBe(250);
    for (const state of ["summary", "next", "noDate"] as const) {
      expect(OCCASION_SCREEN[state].photoHeight).toBe(236);
    }
  });

  it("во всех четырёх состояниях в шапке стоит кадр своей комнаты — и он приглушается", async () => {
    const heads = new Map<OccasionScreenState, string>();
    for (const state of ["summary", "due", "next", "noDate"] as const) {
      const markup = await drawInState(state);
      const head = headerOf(markup);
      // ТОТ ЖЕ ФАЙЛ, ЧТО НА ГЛАВНОМ ЭКРАНЕ, и простое кадрирование контракта.
      expect(head, `в состоянии ${state} шапка без кадра`).toContain(
        `background-image:url(${PRESET_FRAME})`,
      );
      expect(head).toContain("background-position:30% 38%");
      expect(head).toContain(`opacity:${OCCASION_SCREEN[state].photo}`);
      expect(head).toContain(`height:${OCCASION_SCREEN[state].photoHeight}px`);
      // Не витрина: `c-hall.jpg` — другое место, и итог не про него.
      expect(markup).not.toContain("c-hall.jpg");
      // Числа кропа сюда не переехали: они привязаны к ширине 430.
      expect(head).not.toMatch(/730px|-14px|-26px/u);
      heads.set(state, head);
    }

    // ПРОВЕРКА НЕ ПУСТАЯ: приглушение живое, а не одно число на четыре экрана.
    expect(heads.get("next")).not.toContain("opacity:1");
    expect(heads.get("noDate")).not.toContain("opacity:1");
    expect(heads.get("due")).not.toContain("opacity:0.5");
    expect(heads.get("noDate")).not.toContain("opacity:0.5");
    expect(heads.get("due")).toContain("height:250px");
    expect(heads.get("next")).not.toContain("height:250px");
  });

  it("НА ПОРОГЕ КАДР НЕ ПРИНОСИТ С СОБОЙ НИ ОДНОГО ИМЕНИ (инвариант №1)", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const item = await createItem(owner.room.id, "Кадр-секрет");
    await bookItem({ itemId: item.id, name: "Гостья В Кадре", email: "in-frame@mail.test" });

    const markup = await drawOccasion(owner.user.id);
    // Кадр на месте — и это своя комната, а не первая подаренная вещь.
    expect(headerOf(markup)).toContain(`background-image:url(${PRESET_FRAME})`);
    expect(markup).not.toMatch(/Гостья В Кадре|in-frame@|Кадр-секрет/u);
    // Фотографий вещей в шапке нет вовсе: кадр один, и он комнатный.
    expect(headerOf(markup)).not.toContain("/i/");
  });
});

describe("«Сказать спасибо» — адресно и только там, где есть куда (пакет 49)", () => {
  /** Открытый итог с заданным составом дарителей. */
  async function openedSummary(guests: Array<{ name: string; email?: string }>) {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    for (const guest of guests) {
      const item = await createItem(owner.room.id, `Вещь ${guest.name}`);
      await bookItem({ itemId: item.id, name: guest.name, email: guest.email });
    }
    await closeOccasion(owner.room.id, { manual: true });
    return { owner, markup: await drawOccasion(owner.user.id) };
  }

  it("у дарителя с почтой строка есть и ведёт письмом ЕМУ; у дарителя без почты её нет вовсе", async () => {
    const { markup } = await openedSummary([
      { name: "Гостья С Почтой", email: "thanks-here@mail.test" },
      { name: "Гостья Без Почты" },
    ]);

    // Экран тот самый: имена раскрыты у обоих (инвариант №2 отработал).
    expect(markup).toContain("Гостья С Почтой");
    expect(markup).toContain("Гостья Без Почты");

    // Строка ровно одна — у того, кому есть куда писать.
    expect(countOf(markup, THANKS)).toBe(1);
    expect(markup).toContain('href="mailto:thanks-here@mail.test"');
    // «Нет почты — строки нет вовсе: не серой, не выключенной, никакой».
    expect(countOf(markup, "mailto:")).toBe(1);
    // Цель нажатия 44 (`thanksGuest.target`) — строка не тоньше пальца.
    expect(markup).toMatch(/min-h-11[^"]*"[^>]*>\s*Сказать спасибо/u);
  });

  it("почты нет ни у кого: не показываем НИЧЕГО — своих слов не сочиняем", async () => {
    const { markup } = await openedSummary([{ name: "Гостья Одна" }, { name: "Гостья Вторая" }]);

    expect(markup).toContain("Гостья Одна");
    expect(countOf(markup, THANKS)).toBe(0);
    expect(markup).not.toContain("mailto:");
    // Тихой пояснительной «почты ни у кого нет — писать некуда» тоже нет:
    // в пакете она названа прозой (`rowGeometry.noEmail`), ключа не существует.
    // Спрошено письмом 54 — до ответа экран об этом молчит.
    expect(markup).not.toMatch(/писать некуда/iu);
    expect((ru.Occasion as Record<string, string>).thanksNoEmail).toBeUndefined();
  });

  it("ПРОВЕРКА НЕ ПУСТАЯ: две почты — две строки, каждая своим адресом", async () => {
    const { markup } = await openedSummary([
      { name: "Первая Гостья", email: "one-thanks@mail.test" },
      { name: "Вторая Гостья", email: "two-thanks@mail.test" },
    ]);

    expect(countOf(markup, THANKS)).toBe(2);
    expect(markup).toContain("mailto:one-thanks@mail.test");
    expect(markup).toContain("mailto:two-thanks@mail.test");
  });

  it("громкой «спасибо всем» у открытого итога нет — решение round49", async () => {
    const { markup } = await openedSummary([
      { name: "Гостья С Почтой", email: "loud-check@mail.test" },
    ]);
    // Полоса света — единственный `border-b-2` продукта; на этом экране её нет.
    expect(markup).not.toContain("border-b-2");
    expect(markup).not.toContain(words.openButton);
  });

  it("после «Дошло» звать писать нечем: бронь с почтой закрыта вместе с адресом", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const item = await createItem(owner.room.id, "Вещь-благодарность");
    await bookItem({ itemId: item.id, name: "Гостья Отмеченная", email: "gone@mail.test" });
    await closeOccasion(owner.room.id, { manual: true });

    expect(countOf(await drawOccasion(owner.user.id), THANKS)).toBe(1);

    await receiveGift(owner.user.id, item.id);
    const after = await drawOccasion(owner.user.id);
    // Имя осталось при вещи (инвариант №2), а адрес ушёл с бронью — и звать
    // писать некуда. Это следствие контракта тикета 09, а не забытая строка.
    expect(after).toContain("Гостья Отмеченная");
    expect(countOf(after, THANKS)).toBe(0);
    expect(after).not.toContain("gone@mail.test");
  });
});
