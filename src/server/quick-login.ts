// Быстрый вход для ТЕСТОВОГО СТЕНДА (тикет 29). Временный обход письма, пока
// на VPS нет SMTP: штатный вход (почта → письмо → /signin/confirm → сессия,
// тикет 19) остаётся основным и не меняется ни на строку.
//
// ЗАЧЕМ: на удалённой машине magic link печатается в лог сервера — читать его
// оттуда владельцу неудобно. Здесь он открывает `/dev-login?key=…` и попадает
// в свою комнату одним действием.
//
// КАК ВЫДАЁТСЯ СЕССИЯ. Своих cookie и своих сессий тут НЕТ. Модуль выпускает
// обычный одноразовый VerificationToken на заранее заданную почту и отдаёт
// адрес НАСТОЯЩЕГО callback провайдера — дальше всё делает Auth.js: сверяет
// токен и срок, гасит строку через adapter.useVerificationToken, заводит
// пользователя, если его ещё нет, выдаёт сессию через PrismaAdapter и ставит
// свою cookie. То есть вход отличается от штатного ровно одним: кто выпустил
// токен. Вся проверка и вся работа с сессией остались внутри пакета —
// разъехаться с настоящим флоу тут нечему (обоснование — .scratch/deploy/29).
//
// ПОЧЕМУ ЭТО НЕ ДЫРА (подробно — в тикет-файле):
//   • выключен по умолчанию: без QUICK_LOGIN_ENABLED=true маршрут — 404;
//   • ключ 24+ символа, сверка timing-safe; при коротком ключе механизм НЕ
//     включается и в лог уходит громкое предупреждение;
//   • почта — только QUICK_LOGIN_EMAIL; параметры запроса на неё не влияют;
//   • попытки по IP ограничены корзиной (src/server/rate-limit.ts);
//   • любой отказ — 404: наружу не подтверждаем, что механизм вообще есть.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { magicLinkVerifyAction } from "./auth-links";
import { RateLimiter } from "./rate-limit";

/** Адрес служебного экрана. Нигде в интерфейсе не упоминается. */
export const QUICK_LOGIN_PATH = "/dev-login";

/** Имя параметра с ключом — одно на ссылку и на поле формы. */
export const QUICK_LOGIN_KEY_PARAM = "key";

/** Короче — механизм не включается: 24 случайных символа не подбирают. */
export const QUICK_LOGIN_MIN_SECRET_LENGTH = 24;

/**
 * Токен живёт минуту: его тратит же следующий редирект. Утечь ему некуда, но
 * если он всё-таки попадёт в лог прокси или в Referer — через минуту мёртв
 * (и одноразов, как любой токен Auth.js).
 */
export const QUICK_LOGIN_TOKEN_TTL_MS = 60_000;

/** Бюджет попыток на один IP: 5 в минуту (подбор ключа — не про этот темп). */
export const QUICK_LOGIN_ATTEMPTS_PER_MINUTE = 5;

/** Пространство ключей корзины — своё, чужие бюджеты не трогаем. */
export const QUICK_LOGIN_RATE_PREFIX = "rl:v1:quick-login";

/**
 * Переменные окружения, от которых зависит механизм. Индексная сигнатура —
 * чтобы сюда без приведения ложился настоящий process.env (тестам удобно
 * передавать свой объект вместо мутации окружения).
 */
export interface QuickLoginEnv {
  QUICK_LOGIN_ENABLED?: string;
  QUICK_LOGIN_SECRET?: string;
  QUICK_LOGIN_EMAIL?: string;
  AUTH_SECRET?: string;
  [key: string]: string | undefined;
}

export interface QuickLoginConfig {
  /** Ключ из QUICK_LOGIN_SECRET (уже проверен на длину). */
  secret: string;
  /** Единственная почта, которой разрешён быстрый вход (нормализована). */
  email: string;
  /** AUTH_SECRET: им Auth.js солит токен в БД. */
  authSecret: string;
}

/**
 * Итог попытки. Наружу (в HTTP) все отказы выглядят одинаково — 404; reason
 * нужен тестам и логам, в ответ он не попадает.
 */
export type QuickLoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: "disabled" | "rate-limited" | "bad-key" };

// ---------------------------------------------------------------------------
// Состояние процесса (переживает HMR — паттерн src/server/db.ts)
// ---------------------------------------------------------------------------

const globalForQuickLogin = globalThis as unknown as {
  __wishlistQuickLoginLimiter?: RateLimiter;
  __wishlistQuickLoginWarned?: Set<string>;
};

/**
 * Корзина попыток — в памяти процесса, без Redis: механизм живёт на одном
 * тестовом стенде в одном процессе, а память ещё и не зависит от того, поднят
 * ли Redis. Класс и семантика — общие (src/server/rate-limit.ts), префикс свой.
 */
function attemptLimiter(): RateLimiter {
  globalForQuickLogin.__wishlistQuickLoginLimiter ??= new RateLimiter({
    redis: null,
    prefix: QUICK_LOGIN_RATE_PREFIX,
    capacity: QUICK_LOGIN_ATTEMPTS_PER_MINUTE,
    refillPerMinute: QUICK_LOGIN_ATTEMPTS_PER_MINUTE,
  });
  return globalForQuickLogin.__wishlistQuickLoginLimiter;
}

