// Быстрый вход для ТЕСТОВОГО СТЕНДА (тикет 29, послаблен тикетом 31).
// Временный обход письма, пока на VPS нет SMTP: штатный вход (почта → письмо →
// /signin/confirm → сессия, тикет 19) остаётся основным и не меняется ни на
// строку.
//
// ЗАЧЕМ: владелец гоняет приёмку и упирается в трение — сначала ссылка из лога
// сервера, потом ключ в адресе. Теперь при включённом флаге голый `/dev-login`
// пускает внутрь сразу: одна закладка, один клик.
//
// КАК ВЫДАЁТСЯ СЕССИЯ. Своих cookie и своих сессий тут НЕТ (устройство тикета
// 29 сохранено целиком). Модуль выпускает обычный одноразовый
// VerificationToken на заранее заданную почту и отдаёт адрес НАСТОЯЩЕГО
// callback провайдера — дальше всё делает Auth.js: сверяет токен и срок, гасит
// строку через adapter.useVerificationToken, заводит пользователя, если его
// ещё нет, выдаёт сессию через PrismaAdapter и ставит свою cookie. То есть
// вход отличается от штатного ровно одним: кто выпустил токен.
//
// ЧТО ОСТАЛОСЬ ЗАЩИТОЙ (тикет 31 §3), а что снято:
//   • ФЛАГ QUICK_LOGIN_ENABLED — единственный рубильник. Не «true» — маршрута
//     нет вовсе: 404, и механизма как будто не существует;
//   • ПОЧТА только из QUICK_LOGIN_EMAIL. Параметры запроса на неё не влияют —
//     чужой аккаунт этим входом не открыть и чужие данные не стереть;
//   • КЛЮЧ QUICK_LOGIN_SECRET стал НЕОБЯЗАТЕЛЬНЫМ (тикет 31 §1). Не задан —
//     вход открыт. Задан (24+ символа) — старая ссылка `?key=…` продолжает
//     работать, а неверный ключ в адресе по-прежнему 404 (чтобы переменная
//     значила ровно то, что написано на ней). Без ключа пускает в обоих
//     случаях: владелец просил «убери всю безопасность», сюда никто, кроме
//     него, не ходит, а рубильник на месте;
//   • БЮДЖЕТ ПОПЫТОК ПО IP СНЯТ (тикет 31 §3). Подбирать больше нечего — дверь
//     открыта и без ключа, — а корзина на 5 запросов в минуту била бы только
//     по владельцу: двойной клик, префетч браузера или пара перезаходов
//     подряд выдавали бы ему 404 на ровном месте. Это ровно то трение, ради
//     снятия которого написан тикет. src/server/rate-limit.ts не тронут:
//     им пользуются другие маршруты;
//   • ЛЮБОЙ ОТКАЗ — 404 (правило тикета 29 сохранено): выключенный флаг,
//     кривая настройка и неверный ключ снаружи неразличимы.
//
// ?fresh=1 — сброс аккаунта в состояние «первый раз» (тикет 31 §2): комната
// владельца удаляется со всем содержимым, и человек уезжает в /onboarding.
// Что именно удаляется — src/server/services/stand-reset.ts.
//
// ?seed=1 — обратная операция (тикет 61): комната владельца НАПОЛНЯЕТСЯ
// контрактом дизайна плюс сокровищница из демо-пулов, и человек уезжает в
// /room смотреть.
// Что именно создаётся — src/server/services/stand-seed.ts. Защита у обеих
// операций одна и та же и живёт здесь: флаг + почта из окружения.
//
// ?empty=1 — вход ВТОРЫМ пользователем стенда, у которого комната ЗАВЕДОМО
// ПУСТАЯ (тикет 190). Комната владельца полна и наполняется при каждом входе,
// а «первое действие пустой комнаты» проверять на ней нечем; опустошать её
// ради проверки — значит сносить стенд (?fresh=1). Поэтому пустая комната у
// стенда своя, отдельным человеком: `prisma/seed.ts` заводит её пустой, а этот
// вход НЕ СЕЕТ и НЕ СБРАСЫВАЕТ ничего — иначе она перестала бы быть пустой в
// первую же секунду.
//
// ПОЧТА И ЗДЕСЬ ТОЛЬКО ИЗ ОКРУЖЕНИЯ — QUICK_LOGIN_EMPTY_EMAIL. Параметр
// выбирает между ДВУМЯ заранее объявленными почтами и ничего не сообщает о
// третьей: правило «чужой аккаунт этим входом не открыть» не ослаблено ни на
// шаг. Переменная не задана — адрес отвечает 404, как и всё остальное здесь.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { magicLinkVerifyAction } from "./auth-links";
import { resetStandRoom, type StandResetResult, type StandResetStorage } from "./services/stand-reset";
import { seedStandRoom, type StandSeedResult, type StandSeedStorage } from "./services/stand-seed";

