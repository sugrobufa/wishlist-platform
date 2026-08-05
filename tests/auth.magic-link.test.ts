// Тикет 19: вход по ссылке не сгорает заранее, вошедшего не спрашивают снова.
//
// Под замком главное свойство: одноразовый токен расходуется ТОЛЬКО по
// действию человека. Ссылка из письма ведёт на нашу страницу подтверждения —
// её GET (предзагрузка адресной строки Chrome, почтовый антивирус, сканер
// корпоративной почты) не трогает токен вообще; вход происходит обычным POST
// формы в callback Auth.js, и второй раз тот же токен уже не проходит.
//
// Стенд: настоящая dev-БД (как в tests/owner-counter.test.ts) и НАСТОЯЩИЙ
// обработчик Auth.js (handlers.POST) — проверять одноразовость на моках
// бессмысленно. Мокаются ровно две вещи: auth() (сессия страницы) и
// next-intl (тексты берём из messages/ru.json как есть).
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// auth() подменяем, handlers/signIn оставляем настоящими.
vi.mock("@/server/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth")>();
  return { ...actual, auth: vi.fn(async () => null) };
});

// Тексты страниц — реальные строки продукта, без request-scope next-intl.
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
import { auth, handlers } from "@/server/auth";
import {
  AFTER_SIGNIN_PATH,
  AUTH_BASE_PATH,
  CONFIRM_PATH,
  MAGIC_PROVIDER_ID,
  magicLinkUrl,
  magicLinkVerifyAction,
} from "@/server/auth-links";
import ConfirmSignInPage from "../src/app/signin/confirm/page";
import SignInPage from "../src/app/signin/page";
import { prisma } from "../src/server/db";
import ruMessages from "../messages/ru.json";
import enMessages from "../messages/en.json";

const ORIGIN = "http://localhost:3000";
const TEST_EMAIL_DOMAIN = "@magic-link.test";
const DAY_MS = 24 * 60 * 60 * 1000;

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

/** Тот же хеш, что кладёт в БД сам Auth.js: sha256(token + AUTH_SECRET). */
function storedToken(rawToken: string): string {
  return createHash("sha256").update(`${rawToken}${process.env.AUTH_SECRET}`).digest("hex");
}

/** Свежая пара «почта + сырой токен», строка VerificationToken уже в БД. */
async function issueToken(expiresAt = new Date(Date.now() + DAY_MS)) {
  const email = `magic-${randomUUID().slice(0, 8)}${TEST_EMAIL_DOMAIN}`;
  const rawToken = randomUUID().replace(/-/g, "");
  await prisma.verificationToken.create({
    data: { identifier: email, token: storedToken(rawToken), expires: expiresAt },
  });
  return { email, rawToken };
}

function tokenAlive(email: string): Promise<number> {
  return prisma.verificationToken.count({ where: { identifier: email } });
}

