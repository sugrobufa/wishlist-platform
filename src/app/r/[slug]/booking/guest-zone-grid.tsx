"use client";

// Сетка зоны глазами гостя (тикет 08): та же ZoneGrid тикета 03, но с
// заполненным слотом действия. Правила слота:
// - бирка «Подарить» — ТОЛЬКО у state=WANT && !isDemo (демо-призраки не
//   бронируются, сервер это проверяет ещё раз);
// - у забронированных — тихое «занято» без имён; у своей брони — «занято тобой»;
// - «занято» приезжает отдельным некэшируемым каналом (booking-context)
//   и мержится в плитки уже на клиенте — кэш комнаты не трогаем.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import type { ZoneGridItem } from "@/components/zone/types";
import { useGuestBooking } from "./booking-context";
import { BookingDialog } from "./booking-dialog";
import { GiftTag } from "./gift-tag";
import s from "./guest-booking.module.css";

type GuestZoneGridProps = {
  /** Ключ зоны — форму списка выбирает она («Впечатления» строками). */
  zoneKey: string;
  items: ZoneGridItem[];
  accent: string;
  ink: string;
  /** Имя хозяйки — «для {имя}» на бирке (имя получателя над надписью, турн 22). */
  ownerName: string;
  /** Пул зоны — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
  /** Адрес комнаты — из него собирается ссылка на карточку вещи (тикет 91). */
  roomSlug: string;
};

export function GuestZoneGrid({
  zoneKey,
  items,
  accent,
  ink,
  ownerName,
  pool,
  roomSlug,
}: GuestZoneGridProps) {
  const t = useTranslations("Booking");
  const tExp = useTranslations("Experience");
  const { taken, mine } = useGuestBooking();
  const [bookingItem, setBookingItem] = useState<ZoneGridItem | null>(null);

  const renderItemAction = (item: ZoneGridItem): ReactNode => {
    // Карточка вещи (тикет 91) — у ЛЮБОЙ настоящей вещи, а не только у «хочу»:
    // рассмотреть «люблю» гостю тоже незачем запрещать, это часть комнаты.
    // У демо-призрака карточки нет — его id ничего не значит вне рендера.
    const card = item.isDemo ? null : (
      <Link
        href={`/r/${roomSlug}/i/${item.id}`}
        className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
      >
        {t("itemMore")}
      </Link>
    );
    // Дарится всё, что лежит в комнате (тикет 124); витринных вещей здесь
    // нет вовсе — сервис их не отдаёт.
    if (item.isDemo) return card;
    // Впечатление с вышедшим сроком уходит из «можно подарить» (тикет 97):
    // бирки нет, вместо неё честная строка. Саму вещь не прячем — хозяйка её
    // не убирала, и решать за неё нечего.
    if ("expired" in item && item.expired === true) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className={s.taken}>{tExp("expiredGuest")}</p>
          {card}
        </div>
      );
    }
    if (mine.has(item.id)) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className={`${s.taken} ${s.mine}`} style={{ color: accent }}>
            {t("takenByYou")}
          </p>
          {card}
        </div>
      );
    }
    if (taken.has(item.id)) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className={s.taken}>{t("taken")}</p>
          {card}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-3">
        <GiftTag
          size="tile"
          label={t("tagAction")}
          onClick={() => setBookingItem(item)}
        />
        {card}
      </div>
    );
  };

  return (
    <>
      <ZoneGrid
        zoneKey={zoneKey}
        items={items}
        accent={accent}
        ink={ink}
        enterDelay="scene"
        renderItemAction={renderItemAction}
        pool={pool}
      />
      {bookingItem && (
        <BookingDialog
          item={{
            id: bookingItem.id,
            title: bookingItem.title,
            // Ссылку на магазин лист не добывает сам — она уже в вещи (тикет 37).
            shop: bookingItem.shop ?? null,
          }}
          ownerName={ownerName}
          accent={accent}
          onClose={() => setBookingItem(null)}
        />
      )}
    </>
  );
}
