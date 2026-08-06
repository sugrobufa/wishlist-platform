import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  attemptQuickLogin,
  isFreshRequested,
  isSeedRequested,
  QUICK_LOGIN_FRESH_PARAM,
  QUICK_LOGIN_KEY_PARAM,
  QUICK_LOGIN_SEED_PARAM,
} from "@/server/quick-login";

// Служебный экран: не кэшируется, не индексируется, в интерфейсе штатного
// входа не упоминается вообще — ни при включённом флаге, ни при выключенном.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Быстрый вход на тестовом стенде (тикет 29, послаблен тикетом 31).
 *
 * Экрана у страницы больше нет — и это вся суть тикета 31: голый `/dev-login`
 * при включённом флаге пускает внутрь сразу, без ключа, без формы, без
 * вопросов. Форма с полем для ключа исчезла вместе с обязательностью ключа;
 * старая закладка `?key=…` продолжает работать (обратная совместимость).
 *
 * Три адреса, одна дорога:
 *   /dev-login          → вход → /room
 *   /dev-login?fresh=1  → вход + сброс комнаты владельца → /onboarding
 *   /dev-login?seed=1   → вход + посев комнаты владельца вещами → /room
 *
 * Любой отказ — 404 через notFound(): выключенный флаг, кривая настройка и
 * неверный ключ выглядят снаружи одинаково, и по ответу нельзя понять,
 * существует ли механизм вообще (правило тикета 29 сохранено).
 *
 * Сессию эта страница не выдаёт: при успехе она только уводит на настоящий
 * callback Auth.js (см. src/server/quick-login.ts).
 */
export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    key?: string | string[];
    fresh?: string | string[];
    seed?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // Страница читает РОВНО три параметра — ключ, «заново» и «наполнить». Ни
  // почты, ни «кого стереть/наполнить» здесь нет и быть не может: это берётся
  // из окружения.
  const raw = params[QUICK_LOGIN_KEY_PARAM];
  const key = Array.isArray(raw) ? raw[0] : raw;

  const outcome = await attemptQuickLogin({
    key,
    fresh: isFreshRequested(params[QUICK_LOGIN_FRESH_PARAM]),
    seed: isSeedRequested(params[QUICK_LOGIN_SEED_PARAM]),
  });
  if (!outcome.ok) notFound();

  // Дальше всё делает Auth.js: гасит токен, заводит сессию, ставит cookie и
  // уводит в /room (а после сброса — сразу в /onboarding).
  redirect(outcome.redirectTo);
}
