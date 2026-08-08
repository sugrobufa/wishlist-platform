"use client";

// Карточка вещи глазами ГОСТЯ (тикет 91, доска А2 + Б24, турн 25b).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН. До него гость видел плитку в сетке и бирку
// «Подарить» — рассмотреть подарок было негде: ни заметки хозяйки, ни
// «где купить» крупно, ни обещания про тихую бронь. Доска ставила этот экран
// в P0 и отмечала, что он дешёвый: та же карточка, что у хозяйки (тикет 39),
// только правки в ней нет, а есть бирка.
//
// БРОНЬ ЖИВЁТ ЗДЕСЬ ЖЕ и тем же каналом, что в сетке (тикет 08): «занято»
// приезжает некэшируемым запросом внутри GuestBookingProvider, поэтому HTML
// карточки одинаков для всех — инвариант №1 не трогается.
import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { GuestItemDto } from "@/server/dto/guest-items";
import { IconLock } from "@/components/icons";
import { ShopLink } from "@/components/zone/shop-link";
import { PoolIcon } from "@/components/pool-icons";
import { useGuestBooking } from "../../booking/booking-context";
import { BookingDialog } from "../../booking/booking-dialog";
import { GiftTag } from "../../booking/gift-tag";

type GuestItemViewProps = {
  item: GuestItemDto;
  /** Подпись зоны из zones.json — для хлебной крошки. */
  zoneLabel: string;
  /** Пул зоны — значок вместо чёрной дыры у вещи без фото (тикет 82). */
  pool?: string | null;
  ownerName: string;
  accent: string;
  roomHref: string;
};

/** Цена строкой: «14 900 ₽». Деньги в DTO — строка Decimal (CLAUDE.md). */
function price(item: GuestItemDto, locale: string): string | null {
  if (item.state !== "WANT" || item.price == null) return null;
  const value = Number(item.price);
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: item.currency ?? "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${item.price} ${item.currency ?? ""}`.trim();
  }
}

export function GuestItemView({
  item,
  zoneLabel,
  pool,
  ownerName,
  accent,
  roomHref,
}: GuestItemViewProps) {
  const t = useTranslations("GuestItem");
  const tb = useTranslations("Booking");
  const locale = useLocale();
  const { taken, mine } = useGuestBooking();
  const [booking, setBooking] = useState(false);

  const isWant = item.state === "WANT";
  // Сужение типа руками: `shop` есть только у формы «хочу» (guest-DTO), и
  // компилятор прав — у «люблю» такого ключа нет вовсе.
  const shop = item.state === "WANT" ? item.shop : null;
  const isTaken = taken.has(item.id);
  const isMine = mine.has(item.id);
  const sum = price(item, locale);

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-2xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href={roomHref} className="pressable btn-quiet">
            {t("back")}
          </Link>
          {/* Хлебная крошка с доски 25b: человек пришёл по ссылке и должен
              понять, где он, — «Украшения · комната Милы». */}
          <p className="overline mt-5 text-text-muted">
            {t("crumb", { zone: zoneLabel, name: ownerName })}
          </p>
          <h1 className="display mt-2 text-3xl lg:text-4xl">{item.title}</h1>
          {sum && (
            <p className="mt-2 text-2xl font-semibold" style={{ color: accent }}>
              {sum}
            </p>
          )}
          {!isWant && <p className="mt-2 text-sm text-text-muted">{t("loveCaption")}</p>}
        </header>

        <div
          className="relative mt-4 aspect-[4/3] w-full overflow-hidden bg-surface-fill"
          style={{ "--zg-accent": accent } as React.CSSProperties}
        >
          {item.photoUrl ? (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${item.photoUrl})` }}
              aria-hidden
            />
          ) : (
            <span
              className="absolute inset-0 flex items-center justify-center opacity-20"
              style={{ color: accent }}
              aria-hidden
            >
              {pool ? <PoolIcon pool={pool} size={64} /> : null}
            </span>
          )}
        </div>

        {/* Заметка хозяйки — то, чего в сетке нет вовсе: «Ждала её два года».
            Поле есть в гостевом DTO и до этого экрана нигде не показывалось. */}
        {item.note && (
          <section className="mt-6">
            <p className="overline text-text-muted">{t("noteLabel")}</p>
            <p className="mt-1 text-base text-text-primary">{item.note}</p>
          </section>
        )}

        {/* «Где купить» (тикет 37) — здесь крупно, а не строкой под плиткой:
            гость пришёл выбрать подарок, и это его следующий шаг. */}
        {shop && (
          <section className="mt-6">
            <ShopLink itemId={item.id} url={shop.url} domain={shop.domain} place="sheet" />
          </section>
        )}

        {/* Обещание тихой брони (доска 25b): человек боится, что хозяйка
            узнает. Инвариант №1 — это ровно то, что мы ему обещаем. */}
        {isWant && (
          <p className="mt-6 flex items-start gap-2 text-sm text-text-muted">
            <IconLock size={16} className="mt-0.5 flex-none" />
            <span>{t("promise", { name: ownerName })}</span>
          </p>
        )}

        <div className="mt-8">
          {!isWant ? null : isMine ? (
            <p className="text-sm font-semibold" style={{ color: accent }}>
              {tb("takenByYou")}
            </p>
          ) : isTaken ? (
            <>
              <p className="text-base font-semibold text-text-primary">{t("takenTitle")}</p>
              <Link href={roomHref} className="pressable btn-quiet mt-3">
                {t("takenHint")}
              </Link>
            </>
          ) : item.isDemo ? null : (
            <GiftTag
              size="sheet"
              forName={tb("tagFor", { name: ownerName })}
              label={tb("tagAction")}
              onClick={() => setBooking(true)}
            />
          )}
        </div>
      </div>

      {booking && (
        <BookingDialog
          item={{ id: item.id, title: item.title, shop }}
          ownerName={ownerName}
          accent={accent}
          onClose={() => setBooking(false)}
        />
      )}
    </main>
  );
}
