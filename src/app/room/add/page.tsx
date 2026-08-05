import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { rooms, zoneInfo } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { visibleZones } from "@/components/scene/zones";
import { AddItemFlow, type ZoneOption } from "./add-item-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AddItem");
  return { title: t("overline"), robots: { index: false, follow: false } };
}

type SearchParams = { searchParams: Promise<{ zone?: string }> };

/**
 * Добавление вещи (тикет 04, турн 8). Страница тонкая: собирает видимые
 * зоны комнаты с подписями из zones.json и отдаёт клиентскому флоу;
 * ?zone=… предвыбирает зону (невидимые ключи молча игнорируются).
 */
export default async function AddItemPage({ searchParams }: SearchParams) {
  const { zone: zoneParam } = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) redirect("/room");

  // Прямоугольник зоны едет во флоу вместе с подписью: из него режется кроп
  // комнаты для выбора «люблю / хочу» (тикет 27).
  const zones: ZoneOption[] = visibleZones(preset.zones, room.zonesOff).map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
    rect: zone.rect,
  }));
  const preselected = zones.find((zone) => zone.key === zoneParam)?.key;
  const initialZone = preselected ?? zones[0]?.key ?? "";

  return (
    <AddItemFlow
      zones={zones}
      initialZone={initialZone}
      // Пришли «добавить в эту зону» (?zone=…) — подсказка парсера зону не двигает.
      zonePreselected={preselected !== undefined}
      // Выход из карточки ведёт туда, откуда пришли: со страницы зоны (?zone=…)
      // обратно в неё, иначе в комнату (приёмка п.1).
      exitHref={preselected ? `/room/zone/${preselected}` : "/room"}
      roomImage={roomImageUrl(preset.base)}
      accent={preset.accent}
      ink={preset.ink}
    />
  );
}
