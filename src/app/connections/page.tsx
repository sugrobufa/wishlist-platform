import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listConnections } from "@/server/services/connections";
import { rooms } from "@/config/design";
import { TabBar } from "@/components/tab-bar/tab-bar";
import { ConnectionsList } from "./connections-list";

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
 * «смотрел(а) · N визитов»). ИНВАРИАНТ №4: здесь НЕТ ни поиска людей, ни
 * добавления — связи рождаются сами, страница только читает (ни одной формы
 * и ни одного экшена — под негативным тестом).
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

  const connections = await listConnections(userId);
  const counts = {
    mutual: connections.filter((row) => row.kind === "MUTUAL").length,
    follow: connections.filter((row) => row.kind === "FOLLOW").length,
    viewed: connections.filter((row) => row.kind === "VIEWED").length,
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
          {connections.length > 0 && (
            <p className="mt-2.5 text-[11px] font-medium text-text-muted">
              {t("countsLine", counts)}
            </p>
          )}
        </header>

        {connections.length > 0 ? (
          // «Сейчас» для relativeTime фиксируется на сервере: страница
          // force-dynamic (рендер на каждый запрос), клиент считает от того же
          // момента — без гидрационных расхождений и без ENVIRONMENT_FALLBACK.
          // eslint-disable-next-line react-hooks/purity -- перезапуска рендера с устаревшим now у RSC-страницы не бывает
          <ConnectionsList rows={connections} accent={accent} ink={ink} now={Date.now()} />
        ) : (
          // Тихое пустое состояние: добавлять руками нечего — и это нормально.
          <div className="max-w-md border border-dashed border-surface-hairline p-5">
            <p className="text-sm leading-relaxed text-text-muted">{t("empty")}</p>
          </div>
        )}
      </div>

      {/* Таб-бар «в списках — постоянный» (тикет 52, турн 25a). */}
      <TabBar active="connections" accent={accent} ink={ink} />
    </main>
  );
}
