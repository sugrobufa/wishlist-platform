// ЭКРАН «ЧТО ПОДАРИЛИ» ЗНАЕТ, ПРОШЁЛ ЛИ ПРАЗДНИК (тикеты 216 и 217, приёмка
// владельца 13.08.2026).
//
// ЗАМЕЧАНИЕ ДОСЛОВНО: «Написано праздник еще впереди и кнопка праздник прошел…
// на этой форме я оказался когда нажал кнопку на главном экране что праздник
// прошел, но он еще оказывается впереди». Две поверхности отвечали на ОДИН
// вопрос по разным данным: комната считала наступивший день рождения, экран
// смотрел только на существование итога.
//
// Поэтому здесь три проверки, и главная — третья:
//
// 1. таблица состояний (`screen-state`) — чем говорит каждое из четырёх;
// 2. кнопка (тикет 217) — слово-действие, стрелки нет, тон по состоянию;
// 3. **СВОДКА ДВУХ ПОВЕРХНОСТЕЙ В НАСТОЯЩЕЙ БАЗЕ**: там, где
//    `occasionBannerVisible` даёт true, экран НЕ имеет права говорить
//    «Праздник ещё впереди». Это и есть замечание владельца, и оно обязано
//    быть под тестом, а не под глазами.
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

// Клиентская кнопка рендерится НАСТОЯЩАЯ — с её же словами из ru.json. Мокаются
// только две вещи, которых в node нет: маршрутизатор и серверные экшены.
vi.mock("next-intl", () => ({
  useTranslations: (namespace: keyof typeof ru) => (key: string) =>
    (ru[namespace] as Record<string, string>)[key] ?? `нет ключа ${String(namespace)}.${key}`,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("../src/app/room/occasion/actions", () => ({
  closeOccasionAction: vi.fn(async () => undefined),
  receiveGiftAction: vi.fn(async () => undefined),
}));

import { prisma } from "../src/server/db";
import { birthdayColumns, parseBirthday } from "../src/server/birthday";
import {
  closeOccasion,
  getOccasionView,
  occasionBannerVisible,
} from "../src/server/services/occasions";
import { bookItem } from "../src/server/services/bookings";
import {
  OCCASION_SCREEN,
  occasionScreenState,
  type OccasionScreenState,
} from "../src/app/room/occasion/screen-state";
import { CloseOccasionButton } from "../src/app/room/occasion/occasion-client";

const TEST_EMAIL_DOMAIN = "@occasion-states.test";
const words = ru.Occasion as Record<string, string>;

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

async function createItem(roomId: string) {
  return prisma.item.create({
    data: {
      roomId,
      zone: "jewelry",
      inHall: false,
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
    },
  });
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

describe("состояний четыре, и каждое говорит своё (тикет 216)", () => {
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

  it("праздник НАСТУПИЛ: «Праздник прошёл», своя подсказка и громкое действие", () => {
    expect(titleOf("due")).toBe("Праздник прошёл");
    expect(OCCASION_SCREEN.due.hint).toBe("dueHint");
    expect(OCCASION_SCREEN.due.close).toBe("loud");
    // Дату ближайшего здесь не показываем: ближайший — через год, а разговор
    // про тот, что уже прошёл.
    expect(OCCASION_SCREEN.due.nearest).toBe(false);
    expect(OCCASION_SCREEN.due.settings).toBe(false);
  });

  it("праздник ВПЕРЕДИ: «Праздник ещё впереди» с датой и БЕЗ громкой кнопки", () => {
    expect(titleOf("next")).toBe("Праздник ещё впереди");
    expect(OCCASION_SCREEN.next.hint).toBe("notClosedHint");
    // Дата строкой — тем же видом, что в комнате: «День рождения · 14 сентября».
    expect(OCCASION_SCREEN.next.nearest).toBe(true);
    // Дорогу не убираем (решение гриллинга №6), но гореть год она не должна.
    expect(OCCASION_SCREEN.next.close).toBe("quiet");
  });

  it("дня рождения НЕТ: про дату — своя строка и тихая ссылка в настройки", () => {
    expect(titleOf("noDate")).toBe("Праздник ещё впереди");
    expect(OCCASION_SCREEN.noDate.hint).toBe("notClosedNoDate");
    expect(OCCASION_SCREEN.noDate.settings).toBe(true);
    // «Когда он пройдёт» такой комнате сказать нечем — даты нет.
    expect(OCCASION_SCREEN.noDate.nearest).toBe(false);
    // Ручное закрытие — её единственная дорога, но и она не срочная.
    expect(OCCASION_SCREEN.noDate.close).toBe("quiet");
  });

  it("итог открыт: заголовок и подсказку собирает своя ветка, кнопки нет", () => {
    expect(OCCASION_SCREEN.summary).toEqual({
      title: null,
      hint: null,
      nearest: false,
      close: null,
      settings: false,
    });
  });

  it("разметка берёт слова ИЗ таблицы, а не мимо неё", () => {
    // Иначе таблица стала бы вторым описанием экрана — и разъехалась бы с ним
    // ровно так же, как разъехались комната и экран (тикет 216).
    const page = readSource("../src/app/room/occasion/page.tsx");
    expect(page).toContain("OCCASION_SCREEN[occasionScreenState(view)]");
    expect(page).toContain("screen.close");
    expect(page).toContain("screen.settings");
    expect(page).not.toMatch(/t\("notClosedTitle"\)|t\("dueTitle"\)|t\("notClosedHint"\)/u);
  });
});

// ---------------------------------------------------------------------------
// 2. Кнопка — действие, а не состояние (тикет 217)
// ---------------------------------------------------------------------------

/** Настоящая разметка кнопки — тем же React, что в браузере. */
function renderClose(tone: "loud" | "quiet"): string {
  return renderToStaticMarkup(createElement(CloseOccasionButton, { accent: "#E7C9A9", tone }));
}

describe("кнопка итога: слово-действие, без стрелки, тон по состоянию (тикет 217)", () => {
  it("главная кнопка называет ДЕЙСТВИЕ и не повторяет заголовок", () => {
    const html = renderClose("loud");
    expect(html).toContain("Показать, кто что подарил");
    // Заголовок наступившего праздника — «Праздник прошёл»; кнопка рядом с ним
    // повторяла его слово в слово и не называла, что произойдёт по нажатию.
    expect(html).not.toContain("Праздник прошёл");
    expect(titleOf("due")).toBe("Праздник прошёл");
  });

  it("СТРЕЛКИ НЕТ: её приписывал код строкой, а не контракт", () => {
    expect(renderClose("loud")).not.toContain("→");
    expect(renderClose("quiet")).not.toContain("→");
  });

  it("«полоса света» осталась полосой света: пол 2 px и свечение акцента", () => {
    const html = renderClose("loud");
    expect(html).toContain("border-b-2");
    expect(html).toMatch(/border-color:\s*#E7C9A9/iu);
    expect(html).toMatch(/box-shadow/iu);
  });

  it("тихий тон — тем же тоном, что «В комнату»: ни полосы, ни свечения", () => {
    const html = renderClose("quiet");
    expect(html).toContain("Праздник уже был — подвести итог");
    expect(html).not.toContain("border-b-2");
    expect(html).not.toMatch(/box-shadow/iu);
    // Тон ссылки «В комнату» — тот же класс, что у неё в шапке экрана.
    expect(html).toContain("text-xs font-semibold text-text-strong");
  });

  it("проверка не пустая: разметка кнопки вообще-то содержит слова", () => {
    // Сторож на самого себя: пустая строка прошла бы все `not.toContain` выше.
    expect(renderClose("loud")).toMatch(/<button[^>]*>/u);
    expect(renderClose("quiet")).toMatch(/<button[^>]*>/u);
    expect(renderClose("loud")).not.toBe(renderClose("quiet"));
  });
});

// ---------------------------------------------------------------------------
// 3. ГЛАВНОЕ: две поверхности сводятся вместе, в настоящей базе
// ---------------------------------------------------------------------------

describe("комната и экран отвечают на «праздник прошёл?» одинаково (тикет 216)", () => {
  it("день рождения вчера, итога нет: комната зовёт — экран говорит «Праздник прошёл»", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));

    // Ровно стенд владельца: день рождения 12-го, приёмка 13-го.
    expect(await occasionBannerVisible(owner.user.id)).toBe(true);
    const view = await getOccasionView(owner.user.id);
    const state = occasionScreenState(view);

    expect(state).toBe("due");
    expect(titleOf(state)).toBe("Праздник прошёл");
    expect(titleOf(state)).not.toBe("Праздник ещё впереди");
    // И дело, за которым он сюда пришёл, стоит на экране громким действием.
    expect(OCCASION_SCREEN[state].close).toBe("loud");

    // ПРОВЕРКА НЕ ПУСТАЯ. Старое правило экрана («нет итога → впереди») на
    // этой же комнате дало бы ровно то, что увидел владелец.
    const oldRule = view.summary ? "summary" : "next";
    expect(titleOf(oldRule)).toBe("Праздник ещё впереди");
  });

  it("обход состояний: где строка в комнате горит, «впереди» на экране не бывает", async () => {
    // Пять комнат, покрывающих обе причины строки (наступивший праздник без
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
          "Праздник ещё впереди",
        );
      }
    }

    // Обход прошёл по обеим сторонам вопроса: и по горящей строке, и по тихой.
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
    // Здесь «Праздник ещё впереди» — правда, и он стоит с датой.
    expect(titleOf(state)).toBe("Праздник ещё впереди");
    expect(view.next).not.toBeNull();
    expect(OCCASION_SCREEN[state].nearest).toBe(true);
    // Гореть год до следующего праздника кнопка не будет.
    expect(OCCASION_SCREEN[state].close).toBe("quiet");
  });

  it("комната без даты: дорога к итогу осталась, и она работает", async () => {
    const owner = await createOwnerWithRoom(null);

    const state = occasionScreenState(await getOccasionView(owner.user.id));
    expect(state).toBe("noDate");
    expect(OCCASION_SCREEN[state].close).toBe("quiet");
    expect(OCCASION_SCREEN[state].settings).toBe(true);

    // Решение гриллинга №6 в силе: ручное закрытие без даты закрывает «сегодня».
    const closed = await closeOccasion(owner.room.id, { manual: true });
    expect(closed?.created).toBe(true);
    expect(occasionScreenState(await getOccasionView(owner.user.id))).toBe("summary");
  });
});
