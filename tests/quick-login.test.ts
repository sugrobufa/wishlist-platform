// Тикет 29 (быстрый вход на стенде) + тикет 31 (вход без ключа и онбординг
// заново). Сьюта переписана под новое поведение, а не заведена рядом.
//
// Под замком главное:
//   • ФЛАГ — единственный рубильник: без QUICK_LOGIN_ENABLED=true любой адрес
//     механизма отвечает 404, ничего не выпускается и ничего не удаляется;
//   • голый /dev-login при включённом флаге ПУСКАЕТ — без ключа и без формы;
//   • ключ стал необязательным: задан — старая ссылка `?key=…` работает,
//     неверный ключ по-прежнему 404; не задан — параметр просто игнорируется;
//   • бюджета попыток больше нет: владелец не может запереть сам себя;
//   • ?fresh=1 стирает комнату ВЛАДЕЛЬЦА (и только её) и ведёт в /onboarding;
//   • почта — только из окружения: чужой аккаунт этим входом не открыть и
//     чужие данные не стереть.
//
// Стенд как в tests/auth.magic-link.test.ts: настоящая dev-БД и НАСТОЯЩИЙ
// обработчик Auth.js (handlers.GET) — сессию проверяем ту, что выдал пакет, а
// не свою выдумку. Моков нет вовсе: экрана у страницы больше не осталось,
// поэтому ни next/headers, ни next-intl ей не нужны.
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { handlers } from "@/server/auth";
import { AFTER_SIGNIN_PATH, AUTH_BASE_PATH, MAGIC_PROVIDER_ID } from "@/server/auth-links";
import {
  attemptQuickLogin,
  isEmptyRoomRequested,
  isFreshRequested,
  readQuickLoginConfig,
  resetQuickLoginWarnings,
  QUICK_LOGIN_FRESH_PATH,
  QUICK_LOGIN_MIN_SECRET_LENGTH,
  QUICK_LOGIN_TOKEN_TTL_MS,
  type QuickLoginEnv,
} from "@/server/quick-login";
import { resetStandRoom, type StandResetStorage } from "@/server/services/stand-reset";
import DevLoginPage, { metadata } from "../src/app/dev-login/page";
import { prisma } from "../src/server/db";
import ruMessages from "../messages/ru.json";
import enMessages from "../messages/en.json";

const ORIGIN = "http://localhost:3000";
const TEST_EMAIL_DOMAIN = "@quick-login.test";
const OWNER_EMAIL = `owner${TEST_EMAIL_DOMAIN}`;
/** Второй пользователь стенда — тот, у кого комната пустая (тикет 190). */
const EMPTY_EMAIL = `empty${TEST_EMAIL_DOMAIN}`;
const SECRET = "s3cret-длиной-строго-больше-24-символов-0123456789";
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

/** Рабочее окружение: флаг включён, почта задана, ключа НЕТ (режим тикета 31). */
function goodEnv(overrides: QuickLoginEnv = {}): QuickLoginEnv {
  return {
    QUICK_LOGIN_ENABLED: "true",
    QUICK_LOGIN_SECRET: "",
    QUICK_LOGIN_EMAIL: OWNER_EMAIL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    ...overrides,
  };
}

/** То же окружение, но со «строгим» ключом — проверка обратной совместимости. */
function envWithSecret(overrides: QuickLoginEnv = {}): QuickLoginEnv {
  return goodEnv({ QUICK_LOGIN_SECRET: SECRET, ...overrides });
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Шов хранилища-заглушки: БД-тесты не должны зависеть от MinIO. */
function blindStorage(): StandResetStorage {
  return { listKeysByPrefix: async () => [], deleteObjects: async () => undefined };
}

// ---------------------------------------------------------------- окружение

const ENV_KEYS = [
  "QUICK_LOGIN_ENABLED",
  "QUICK_LOGIN_SECRET",
  "QUICK_LOGIN_EMAIL",
  "QUICK_LOGIN_EMPTY_EMAIL",
] as const;
const savedEnv = new Map<string, string | undefined>();

/** Настоящий process.env — его читает страница (она зовёт конфиг без аргумента). */
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

// ------------------------------------------------------------- помощники

/** Открыть страницу (GET). Она НИЧЕГО не рисует: всегда редирект или 404. */
async function openPage(
  params: {
    key?: string | string[];
    fresh?: string | string[];
    empty?: string | string[];
  } = {},
) {
  return DevLoginPage({ searchParams: Promise.resolve(params) });
}

/** Ждём 404: notFound() бросает ошибку с этим digest. */
async function expectNotFound(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(String((error as { digest?: string }).digest ?? "")).toBe(NOT_FOUND_DIGEST);
    return;
  }
  throw new Error("ожидался 404, но страница отрисовалась");
}