/**
 * Громкое предупреждение о неверной настройке — один раз на текст, чтобы не
 * залить лог на каждом запросе.
 */
function warnOnce(message: string): void {
  const warned = (globalForQuickLogin.__wishlistQuickLoginWarned ??= new Set<string>());
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`\n⚠  [быстрый вход] ${message}\n   Механизм НЕ включён, /dev-login отвечает 404.\n`);
}

/** Забыть, о чём уже предупреждали. Нужно тестам и dev-HMR. */
export function resetQuickLoginWarnings(): void {
  globalForQuickLogin.__wishlistQuickLoginWarned = undefined;
}

// ---------------------------------------------------------------------------
// Конфиг
// ---------------------------------------------------------------------------

/**
 * Почта в том же виде, в каком её пишет в БД штатный вход (нормализатор
 * @auth/core: NFKC + lower + trim). Иначе «Owner@X.ru» из env завёл бы
 * ВТОРОГО пользователя рядом с «owner@x.ru» из письма.
 */
function normalizeEmail(raw: string): string | null {
  const email = raw.normalize("NFKC").trim().toLowerCase();
  if (email.includes('"')) return null;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return email;
}

/**
 * Конфиг быстрого входа или null — «механизма не существует».
 *
 * null возвращается молча только если флаг выключен: это норма. Если флаг
 * включён, а настройка кривая (короткий ключ, нет почты, нет AUTH_SECRET) —
 * механизм всё равно не включается, но в лог уходит предупреждение.
 */
export function readQuickLoginConfig(env: QuickLoginEnv = process.env): QuickLoginConfig | null {
  if (env.QUICK_LOGIN_ENABLED !== "true") return null;

  const secret = env.QUICK_LOGIN_SECRET ?? "";
  if (secret.length < QUICK_LOGIN_MIN_SECRET_LENGTH) {
    warnOnce(
      `QUICK_LOGIN_ENABLED=true, но QUICK_LOGIN_SECRET ${secret ? "короче" : "пуст (нужно"} ` +
        `${QUICK_LOGIN_MIN_SECRET_LENGTH} символов${secret ? "" : ")"}.`,
    );
    return null;
  }

  const email = normalizeEmail(env.QUICK_LOGIN_EMAIL ?? "");
  if (!email) {
    warnOnce("QUICK_LOGIN_ENABLED=true, но QUICK_LOGIN_EMAIL пуст или не похож на почту.");
    return null;
  }

  const authSecret = env.AUTH_SECRET ?? "";
  if (!authSecret) {
    warnOnce("QUICK_LOGIN_ENABLED=true, но AUTH_SECRET пуст — выпускать токен нечем.");
    return null;
  }

  return { secret, email, authSecret };
}

// ---------------------------------------------------------------------------
// Попытка входа
// ---------------------------------------------------------------------------

/**
 * Сверка ключа за постоянное время. Строки сначала сводятся к 32 байтам
 * sha256: timingSafeEqual требует одинаковой длины (иначе бросает), а так по
 * времени не утекает даже длина ключа.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Одноразовый VerificationToken на нужную почту — ровно такой, какой кладёт в
 * БД сам Auth.js при отправке письма: в строке лежит sha256(токен + секрет),
 * сырой токен уходит в ссылку (@auth/core/lib/actions/signin/send-token.js).
 * Проверять его будет callback провайдера, а не мы.
 */
async function issueVerificationToken(config: QuickLoginConfig): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: config.email,
      token: createHash("sha256").update(`${rawToken}${config.authSecret}`).digest("hex"),
      expires: new Date(Date.now() + QUICK_LOGIN_TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

export interface QuickLoginAttempt {
  /** Ключ из ссылки или из поля формы. */
  key: string;
  /** IP запроса (src/server/rate-limit.ts → clientIp). */
  ip: string;
  /** Подмена окружения — тестам; в приложении не передаётся. */
  env?: QuickLoginEnv;
  /** Своя корзина — тестам; в приложении общая на процесс. */
  limiter?: RateLimiter;
}

/**
 * Пустить или не пустить. При успехе возвращает адрес callback Auth.js —
 * вызывающему остаётся сделать редирект; всё остальное (сессия, cookie,
 * заведение пользователя, уход в /room) делает сам Auth.js.
 *
 * Порядок проверок намеренный: сначала «механизма нет», потом бюджет попыток,
 * и только потом ключ — подбор упирается в корзину, а не в сравнение.
 */
export async function attemptQuickLogin(attempt: QuickLoginAttempt): Promise<QuickLoginResult> {
  const config = readQuickLoginConfig(attempt.env);
  if (!config) return { ok: false, reason: "disabled" };

  const limiter = attempt.limiter ?? attemptLimiter();
  if (!(await limiter.allow(attempt.ip))) return { ok: false, reason: "rate-limited" };

  if (!secretMatches(attempt.key, config.secret)) return { ok: false, reason: "bad-key" };

  const rawToken = await issueVerificationToken(config);
  // Тот же адрес, куда шлёт форма подтверждения штатного входа (тикет 19):
  // почта берётся ТОЛЬКО из конфига — что бы ни лежало в параметрах запроса.
  return { ok: true, redirectTo: magicLinkVerifyAction(rawToken, config.email) };
}
