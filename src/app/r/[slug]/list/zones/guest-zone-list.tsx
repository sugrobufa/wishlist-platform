"use client";

// Гостевая половина экрана «Полки» (турн 57a, тикет 239): та же `ZoneListView`,
// что у хозяйки, плюс набор занятых вещей.
//
// НАБОР ЗАНЯТЫХ ПРИЕЗЖАЕТ НЕ ИЗ СТРАНИЦЫ, А ИЗ КАНАЛА БРОНЕЙ (тикет 08): HTML
// гостевой комнаты кэшируется и одинаков для всех, брони некэшируемы. Поэтому
// список обёрнут провайдером — ровно как «комната списком» у гостя
// (`guest-room.tsx`). У хозяйки такого набора нет и быть не должно: инвариант
// №1 запрещает ей знать, что именно забрано.
import { GuestBookingProvider, useGuestBooking } from "../../booking/booking-context";
import { ZoneListView, type ZoneListRow } from "@/components/room-list/zone-list-view";

type GuestZoneListProps = {
  slug: string;
  rows: ZoneListRow[];
  moneyKey?: string;
};

function GuestZoneListView({ rows, moneyKey }: Omit<GuestZoneListProps, "slug">) {
  const { taken } = useGuestBooking();
  return <ZoneListView rows={rows} moneyKey={moneyKey} takenIds={taken} />;
}

export function GuestZoneList({ slug, ...rest }: GuestZoneListProps) {
  return (
    <GuestBookingProvider slug={slug}>
      <GuestZoneListView {...rest} />
    </GuestBookingProvider>
  );
}
