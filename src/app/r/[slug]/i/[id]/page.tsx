import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { getGuestRoom } from "@/server/services/guest-room";
import { rooms, zoneInfo } from "@/config/design";
import { GuestBookingProvider } from "../../booking/booking-context";
import { GuestItemView } from "./guest-item-view";

// Кэшируется ровно так же, как сама комната гостя (тикет 07): страница не
// читает cookie, HTML одинаков для всех, а всё личное («занято», «занято
// тобой») приезжает после рендера некэшируемым каналом внутри провайдера.
export const revalidate = 300;

export function generateStaticParams(): Array<{ slug: string; id: string }> {
  return [];
}

const getRoom = cache(getGuestRoom);

type Params = { params: Promise<{ slug: string; id: string }> };

// Комната гостя доступна по ссылке и не индексируется (инвариант №7) —
// карточка вещи внутри неё тем более.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, id } = await params;
  const room = await getRoom(slug);
  const item = room
    ? Object.values(room.itemsByZone)
        .flat()
        .find((candidate) => candidate.id === id)
    : null;
  return { title: item?.title, robots: { index: false, follow: false } };
}

/**
 * Карточка вещи глазами ГОСТЯ (тикет 91) — единственный экран доски из списка
 * P0, который до сих пор не был построен (`docs/design-board-recheck.md`, А2).
 *
 * ВЕЩЬ ИЩЕТСЯ В УЖЕ ОТДАННОЙ КОМНАТЕ, а не отдельным запросом: `getGuestRoom`
 * кэширован тегом `room-{id}` и уже отфильтровал всё, чего гостю видеть
 * нельзя, — спрятанные вещи, выключенные зоны, цены по `priceVisibility`
 * (инварианты 5 и 8). Свой запрос к БД пришлось бы фильтровать заново, и
 * первая же забытая проверка стала бы дырой.
 *
 * Демо-призрака по прямой ссылке не показываем: его id живёт только в памяти
 * процесса и ничего не значит для другого рендера.
 */
export default async function GuestItemPage({ params }: Params) {
  const { slug, id } = await params;
  const room = await getRoom(slug);
  if (!room) notFound();

  // Канонический адрес комнаты один — как и на самой комнате (тикет 13).
  if (room.nick && slug !== room.nick) {
    permanentRedirect(`/r/${room.nick}/i/${id}`);
  }

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const zoneKey = Object.keys(room.itemsByZone).find((key) =>
    room.itemsByZone[key]?.some((candidate) => candidate.id === id),
  );
  const item = zoneKey ? room.itemsByZone[zoneKey]?.find((candidate) => candidate.id === id) : null;
  if (!item || item.isDemo) notFound();

  const t = await getTranslations("GuestRoom");
  const zone = preset.zones.find((candidate) => candidate.key === zoneKey);
  const roomHref = `/r/${room.nick ?? room.shareSlug}`;

  return (
    <GuestBookingProvider slug={room.nick ?? room.shareSlug}>
      <GuestItemView
        item={item}
        zoneLabel={zoneInfo(zoneKey ?? "")?.label ?? zone?.label ?? ""}
        pool={zone?.pool}
        ownerName={room.ownerName ?? t("ownerFallback")}
        accent={preset.accent}
        roomHref={roomHref}
      />
    </GuestBookingProvider>
  );
}
