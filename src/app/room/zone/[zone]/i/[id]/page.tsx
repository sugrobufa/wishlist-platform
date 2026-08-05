import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { getOwnItem } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { ItemCard, type ZoneOption } from "./item-card";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ zone: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { zone } = await params;
  return {
    title: zoneInfo(zone)?.label ?? "Wishlist Platform",
    robots: { index: false, follow: false },
  };
}

/**
 * Карточка вещи глазами хозяйки (тикет 39, турны 11e и 8c; P0-экран из 19b):
 * правка полей, перенос на другую полку, «спрятать» и «удалить». У вещи
 * «люблю» сверху — её история: «В комнате с {год}», «Подарок от {кто}»,
 * «Цена · скрыта» и заметка, которая до сих пор не показывалась нигде (Б21).
 *
 * Страница тонкая: читает свою вещь (чужая и несуществующая одинаково — 404,
 * существование чужого id не подтверждаем), собирает видимые зоны комнаты и
 * отдаёт клиентской карточке. Про бронь здесь не знает никто — DTO хозяйки
 * booking не содержит (инвариант №1).
 */
export default async function OwnerItemPage({ params }: Params) {
  const { zone: zoneKey, id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const item = await getOwnItem(userId, id);
  if (!item) notFound();

  // Вещь переехала (или пришли по старой ссылке) — канонический адрес один:
  // тот, где вещь лежит сейчас.
  if (item.zone !== zoneKey) redirect(`/room/zone/${item.zone}/i/${item.id}`);

  const zones: ZoneOption[] = visibleZones(preset.zones, room.zonesOff).map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
  }));

  // Полка выключена или её нет в этом интерьере — карточка недоступна ровно
  // так же, как сама полка (страница зоны на такой ключ отвечает 404).
  const zone = zones.find((candidate) => candidate.key === item.zone);
  if (!zone) notFound();

  return (
    <ItemCard
      item={itemForOwner(item)}
      zones={zones}
      zoneLabel={zone.label}
      accent={preset.accent}
      ink={preset.ink}
    />
  );
}
