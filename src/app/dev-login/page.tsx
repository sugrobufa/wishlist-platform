import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  attemptQuickLogin,
  isEmptyRoomRequested,
  isFreshRequested,
  isReportRequested,
  QUICK_LOGIN_EMPTY_PARAM,
  QUICK_LOGIN_FRESH_PARAM,
  QUICK_LOGIN_KEY_PARAM,
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
 * Пять адресов, одна дорога:
 *   /dev-login          → вход + посев пустых зон комнаты → /room
 *   /dev-login?fresh=1  → вход + сброс комнаты владельца → /onboarding
 *   /dev-login?seed=1   → то же, что голый /dev-login (тикет 70)
 *   /dev-login?report=1 → отчёт посева текстом, БЕЗ входа и без редиректа
 *   /dev-login?empty=1  → вход ВТОРЫМ пользователем стенда, у которого комната
 *                         заведомо пустая (тикет 190): ни сброса, ни посева
 *
 * ОТЧЁТ ЗАВЕДЁН, ПОТОМУ ЧТО ПОСЕВ МОЛЧИТ (07.08). Он возвращает подробный
 * разбор — нашёлся ли пользователь, нашлась ли комната, что создано в каждой
 * зоне и почему зона пропущена, — и всё это уходило в никуда: страница
 * редиректит, а логи контейнера с рабочего места не видны. Час ушёл на
 * догадки о том, что механизм сообщает сам. Больше так не гадаем.
 *
 * Посев идёт при КАЖДОМ входе (тикет 70): прежде он ждал `?seed=1`, и стенд
 * из-за этого стоял с пустыми зонами — владелец входит обычной ссылкой.
 * Параметр остался рабочим ради старых закладок и больше ничего не включает.
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
    report?: string | string[];
    empty?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // Страница читает три параметра — ключ, «заново» и «пустая комната».
  // Четвёртый, `?seed=1`, остался в типе ради старых закладок, но ни на что не
  // влияет: наполнение безусловно (тикет 70). Ни почты, ни «кого стереть/
  // наполнить» здесь нет и быть не может: это берётся из окружения — включая
  // почту пустой комнаты, которую `?empty=1` только ВЫБИРАЕТ, а не приносит.
  const raw = params[QUICK_LOGIN_KEY_PARAM];
  const key = Array.isArray(raw) ? raw[0] : raw;
  const empty = isEmptyRoomRequested(params[QUICK_LOGIN_EMPTY_PARAM]);

  const outcome = await attemptQuickLogin({
    key,
    empty,
    fresh: isFreshRequested(params[QUICK_LOGIN_FRESH_PARAM]),
    // Посев — ВСЕГДА (тикет 70), а не по `?seed=1`. Он идемпотентен: зона с
    // вещами пропускается целиком, и у полной комнаты вся работа — тринадцать
    // `count` и ноль записей. Заведённое руками не трогается.
    //
    // …КРОМЕ ВХОДА В ПУСТУЮ КОМНАТУ: там сеять нечего и некому — комната чужая
    // (не `QUICK_LOGIN_EMAIL`), а сам смысл этого входа в том, что она пустая.
    seed: !empty,
  });
  if (!outcome.ok) notFound();

  // Отчёт вместо редиректа. Секретов в нём нет: ключи зон, имена пулов и
  // счётчики — ни почты, ни ключа, ни адресов хранилища. Выданный токен
  // остаётся неиспользованным и протухает сам; ради одной диагностики это
  // дешевле, чем менять порядок операций в attemptQuickLogin (он намеренно
  // выпускает токен последним).
  if (isReportRequested(params.report)) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
        <h1 style={{ fontSize: 15, marginBottom: 12 }}>Отчёт посева стенда</h1>
        <pre style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {JSON.stringify(outcome.seed, null, 2)}
        </pre>
      </main>
    );
  }

  // Дальше всё делает Auth.js: гасит токен, заводит сессию, ставит cookie и
  // уводит в /room (а после сброса — сразу в /onboarding).
  redirect(outcome.redirectTo);
}
