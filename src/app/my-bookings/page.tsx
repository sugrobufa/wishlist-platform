import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import {
  GUEST_BOOKINGS_COOKIE,
  listBookingsByTokens,
  parseGuestBookingTokens,
} from "@/server/services/bookings";
import { BookingsList } from "./bookings-list";

// Страница гостя: список живёт в его HTTP-only cookie — рендер только SSR,
// в кэш такому HTML нельзя. Приватна и не индексируется.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Мои брони» (тикет 08, US 27): брони гостя по токенам из cookie
 * `guest_bookings` — вещь, чья комната, режим; отмена с подтверждением и
 * переключатель «куплено». Регистрации нет и не нужно.
 */
export default async function MyBookingsPage() {
  const t = await getTranslations("MyBookings");
  const raw = (await cookies()).get(GUEST_BOOKINGS_COOKIE)?.value;
  const bookings = await listBookingsByTokens(parseGuestBookingTokens(raw));

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-2xl px-5 lg:px-0">
        <header className="pb-6 pt-6 lg:pt-10">
          <p className="overline text-text-muted">{t("overline")}</p>
          <h1 className="display mt-2 text-2xl lg:text-4xl">{t("title")}</h1>
        </header>

        {bookings.length === 0 ? (
          <div className="border border-surface-hairline bg-surface-fill p-6">
            <p className="text-sm leading-relaxed text-text-muted">{t("empty")}</p>
          </div>
        ) : (
          <BookingsList bookings={bookings} />
        )}
      </div>
    </main>
  );
}
