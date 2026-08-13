// Тикет 227: «Отдать ссылку на комнату» на пустых «Друзьях» ничего не делала.
//
// ЧТО БЫЛО. Кнопка была `<Link href="/room">`: она называла действие и уводила
// человека ИСКАТЬ это действие в другом экране. Приёмка владельца 14.08.2026
// прочла это ровно так, как оно и выглядит: «при нажатии ничего не
// происходит». Пустые «Друзья» — единственное место, куда приходят именно за
// тем, чтобы отдать ссылку, и оно одно эту ссылку не отдавало.
//
// ЧТО СТОРОЖИТ ТЕСТ. Две вещи, и вторая важнее первой:
//
// 1. нажимаемое на этом экране — КНОПКА, а не дорога в комнату. Ловится
//    разметкой: якоря и `href` в ней быть не должно вовсе;
// 2. ПРЕДУСЛОВИЕ ШЕРА ОТРАБАТЫВАЕТ ЗДЕСЬ ТАК ЖЕ, КАК В КОМНАТЕ. Перед ПЕРВЫМ
//    шером просим укрепить аккаунт (тикет 94, доска Б8) — и это то место, где
//    вторая кнопка шера провалилась бы ТИХО: ссылку она бы отдала, а просьбу
//    молча пропустила, и заметить это можно было бы только потеряв комнату.
//    Поэтому сторожим не «есть кнопка», а «логика ровно одна на два экрана»:
//    поведение приходит хуком из кнопки комнаты, а решение «просить ли» —
//    тем же вызовом `shouldAskToHarden`, что на странице комнаты.
//
// ПОЧЕМУ РЕНДЕРОМ И ЧТЕНИЕМ, А НЕ НАЖАТИЕМ. В наборе нет ни jsdom, ни
// testing-library (vitest поднят с `environment: "node"`), а зависимостей
// тикет не добавляет. Разметкой проверяется всё, что видно без нажатия;
// остальное — тем, что второй реализации в файле нет физически.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ru from "../messages/ru.json";

// Словарь настоящий: слова кнопки — часть проверки (тикет просил их не менять).
vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, string | number>) =>
      (dict[ns]?.[key] ?? key).replace(/\{(\w+)\}/gu, (whole, name: string) =>
        values?.[name] === undefined ? whole : String(values[name]),
      ),
    useLocale: () => "ru",
  };
});

// Серверные экшены укрепления зовутся из браузера — в юните им нужен только
// вызов, не настоящий Auth.js (иначе за ними приедут next-auth и Prisma).
vi.mock("../src/app/room/harden-actions", () => ({
  markHardenAskedAction: vi.fn(async () => undefined),
  linkSecondAuthAction: vi.fn(async () => undefined),
}));

const { ShareRoomButton } = await import("../src/app/connections/share-room-button");
const { HardenAskCard, ShareAddressCard, ShareButton } =
  await import("../src/app/room/share-button");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const connectionsPage = read("../src/app/connections/page.tsx");
const connectionsButton = read("../src/app/connections/share-room-button.tsx");
const roomPage = read("../src/app/room/page.tsx");
const roomButton = read("../src/app/room/share-button.tsx");

const ACCENT = "#E7C9A9";
const PATH = "/r/irina";

/** Кнопка пустых «Друзей» так, как её увидит браузер до первого нажатия. */
const drawConnections = (harden?: { providers: string[] } | null) =>
  renderToStaticMarkup(createElement(ShareRoomButton, { path: PATH, accent: ACCENT, harden }));

/** Пробелы и переносы не считаем: сверяем СМЫСЛ вызова, а не его вёрстку. */
const squeeze = (text: string) => text.replace(/\s+/gu, " ").trim();

/**
 * Исходник БЕЗ комментариев. Запреты ниже — про код, а не про прозу: без этого
 * первым же нарушителем «второй ссылки в комнату» стал бы рассказ о том, что
 * её здесь больше нет. Сторож, ловящий собственную объяснительную записку, —
 * ровно тот сторож, который потом молчит про настоящую поломку.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");

/** Вызов `shouldAskToHarden({…})` целиком — от имени до закрывающей скобки. */
function hardenCall(source: string): string {
  const code = stripComments(source);
  const start = code.indexOf("shouldAskToHarden({");
  expect(start, "вызов политики укрепления пропал").toBeGreaterThan(0);
  const end = code.indexOf("})", start);
  return squeeze(code.slice(start, end + 2));
}

