// Общий транспорт и шаблоны писем (тикет 12) — без БД и без сети.
// Ключевое: без EMAIL_SERVER всё уходит в консоль (dev-режим), рамка
// magic link сохранена байт-в-байт с Phase 0 (её перехватывает e2e тикета
// 15), шаблоны несут имя/вещь/дату/ссылки и экранируют пользовательский
// ввод в HTML.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  formatOccasionDate,
  occasionOwnerMail,
  reminderGuestMail,
  sendMagicLink,
  sendMail,
} from "../src/server/mailer";

const BASE = "https://rooms.test";
const OCCASION_DATE = new Date("2026-03-14T00:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("EMAIL_SERVER", ""); // dev-режим: консоль, nodemailer не трогаем
  vi.stubEnv("APP_BASE_URL", BASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("консольный транспорт (без EMAIL_SERVER)", () => {
  it("sendMail печатает рамку «✉ [письмо] кому / тема / текст» одним вызовом", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendMail({
      to: "guest@example.com",
      subject: "Тема письма",
      text: "строка один\nстрока два",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain("✉  [письмо] guest@example.com");
    expect(output).toContain("   Тема: Тема письма");
    // многострочный текст остаётся внутри рамки — каждая строка с отступом
    expect(output).toContain("\n   строка один\n   строка два");
  });

  it("sendMagicLink: рамка Phase 0 байт-в-байт (её перехватывает e2e тикета 15)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const url = "http://localhost:3000/api/auth/callback/nodemailer?token=abc&email=dev%40x.ru";

    await sendMagicLink("dev@x.ru", url);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`\n✉  [magic link] dev@x.ru\n   ${url}\n`);
  });
});

describe("reminderGuestMail — напоминание гостю за 3 дня", () => {
  const params = {
    guestName: "Паша",
    ownerName: "Мила",
    itemTitle: "Серьги-каффы",
    occasionDate: OCCASION_DATE,
    roomSlug: "x7k2m9",
  };

  it("несёт имя гостя, имя хозяйки, вещь, дату по-русски и обе ссылки", () => {
    const mail = reminderGuestMail(params);

    expect(mail.subject).toBe("Праздник уже близко — 14 марта");
    expect(mail.text).toContain("Здравствуйте, Паша!");
    // имя хозяйки — в именительном падеже, displayName не склоняем
    expect(mail.text).toContain("Мила отмечает праздник 14 марта");
    expect(mail.text).toContain("«Серьги-каффы»");
    expect(mail.text).toContain(`${BASE}/my-bookings`);
    expect(mail.text).toContain(`${BASE}/r/x7k2m9`);

    expect(mail.html).toContain(`href="${BASE}/my-bookings"`);
    expect(mail.html).toContain(`href="${BASE}/r/x7k2m9"`);
    expect(mail.html).toContain("Серьги-каффы");
    expect(mail.html).toContain("14 марта");
  });

  it("без displayName хозяйки письмо связно и без слова null", () => {
    const mail = reminderGuestMail({ ...params, ownerName: null });

    expect(mail.subject).toBe("Праздник уже близко — 14 марта");
    expect(mail.text).toContain("Праздник уже близко: 14 марта.");
    expect(mail.text).toContain("Вы заняли подарок: «Серьги-каффы»");
    expect(mail.text).not.toContain("null");
    expect(mail.html).not.toContain("null");
  });

  it("пользовательский ввод в HTML экранируется (имя и название вещи)", () => {
    const mail = reminderGuestMail({
      ...params,
      guestName: `Паша <script>alert(1)</script>`,
      itemTitle: `Кружка <странная> & "любимая"`,
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Кружка &lt;странная&gt; &amp; &quot;любимая&quot;");
    // plain-текст не трогаем — там экранировать нечего
    expect(mail.text).toContain(`Кружка <странная> & "любимая"`);
  });
});

describe("occasionOwnerMail — хозяйке после праздника", () => {
  it("зовёт открыть «что подарили» по ссылке, обращается по имени", () => {
    const mail = occasionOwnerMail({
      ownerName: "Мила",
      occasionUrl: `${BASE}/room/occasion`,
    });

    expect(mail.subject).toContain("что подарили");
    expect(mail.text).toContain("Мила, привет!");
    expect(mail.text).toContain(`${BASE}/room/occasion`);
    expect(mail.html).toContain(`href="${BASE}/room/occasion"`);
  });

  it("без displayName — просто «Привет!», без слова null", () => {
    const mail = occasionOwnerMail({ ownerName: null, occasionUrl: `${BASE}/room/occasion` });
    expect(mail.text).toContain("Привет!");
    expect(mail.text).not.toContain("null");
    expect(mail.html).not.toContain("null");
  });
});

describe("помощники", () => {
  it("formatOccasionDate — русская дата по UTC-суткам (полночь UTC не уезжает)", () => {
    expect(formatOccasionDate(OCCASION_DATE)).toBe("14 марта");
    expect(formatOccasionDate(new Date("2026-12-31T23:59:59.000Z"))).toBe("31 декабря");
  });

  it("appUrl строит абсолютную ссылку от APP_BASE_URL", () => {
    expect(appUrl("/my-bookings")).toBe(`${BASE}/my-bookings`);
  });
});
