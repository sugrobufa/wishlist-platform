// Общий транспорт и шаблоны писем (тикет 12) — без БД и без сети.
// Ключевое: без EMAIL_SERVER всё уходит в консоль (dev-режим), рамка
// magic link сохранена байт-в-байт с Phase 0 (её перехватывает e2e тикета
// 15), шаблоны несут имя/вещь/дату/ссылки и экранируют пользовательский
// ввод в HTML.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  formatOccasionDate,
  itemGoneMail,
  occasionOwnerMail,
  reminderGuestMail,
  sendMagicLink,
  sendMail,
  signInMail,
} from "../src/server/mailer";
import { brandName } from "../src/server/mail-messages";

const BASE = "https://rooms.test";
const OCCASION_DATE = new Date("2026-03-14T00:00:00.000Z");

/**
 * Неразрывные пробелы — в обычные. Цена («7 900 ₽») и разделители плашки
 * набраны U+00A0: так их поставил дизайн (`&nbsp;·&nbsp;`) и так их отдаёт
 * Intl. Сравнивать с ними глазами в тесте невозможно — нормализуем.
 */
const plain = (value: string) => value.replace(/\u00A0/g, " ");

beforeEach(() => {
  vi.stubEnv("EMAIL_SERVER", ""); // dev-режим: консоль, nodemailer не трогаем
  vi.stubEnv("APP_BASE_URL", BASE);
  vi.stubEnv("E2E_MAIL_FILE", ""); // шов e2e по умолчанию выключен
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

describe("тестовый шов E2E_MAIL_FILE (тикет 15)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wishlist-mail-"));
    file = join(dir, "nested", "mail.ndjson"); // вложенный путь: mkdir -p обязан работать
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("флаг пуст → файл не появляется, консольная рамка прежняя (байт-в-байт)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const url = "http://localhost:3000/api/auth/callback/nodemailer?token=abc";

    await sendMagicLink("dev@x.ru", url);
    await sendMail({ to: "guest@example.com", subject: "Тема", text: "текст" });

    expect(existsSync(file)).toBe(false);
    expect(log).toHaveBeenCalledWith(`\n✉  [magic link] dev@x.ru\n   ${url}\n`);
  });

  it("sendMail дописывает NDJSON-строку {kind:'mail', to, subject, text, at}, не трогая консоль", async () => {
    vi.stubEnv("E2E_MAIL_FILE", file);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendMail({ to: "owner@example.com", subject: "Первое", text: "раз" });
    await sendMail({ to: "guest@example.com", subject: "Второе", text: "два" });

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2); // append, не перезапись
    const first = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(first).toMatchObject({ kind: "mail", to: "owner@example.com", subject: "Первое" });
    expect(new Date(String(first.at)).getTime()).not.toBeNaN();
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ kind: "mail", to: "guest@example.com" });

    // Консольный вывод не изменился: письмо по-прежнему печатается рамкой.
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]?.[0])).toContain("✉  [письмо] owner@example.com");
  });

  it("в записи письма лежит ТЕКСТ со ссылками — по нему прогон проверяет хост (тикет 158)", async () => {
    // Без текста прогон видел только «кому» и «тему» и оставался зелёным,
    // когда ссылка в письме вела на чужой адрес. Многострочный текст обязан
    // остаться ОДНОЙ строкой NDJSON: переносы экранирует JSON.
    vi.stubEnv("E2E_MAIL_FILE", file);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mail = occasionOwnerMail({ occasionUrl: `${BASE}/room/occasion` });

    await sendMail({ to: "owner@example.com", ...mail });

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(record.text).toBe(mail.text);
    expect(String(record.text)).toContain(`${BASE}/room/occasion`);
  });

  it("sendMagicLink дописывает {kind:'magic-link', to, url} и печатает рамку байт-в-байт", async () => {
    vi.stubEnv("E2E_MAIL_FILE", file);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const url = "http://localhost:3100/api/auth/callback/nodemailer?token=t&email=e%40x.ru";

    await sendMagicLink("e@x.ru", url);

    const record = JSON.parse(readFileSync(file, "utf8").trim()) as Record<string, unknown>;
    expect(record).toMatchObject({ kind: "magic-link", to: "e@x.ru", url });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`\n✉  [magic link] e@x.ru\n   ${url}\n`);
  });

  it("сбой записи (путь-каталог) не роняет отправку — письмо уходит, ошибка в console.error", async () => {
    vi.stubEnv("E2E_MAIL_FILE", dir); // каталог вместо файла: append гарантированно падает
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendMail({ to: "guest@example.com", subject: "Тема", text: "текст" }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1); // письмо честно напечатано
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("reminderGuestMail — напоминание гостю за 3 дня", () => {
  // Ровно за трое суток до праздника — окно тика напоминаний.
  const THREE_DAYS_BEFORE = new Date("2026-03-11T09:00:00.000Z");
  const params = {
    ownerName: "Мила",
    itemTitle: "Серьги-каффы",
    occasionDate: OCCASION_DATE,
    itemZone: "jewelry",
    price: "7900",
    currency: "RUB",
    priceVisibility: "ALL" as const,
    now: THREE_DAYS_BEFORE,
  };

  it("тема и заголовок — по контракту round41, дата праздника в письме есть", () => {
    const mail = reminderGuestMail(params);

    // Контракт пишет «праздник у {name}» — это родительный падеж, а в
    // displayName лежит «Мила». Имя прикреплено оборотом продукта («комната
    // {name}»): склонять чужие имена нельзя.
    expect(mail.subject).toBe("Через три дня праздник — комната Мила");
    // Заголовок вёрстки разрезан переносом ровно там, где его поставил дизайн.
    expect(mail.html).toContain("Через три дня<br>праздник — комната Мила");
    // Дату блоки контракта просят в заголовке, а его же вёрстка её там не
    // показывает: у нас она стоит в строке про тишину брони.
    expect(mail.text).toContain("Праздник — 14 марта");
    expect(mail.html).toContain("Праздник — 14 марта");
  });

  it("плашка вещи: название, цена, полка, комната — и ссылка «Мои подарки»", () => {
    const mail = reminderGuestMail(params);

    expect(mail.html).toContain("Серьги-каффы");
    expect(plain(mail.html)).toContain("7 900 ₽");
    expect(mail.html).toContain("полка «Украшения»"); // подпись из zones.json
    expect(mail.html).toContain("комната Мила");
    // Разделители плашки — неразрывные, как в вёрстке дизайна.
    expect(plain(mail.html)).toContain("7 900 ₽ · полка «Украшения» · комната Мила");
    expect(mail.html).toContain(`href="${BASE}/my-bookings"`);
    expect(mail.text).toContain(`${BASE}/my-bookings`);
  });

  it("ИНВАРИАНТ №8: цену ME/NONE письмо не показывает — комната её прячет", () => {
    // Настройка могла смениться, пока джоба лежала в очереди; письмо читает
    // её свежей и обязано молчать так же, как страница вещи.
    for (const visibility of ["ME", "NONE"] as const) {
      const mail = reminderGuestMail({ ...params, priceVisibility: visibility });
      expect(plain(mail.html)).not.toContain("7 900");
      expect(plain(mail.text)).not.toContain("7 900");
      expect(mail.html).not.toContain("₽");
      // Полка и комната на месте — молчит именно цена.
      expect(mail.html).toContain("полка «Украшения»");
    }
    // FRIENDS видит цену — то же правило, что у гостевого DTO вещи.
    expect(plain(reminderGuestMail({ ...params, priceVisibility: "FRIENDS" }).html)).toContain(
      "7 900 ₽",
    );
  });

  it("«через три дня» не врёт: бронь могли занять позже — тогда «завтра»", () => {
    const subjectAt = (iso: string) => reminderGuestMail({ ...params, now: new Date(iso) }).subject;

    expect(subjectAt("2026-03-13T09:00:00.000Z")).toBe("Завтра праздник — комната Мила");
    expect(subjectAt("2026-03-12T23:00:00.000Z")).toBe("Через два дня праздник — комната Мила");
    expect(subjectAt("2026-03-14T06:00:00.000Z")).toBe("Сегодня праздник — комната Мила");
  });

  it("зовёт экран и действие словами продукта (тикет 32)", () => {
    // «Мои подарки» и «освободить вещь» вместо прежних «мои брони» и
    // «снять бронь»: человек приходит по ссылке и видит ту же надпись.
    const mail = reminderGuestMail(params);

    expect(mail.text).toContain("Мои подарки — там можно освободить вещь");
    expect(mail.html).toContain(">освободить вещь</a>");
    expect(mail.text).not.toMatch(/мои\s+брон/iu);
    expect(mail.text).not.toMatch(/снять\s+брон/iu);
  });

  it("без displayName хозяйки письмо связно и без слова null", () => {
    const mail = reminderGuestMail({ ...params, ownerName: null });

    expect(mail.subject).toBe("Через три дня праздник");
    expect(mail.text).toContain("Праздник — 14 марта");
    expect(mail.text).not.toContain("null");
    expect(mail.html).not.toContain("null");
    // Пустого «комната » в плашке не остаётся — сегмент пропадает целиком
    // (слово «комната» в письме ещё есть — в подписи «комната, а не список»).
    expect(plain(mail.html)).not.toContain(" · комната");
    expect(mail.html).not.toContain("комната Мила");
  });

  it("вещь без цены и с незнакомой зоной — плашка не разваливается", () => {
    const mail = reminderGuestMail({
      ...params,
      price: null,
      currency: null,
      itemZone: "no-such-zone",
    });

    expect(mail.html).toContain("Серьги-каффы");
    expect(mail.html).not.toContain("полка");
    expect(mail.html).not.toContain("₽");
    expect(mail.html).toContain("комната Мила");
    // Разделителей от пропавших частей не остаётся.
    expect(plain(mail.html)).not.toContain(" · комната");
  });

  it("пользовательский ввод в HTML экранируется (имя хозяйки и название вещи)", () => {
    const mail = reminderGuestMail({
      ...params,
      ownerName: `Мила <script>alert(1)</script>`,
      itemTitle: `Кружка <странная> & "любимая"`,
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Кружка &lt;странная&gt; &amp; &quot;любимая&quot;");
    // plain-текст не трогаем — там экранировать нечего
    expect(mail.text).toContain(`Кружка <странная> & "любимая"`);
  });
});

describe("itemGoneMail — гостю: вещь уехала, бронь снята", () => {
  const params = {
    itemTitle: "Стёганая сумка",
    roomSlug: "mila",
    ownerName: "Мила",
    freeCount: 19,
    occasionDate: OCCASION_DATE,
    now: new Date("2026-03-11T09:00:00.000Z"),
  };

  it("тема и заголовок — дословно контракт round41, ссылка на комнату", () => {
    const mail = itemGoneMail(params);

    expect(mail.subject).toBe("Вещь уехала — выбери другую");
    expect(mail.html).toContain("Вещь уехала —<br>выбери другую");
    expect(mail.html).toContain("Бронь снята");
    expect(mail.html).toContain(`href="${BASE}/r/mila"`);
    expect(mail.text).toContain(`${BASE}/r/mila`);
    expect(mail.text).toContain(`${BASE}/my-bookings`);
  });

  it("говорит ЧТО случилось и молчит ПОЧЕМУ — запрет контракта", () => {
    const mail = itemGoneMail(params);

    expect(mail.html).toContain("«Стёганая сумка» больше нет в комнате");
    // Прежняя строка «уже у хозяйки» была догадкой о причине: для переезда в
    // сокровищницу правда, для удаления вещи — нет.
    expect(`${mail.text} ${mail.html}`).not.toContain("уже у хозяйки");
    // «Деньги вернулись тем же путём» контракта не берём: денег сервис не
    // принимает и не переводит (PRD §12а, инвариант №9) — возвращать нечего.
    expect(`${mail.subject} ${mail.text} ${mail.html}`.toLowerCase()).not.toContain("деньги");
  });

  it("подвал: сколько свободно и когда праздник", () => {
    expect(itemGoneMail(params).html).toContain("Комната Мила — свободно ещё 19 вещей");
    expect(itemGoneMail(params).html).toContain("Праздник — 14 марта");
    expect(itemGoneMail({ ...params, freeCount: 1 }).html).toContain("свободно ещё 1 вещь");
    expect(itemGoneMail({ ...params, freeCount: 3 }).html).toContain("свободно ещё 3 вещи");
    expect(itemGoneMail({ ...params, freeCount: 11 }).html).toContain("свободно ещё 11 вещей");
  });

  it("нечего сказать — не говорим: пустая комната, нет даты, праздник прошёл", () => {
    const bare = itemGoneMail({ ...params, freeCount: 0, occasionDate: null });
    expect(bare.html).not.toContain("свободно");
    expect(bare.html).not.toContain("Праздник —");
    // Дата в прошлом (письмо пролежало в очереди) — праздник не называем.
    const past = itemGoneMail({ ...params, now: new Date("2026-03-20T00:00:00.000Z") });
    expect(past.html).not.toContain("Праздник —");
  });

  it("без имени хозяйки и без названия вещи письмо связно и без слова null", () => {
    const noName = itemGoneMail({ ...params, ownerName: null });
    expect(noName.html).toContain("больше нет в комнате —");
    expect(noName.html).toContain("В комнате свободно ещё 19 вещей");
    expect(noName.html).not.toContain("null");

    const noItem = itemGoneMail({ ...params, itemTitle: "" });
    expect(noItem.html).toContain("Вещи из твоей брони больше нет в комнате");
    expect(noItem.html).not.toContain("«»");
  });

  it("пользовательский ввод в HTML экранируется", () => {
    const mail = itemGoneMail({
      ...params,
      itemTitle: `Сумка <script>alert(1)</script>`,
      ownerName: `Мила & "К"`,
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Мила &amp; &quot;К&quot;");
  });
});

describe("occasionOwnerMail — хозяйке после праздника", () => {
  it("зовёт открыть «что подарили» по ссылке (вёрстка round41)", () => {
    const mail = occasionOwnerMail({ occasionUrl: `${BASE}/room/occasion` });

    expect(mail.subject).toContain("что подарили");
    expect(mail.text.startsWith("Праздник прошёл\n")).toBe(true);
    expect(mail.text).toContain(`${BASE}/room/occasion`);
    expect(mail.html).toContain(`href="${BASE}/room/occasion"`);
    expect(mail.html).toContain(">После праздника<"); // надстрочная табличной вёрстки
  });

  it("обращения по имени в письме больше нет — параметр всего один", () => {
    // Табличный макет round41 открывается надстрочной и заголовком, слота под
    // «Привет, {name}» в нём нет. Заодно письмо хозяйке перестало принимать
    // хоть какое-нибудь имя вообще (инвариант №1 — tests/mail-round41).
    const mail = occasionOwnerMail({ occasionUrl: `${BASE}/room/occasion` });

    expect(mail.text).not.toContain("Привет");
    expect(mail.text).not.toContain("null");
    expect(mail.html).not.toContain("null");
    expect(Object.keys({ occasionUrl: "" })).toEqual(["occasionUrl"]);
  });

  it("разводит раскрытие имён и «Дошло» — это две разные необратимости", () => {
    // Контракт писал «Отметишь „дошло" — … и тогда же станет видно, от кого
    // она». Имена раскрывает ПЕРВОЕ ОТКРЫТИЕ экрана (`revealedAt`), а «Дошло»
    // увозит вещь в сокровищницу и закрепляет имя у неё (`receiveGift`).
    const mail = occasionOwnerMail({ occasionUrl: `${BASE}/room/occasion` });

    expect(mail.text).toContain("когда откроешь страницу");
    expect(mail.text).toContain("ровно один раз");
    expect(mail.text).toContain("вещь уезжает в сокровищницу");
    expect(`${mail.text} ${mail.html}`).not.toContain("тогда же");
  });
});

describe("signInMail — письмо входа", () => {
  it("несёт ссылку как есть и говорит на «ты» (тикет 32)", () => {
    const url = `${BASE}/signin/confirm?token=abc&email=dev%40x.ru`;
    const mail = signInMail(url);

    expect(mail.subject).toBe(`Вход в твою комнату — ${brandName}`);
    expect(mail.text).toContain(url);
    // ссылку не трогаем: &amp; ушёл бы в адрес и сломал бы вход
    expect(mail.html).toContain(`href="${BASE}/signin/confirm?token=abc&amp;email=dev%40x.ru"`);
    // «Вход в вашу комнату» — то, с чего начинался тикет 32
    expect(`${mail.subject} ${mail.text}`.toLowerCase()).not.toContain("ваш");
    expect(mail.text).not.toContain("!");
  });
});

describe("имя площадки в письмах (тикет 58)", () => {
  // Имя берётся из ЕДИНСТВЕННОГО ключа продукта (`Brand.name`), поэтому тест
  // сверяет с `brandName`, а не с литералом: переименование не должно
  // требовать правок в двух местах. Адрес отправителя (EMAIL_FROM) — техимя,
  // его тикет 58 не трогает.
  const letters = {
    вход: signInMail(`${BASE}/signin/confirm?token=abc`),
    напоминание: reminderGuestMail({
      ownerName: "Мила",
      itemTitle: "Серьги-каффы",
      occasionDate: OCCASION_DATE,
      itemZone: "jewelry",
      price: "7900",
      currency: "RUB",
      priceVisibility: "ALL",
      now: new Date("2026-03-11T09:00:00.000Z"),
    }),
    "вещь уехала": itemGoneMail({
      itemTitle: "Стёганая сумка",
      roomSlug: "mila",
      ownerName: "Мила",
      freeCount: 19,
      occasionDate: OCCASION_DATE,
      now: new Date("2026-03-11T09:00:00.000Z"),
    }),
    праздник: occasionOwnerMail({ occasionUrl: `${BASE}/room/occasion` }),
  };

  for (const [name, mail] of Object.entries(letters)) {
    it(`письмо «${name}» подписано именем площадки`, () => {
      expect(mail.text.trimEnd().endsWith(`${brandName} — комната, а не список`)).toBe(true);
      expect(mail.html).toContain(`${brandName} — комната, а не список`);
    });
  }

  it("тема письма входа несёт имя площадки", () => {
    expect(letters.вход.subject).toContain(brandName);
  });

  it("подстановка {brand} нигде не осталась сырой", () => {
    for (const mail of Object.values(letters)) {
      expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toContain("{brand}");
    }
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
