"use client";

// Сетка зоны глазами гостя (тикет 08): та же ZoneGrid тикета 03, но с
// заполненным слотом действия. Правила слота:
// - бирка «Подарить» — ТОЛЬКО у state=WANT && !isDemo (демо-призраки не
//   бронируются, сервер это проверяет ещё раз);
// - у забронированных — тихое «занято» без имён; у своей брони — «занято тобой»;
// - «занято» приезжает отдельным некэшируемым каналом (booking-context)
//   и мержится в плитки уже на клиенте — кэш комнаты не трогаем.
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import type { ZoneGridItem } from "@/components/zone/types";
import { useGuestBooking } from "./booking-context";
import { BookingDialog } from "./booking-dialog";
import { GiftTag } from "./gift-tag";
import s from "./guest-booking.module.css";

type GuestZoneGridProps = {
  items: ZoneGridItem[];
  accent: string;
  ink: string;
  /** Имя хозяйки — «для {имя}» на бирке (имя получателя над надписью, турн 22). */
  ownerName: string;
};

export function GuestZoneGrid({ items, accent, ink, ownerName }: GuestZoneGridProps) {
  const t = useTranslations("Booking");
  const { taken, mine } = useGuestBooking();
  const [bookingItem, setBookingItem] = useState<ZoneGridItem | null>(null);

  const renderItemAction = (item: ZoneGridItem): ReactNode => {
    if (item.state !== "WANT" || item.isDemo) return null;
    if (mine.has(item.id)) {
      return (
        <p className={`${s.taken} ${s.mine}`} style={{ color: accent }}>
          {t("takenByYou")}
        </p>
      );
    }
    if (taken.has(item.id)) {
      return <p className={s.taken}>{t("taken")}</p>;
    }
    return (
      <GiftTag
        size="tile"
        forName={t("tagFor", { name: ownerName })}
        label={t("tagAction")}
        onClick={() => setBookingItem(item)}
      />
    );
  };

  return (
    <>
      <ZoneGrid
        items={items}
        accent={accent}
        ink={ink}
        enterDelay="scene"
        renderItemAction={renderItemAction}
      />
      {bookingItem && (
        <BookingDialog
          item={{ id: bookingItem.id, title: bookingItem.title }}
          ownerName={ownerName}
          accent={accent}
          onClose={() => setBookingItem(null)}
        />
      )}
    </>
  );
}