/** Адрес служебного экрана. Нигде в интерфейсе не упоминается. */
export const QUICK_LOGIN_PATH = "/dev-login";

/** Имя параметра с ключом — необязательного (тикет 31). */
export const QUICK_LOGIN_KEY_PARAM = "key";

/** Имя параметра «онбординг заново»: /dev-login?fresh=1. */
export const QUICK_LOGIN_FRESH_PARAM = "fresh";

/** Имя параметра «наполнить комнату»: /dev-login?seed=1 (тикет 61). */
export const QUICK_LOGIN_SEED_PARAM = "seed";

/** Имя параметра «войти в пустую комнату»: /dev-login?empty=1 (тикет 190). */
export const QUICK_LOGIN_EMPTY_PARAM = "empty";

/**
 * Куда уводить после сброса. /room и сам увёл бы в /onboarding (комнаты уже
 * нет), но лишний прыжок владельцу не нужен: ведём прямо на нужный экран.
 */
export const QUICK_LOGIN_FRESH_PATH = "/onboarding";

/**
 * Ключ короче — не ключ. Задан обрубок вместо секрета (опечатка, обрезанная
 * вставка) — механизм НЕ запирается наглухо, как раньше: он просто не считает
 * такую строку ключом и громко предупреждает. Запирать нельзя: при
 * включённом флаге дверь и так открыта без ключа, и 404 в ответ на опечатку
 * в env оставил бы владельца снаружи без единой подсказки.
 */
export const QUICK_LOGIN_MIN_SECRET_LENGTH = 24;

/**
 * Токен живёт минуту: его тратит же следующий редирект. Утечь ему некуда, но
 * если он всё-таки попадёт в лог прокси или в Referer — через минуту мёртв
 * (и одноразов, как любой токен Auth.js).
 */
export const QUICK_LOGIN_TOKEN_TTL_MS = 60_000;

/**
 * Переменные окружения, от которых зависит механизм. Индексная сигнатура —
 * чтобы сюда без приведения ложился настоящий process.env (тестам удобно
 * передавать свой объект вместо мутации окружения).
 */
export interface QuickLoginEnv {
  QUICK_LOGIN_ENABLED?: string;
  QUICK_LOGIN_SECRET?: string;
  QUICK_LOGIN_EMAIL?: string;
  QUICK_LOGIN_EMPTY_EMAIL?: string;
  AUTH_SECRET?: string;
  [key: string]: string | undefined;
}

export interface QuickLoginConfig {
  /**
   * Ключ из QUICK_LOGIN_SECRET или null — «ключа нет, вход открыт».
   * null — это и «переменная пуста», и «в переменной короче 24 символов».
   */
  secret: string | null;
  /** Единственная почта, которой разрешён быстрый вход (нормализована). */
  email: string;
  /**
   * Почта второго пользователя стенда — того, у кого комната заведомо пустая
   * (тикет 190). null — такого пользователя не объявляли, и `?empty=1` тогда
   * 404, как всё незаданное здесь.
   */
  emptyEmail: string | null;
  /** AUTH_SECRET: им Auth.js солит токен в БД. */
  authSecret: string;
}

/**
 * Итог попытки. Наружу (в HTTP) все отказы выглядят одинаково — 404; reason
 * нужен тестам и логам, в ответ он не попадает.
 */
export type QuickLoginResult =
  | { ok: true; redirectTo: string; reset: StandResetResult | null; seed: StandSeedResult | null }
  | { ok: false; reason: "disabled" | "bad-key" | "no-empty-room" };

// ---------------------------------------------------------------------------
// Состояние процесса (переживает HMR — паттерн src/server/db.ts)
// ---------------------------------------------------------------------------

const globalForQuickLogin = globalThis as unknown as {
  __wishlistQuickLoginWarned?: Set<string>;
};

/**
 * Громкое предупреждение о неверной настройке — один раз на текст, чтобы не
 * залить лог на каждом запросе.
 */
function warnOnce(message: string, consequence: string): void {
  const warned = (globalForQuickLogin.__wishlistQuickLoginWarned ??= new Set<string>());
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`\n⚠  [быстрый вход] ${message}\n   ${consequence}\n`);
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
 * включён, а настройки не хватает (нет почты, нет AUTH_SECRET) — механизм не
 * включается, и в лог уходит предупреждение. Пустой QUICK_LOGIN_SECRET —
 * НЕ ошибка и не повод молчать в лог: это штатный открытый режим тикета 31.
 */
