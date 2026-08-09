import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listConnections, listPendingConsent } from "@/server/services/connections";
import { listFriendsFeed } from "@/server/services/friends-feed";
import { rooms } from "@/config/design";
import { TabBar } from "@/components/tab-bar/tab-bar";
import { StayInTouch } from "@/components/consent/stay-in-touch";
import { ConnectionsList } from "./connections-list";
import { WhatsHappening } from "./whats-happening";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Connections");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Страница друзей хозяйки (тикет 11, турн 21; на доске и в маршруте —
 * «связи», имя раздела поменял владелец 06.08.2026, тикет 62): фильтры
 * Все/Взаимно/Слежу/
 * Смотрели, у каждой строки — происхождение («дарил(а) тебе N раз»,
 * «смотрел(а) · N визитов»).
 *
 * Внизу — лента «Что происходит» (тикет 114, часть 2, макет 35a): хроника
 * комнат друзей. Её может не быть вовсе, и это нормальное состояние экрана:
 * у новичка событий нет, и секция не рисуется даже заголовком (задание 19).
 *
 * ИНВАРИАНТ №4: здесь НЕТ ни поиска людей, ни добавления — связи рождаются
 * сами. Единственная мутация страницы — ответ «остаться на связи?» (тикет 98):
 * он отвечает про УЖЕ существующую строку и создать никого не может. Границу
 * сторожит негативный тест: экшены страницы — ровно два ответа, и ни одного
 * создающего глагола.
 */
export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const t = await getTranslations("Connections");
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const accent = preset?.accent ?? "#E7C9A9";
  const ink = preset?.ink ?? "#241A0E";

  // «Сейчас» фиксируется на сервере ОДИН раз: страница force-dynamic (рендер
  // на каждый запрос). От этого же момента считает клиентский список — без
  // гидрационных расхождений и без ENVIRONMENT_FALLBACK; и от него же считает
  // свежесть ленты, чтобы «3 дн» в строке и её право на жизнь не разъезжались.
  // eslint-disable-next-line react-hooks/purity -- перезапуска рендера с устаревшим now у RSC-страницы не бывает
  const now = Date.now();

  const connections = await listConnections(userId);
  // Вопрос «остаться на связи?» второй стороне (тикет 98): даритель узнаёт о
  // связи здесь — экрана «что подарили» у него нет, это экран хозяйки.
  const consent = await listPendingConsent(userId);
  // Лента «Что происходит» (тикет 114, часть 2): вехи комнат друзей и их новые
  // желания. Пусто — секции не будет вовсе, вместе с заголовком (задание 19).
  const feed = await listFriendsFeed(userId, new Date(now));
  // Считаем ТОЛЬКО состоявшиеся: односторонняя строка «знакомы · подарок в
  // истории» (доска 32a) видна в списке, но ни «взаимно», ни «слежу» она не
  // является — назвать её так значило бы соврать про отказ.
  const friends = connections.filter((row) => row.consent === "active");
  const counts = {
    mutual: friends.filter((row) => row.kind === "MUTUAL").length,
    follow: friends.filter((row) => row.kind === "FOLLOW").length,
    viewed: friends.filter((row) => row.kind === "VIEWED").length,
  };

  return (
    // Нижний отступ освобождает место постоянному таб-бару (86 px, фикс).
    <main className="min-h-screen pb-[calc(var(--imm-tab-bar)+30px)]">
      <div className="mx-auto w-full max-w-xl px-5 lg:px-0">
        <header className="pb-5 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-6 text-3xl lg:text-4xl">
            {t("title")}
            {connections.length > 0 && ` · ${connections.length}`}
          </h1>
          {friends.length > 0 && (
            <p className="mt-2.5 text-[11px] font-medium text-text-muted">
              {t("countsLine", counts)}
            </p>
          )}
        </header>

        {/* Висящие вопросы — выше списка: это единственное на странице, что
            ждёт человека. Ответ «да» с обеих сторон превращает строку в друга
            (тикет 98). */}
        <StayInTouch rows={consent} accent={accent} ink={ink} className="mb-7" />

        {connections.length > 0 ? (
          <ConnectionsList rows={connections} accent={accent} ink={ink} now={now} />
        ) : (
          // Тихое пустое состояние: добавлять руками нечего — и это нормально.
          // При висящем вопросе молчим: «здесь пока никого» рядом с «остаться
          // на связи с Кириллом?» — это про одного и того же человека.
          consent.length === 0 && (
            <div className="max-w-md border border-dashed border-surface-hairline p-5">
              <p className="text-sm leading-relaxed text-text-muted">{t("empty")}</p>
              {/* Доска В8 (турн 20a): в пустых связях мало объяснить — надо
                  предложить действие. Друзья рождаются из открытой ссылки,
                  значит единственный ход отсюда — отдать её. Ведём на комнату,
                  где кнопка шера и живёт: второй такой кнопки не заводим. */}
              <Link
                href="/room"
                className="pressable mt-4 inline-block border-b-2 px-5 py-2.5 text-[13px] font-semibold text-text-primary"
                style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
              >
                {t("emptyShare")} →
              </Link>
            </div>
          )
        )}

        {/* «Что происходит» — ПОД карточками: экран держат они (у них отсчёт
            до праздника и «пора действовать»), лента их дополняет. Секции не
            будет вовсе, если свежих событий нет, — компонент решает это сам. */}
        <WhatsHappening rows={feed} now={now} />
      </div>

      {/* Таб-бар «в списках — постоянный» (тикет 52, турн 25a). */}
      <TabBar active="connections" accent={accent} ink={ink} />
    </main>
  );
}