/** POST формы подтверждения — ровно то, что делает браузер по кнопке. */
async function submitConfirmForm(token: string, email: string): Promise<Response> {
  const request = new NextRequest(`${ORIGIN}${magicLinkVerifyAction(token, email)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return handlers.POST(request);
}

/** GET страницы подтверждения — её HTML (то, что увидит человек и сканер). */
async function renderConfirmPage(
  params: { token?: string; email?: string; error?: string } = {},
): Promise<string> {
  const element = await ConfirmSignInPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

/** Адрес редиректа из брошенного next/navigation redirect(). */
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

async function cleanup(): Promise<void> {
  await prisma.verificationToken.deleteMany({
    where: { identifier: { endsWith: TEST_EMAIL_DOMAIN } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeEach(async () => {
  authMock.mockReset();
  authMock.mockResolvedValue(null);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- ссылка

describe("ссылка из письма ведёт на нашу страницу, а не в callback", () => {
  it("magicLinkUrl: callback Auth.js → /signin/confirm с тем же token и email", () => {
    const callback =
      `${ORIGIN}${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}` +
      `?callbackUrl=${encodeURIComponent(ORIGIN)}&token=abc123&email=${encodeURIComponent("Дом@x.ru")}`;

    const link = new URL(magicLinkUrl(callback));

    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe(CONFIRM_PATH);
    expect(link.searchParams.get("token")).toBe("abc123");
    expect(link.searchParams.get("email")).toBe("Дом@x.ru");
    // Ни одного адреса, который тратит токен на GET.
    expect(link.toString()).not.toContain("/api/auth/callback");
  });

  it("чужой формат (нет token/email, не URL) остаётся как есть", () => {
    const noToken = `${ORIGIN}${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}?email=x%40y.ru`;
    expect(magicLinkUrl(noToken)).toBe(noToken);
    expect(magicLinkUrl("не ссылка")).toBe("не ссылка");
  });

  it("magicLinkVerifyAction: POST в callback провайдера с token, email и /room", () => {
    const action = new URL(magicLinkVerifyAction("t0ken", "e@x.ru"), ORIGIN);

    expect(action.pathname).toBe(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(action.searchParams.get("token")).toBe("t0ken");
    expect(action.searchParams.get("email")).toBe("e@x.ru");
    expect(action.searchParams.get("callbackUrl")).toBe(AFTER_SIGNIN_PATH);
  });
});

// -------------------------------------------------- вошедшего не спрашивают

describe("вошедшего редиректит (приёмка п.9)", () => {
  it("/signin при живой сессии — сразу в /room", async () => {
    authMock.mockResolvedValue({ user: { email: `who${TEST_EMAIL_DOMAIN}` } });

    const target = await redirectTarget(SignInPage({ searchParams: Promise.resolve({}) }));
    expect(target).toBe(AFTER_SIGNIN_PATH);
  });

  it("страница подтверждения при живой сессии — сразу в /room, токен не трогает", async () => {
    const { email, rawToken } = await issueToken();
    authMock.mockResolvedValue({ user: { email } });

    const target = await redirectTarget(renderConfirmPage({ token: rawToken, email }));

    expect(target).toBe(AFTER_SIGNIN_PATH);
    expect(await tokenAlive(email)).toBe(1);
  });
});

// ------------------------------------------------- GET страницы ничего не тратит

describe("GET страницы подтверждения не тратит токен", () => {
  it("рисует форму POST в callback и оставляет токен в БД живым", async () => {
    const { email, rawToken } = await issueToken();

    const html = await renderConfirmPage({ token: rawToken, email });

    expect(html).toContain('method="post"');
    expect(html).toContain(`${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}`);
    expect(html).toContain(rawToken);
    expect(html).toContain(ruMessages.SignIn.confirmSubmit);
    expect(html).toContain(ruMessages.SignIn.confirmTitle);
    // Главное: GET прошёл — токен на месте, сессий не появилось.
    expect(await tokenAlive(email)).toBe(1);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
  });

  it("двойная предзагрузка (два GET подряд) не мешает войти после них", async () => {
    const { email, rawToken } = await issueToken();

    await renderConfirmPage({ token: rawToken, email });
    await renderConfirmPage({ token: rawToken, email });
    expect(await tokenAlive(email)).toBe(1);

    const response = await submitConfirmForm(rawToken, email);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);
    expect(await tokenAlive(email)).toBe(0);
  });
});

// ------------------------------------------------------- человеческие ошибки

describe("человеческий текст вместо сырого error=Verification", () => {
  it("заход без токена — «ссылка больше не работает» и кнопка «прислать новую»", async () => {
    const html = await renderConfirmPage({});

    expect(html).toContain(ruMessages.SignIn.expiredTitle);
    expect(html).toContain(ruMessages.SignIn.newLink);
    expect(html).toContain('href="/signin"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Verification");
  });

  it("отказ Auth.js (error=Verification) приходит на тот же тихий экран", async () => {
    const html = await renderConfirmPage({ error: "Verification" });

    expect(html).toContain(ruMessages.SignIn.expiredTitle);
    expect(html).toContain(ruMessages.SignIn.newLink);
  });

  it("прочие отказы — свой текст, тоже без служебных слов", async () => {
    const html = await renderConfirmPage({ error: "Configuration" });

    expect(html).toContain(ruMessages.SignIn.failedTitle);
    expect(html).toContain(ruMessages.SignIn.newLink);
    expect(html).not.toContain("Configuration");
  });

  it("протухший токен: POST не пускает и уводит на наш экран", async () => {
    const { email, rawToken } = await issueToken(new Date(Date.now() - 60_000));

    const response = await submitConfirmForm(rawToken, email);
    const location = new URL(String(response.headers.get("location")));

    expect(location.pathname).toBe(CONFIRM_PATH);
    expect(location.searchParams.get("error")).toBe("Verification");
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
    // Экран по этому адресу — человеческий, без сырого «Verification».
    const html = await renderConfirmPage({ error: "Verification" });
    expect(html).toContain(ruMessages.SignIn.expiredTitle);
  });

  it("оба языка знают тексты экрана подтверждения", () => {
    const keys = [
      "confirmOverline",
      "confirmTitle",
      "confirmBody",
      "confirmSubmit",
      "expiredTitle",
      "expiredBody",
      "failedTitle",
      "failedBody",
      "newLink",
    ] as const;
    for (const key of keys) {
      expect(ruMessages.SignIn[key], `ru.SignIn.${key}`).toBeTruthy();
      expect(enMessages.SignIn[key], `en.SignIn.${key}`).toBeTruthy();
    }
  });
});

// ------------------------------------------------------- POST тратит ровно раз

describe("POST по кнопке: вход и одноразовость токена", () => {
  it("первый POST заводит сессию, гасит токен и уводит в /room", async () => {
    const { email, rawToken } = await issueToken();

    const response = await submitConfirmForm(rawToken, email);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${AFTER_SIGNIN_PATH}`);
    expect(String(response.headers.get("set-cookie"))).toContain("authjs.session-token");

    expect(await tokenAlive(email)).toBe(0);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { sessions: true },
    });
    expect(user?.sessions).toHaveLength(1);
  });

  it("второй POST тем же токеном не проходит — новой сессии нет", async () => {
    const { email, rawToken } = await issueToken();
    await submitConfirmForm(rawToken, email);

    const response = await submitConfirmForm(rawToken, email);
    const location = new URL(String(response.headers.get("location")));

    expect(location.pathname).toBe(CONFIRM_PATH);
    expect(location.searchParams.get("error")).toBe("Verification");
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it("чужая почта при верном токене не пускает", async () => {
    const { email, rawToken } = await issueToken();

    const response = await submitConfirmForm(rawToken, `other${TEST_EMAIL_DOMAIN}`);
    const location = new URL(String(response.headers.get("location")));

    expect(location.pathname).toBe(CONFIRM_PATH);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
  });
});