export function readQuickLoginConfig(env: QuickLoginEnv = process.env): QuickLoginConfig | null {
  if (env.QUICK_LOGIN_ENABLED !== "true") return null;

  const email = normalizeEmail(env.QUICK_LOGIN_EMAIL ?? "");
  if (!email) {
    warnOnce(
      "QUICK_LOGIN_ENABLED=true, но QUICK_LOGIN_EMAIL пуст или не похож на почту.",
      "Механизм НЕ включён, /dev-login отвечает 404.",
    );
    return null;
  }

  const authSecret = env.AUTH_SECRET ?? "";
  if (!authSecret) {
    warnOnce(
      "QUICK_LOGIN_ENABLED=true, но AUTH_SECRET пуст — выпускать токен нечем.",
      "Механизм НЕ включён, /dev-login отвечает 404.",
    );
    return null;
  }

  const raw = env.QUICK_LOGIN_SECRET ?? "";
  const secret = raw.length >= QUICK_LOGIN_MIN_SECRET_LENGTH ? raw : null;
  if (raw.length > 0 && secret === null) {
    warnOnce(
      `QUICK_LOGIN_SECRET короче ${QUICK_LOGIN_MIN_SECRET_LENGTH} символов — за ключ он не считается.`,
      "Вход открыт БЕЗ ключа (как при пустой переменной). Выключается флагом QUICK_LOGIN_ENABLED.",
    );
  }

  // Вторая почта НЕОБЯЗАТЕЛЬНА и на сам механизм не влияет: не задана — просто
  // нет адреса `?empty=1`, остальное работает как работало. Задана мусором —
  // предупреждаем, потому что молча превратить опечатку в 404 значит отправить
  // владельца искать несуществующую поломку.
  const rawEmpty = env.QUICK_LOGIN_EMPTY_EMAIL ?? "";
  const emptyEmail = rawEmpty.trim() === "" ? null : normalizeEmail(rawEmpty);
  if (rawEmpty.trim() !== "" && emptyEmail === null) {
    warnOnce(
      "QUICK_LOGIN_EMPTY_EMAIL задан, но не похож на почту.",
      "Адрес /dev-login?empty=1 отвечает 404; обычный вход работает как обычно.",
    );
  }

  return { secret, email, emptyEmail, authSecret };
}

/**
 * Просили ли операцию флагом в адресе. Считаем просьбой любое присутствие
 * параметра — `?fresh`, `?fresh=1`, `?fresh=yes`, — кроме явного отказа
 * `0`/`false`/`no`: адрес набирают руками, и спорить с владельцем из-за формы
 * значения глупо. Массив значений (`?fresh=1&fresh=0`) — берём первое.
 */
function isFlagRequested(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "no";
}

/** Просили ли онбординг заново (?fresh=1). */
export function isFreshRequested(raw: string | string[] | undefined): boolean {
  return isFlagRequested(raw);
}

/**
 * Просили ли показать отчёт посева вместо входа (?report=1, тикет 70).
 * Диагностика стенда: посев возвращает подробный разбор, а страница его
 * выбрасывала — редирект уводил, логи контейнера с рабочего места не видны.
 */
export function isReportRequested(raw: string | string[] | undefined): boolean {
  return isFlagRequested(raw);
}

/** Просили ли наполнить комнату (?seed=1, тикет 61). */
export function isSeedRequested(raw: string | string[] | undefined): boolean {
  return isFlagRequested(raw);
}