describe("тикет 227 — кнопка отдаёт ссылку там, где на неё нажали", () => {
  it("это кнопка, а не ссылка: ни якоря, ни href в разметке нет вовсе", () => {
    const markup = drawConnections();

    expect(markup).toContain('<button type="button"');
    // Главное утверждение тикета: нажатие больше никуда не уводит.
    expect(markup, "кнопка снова стала ссылкой").not.toMatch(/<a[\s>]/u);
    expect(markup, "href на экране друзей означает уход из него").not.toMatch(/href=/u);
    expect(markup).not.toContain("/room");
  });

  it("слова кнопки те же самые — они верные (границы тикета)", () => {
    expect(drawConnections()).toContain(ru.Connections.emptyShare);
    expect(ru.Connections.emptyShare).toBe("Отдать ссылку на комнату");
  });

  it("на странице пустых друзей стоит она, а дорога в комнату осталась одна — «назад»", () => {
    const empty = stripComments(
      connectionsPage.slice(
        connectionsPage.indexOf("showEmptyState && ("),
        connectionsPage.indexOf("<WhatsHappening"),
      ),
    );
    expect(empty, "пустое состояние не найдено — проверь разметку страницы").not.toBe("");
    expect(empty).toContain("<ShareRoomButton");
    expect(empty).not.toMatch(/href=/u);

    // `href="/room"` на странице ровно один — верхняя ссылка «В комнату».
    const links = [...connectionsPage.matchAll(/href="\/room"/gu)];
    expect(links).toHaveLength(1);
    expect(connectionsPage).toMatch(/href="\/room"[\s\S]{0,120}backToRoom/u);
  });

  it("адрес комнаты — красивый, с ником: тот же, что отдаёт комната (тикет 13)", () => {
    expect(connectionsPage).toContain("const sharePath = `/r/${room.nick ?? room.shareSlug}`;");
    expect(roomPage).toContain("const sharePath = `/r/${room.nick ?? room.shareSlug}`;");
    expect(connectionsPage).toContain("path={sharePath}");
  });
});

describe("тикет 227 — предусловие укрепления (тикет 94) отрабатывает и здесь", () => {
  it("страница считает просьбу ТЕМ ЖЕ вызовом политики, что страница комнаты", () => {
    // Политика одна и живёт в services/harden: экраны её только читают.
    // Разъедутся вызовы — этот тест падает раньше, чем человек потеряет
    // комнату, не увидев просьбы.
    expect(hardenCall(connectionsPage)).toBe(hardenCall(roomPage));
    expect(connectionsPage).toContain("getHardenState(userId)");
    expect(connectionsPage).toContain("{ providers: hardenState.available }");
    // И результат доезжает до кнопки — иначе просьба провалилась бы молча.
    expect(connectionsPage).toContain("harden={harden}");
  });

  it("карточка просьбы — та же самая: и «привязать», и «поделиться без этого»", () => {
    const markup = renderToStaticMarkup(
      createElement(HardenAskCard, {
        providers: ["google"],
        accent: ACCENT,
        onSkip: () => undefined,
      }),
    );

    expect(markup).toContain(ru.Room.hardenOverline);
    expect(markup).toContain(ru.Room.hardenBody);
    // Имя провайдера человеку — «Google», а не «google».
    expect(markup).toContain("Привязать Google и поделиться");
    // Отказ разрешён и на доске: уйти без ответа можно всегда.
    expect(markup).toContain(ru.Room.hardenSkip);
    expect(markup.match(/<button/gu)).toHaveLength(2);
  });

  it("до нажатия просьбы не видно: она не плашка экрана, а шаг шера", () => {
    const markup = drawConnections({ providers: ["google"] });
    expect(markup).not.toContain(ru.Room.hardenOverline);
    expect(markup).not.toContain(ru.Room.hardenSkip);
    // И подтверждения с адресом тоже: оно появляется после копирования.
    expect(markup).not.toContain(ru.Room.copied);
    expect(markup).not.toContain(PATH);
  });

  it("второй логики шера не завелось: файл кнопки не знает ни про буфер, ни про окно", () => {
    const code = stripComments(connectionsButton);
    expect(code).toContain('from "@/app/room/share-button"');
    expect(code).toContain("useRoomShare({ path, harden })");
    for (const forbidden of [
      /navigator\./u,
      /clipboard/iu,
      /execCommand/u,
      /markHardenAsked/u,
      /linkSecondAuth/u,
      /<Link/u,
    ]) {
      expect(code, `вторая реализация шера: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("оба экрана держатся за ОДИН хук — поведение у них общее по построению", () => {
    const room = stripComments(roomButton);
    expect(room).toContain("export function useRoomShare({");
    expect(room).toContain("useRoomShare({ path, harden })");
    expect(stripComments(connectionsButton)).toContain("useRoomShare({ path, harden })");
    // Просьба и подтверждение — тоже общие: у экранов разнится только место.
    expect(room).toContain("export function HardenAskCard({");
    expect(room).toContain("export function ShareAddressCard({");
  });
});

describe("комната от переезда не изменилась", () => {
  it("в полосе по-прежнему круг со знаком и подписью «Скопировать ссылку»", () => {
    const markup = renderToStaticMarkup(
      createElement(ShareButton, { path: PATH, accent: ACCENT, harden: null }),
    );

    expect(markup).toContain(`aria-label="${ru.Room.copy}"`);
    expect(markup).toContain("rounded-full");
    expect(markup.match(/<svg/gu)).toHaveLength(1);
    expect(markup).not.toMatch(/<a[\s>]/u);
  });

  it("карточки комнаты всплывают над полосой, а на «Друзьях» стоят в потоке", () => {
    // Разница между экранами ровно одна — место карточки; сам вид общий.
    expect(roomButton).toContain(
      'className="absolute right-0 bottom-[calc(100%+10px)] w-[min(340px,84vw)]"',
    );
    expect(connectionsButton).toContain('className="mt-4 w-full"');
    const flow = renderToStaticMarkup(
      createElement(ShareAddressCard, { path: PATH, accent: ACCENT, className: "mt-4 w-full" }),
    );
    // Подтверждение нажатий не перехватывает — где бы оно ни стояло.
    expect(flow).toContain("pointer-events-none");
    expect(flow).toContain(PATH);
  });
});