/** Адрес из брошенного next/navigation redirect(). */
async function redirectTarget(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    expect(digest).toContain("NEXT_REDIRECT");
    return digest.split(";")[2] ?? "";
  }
  throw new Error("ожидался редирект, но страница отрисовалась");
}

/** Пройти по выданному адресу так же, как это сделает браузер: GET в Auth.js. */
async function followRedirect(redirectTo: string): Promise<Response> {
  return handlers.GET(new NextRequest(`${ORIGIN}${redirectTo}`, { method: "GET" }));
}

/** `callbackUrl` из адреса, который вернул быстрый вход. */
function callbackUrlOf(redirectTo: string): string {
  return new URL(redirectTo, ORIGIN).searchParams.get("callbackUrl") ?? "";
}

function tokensFor(email: string): Promise<number> {
  return prisma.verificationToken.count({ where: { identifier: email } });
}

// ------------------------------------------------------------- фикстуры

async function createUserWithRoom(email: string) {
  const user = await prisma.user.create({ data: { email, displayName: "Мила" } });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ql${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    },
  });
  return { user, room };
}

/**
 * Комната «поживee»: вещь с фото, бронь со взносом в складчину, снимок цены,
 * сводка праздника, связи в обе стороны, задания парсера и распознавания —
 * по одной строке в каждую модель, которую обязан снести сброс.
 */
async function fillRoom(userId: string, roomId: string) {
  const photoKey = `items/${roomId}/${hex(8)}.jpg`;
  const item = await prisma.item.create({
    data: { roomId, zone: "jewelry", inHall: false, title: "Серьги", photoKey },
  });
  const booking = await prisma.booking.create({
    data: {
      itemId: item.id,
      mode: "POOL",
      guestName: "Складчица",
      cancelToken: hex(24),
      pool: { create: { name: "Складчица", amount: "1000" } },
    },
  });
  const snapshot = await prisma.priceSnapshot.create({
    data: { itemId: item.id, price: "4900", currency: "RUB" },
  });
  // Дата в БУДУЩЕМ: processOccasionClose() из соседнего форка выбирает все
  // комнаты, у которых праздник уже наступил, и заводит им сводки — прошедшая
  // дата дала бы гонку на (roomId, date). Само значение ни на что не влияет.
  const summary = await prisma.occasionSummary.create({
    data: { roomId, date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  });
  const parseJob = await prisma.parseJob.create({
    data: { url: "https://shop.example/x", userId, status: "DONE" },
  });
  const recognitionJob = await prisma.recognitionJob.create({
    data: { userId, imageKey: `private/${hex(8)}.jpg`, status: "PENDING" },
  });
  return { item, booking, snapshot, summary, parseJob, recognitionJob, photoKey };
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true, room: { select: { id: true } } },
  });
  const userIds = users.map((entry) => entry.id);
  const roomIds = users.flatMap((entry) => (entry.room ? [entry.room.id] : []));
  // Модели без FK-связи с User каскад не заденет — чистим руками (как сервис).
  await prisma.occasionSummary.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.parseJob.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.recognitionJob.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verificationToken.deleteMany({
    where: { identifier: { endsWith: TEST_EMAIL_DOMAIN } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(async () => {
  resetQuickLoginWarnings();
  await cleanup();
});

afterEach(() => {
  restoreProcessEnv();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ------------------------------------------------------- конфиг и флаг

describe("выключен по умолчанию", () => {
  it("без QUICK_LOGIN_ENABLED конфига нет и никто не шумит в лог", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readQuickLoginConfig({})).toBeNull();
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_ENABLED: undefined }))).toBeNull();
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_ENABLED: "false" }))).toBeNull();
    // «1», «yes», «TRUE» — не считаются: включает ровно строка "true".
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_ENABLED: "1" }))).toBeNull();
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_ENABLED: "TRUE" }))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("страница при выключенном флаге — 404 на все три адреса, без токенов", async () => {
    setProcessEnv({});

    await expectNotFound(openPage());
    await expectNotFound(openPage({ key: SECRET }));
    await expectNotFound(openPage({ fresh: "1" }));
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("выключенный флаг НИЧЕГО не стирает: ?fresh=1 — просто 404", async () => {
    const owner = await createUserWithRoom(OWNER_EMAIL);
    await fillRoom(owner.user.id, owner.room.id);
    setProcessEnv({});

    await expectNotFound(openPage({ fresh: "1" }));

    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(1);
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(1);
  });
});

