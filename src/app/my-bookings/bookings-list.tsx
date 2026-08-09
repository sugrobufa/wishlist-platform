"use client";

// Список «моих броней» (тикет 08): отмена — в два касания (подтверждение),
// «куплено» — переключатель. После мутации — router.refresh(): сервер заново
// читает cookie (отменённый токен уже вычеркнут роутом) и перерисовывает список.
//
// Третья строка карточки — «Показаться после праздника» (хвост тикета 98b,
// слова и подача — тикет 128): единственное место, где гость может передумать
// про связь, пока итог праздника не закрыт. Ответ хранится на броне, а не на
// связи: связи в этот момент ещё нет (она родится на «Дошло»).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconCheck } from "@/components/icons";
import type { MyBookingDto } from "@/server/services/bookings";
import { RethinkRow } from "./rethink-row";

type BookingsListProps = {
  bookings: MyBookingDto[];
};

export function BookingsList({ bookings }: BookingsListProps) {
  const t = useTranslations("MyBookings");
  // Слова «передумать» живут в словаре согласия: это тот же вопрос, что и на
  // подтверждении брони, просто заданный позже (тикет 128).
  const tConsent = useTranslations("Consent");
  const tGuest = useTranslations("GuestRoom");
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const run = async (booking: MyBookingDto, request: () => Promise<Response>) => {
    setBusyId(booking.itemId);
    setErrorId(null);
    try {
      const response = await request();
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      setErrorId(booking.itemId);
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  };

  const cancel = (booking: MyBookingDto) =>
    run(booking, () =>
      fetch(`/api/v1/items/${encodeURIComponent(booking.itemId)}/book`, { method: "DELETE" }),
    );

  const togglePurchased = (booking: MyBookingDto) =>
    run(booking, () =>
      fetch(`/api/v1/items/${encodeURIComponent(booking.itemId)}/book/purchased`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purchased: !booking.purchased }),
      }),
    );

  // «Показаться после праздника» — тот же роут, что и на подтверждении брони:
  // ответ живёт на паре гость↔хозяйка, а не на вещи (хвост тикета 98b).
  const setOffer = (booking: MyBookingDto, offers: boolean) =>
    run(booking, () =>
      fetch(`/api/v1/items/${encodeURIComponent(booking.itemId)}/book/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offers }),
      }),
    );

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {bookings.map((booking) => {
        const busy = busyId === booking.itemId;
        const confirming = confirmingId === booking.itemId;
        // Ответ про связь: null — гость бронировал без аккаунта, связывать
        // некого, и строки не будет вовсе.
        const connection = booking.connection;
        return (
          <li
            key={booking.itemId}
            className="border border-surface-hairline bg-surface-fill p-4"
          >
            <div className="flex gap-4">
              {/* Фото вещи; без фото — честная серая заливка (инвариант №3 тут ни при чём: это не плитка состояния). */}
              <div
                aria-hidden
                className="h-14 w-14 shrink-0 border border-surface-hairline bg-surface-fill bg-cover bg-center"
                style={booking.photoUrl ? { backgroundImage: `url(${booking.photoUrl})` } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{booking.title}</p>
                <p className="mt-1 text-xs text-text-muted">
                  <Link href={`/r/${booking.roomSlug}`} className="pressable underline-offset-2 hover:underline">
                    {booking.ownerName
                      ? t("roomOf", { name: booking.ownerName })
                      : t("roomNoName")}
                  </Link>
                  {" · "}
                  {booking.mode === "SIGNED" ? t("modeSIGNED") : t("modeQUIET")}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    aria-pressed={booking.purchased}
                    disabled={busy}
                    onClick={() => void togglePurchased(booking)}
                    className={`pressable inline-flex items-center gap-1.5 border px-3 py-2 text-xs font-semibold ${
                      booking.purchased
                        ? "border-surface-hairline-strong text-text-strong"
                        : "border-surface-hairline text-text-muted"
                    }`}
                  >
                    {t("purchased")}
                    {/* Галочка «Дошло» из набора вместо прежней галочки-глифа
                        из шрифта — глифов в интерфейсе не бывает (tokens.json →
                        icons, найдено проверкой тикета 52). На 11 px контур
                        утолщён до 3.2 (см. components/icons.tsx). */}
                    {booking.purchased && <IconCheck size={11} strokeWidth={3.2} />}
                  </button>

                  {confirming ? (
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-text-muted">{t("cancelConfirm")}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void cancel(booking)}
                        className="pressable font-semibold text-text-strong"
                      >
                        {t("cancelYes")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingId(null)}
                        className="pressable text-text-muted"
                      >
                        {t("cancelNo")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setErrorId(null);
                        setConfirmingId(booking.itemId);
                      }}
                      className="pressable text-xs text-text-muted"
                    >
                      {t("cancel")}
                    </button>
                  )}
                </div>

                {/* «Показаться после праздника» (хвост тикета 98b, доска 32a;
                    слова и подтверждения — тикет 128). Ответ гость даёт на
                    подтверждении брони, а передумать ему было негде: вот это
                    место. После закрытия итога строка статична — вопрос
                    отыгран, и решает это сервер (`connection.editable`), а не
                    разметка. Имя в объяснении — хозяйкино: чьё имя увидят,
                    гость и так знает, чужих сюда не приходит (инвариант №2). */}
                {connection && (
                  <RethinkRow
                    offers={connection.offers}
                    editable={connection.editable}
                    busy={busy}
                    onAnswer={(offers) => void setOffer(booking, offers)}
                    words={{
                      row: tConsent("rethinkRow"),
                      onTitle: tConsent("rethinkOnTitle"),
                      onBody: tConsent("rethinkOnBody", {
                        name: booking.ownerName ?? tGuest("ownerFallback"),
                      }),
                      onYes: tConsent("rethinkOnYes"),
                      offTitle: tConsent("rethinkOffTitle"),
                      offBody: tConsent("rethinkOffBody"),
                      offYes: tConsent("rethinkOffYes"),
                      keep: tConsent("rethinkKeep"),
                      locked: tConsent("rethinkLocked"),
                    }}
                  />
                )}

                {errorId === booking.itemId && (
                  <p className="mt-2 text-xs" style={{ color: "#E08A6D" }} role="alert">
                    {t("errGeneric")}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
