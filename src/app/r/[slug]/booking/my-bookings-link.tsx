"use client";

// Маленькая строка внизу гостевой комнаты: «Мои брони · N» (тикет 08).
// Cookie гостя HTTP-only, поэтому N приходит из канала «занято»
// (booking-context) уже после рендера — HTML страницы одинаков для всех.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useGuestBooking } from "./booking-context";
import s from "./guest-booking.module.css";

export function MyBookingsLink() {
  const t = useTranslations("Booking");
  const { myBookingsCount } = useGuestBooking();
  if (myBookingsCount === 0) return null;

  return (
    <p className={s.myBookingsRow}>
      {/* Тихая пилюля, как у соседнего «Списком» (тикет 86): в одной строке
          два перехода, и разного вида им быть незачем. */}
      <Link href="/my-bookings" className="pressable btn-quiet">
        {t("myBookingsLink", { count: myBookingsCount })}
      </Link>
    </p>
  );
}