describe("включён, но настроен криво — не включается и громко предупреждает", () => {
  it.each([
    ["почты нет", goodEnv({ QUICK_LOGIN_EMAIL: "" })],
    ["почта не похожа на почту", goodEnv({ QUICK_LOGIN_EMAIL: "не-почта" })],
    ["нет AUTH_SECRET", goodEnv({ AUTH_SECRET: "" })],
  ])("%s → конфига нет, в лог ушло предупреждение", (_name, env) => {
    resetQuickLoginWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readQuickLoginConfig(env)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("быстрый вход");
  });

  it("предупреждение не заливает лог: один текст — один раз", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = goodEnv({ QUICK_LOGIN_EMAIL: "" });

    readQuickLoginConfig(env);
    readQuickLoginConfig(env);
    readQuickLoginConfig(env);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("страница без почты в env — 404, ключ не спасает", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setProcessEnv(envWithSecret({ QUICK_LOGIN_EMAIL: "" }));

    await expectNotFound(openPage({ key: SECRET }));
    await expectNotFound(openPage());
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("почта из env приводится к виду, в котором её пишет штатный вход", () => {
    const config = readQuickLoginConfig(goodEnv({ QUICK_LOGIN_EMAIL: `  OWNER${TEST_EMAIL_DOMAIN}  ` }));
    expect(config?.email).toBe(OWNER_EMAIL);
  });
});

// ------------------------------------------------- ключ стал необязательным

describe("ключ необязателен (тикет 31)", () => {
  it("пустой QUICK_LOGIN_SECRET — это норма: конфиг есть, ключа нет, лог молчит", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const config = readQuickLoginConfig(goodEnv());

    expect(config).not.toBeNull();
    expect(config?.secret).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("обрубок короче 24 символов ключом не считается, но и дверь не запирает", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const short = "k".repeat(QUICK_LOGIN_MIN_SECRET_LENGTH - 1);

    const config = readQuickLoginConfig(goodEnv({ QUICK_LOGIN_SECRET: short }));

    // Раньше это было 404 на всё; теперь — предупреждение и открытый вход.
    expect(config?.secret).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("короче");
  });

  it("ровно 24 символа уже годятся за ключ", () => {
    const enough = "k".repeat(QUICK_LOGIN_MIN_SECRET_LENGTH);
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_SECRET: enough }))?.secret).toBe(enough);
  });

  it("голый вход пускает и при заданном ключе — ключ спрашивают, только если он принесён", async () => {
    const result = await attemptQuickLogin({ env: envWithSecret(), storage: blindStorage() });
    expect(result.ok).toBe(true);
  });

  it("старая ссылка с верным ключом продолжает работать", async () => {
    const result = await attemptQuickLogin({ key: SECRET, env: envWithSecret() });
    expect(result.ok).toBe(true);
    expect(await tokensFor(OWNER_EMAIL)).toBe(1);
  });

  it("неверный ключ при заданном секрете — отказ и ни одного токена", async () => {
    const env = envWithSecret();

    expect(await attemptQuickLogin({ key: "", env })).toEqual({ ok: false, reason: "bad-key" });
    expect(await attemptQuickLogin({ key: `${SECRET}x`, env })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(await attemptQuickLogin({ key: SECRET.slice(0, -1), env })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("сверка не падает на ключах другой длины (timing-safe через хеши)", async () => {
    // timingSafeEqual бросает на разной длине буферов — здесь сравниваются
    // sha256 фиксированной длины, поэтому и очень длинный ключ просто «не тот».
    const result = await attemptQuickLogin({ key: "y".repeat(5000), env: envWithSecret() });
    expect(result).toEqual({ ok: false, reason: "bad-key" });
  });

  it("ключ в адресе при пустом секрете просто игнорируется (закладка со старым ключом жива)", async () => {
    const result = await attemptQuickLogin({ key: "давно протухший ключ", env: goodEnv() });
    expect(result.ok).toBe(true);
  });

  it("страница с неверным ключом — 404 (а не форма и не 403)", async () => {
    setProcessEnv(envWithSecret());

    await expectNotFound(openPage({ key: "не тот ключ" }));
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });
});

// ------------------------------------------------- бюджет попыток снят

describe("бюджета попыток больше нет (тикет 31 §3)", () => {
  it("двенадцать заходов подряд — все двенадцать пускают", async () => {
    for (let i = 0; i < 12; i += 1) {
      const result = await attemptQuickLogin({ env: goodEnv() });
      expect(result.ok, `заход №${i + 1}`).toBe(true);
    }
    // Владелец не может запереть сам себя двойным кликом или префетчем.
    expect(await tokensFor(OWNER_EMAIL)).toBe(12);
  });
});

// ------------------------------------------------- вход выдаёт сессию

describe("вход выдаёт настоящую сессию Auth.js", () => {
  it("уводит на callback провайдера с почтой из env и живым токеном", async () => {
    const result = await attemptQuickLogin({ env: goodEnv() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = new URL(result.redirectTo, ORIGIN);
    expect(target.pathname).toBe(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(target.searchParams.get("email")).toBe(OWNER_EMAIL);
    expect(target.searchParams.get("callbackUrl")).toBe(AFTER_SIGNIN_PATH);
    expect(target.searchParams.get("token")).toBeTruthy();
    expect(result.reset).toBeNull();

    // Выпущен обычный одноразовый VerificationToken, живёт минуту.
    const row = await prisma.verificationToken.findFirst({ where: { identifier: OWNER_EMAIL } });
    expect(row).not.toBeNull();
    const ttl = Number(row?.expires) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(QUICK_LOGIN_TOKEN_TTL_MS);
  });

  it("сессия заводится и принадлежит именно QUICK_LOGIN_EMAIL", async () => {
    const result = await attemptQuickLogin({ env: goodEnv() });
    if (!result.ok) throw new Error("быстрый вход не сработал");

    const response = await followRedirect(result.redirectTo);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);
    expect(String(response.headers.get("set-cookie"))).toContain("authjs.session-token");

    // Пользователя не было — Auth.js завёл его сам, как при первом входе по почте.
    const user = await prisma.user.findUnique({
      where: { email: OWNER_EMAIL },
      include: { sessions: true },
    });
    expect(user).not.toBeNull();
    expect(user?.sessions).toHaveLength(1);

    // Сессия ровно одна и ровно на эту почту — чужих в БД не появилось.
    const sessions = await prisma.session.findMany({ include: { user: true } });
    const ours = sessions.filter((s) => s.user.email?.endsWith(TEST_EMAIL_DOMAIN));
    expect(ours).toHaveLength(1);
    expect(ours[0]?.user.email).toBe(OWNER_EMAIL);

    // Токен потрачен — он одноразовый, как у обычной ссылки из письма.
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("повторный вход работает — в отличие от одноразовой ссылки из письма", async () => {
    const first = await attemptQuickLogin({ env: goodEnv() });
    if (!first.ok) throw new Error("первый вход не сработал");
    const firstResponse = await followRedirect(first.redirectTo);
    expect(firstResponse.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);

    const second = await attemptQuickLogin({ env: goodEnv() });
    if (!second.ok) throw new Error("повторный вход не сработал");
    expect(second.redirectTo).not.toBe(first.redirectTo);
    const secondResponse = await followRedirect(second.redirectTo);

    expect(secondResponse.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);
    expect(String(secondResponse.headers.get("set-cookie"))).toContain("authjs.session-token");

    // Пользователь тот же один, сессий стало две — второй вход настоящий.
    const users = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
      include: { sessions: true },
    });
    expect(users).toHaveLength(1);
    expect(users[0]?.sessions).toHaveLength(2);
  });

  it("голая страница /dev-login редиректит на тот же callback — без ключа и без формы", async () => {
    setProcessEnv(goodEnv());

    const target = await redirectTarget(openPage());

    expect(target).toContain(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(target).toContain(encodeURIComponent(OWNER_EMAIL));
    expect(callbackUrlOf(target)).toBe(AFTER_SIGNIN_PATH);
    expect(await tokensFor(OWNER_EMAIL)).toBe(1);
  });
});

// ------------------------------------------------------ чужая почта

describe("чужим адресом не войти", () => {
  it("email в параметрах запроса игнорируется — токен только на почту из env", async () => {
    setProcessEnv(goodEnv());
    const stranger = `stranger${TEST_EMAIL_DOMAIN}`;

    const target = await redirectTarget(
      // Страница читает только `key` и `fresh`; всё прочее в адресе — шум.
      openPage({ key: SECRET, email: stranger, identifier: stranger } as {
        key?: string | string[];
      }),
    );

    expect(target).toContain(encodeURIComponent(OWNER_EMAIL));
    expect(target).not.toContain(encodeURIComponent(stranger));
    expect(await tokensFor(stranger)).toBe(0);
  });

  it("подмена почты в самом callback не проходит: токен выпущен не на неё", async () => {
    const result = await attemptQuickLogin({ env: goodEnv() });
    if (!result.ok) throw new Error("быстрый вход не сработал");

    const stranger = `stranger${TEST_EMAIL_DOMAIN}`;
    const tampered = new URL(result.redirectTo, ORIGIN);
    tampered.searchParams.set("email", stranger);

    const response = await followRedirect(`${tampered.pathname}${tampered.search}`);

    // Auth.js сверяет identifier строки токена — чужой адрес отбивается.
    expect(String(response.headers.get("location"))).toContain("error=Verification");
    expect(await prisma.user.count({ where: { email: stranger } })).toBe(0);
    expect(await prisma.session.count({ where: { user: { email: stranger } } })).toBe(0);
  });
});

// ------------------------------------------------ ?fresh=1: онбординг заново

describe("?fresh=1 — распознавание параметра", () => {
  it.each([
    ["1", true],
    ["", true],
    ["true", true],
    ["yes", true],
    ["0", false],
    ["false", false],
    ["no", false],
  ])("fresh=%s → %s", (value, expected) => {
    expect(isFreshRequested(value)).toBe(expected);
  });

  it("без параметра — не сброс; массив значений — берём первое", () => {
    expect(isFreshRequested(undefined)).toBe(false);
    expect(isFreshRequested(["1", "0"])).toBe(true);
    expect(isFreshRequested(["0", "1"])).toBe(false);
  });
});

describe("?fresh=1 — комната владельца стирается, аккаунт остаётся", () => {
  it("сносит комнату со всем содержимым, а пользователя и сессии не трогает", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const filled = await fillRoom(owner.user.id, owner.room.id);
    const session = await prisma.session.create({
      data: {
        userId: owner.user.id,
        sessionToken: `sess-${randomUUID()}`,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    const stranger = await createUserWithRoom(`stranger${TEST_EMAIL_DOMAIN}`);
    await prisma.connection.create({
      data: { aUserId: owner.user.id, bUserId: stranger.user.id, kind: "VIEWED", origin: "visit" },
    });
    await prisma.connection.create({
      data: { aUserId: stranger.user.id, bUserId: owner.user.id, kind: "FOLLOW", origin: "visit" },
    });

    const result = await attemptQuickLogin({
      fresh: true,
      env: goodEnv(),
      storage: blindStorage(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reset).toMatchObject({
      userFound: true,
      roomDeleted: true,
      s3Cleaned: true,
      removed: { items: 1, occasionSummaries: 1, connections: 2, parseJobs: 1, recognitionJobs: 1 },
    });

    // Комната и всё, что за ней тянется каскадом схемы.
    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(0);
    expect(await prisma.item.count({ where: { id: filled.item.id } })).toBe(0);
    expect(await prisma.booking.count({ where: { id: filled.booking.id } })).toBe(0);
    expect(await prisma.poolContribution.count({ where: { bookingId: filled.booking.id } })).toBe(0);
    expect(await prisma.priceSnapshot.count({ where: { id: filled.snapshot.id } })).toBe(0);
    // Модели без FK — снесены явно.
    expect(await prisma.occasionSummary.count({ where: { roomId: owner.room.id } })).toBe(0);
    expect(await prisma.parseJob.count({ where: { userId: owner.user.id } })).toBe(0);
    expect(await prisma.recognitionJob.count({ where: { userId: owner.user.id } })).toBe(0);
    expect(
      await prisma.connection.count({
        where: { OR: [{ aUserId: owner.user.id }, { bUserId: owner.user.id }] },
      }),
    ).toBe(0);

    // Сам аккаунт цел — иначе сброс разлогинил бы владельца по дороге.
    const user = await prisma.user.findUnique({ where: { id: owner.user.id } });
    expect(user?.email).toBe(OWNER_EMAIL);
    expect(user?.displayName).toBe("Мила");
    expect(await prisma.session.count({ where: { id: session.id } })).toBe(1);
  });

  it("чужая комната этим маршрутом не сносится", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    await fillRoom(owner.user.id, owner.room.id);
    const stranger = await createUserWithRoom(`stranger${TEST_EMAIL_DOMAIN}`);
    const strangerStuff = await fillRoom(stranger.user.id, stranger.room.id);
    const third = await createUserWithRoom(`third${TEST_EMAIL_DOMAIN}`);
    const foreignConnection = await prisma.connection.create({
      data: { aUserId: stranger.user.id, bUserId: third.user.id, kind: "MUTUAL", origin: "visit" },
    });

    // Почта соседа В ПАРАМЕТРАХ запроса — на сброс она не влияет никак.
    setProcessEnv(goodEnv());
    await redirectTarget(
      openPage({ fresh: "1", email: stranger.user.email } as { fresh?: string | string[] }),
    );

    // Владелец сброшен...
    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(0);
    // ...сосед цел целиком: комната, вещь, бронь, сводка, задания, связь с третьим.
    expect(await prisma.room.count({ where: { id: stranger.room.id } })).toBe(1);
    expect(await prisma.item.count({ where: { id: strangerStuff.item.id } })).toBe(1);
    expect(await prisma.booking.count({ where: { id: strangerStuff.booking.id } })).toBe(1);
    expect(await prisma.priceSnapshot.count({ where: { id: strangerStuff.snapshot.id } })).toBe(1);
    expect(await prisma.occasionSummary.count({ where: { roomId: stranger.room.id } })).toBe(1);
    expect(await prisma.parseJob.count({ where: { userId: stranger.user.id } })).toBe(1);
    expect(await prisma.recognitionJob.count({ where: { userId: stranger.user.id } })).toBe(1);
    expect(await prisma.connection.count({ where: { id: foreignConnection.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: stranger.user.id } })).toBe(1);
  });

  it("ведёт в /onboarding, а обычный вход — в /room", async () => {
    setProcessEnv(goodEnv());
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const fresh = await redirectTarget(openPage({ fresh: "1" }));
    expect(callbackUrlOf(fresh)).toBe(QUICK_LOGIN_FRESH_PATH);
    expect(new URL(fresh, ORIGIN).searchParams.get("email")).toBe(OWNER_EMAIL);

    const plain = await redirectTarget(openPage());
    expect(callbackUrlOf(plain)).toBe(AFTER_SIGNIN_PATH);
  });

  it("после сброса онбординг действительно открывается: сессия жива, комнаты нет", async () => {
    setProcessEnv(goodEnv());
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    // Сначала обычный вход — заводим пользователя и комнату, как после онбординга.
    const first = await redirectTarget(openPage());
    await followRedirect(first);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const room = await prisma.room.create({
      data: {
        userId: user.id,
        preset: "cream",
        zoneSet: "F",
        shareSlug: `ql${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      },
    });

    const target = await redirectTarget(openPage({ fresh: "1" }));
    const response = await followRedirect(target);

    // Auth.js увёл ровно на онбординг и выдал сессию.
    expect(response.headers.get("location")).toBe(`${ORIGIN}${QUICK_LOGIN_FRESH_PATH}`);
    expect(String(response.headers.get("set-cookie"))).toContain("authjs.session-token");
    // Комнаты нет → страница онбординга больше не редиректит в /room.
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);
  });

  it("обычный вход комнату НЕ трогает", async () => {
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const filled = await fillRoom(owner.user.id, owner.room.id);
    setProcessEnv(goodEnv());

    await redirectTarget(openPage());

    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(1);
    expect(await prisma.item.count({ where: { id: filled.item.id } })).toBe(1);
  });

  it("первый вход с ?fresh=1, когда пользователя ещё нет — не отказ, а обычный вход", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await attemptQuickLogin({ fresh: true, env: goodEnv(), storage: blindStorage() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reset).toMatchObject({ userFound: false, roomDeleted: false });
    expect(callbackUrlOf(result.redirectTo)).toBe(QUICK_LOGIN_FRESH_PATH);
  });
});

// ------------------------------------------- ?empty=1: вторая, пустая комната

/**
 * ТИКЕТ 190. Комната владельца стенда полна и наполняется при КАЖДОМ входе, а
 * «первое действие пустой комнаты ведёт в /room/add» — утверждение о ПУСТОЙ
 * комнате. Опустошить стенд можно было только `?fresh=1`, то есть снести его.
 *
 * Поэтому у стенда появился ВТОРОЙ пользователь с заведомо пустой комнатой
 * (`prisma/seed.ts`), а у входа — адрес `?empty=1`. Под замком здесь три вещи:
 * этот вход НИЧЕГО НЕ СЕЕТ (иначе комната сразу перестала бы быть пустой),
 * НИЧЕГО НЕ СТИРАЕТ и берёт почту ТОЛЬКО из окружения — правило «чужой аккаунт
 * этим входом не открыть» не ослаблено ни на шаг.
 */
describe("?empty=1 — вход второй, заведомо пустой комнатой (тикет 190)", () => {
  /** Окружение стенда с объявленной второй почтой. */
  function envWithEmpty(overrides: QuickLoginEnv = {}): QuickLoginEnv {
    return goodEnv({ QUICK_LOGIN_EMPTY_EMAIL: EMPTY_EMAIL, ...overrides });
  }

  it.each([
    ["1", true],
    ["", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["no", false],
  ])("empty=%s → %s", (value, expected) => {
    expect(isEmptyRoomRequested(value)).toBe(expected);
  });

  it("токен выпускается на ВТОРУЮ почту из env, а вход ведёт в /room", async () => {
    const result = await attemptQuickLogin({ empty: true, env: envWithEmpty() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = new URL(result.redirectTo, ORIGIN);
    expect(target.searchParams.get("email")).toBe(EMPTY_EMAIL);
    expect(callbackUrlOf(result.redirectTo)).toBe(AFTER_SIGNIN_PATH);
    expect(await tokensFor(EMPTY_EMAIL)).toBe(1);
    // …и владельцу при этом ничего не выписано: вход не «двойной».
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("НЕ СЕЕТ и НЕ СТИРАЕТ: обе комнаты остаются такими, какими были", async () => {
    // Главное свойство адреса. Посев наполнил бы пустую комнату в первую же
    // секунду (а он ходит по почте владельца — наполнил бы вообще не ту), сброс
    // снёс бы комнату владельца. Ни того, ни другого здесь нет.
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const filled = await fillRoom(owner.user.id, owner.room.id);
    const empty = await createUserWithRoom(EMPTY_EMAIL);

    const result = await attemptQuickLogin({
      empty: true,
      // Флаги «наполнить» и «стереть» принесены ОБА и оба обязаны молчать:
      // они про комнату владельца, а этот вход к ней не относится.
      seed: true,
      fresh: true,
      env: envWithEmpty(),
      storage: blindStorage(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed, "посев при входе в пустую комнату не запускается").toBeNull();
    expect(result.reset, "сброс при входе в пустую комнату не запускается").toBeNull();

    expect(await prisma.item.count({ where: { roomId: empty.room.id } })).toBe(0);
    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(1);
    expect(await prisma.item.count({ where: { id: filled.item.id } })).toBe(1);
  });

  it("страница ?empty=1 уводит на ту же почту — и комнату владельца не трогает", async () => {
    const owner = await createUserWithRoom(OWNER_EMAIL);
    await fillRoom(owner.user.id, owner.room.id);
    await createUserWithRoom(EMPTY_EMAIL);
    setProcessEnv(envWithEmpty());

    const target = await redirectTarget(openPage({ empty: "1" }));

    expect(target).toContain(encodeURIComponent(EMPTY_EMAIL));
    expect(target).not.toContain(encodeURIComponent(OWNER_EMAIL));
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(1);
  });

  it("почта пустой комнаты — тоже только из env: адрес её не приносит", async () => {
    const stranger = `stranger${TEST_EMAIL_DOMAIN}`;
    setProcessEnv(envWithEmpty());

    const target = await redirectTarget(
      openPage({ empty: "1", email: stranger, identifier: stranger } as {
        empty?: string | string[];
      }),
    );

    expect(target).toContain(encodeURIComponent(EMPTY_EMAIL));
    expect(await tokensFor(stranger)).toBe(0);
  });

  it("вторая почта не объявлена — адреса просто нет: 404 и ни одного токена", async () => {
    // Переменная необязательная, и её отсутствие не должно ломать обычный вход.
    expect(await attemptQuickLogin({ empty: true, env: goodEnv() })).toEqual({
      ok: false,
      reason: "no-empty-room",
    });

    setProcessEnv(goodEnv());
    await expectNotFound(openPage({ empty: "1" }));
    expect(await tokensFor(EMPTY_EMAIL)).toBe(0);
    // …а голый /dev-login при этом работает как работал.
    expect(await redirectTarget(openPage())).toContain(encodeURIComponent(OWNER_EMAIL));
  });

  it("вторая почта задана мусором — 404 и предупреждение, обычный вход цел", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = envWithEmpty({ QUICK_LOGIN_EMPTY_EMAIL: "не-почта" });

    const config = readQuickLoginConfig(env);

    expect(config?.email, "обычный вход от опечатки во ВТОРОЙ почте не страдает").toBe(OWNER_EMAIL);
    expect(config?.emptyEmail).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("QUICK_LOGIN_EMPTY_EMAIL");
    expect(await attemptQuickLogin({ empty: true, env })).toEqual({
      ok: false,
      reason: "no-empty-room",
    });
  });

  it("пустая переменная — не ошибка и в лог не шумит", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readQuickLoginConfig(goodEnv())?.emptyEmail).toBeNull();
    expect(readQuickLoginConfig(envWithEmpty({ QUICK_LOGIN_EMPTY_EMAIL: "  " }))?.emptyEmail).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("вторая почта приводится к тому же виду, что и первая", () => {
    const config = readQuickLoginConfig(
      envWithEmpty({ QUICK_LOGIN_EMPTY_EMAIL: `  EMPTY${TEST_EMAIL_DOMAIN}  ` }),
    );
    expect(config?.emptyEmail).toBe(EMPTY_EMAIL);
  });

  it("выключенный флаг гасит и этот адрес", async () => {
    setProcessEnv({});
    await expectNotFound(openPage({ empty: "1" }));
    expect(await tokensFor(EMPTY_EMAIL)).toBe(0);
  });
});

describe("сброс и хранилище", () => {
  it("фото вещей уходят в deleteObjects вместе с сиротами префикса", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    const filled = await fillRoom(owner.user.id, owner.room.id);
    const orphan = `items/${owner.room.id}/${hex(8)}.jpg`;

    const deleted = vi.fn(async (keys: string[]) => {
      void keys;
    });
    const result = await resetStandRoom(OWNER_EMAIL, {
      listKeysByPrefix: async (prefix) => (prefix === `items/${owner.room.id}/` ? [orphan] : []),
      deleteObjects: deleted,
    });

    expect(result.s3Cleaned).toBe(true);
    const keys = deleted.mock.calls[0]?.[0] ?? [];
    expect(keys).toContain(filled.photoKey);
    expect(keys).toContain(orphan);
    // Аватар владельца — часть User, а User мы не трогаем: префикс avatars/ не листается.
    expect(keys.every((key) => key.startsWith(`items/${owner.room.id}/`))).toBe(true);
  });

  it("отказ S3 не валит сброс: комнаты уже нет, s3Cleaned=false, в лог написано", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const owner = await createUserWithRoom(OWNER_EMAIL);
    await fillRoom(owner.user.id, owner.room.id);

    const result = await resetStandRoom(OWNER_EMAIL, {
      listKeysByPrefix: async () => {
        throw new Error("S3 недоступен");
      },
      deleteObjects: async () => undefined,
    });

    expect(result).toMatchObject({ userFound: true, roomDeleted: true, s3Cleaned: false });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(await prisma.room.count({ where: { id: owner.room.id } })).toBe(0);
  });
});

// ------------------------------------------------------------- экран

describe("служебный экран", () => {
  it("экрана больше нет: страница либо уводит, либо отвечает 404 — но не рисует", async () => {
    setProcessEnv(goodEnv());
    await redirectTarget(openPage());

    setProcessEnv({});
    await expectNotFound(openPage());
  });

  it("страница noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("служебных слов НЕТ в общем словаре — иначе их видно на каждом экране", () => {
    // src/app/layout.tsx сериализует весь общий словарь в разметку любой
    // страницы. Пространство «DevLogin» там означало бы, что обход входа
    // объявлен всему интернету ещё до всяких попыток его найти. С тикетом 31
    // у механизма не осталось вообще ни одного слова: экран исчез, отдельный
    // словарь messages/dev-login.* удалён за ненадобностью.
    expect(ruMessages).not.toHaveProperty("DevLogin");
    expect(enMessages).not.toHaveProperty("DevLogin");
    expect(JSON.stringify(ruMessages)).not.toContain("dev-login");
    expect(JSON.stringify(enMessages)).not.toContain("dev-login");
  });
});
