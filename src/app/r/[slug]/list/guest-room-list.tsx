"use client";

// Гостевой «вся комната списком» (тикет 74, турн 29b-guest): та же
// `RoomListView`, что у хозяйки, плюс переключатель «только свободные».
//
// Набор занятых вещей приезжает НЕ из кэшируемой страницы, а из канала броней
// (тикет 08): HTML комнаты одинаков для всех, брони некэшируемы. Поэтому
// список обёрнут провайдером, а фильтр появляется только здесь — у хозяйки
// такого набора нет и быть не должно (инвариант №1).
import { GuestBookingProvider, useGuestBooking } from "../booking/booking-context";
import { RoomListView, type RoomListGroup } from "@/components/room-list/room-list-view";

type GuestRoomListProps = {
  slug: string;
  groups: RoomListGroup[];
  accent: string;
  roomHref?: string;
  embedded?: boolean;
};

/**
 * Список БЕЗ своего провайдера — для случая, когда он уже есть снаружи.
 * Ровно это и происходит в полосе под кадром гостевой комнаты (тикет 129):
 * там `GuestBookingProvider` стоит на всей странице, и второй завёл бы второй
 * запрос канала «занято» на тот же экран.
 */
export function GuestRoomListView({
  groups,
  accent,
  roomHref,
  embedded,
}: Omit<GuestRoomListProps, "slug">) {
  const { taken } = useGuestBooking();
  return (
    <RoomListView
      groups={groups}
      accent={accent}
      roomHref={roomHref}
      embedded={embedded}
      takenIds={taken}
    />
  );
}

export function GuestRoomList({ slug, ...rest }: GuestRoomListProps) {
  return (
    <GuestBookingProvider slug={slug}>
      <GuestRoomListView {...rest} />
    </GuestBookingProvider>
  );
}
