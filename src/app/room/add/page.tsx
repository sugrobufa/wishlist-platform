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

type SearchParams = { searchParams: Promise<{ zone?: string; hall?: string }> };

/**
 * Добавление вещи (тикет 04, турн 8). Страница тонкая: собирает видимые
 * зоны комнаты с подписями из zones.json и отдаёт клиентскому флоу;
 * ?zone=… предвыбирает зону (невидимые ключи молча игнорируются).
 *
 * ?hall=1 — пришли с витрины сокровищницы (тикет 89): вещь по определению уже
 * своя, поэтому вопрос «люблю или хочу» не задаётся вовсе (решение владельца
 * 08.08.2026: «хочу» в сокровищнице не надо). Зону всё равно спрашиваем —
 * витрина зоне не замена, а слой поверх.
 */
export default async function AddItemPage({ searchParams }: SearchParams) {
  const { zone: zoneParam, hall: hallParam } = await searchParams;
  const toHall = hallParam === "1";

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
  // Выбранные в онбординге категории — верхними (тикет 113, доска 34b):
  // список зон не меняется, меняется его порядок. Пустой ответ — как было.
  const wanted = new Set(room.wants);
  const ordered = [
    ...visibleZones(preset.zones, room.zonesOff).filter((zone) => wanted.has(zone.key)),
    ...visibleZones(preset.zones, room.zonesOff).filter((zone) => !wanted.has(zone.key)),
  ];
  const zones: ZoneOption[] = ordered.map((zone) => ({
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
      toHall={toHall}
      // Выход из карточки ведёт туда, откуда пришли: с витрины (?hall=1) на
      // витрину, со страницы зоны (?zone=…) обратно в неё, иначе в комнату
      // (приёмка п.1).
      exitHref={toHall ? "/room/hall" : preselected ? `/room/zone/${preselected}` : "/room"}
      roomImage={roomImageUrl(preset.base)}
      accent={preset.accent}
      ink={preset.ink}
    />
  );
}
