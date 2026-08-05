// Тикет 29: быстрый вход на тестовом стенде — обход письма, пока нет SMTP.
//
// Под замком главное: механизм выключен по умолчанию, включается только полным
// набором переменных, пускает только заранее заданную почту, а любой отказ
// выглядит снаружи как 404 — по ответу нельзя понять, есть ли он вообще.
//
// Стенд как в tests/auth.magic-link.test.ts: настоящая dev-БД и НАСТОЯЩИЙ
// обработчик Auth.js (handlers.GET) — сессию проверяем ту, что выдал пакет, а
// не свою выдумку. Мокаются ровно три вещи: headers() (IP запроса), next-intl
// (тексты берём из messages/ru.json) и ничего больше.
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// IP запроса — страница берёт его из headers(); тест двигает сам.
let currentIp = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": currentIp }),
}));

// Тексты страницы — реальные строки продукта, без request-scope next-intl.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const messages = (await import("../messages/ru.json")).default as unknown as Record<
      string,
      Record<string, string>
    >;
    return (key: string) => messages[namespace]?.[key] ?? `!${namespace}.${key}`;
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import { handlers } from "@/server/auth";
import { AFTER_SIGNIN_PATH, AUTH_BASE_PATH, MAGIC_PROVIDER_ID } from "@/server/auth-links";
import {
  attemptQuickLogin,
  readQuickLoginConfig,
  resetQuickLoginWarnings,
  QUICK_LOGIN_ATTEMPTS_PER_MINUTE,
  QUICK_LOGIN_KEY_PARAM,
  QUICK_LOGIN_MIN_SECRET_LENGTH,
  QUICK_LOGIN_PATH,
  QUICK_LOGIN_TOKEN_TTL_MS,
  type QuickLoginEnv,
} from "@/server/quick-login";
import { RateLimiter } from "@/server/rate-limit";
import DevLoginPage, { metadata } from "../src/app/dev-login/page";
import { prisma } from "../src/server/db";
import ruMessages from "../messages/ru.json";
import enMessages from "../messages/en.json";

const ORIGIN = "http://localhost:3000";
const TEST_EMAIL_DOMAIN = "@quick-login.test";
const OWNER_EMAIL = `owner${TEST_EMAIL_DOMAIN}`;
const SECRET = "s3cret-длиной-строго-больше-24-символов-0123456789";
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

/** Рабочее окружение: всё включено и настроено верно. */
function goodEnv(overrides: QuickLoginEnv = {}): QuickLoginEnv {
  return {
    QUICK_LOGIN_ENABLED: "true",
    QUICK_LOGIN_SECRET: SECRET,
    QUICK_LOGIN_EMAIL: OWNER_EMAIL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    ...overrides,
  };
}

/** Свежая корзина попыток на тест: бюджеты тестов не пересекаются. */
function freshLimiter(): RateLimiter {
  return new RateLimiter({
    redis: null,
    prefix: "rl:test:quick-login",
    capacity: QUICK_LOGIN_ATTEMPTS_PER_MINUTE,
    refillPerMinute: QUICK_LOGIN_ATTEMPTS_PER_MINUTE,
  });
}

// ---------------------------------------------------------------- окружение

const ENV_KEYS = ["QUICK_LOGIN_ENABLED", "QUICK_LOGIN_SECRET", "QUICK_LOGIN_EMAIL"] as const;
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

/** Каждому тесту свой IP: общая корзина страницы не течёт между тестами. */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  currentIp = `198.51.100.${ipCounter % 250}`;
  return currentIp;
}

