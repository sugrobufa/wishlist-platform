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
  roomHref: string;
};

function Inner({ groups, accent, roomHref }: Omit<GuestRoomListProps, "slug">) {
  const { taken } = useGuestBooking();
  return <RoomListView groups={groups} accent={accent} roomHref={roomHref} takenIds={taken} />;
}

export function GuestRoomList({ slug, ...rest }: GuestRoomListProps) {
  return (
    <GuestBookingProvider slug={slug}>
      <Inner {...rest} />
    </GuestBookingProvider>
  );
}