/** Просили ли войти пользователем с пустой комнатой (?empty=1, тикет 190). */
export function isEmptyRoomRequested(raw: string | string[] | undefined): boolean {
  return isFlagRequested(raw);
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
async function issueVerificationToken(config: QuickLoginConfig, email: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${rawToken}${config.authSecret}`).digest("hex"),
      expires: new Date(Date.now() + QUICK_LOGIN_TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

/**
 * Подменить `callbackUrl` в готовом адресе callback. Адрес целиком собирает
 * общий magicLinkVerifyAction (src/server/auth-links.ts) — модуль штатного
 * входа, и трогать его ради стенда мы не будем: правим только свой параметр
 * и только у себя.
 */
function withCallbackUrl(action: string, callbackUrl: string): string {
  const [path = action, query = ""] = action.split("?");
  const params = new URLSearchParams(query);
  params.set("callbackUrl", callbackUrl);
  return `${path}?${params.toString()}`;
}

export interface QuickLoginAttempt {
  /** Ключ из ссылки. undefined — «пришли без ключа», это норма (тикет 31). */
  key?: string;
  /** Просили ли онбординг заново (?fresh=1). */
  fresh?: boolean;
  /**
   * Наполнить комнату владельца вещами (тикет 61). Вход стенда ставит это
   * поле всегда (тикет 70); адрес `?seed=1` на него больше не влияет.
   */
  seed?: boolean;
  /**
   * Войти ВТОРЫМ пользователем стенда — тем, у кого комната пустая (тикет 190).
   * Взаимоисключающе с `fresh` и `seed`: и сброс, и посев работают по комнате
   * ВЛАДЕЛЬЦА, а этот вход к ней не относится вовсе.
   */
  empty?: boolean;
  /** Подмена окружения — тестам; в приложении не передаётся. */
  env?: QuickLoginEnv;
  /** Шов хранилища для сброса — тестам; в приложении настоящий S3. */
  storage?: StandResetStorage;
  /** Шов хранилища для посева — тестам; в приложении настоящий S3. */
  seedStorage?: StandSeedStorage;
}

/**
 * Пустить или не пустить. При успехе возвращает адрес callback Auth.js —
 * вызывающему остаётся сделать редирект; всё остальное (сессия, cookie,
 * заведение пользователя, уход в /room или /onboarding) делает сам Auth.js.
 *
 * Порядок намеренный: сначала «механизма нет», потом ключ (если он вообще
 * задан в окружении и передан в адресе), потом развилка «чья это комната»
 * (`?empty=1`, тикет 190), потом сброс и посев — и только последним выпуск
 * токена, чтобы неудавшаяся операция не оставила в БД живой токен.
 *
 * КТО РЕШАЕТ, СЕЯТЬ ЛИ (тикет 70). Здесь — только исполнение флага; решение
 * принимает вход стенда (`src/app/dev-login/page.tsx`), и с тикета 70 он
 * ставит флаг ВСЕГДА. Прежде флаг приходил из адреса `?seed=1`, и на стенде
 * это означало пустую комнату навсегда: владелец входит обычной ссылкой, и
 * все тринадцать зон рисовали демо-призраков с бейджем «пример» — замер 07.08
 * нашёл ноль своих вещей во всех зонах.
 *
 * Разделение оставлено намеренно: сервис — механизм с явным выключателем, и
 * его можно позвать без посева (так делают тесты, которым незачем ходить в S3
 * на каждом входе). Кто именно всегда наполняет стенд — политика страницы.
 *
 * `?fresh=1` сносит комнату; посеву после него нечего наполнять (он честно
 * вернёт roomFound:false), и владелец уезжает в /onboarding заводить комнату
 * заново — а наполнит её следующий же вход.
 */
export async function attemptQuickLogin(attempt: QuickLoginAttempt): Promise<QuickLoginResult> {
  const config = readQuickLoginConfig(attempt.env);
  if (!config) return { ok: false, reason: "disabled" };

  // Ключ спрашиваем, только если он задан в окружении И принесён в адресе:
  // старая закладка `?key=…` продолжает работать, а её отсутствие — не отказ.
  if (config.secret !== null && attempt.key !== undefined) {
    if (!secretMatches(attempt.key, config.secret)) return { ok: false, reason: "bad-key" };
  }

  // ПУСТАЯ КОМНАТА (тикет 190) — отдельная дорога и самая короткая: выпустить
  // токен на ВТОРУЮ почту из окружения и уйти. Ни сброса, ни посева здесь нет
  // и быть не может — оба работают по комнате владельца, а посев вдобавок
  // немедленно перестал бы делать эту комнату пустой.
  if (attempt.empty) {
    if (config.emptyEmail === null) return { ok: false, reason: "no-empty-room" };
    const emptyToken = await issueVerificationToken(config, config.emptyEmail);
    return {
      ok: true,
      redirectTo: magicLinkVerifyAction(emptyToken, config.emptyEmail),
      reset: null,
      seed: null,
    };
  }

  // Сброс и посев — ТОЛЬКО комната владельца стенда: почта берётся из конфига,
  // то есть из окружения. Ни один параметр запроса на неё не влияет.
  const reset = attempt.fresh ? await resetStandRoom(config.email, attempt.storage) : null;
  const seed = attempt.seed ? await seedStandRoom(config.email, attempt.seedStorage) : null;

  const rawToken = await issueVerificationToken(config, config.email);
  // Тот же адрес, куда шлёт форма подтверждения штатного входа (тикет 19);
  // после сброса — сразу на онбординг, без прыжка через пустую /room. После
  // посева адрес штатный: /room — это и есть наполненная комната.
  const action = magicLinkVerifyAction(rawToken, config.email);
  const redirectTo = attempt.fresh ? withCallbackUrl(action, QUICK_LOGIN_FRESH_PATH) : action;
  return { ok: true, redirectTo, reset, seed };
}