/** Отрисовать страницу (GET) и вернуть HTML. */
async function renderPage(params: { key?: string | string[] } = {}): Promise<string> {
  const element = await DevLoginPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
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

function tokensFor(email: string): Promise<number> {
  return prisma.verificationToken.count({ where: { identifier: email } });
}

async function cleanup(): Promise<void> {
  await prisma.verificationToken.deleteMany({
    where: { identifier: { endsWith: TEST_EMAIL_DOMAIN } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeEach(async () => {
  resetQuickLoginWarnings();
  nextIp();
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

  it("страница при выключенном флаге — 404, а не форма и не редирект", async () => {
    setProcessEnv({});

    await expectNotFound(renderPage());
    await expectNotFound(renderPage({ key: SECRET }));
    // Верный ключ при выключенном флаге не выпускает даже токена.
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });
});

describe("включён, но настроен криво — не включается и громко предупреждает", () => {
  it.each([
    ["секрет пуст", goodEnv({ QUICK_LOGIN_SECRET: "" })],
    ["секрет короче 24", goodEnv({ QUICK_LOGIN_SECRET: "x".repeat(QUICK_LOGIN_MIN_SECRET_LENGTH - 1) })],
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

  it("ровно 24 символа уже годятся, 23 — нет", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const short = "k".repeat(QUICK_LOGIN_MIN_SECRET_LENGTH - 1);
    const enough = "k".repeat(QUICK_LOGIN_MIN_SECRET_LENGTH);

    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_SECRET: short }))).toBeNull();
    expect(readQuickLoginConfig(goodEnv({ QUICK_LOGIN_SECRET: enough }))?.secret).toBe(enough);
  });

  it("предупреждение не заливает лог: один текст — один раз", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = goodEnv({ QUICK_LOGIN_SECRET: "коротко" });

    readQuickLoginConfig(env);
    readQuickLoginConfig(env);
    readQuickLoginConfig(env);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("страница с коротким секретом — 404, ключ не спасает", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setProcessEnv(goodEnv({ QUICK_LOGIN_SECRET: "коротко" }));

    await expectNotFound(renderPage({ key: "коротко" }));
    await expectNotFound(renderPage());
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("почта из env приводится к виду, в котором её пишет штатный вход", () => {
    const config = readQuickLoginConfig(goodEnv({ QUICK_LOGIN_EMAIL: `  OWNER${TEST_EMAIL_DOMAIN}  ` }));
    expect(config?.email).toBe(OWNER_EMAIL);
  });
});

// -------------------------------------------------------------- ключ

describe("ключ", () => {
  it("неверный ключ — отказ и ни одного выпущенного токена", async () => {
    const attempt = { ip: nextIp(), env: goodEnv(), limiter: freshLimiter() };

    expect(await attemptQuickLogin({ ...attempt, key: "" })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(await attemptQuickLogin({ ...attempt, key: `${SECRET}x` })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(await attemptQuickLogin({ ...attempt, key: SECRET.slice(0, -1) })).toEqual({
      ok: false,
      reason: "bad-key",
    });
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("сверка не падает на ключах другой длины (timing-safe через хеши)", async () => {
    const attempt = { ip: nextIp(), env: goodEnv(), limiter: freshLimiter() };
    // timingSafeEqual бросает на разной длине буферов — здесь сравниваются
    // sha256 фиксированной длины, поэтому и очень длинный ключ просто «не тот».
    const result = await attemptQuickLogin({ ...attempt, key: "y".repeat(5000) });
    expect(result).toEqual({ ok: false, reason: "bad-key" });
  });

  it("страница с неверным ключом — 404 (а не 403 и не форма)", async () => {
    setProcessEnv(goodEnv());

    await expectNotFound(renderPage({ key: "не тот ключ" }));
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });
});

// ---------------------------------------------------- бюджет попыток по IP

describe("частота попыток по IP", () => {
  it(`после ${QUICK_LOGIN_ATTEMPTS_PER_MINUTE} попыток IP уходит в отказ — даже с верным ключом`, async () => {
    const limiter = freshLimiter();
    const ip = nextIp();

    for (let i = 0; i < QUICK_LOGIN_ATTEMPTS_PER_MINUTE; i += 1) {
      const result = await attemptQuickLogin({ key: "мимо", ip, env: goodEnv(), limiter });
      expect(result).toEqual({ ok: false, reason: "bad-key" });
    }

    // Бюджет исчерпан: даже настоящий ключ уже не пускают.
    expect(await attemptQuickLogin({ key: SECRET, ip, env: goodEnv(), limiter })).toEqual({
      ok: false,
      reason: "rate-limited",
    });
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });

  it("сосед по другому IP свой бюджет не потерял", async () => {
    const limiter = freshLimiter();
    for (let i = 0; i < QUICK_LOGIN_ATTEMPTS_PER_MINUTE + 3; i += 1) {
      await attemptQuickLogin({ key: "мимо", ip: "10.0.0.1", env: goodEnv(), limiter });
    }

    const other = await attemptQuickLogin({
      key: SECRET,
      ip: "10.0.0.2",
      env: goodEnv(),
      limiter,
    });
    expect(other.ok).toBe(true);
  });

  it("страница режет перебор по одному IP и отвечает 404", async () => {
    setProcessEnv(goodEnv());
    nextIp(); // общая корзина процесса, но ключ IP у теста свой

    for (let i = 0; i < QUICK_LOGIN_ATTEMPTS_PER_MINUTE; i += 1) {
      await expectNotFound(renderPage({ key: "мимо" }));
    }
    // Бюджет кончился — верный ключ отсюда уже не пускают, и это тоже 404.
    await expectNotFound(renderPage({ key: SECRET }));
    expect(await tokensFor(OWNER_EMAIL)).toBe(0);
  });
});

// ------------------------------------------------- верный ключ: сессия

describe("верный ключ выдаёт настоящую сессию Auth.js", () => {
  it("уводит на callback провайдера с почтой из env и живым токеном", async () => {
    const result = await attemptQuickLogin({
      key: SECRET,
      ip: nextIp(),
      env: goodEnv(),
      limiter: freshLimiter(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = new URL(result.redirectTo, ORIGIN);
    expect(target.pathname).toBe(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(target.searchParams.get("email")).toBe(OWNER_EMAIL);
    expect(target.searchParams.get("callbackUrl")).toBe(AFTER_SIGNIN_PATH);
    expect(target.searchParams.get("token")).toBeTruthy();
    // Ключа в выданном адресе нет — он не расползается дальше.
    expect(result.redirectTo).not.toContain(SECRET);

    // Выпущен обычный одноразовый VerificationToken, живёт минуту.
    const row = await prisma.verificationToken.findFirst({ where: { identifier: OWNER_EMAIL } });
    expect(row).not.toBeNull();
    const ttl = Number(row?.expires) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(QUICK_LOGIN_TOKEN_TTL_MS);
  });

  it("сессия заводится и принадлежит именно QUICK_LOGIN_EMAIL", async () => {
    const result = await attemptQuickLogin({
      key: SECRET,
      ip: nextIp(),
      env: goodEnv(),
      limiter: freshLimiter(),
    });
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
    const attempt = { key: SECRET, ip: nextIp(), env: goodEnv(), limiter: freshLimiter() };

    const first = await attemptQuickLogin(attempt);
    if (!first.ok) throw new Error("первый вход не сработал");
    const firstResponse = await followRedirect(first.redirectTo);
    expect(firstResponse.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);

    // Тот же ключ снова: выпускается свежий токен, вход проходит второй раз.
    const second = await attemptQuickLogin(attempt);
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

  it("страница с верным ключом редиректит на тот же callback", async () => {
    setProcessEnv(goodEnv());

    const target = await redirectTarget(renderPage({ key: SECRET }));

    expect(target).toContain(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(target).toContain(encodeURIComponent(OWNER_EMAIL));
    expect(await tokensFor(OWNER_EMAIL)).toBe(1);
  });
});

// ------------------------------------------------------ чужая почта

describe("чужим адресом не войти", () => {
  it("email в параметрах запроса игнорируется — токен только на почту из env", async () => {
    setProcessEnv(goodEnv());
    const stranger = `stranger${TEST_EMAIL_DOMAIN}`;

    const target = await redirectTarget(
      // Страница читает только `key`; всё прочее в адресе — шум.
      renderPage({ key: SECRET, email: stranger, identifier: stranger } as {
        key?: string | string[];
      }),
    );

    expect(target).toContain(encodeURIComponent(OWNER_EMAIL));
    expect(target).not.toContain(encodeURIComponent(stranger));
    expect(await tokensFor(stranger)).toBe(0);
  });

  it("подмена почты в самом callback не проходит: токен выпущен не на неё", async () => {
    const result = await attemptQuickLogin({
      key: SECRET,
      ip: nextIp(),
      env: goodEnv(),
      limiter: freshLimiter(),
    });
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

// ------------------------------------------------------------- экран

describe("служебный экран", () => {
  it("без ключа — форма method=get на этот же адрес, без JS и без секретов", async () => {
    setProcessEnv(goodEnv());

    const html = await renderPage();

    expect(html).toContain('method="get"');
    expect(html).toContain(`action="${QUICK_LOGIN_PATH}"`);
    expect(html).toContain(`name="${QUICK_LOGIN_KEY_PARAM}"`);
    expect(html).toContain(ruMessages.DevLogin.title);
    expect(html).toContain(ruMessages.DevLogin.submit);
    // Ни ключа, ни почты владельца на экране нет.
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(OWNER_EMAIL);
    // Никаких серверных действий: форма — чистый браузерный GET.
    expect(html).not.toContain('method="post"');
  });

  it("страница noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("оба языка знают тексты экрана", () => {
    const keys = ["overline", "title", "body", "keyLabel", "submit"] as const;
    for (const key of keys) {
      expect(ruMessages.DevLogin[key], `ru.DevLogin.${key}`).toBeTruthy();
      expect(enMessages.DevLogin[key], `en.DevLogin.${key}`).toBeTruthy();
      // Тон продукта: без восклицательных знаков (design/package/handoff/tone.md).
      expect(ruMessages.DevLogin[key]).not.toContain("!");
      expect(enMessages.DevLogin[key]).not.toContain("!");
    }
  });
});
