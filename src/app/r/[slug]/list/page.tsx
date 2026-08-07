import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getGuestRoom } from "@/server/services/guest-room";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { RoomListView, type RoomListGroup } from "@/components/room-list/room-list-view";

type Params = { params: Promise<{ slug: string }> };

// Только generateMetadata: рядом с ним `export const metadata` Next запрещает
// («cannot be exported at the same time»), и сборка падает. Типы и линт этого
// не ловят — ловит только `next build`.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RoomList");
  // Комната гостя не индексируется (инвариант №7) — как и сама /r/{slug}.
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Вся комната списком глазами ГОСТЯ (тикет 67).
 *
 * Отдельный маршрут, а не `?view=list` на самой комнате: `/r/{slug}` кэшируется
 * полностраничным ISR (тикет 07), и параметр запроса сделал бы её динамической
 * ради второго экрана. Ссылка на список так же пересылаема, как и на комнату.
 *
 * ЧТО ВИДНО ГОСТЮ, РЕШАЕТ НЕ ЭТОТ ФАЙЛ. `getGuestRoom` уже отдал ровно то, что
 * можно: спрятанные вещи и выключенные зоны отфильтрованы на чтении (инвариант
 * №5), цены — по `priceVisibility` (инвариант №8), следов броней в форме вещи
 * нет вовсе (инвариант №1). Здесь только раскладка.
 *
 * ДЕМО-ПРИЗРАКОВ НЕТ: сервис наполняет ими пустые зоны, чтобы комната новичка
 * не выглядела мёртвой в СЦЕНЕ; в плоском перечне они читались бы как вещи
 * хозяйки. Отбрасываем по `isDemo` — своего запроса ради этого не заводим.
 */
export default async function GuestRoomAsListPage({ params }: Params) {
  const { slug } = await params;
  const room = await getGuestRoom(slug);
  if (!room) notFound();

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("RoomList");
  const back = `/r/${room.nick ?? room.shareSlug}`;

  const groups: RoomListGroup[] = [];
  for (const zone of visibleZones(preset.zones, room.zonesOff)) {
    const items = (room.itemsByZone[zone.key] ?? []).filter((item) => !item.isDemo);
    if (items.length === 0) continue;
    groups.push({
      key: zone.key,
      label: zoneInfo(zone.key)?.label ?? zone.label,
      pool: zone.pool,
      items,
    });
  }

  // Шапка гостя говорит именем хозяйки, а не «Моя комната»: это её комната,
  // и на 29a-guest подпись такая же. Счётчик забранных гостю не показывается
  // никогда и ни в каком виде (инвариант №1) — здесь его нет и не было.
  const items = groups.reduce((sum, group) => sum + group.items.length, 0);
  const wants = groups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.state === "WANT").length,
    0,
  );
  const tGrid = await getTranslations("ZoneGrid");

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <h1 className="display text-3xl lg:text-4xl">{room.ownerName ?? t("title")}</h1>
          {items > 0 && (
            <p className="overline mt-2 text-text-muted">
              {tGrid("zoneCounts", { total: items, want: wants })}
            </p>
          )}
        </header>

        {/* Заголовок группы у гостя — просто заголовок: своего экрана зоны
            у него нет, и вести ссылке некуда. */}
        <RoomListView groups={groups} accent={preset.accent} roomHref={back} />
      </div>
    </main>
  );
}
