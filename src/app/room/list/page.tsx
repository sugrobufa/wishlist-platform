import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { RoomListView, type RoomListGroup } from "@/components/room-list/room-list-view";
import { TabBar } from "@/components/tab-bar/tab-bar";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RoomList");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Вся комната списком глазами ХОЗЯЙКИ (тикет 67).
 *
 * Второй вход в то же содержимое, что и сцена: кто не хочет гулять по комнате,
 * видит все свои вещи разом, сгруппированные по зонам. Сцену не заменяет —
 * переключатель стоит рядом с ней.
 *
 * ДЕМО-ПРИЗРАКОВ ЗДЕСЬ НЕТ. Они объясняют язык ЗОНЫ в сцене («вот так выглядит
 * „хочу", а вот так „люблю"»); в плоском перечне всей комнаты они читались бы
 * как чужие вещи. Пустая комната показывает пустое состояние — это честнее.
 *
 * Спрятанные вещи хозяйке видны (это её экран, и `hidden` у неё — пометка, а
 * не запрет); гостю их не отдаёт сервис (инвариант №5, свой маршрут).
 */
export default async function RoomAsListPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("RoomList");

  // Порядок зон — тот же, что в комнате и в оглавлении: номер группы совпадает
  // с номером зоны, которую человек видел на сцене.
  const zones = visibleZones(preset.zones, room.zonesOff);
  const groups: RoomListGroup[] = [];
  for (const zone of zones) {
    const rows = await listZoneItems(room.id, zone.key);
    if (rows.length === 0) continue;
    groups.push({
      key: zone.key,
      label: zoneInfo(zone.key)?.label ?? zone.label,
      items: rows.map(itemForOwner),
    });
  }

  return (
    <main className="min-h-screen pb-[calc(var(--imm-tab-bar)+30px)]">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("toRoom")}
          </Link>
          <h1 className="display mt-5 text-3xl lg:text-4xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-text-muted">{t("subtitle")}</p>
        </header>

        <RoomListView
          groups={groups}
          accent={preset.accent}
          zoneHref={(key) => `/room/zone/${key}`}
        />
      </div>

      <TabBar active="room" accent={preset.accent} ink={preset.ink} />
    </main>
  );
}
