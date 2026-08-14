"use client";

// Карточка вещи глазами ГОСТЯ — ЭКРАН ЧТЕНИЯ (тикет 196, доска 51b; числа
// контракта `design/package/handoff/round45/item-card.json` → guest). Прежняя
// редакция — тикет 91, доска А2 + Б24, турн 25b.
//
// ЗАЧЕМ ПЕРЕДЕЛАНО. «Форма упорядочена по полям модели, экран чтения — по
// вопросу читателя» (принцип пакета 45). Вопрос гостя — «ДАРИТЬ ЛИ ЭТО», и
// отвечают на него два блока: цена и магазины. Поэтому цена здесь 29 против
// 16 у хозяйки, магазины раскрыты сразу, а не строкой, название наоборот
// МЕЛЬЧЕ на 3 (21 против 24) — гость знает, за чем пришёл. Полки и даты
// добавления нет вовсе: где вещь стоит, гостю всё равно (guest.notShown).
//
// ГЛАВНОЕ ДЕЙСТВИЕ ОДНО — БИРКА НА НИТИ, и это единственное её место во всём
// продукте (22a, направление 04; правило кнопок из CLAUDE.md). Полосы света на
// этом экране нет ни одной: «иначе главных действий два» (guest.tag.rule).
//
// БРОНЬ ЖИВЁТ ЗДЕСЬ ЖЕ и тем же каналом, что в сетке (тикет 08): «занято»
// приезжает некэшируемым запросом внутри GuestBookingProvider, поэтому HTML
// карточки одинаков для всех — инвариант №1 не трогается.
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { GuestItemDto } from "@/server/dto/guest-items";
import { IconLock } from "@/components/icons";
import { DesireScale } from "@/components/item/desire-scale";
import { ShopLink } from "@/components/zone/shop-link";
import { ExperienceStrip } from "@/components/zone/experience-strip";
import { PoolIcon } from "@/components/pool-icons";
import { useGuestBooking } from "../../booking/booking-context";
import { BookingDialog } from "../../booking/booking-dialog";
import { GiftTag } from "../../booking/gift-tag";
import s from "@/components/item/guest-card.module.css";

type GuestItemViewProps = {
  item: GuestItemDto;
  /** Подпись зоны из zones.json — для хлебной крошки и пустого места фото. */
  zoneLabel: string;
  /** Пул зоны — значок вместо чёрной дыры у вещи без фото (тикет 82). */
  pool?: string | null;
  ownerName: string;
  accent: string;
  roomHref: string;
};

/** Цена строкой: «14 900 ₽». Деньги в DTO — строка Decimal (CLAUDE.md). */
function price(item: GuestItemDto, locale: string): string | null {
  // Цена бывает только у вещи КОМНАТЫ (тикет 124): на витрине гость её не
  // видит вовсе, и ключа `price` у той формы просто нет.
  if (item.inHall || item.price == null) return null;
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

/** Год подарка строкой: ICU расставил бы разряды («2 019»), а это год. */
function yearOf(iso: string): string {
  return String(new Date(iso).getUTCFullYear());
}

/** "#RRGGBB" + альфа → 8-значный hex (рамка и заливка главной двери). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
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
  const tg = useTranslations("ZoneGrid");
  const tShop = useTranslations("Shop");
  const tField = useTranslations("AddItem");
  const tExp = useTranslations("Experience");
  const locale = useLocale();
  const { taken, mine } = useGuestBooking();
  const [booking, setBooking] = useState(false);

  // Дарится всё, что в комнате (тикет 124): вещь витрины гостю сюда не
  // приезжает, и «подарить» у неё нет.
  const isWant = !item.inHall;
  // Сужение типа руками: `shop` есть только у формы вещи комнаты (guest-DTO).
  const shop = item.inHall ? null : item.shop;
  // Степень желания приезжает гостю тем же DTO, что и цена (тикет 125), и
  // показывается ему ТАК ЖЕ, как хозяйке: по ней он и выбирает подарок.
  const desire = item.inHall ? null : item.desire;
  const isTaken = taken.has(item.id);
  const isMine = mine.has(item.id);
  const sum = price(item, locale);

  /**
   * СЛУЧАЙ «БЕЗ ЦЕНЫ И БЕЗ МАГАЗИНА» (contract → cases.noPriceNoStore).
   * Заметка становится телом карточки, название прибавляет 3 px. Строк «цена
   * не указана» и «магазины не добавлены» НЕТ: отсутствие цены — не пробел, а
   * способ сказать «любая».
   */
  const noteHoldsCard = isWant && sum === null && !shop;

  /**
   * ЦЕНА СКРЫТА, А МАГАЗИН ЕСТЬ (тикет 196, контракт round46). Состояние
   * появилось тикетом 195: ссылка приходит гостю всегда, когда она есть, — и
   * значит бывает карточка без числа, но с дорогой.
   *
   * ПРАВИЛО ЗДЕСЬ ОДНО И ОНО ТИХОЕ: при скрытой цене продукт не печатает ни
   * одного числа денег — ни своего, ни разобранного, ни «от», ни «примерно».
   * У нас оно держится швом, а не вёрсткой: в гостевом DTO при скрытой цене
   * ключей `price`/`currency` нет вовсе, а у магазина их не бывает никогда —
   * `shopOf` отдаёт адрес и домен. Печатать нечего.
   */
  const priceHidden = isWant && sum === null && shop != null;

  const style = {
    "--card-accent": accent,
    "--zg-accent": accent,
    // Рамка и заливка главной двери — акцент комнаты при .34 и .05 (contract →
    // storeBlock.primaryRow). У контракта они сняты с кремовой комнаты, у нас
    // акцент свой у каждой.
    "--sl-door-border": withAlpha(accent, 0.34),
    "--sl-door-bg": withAlpha(accent, 0.05),
  } as CSSProperties;

  return (
    <main className={s.screen} style={style}>
      <div className={s.column}>
        <header className={s.head}>
          <Link href={roomHref} className="pressable btn-quiet">
            {t("back")}
          </Link>
        </header>

        {/* Хлебная крошка с доски 25b: человек пришёл по ссылке и должен
            понять, где он, — «Украшения · комната Милы». Это НЕ полка из
            guest.notShown: та была ссылкой «Полка целиком», а это адрес. */}
        <p className={s.crumb}>{t("crumb", { zone: zoneLabel, name: ownerName })}</p>

        {/* Фотография 430×312; занятая вещь приглушена до .55 — то же
            приглушение, что на плитке (contract → guest.taken.why). */}
        <div
          className={[
            s.photo,
            item.photoUrl ? null : s.photoEmpty,
            isTaken && !isMine ? s.photoTaken : null,
          ]
            .filter(Boolean)
            .join(" ")}
          style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
        >
          {!item.photoUrl && (
            <>
              {pool ? <PoolIcon pool={pool} size={38} /> : null}
              <span className={s.photoEmptyLabel}>{zoneLabel}</span>
            </>
          )}
        </div>

        <h1 className={noteHoldsCard ? `${s.name} ${s.nameBig}` : s.name}>{item.title}</h1>

        {/* ВЕЩЬ СОКРОВИЩНИЦЫ (contract → cases.treasury.guest): «Подарок 2019
            года» и НИКАКИХ действий — цена, степень желания, «где купить» и
            бирка сняты, желание исполнено. Имени дарителя здесь нет и быть не
            может: оно раскрывается ровно один раз и ровно хозяйке (инвариант
            №2), и в гостевом DTO этого ключа не существует вовсе. */}
        {!isWant && (
          <p className={s.caption}>
            {item.inHall && item.receivedAt
              ? tg("givenYear", { year: yearOf(item.receivedAt) })
              : t("loveCaption")}
          </p>
        )}

        {/* Цена 29 и огоньки — обе величины про решение (contract → guest.order). */}
        {(sum || desire != null) && (
          <div className={s.priceRow}>
            {sum && <span className={s.price}>{sum}</span>}
            <DesireScale desire={desire} accent={accent} />
          </div>
        )}

        {/* Заметка хозяйки — СРАЗУ ПОД ЦЕНОЙ (contract → guest.order): «Ждала
            её два года». Надстрочной у гостя нет — у него это не раздел
            карточки, а голос хозяйки в ответ на его вопрос. */}
        {item.note && (
          <p className={noteHoldsCard ? `${s.note} ${s.noteBody}` : s.note}>{item.note}</p>
        )}

        {/* «Где купить» — РАСКРЫТО СРАЗУ (contract → guest.order), а не строкой
            как у хозяйки: гость пришёл выбрать подарок, и это его следующий
            шаг. Ссылка приходит ВСЕГДА, когда она есть, — при любом
            `priceVisibility` (тикет 195, инвариант №8).
            ЦЕНЫ В СТРОКЕ МАГАЗИНА НЕТ НИКОГДА (round46 → leak.rule), и не
            только при скрытой: в DTO её нет вовсе — есть адрес и домен. */}
        {shop &&
          (priceHidden ? (
            /* СКРЫТАЯ ЦЕНА: якорем становится ПУТЬ (round46 → anchor). Не
               заметка — та в этом случае осталась бы вторым якорем на одном
               экране, — а дорога в магазин: гость всё равно узнает цену там.
               Заголовок вырастает из надстрочной 9 в строку 500 13, магазин
               выходит в главную дверь 17 в рамке акцентом. */
            <section className={s.storeBlock}>
              <p className={s.storeHeading}>{tShop("title")}</p>
              <ShopLink
                itemId={item.id}
                url={shop.url}
                domain={shop.domain}
                place="sheet"
                door
                action={tField("cardStoreOpen")}
              />
              {/* Отвечает на вопрос, который тут возникает у каждого («а
                  сколько?»), и отвечает не извинением, а адресом. Заглушки
                  «цена скрыта» нет: отсутствие цены — не пробел. */}
              <p className={s.storeHint}>{tField("cardStorePriceByStore")}</p>
            </section>
          ) : (
            <ShopLink itemId={item.id} url={shop.url} domain={shop.domain} place="sheet" />
          ))}

        {/* Услуга-впечатление (тикет 97): «Когда · Где · Годен до» вместо
            размера и цвета. Пустые ячейки не рисуются. */}
        {isWant && (
          <>
            <ExperienceStrip item={item} />
            {/* Срок вышел — бирки нет (её убирает сетка и эта же карточка),
                и человеку честно сказано почему. */}
            {!item.inHall && item.expired && <p className={s.note}>{tExp("expiredGuest")}</p>}
          </>
        )}

        {/* Обещание тихой брони (доска 25b): человек боится, что хозяйка
            узнает. Инвариант №1 — это ровно то, что мы ему обещаем. */}
        {isWant && (
          <p className={`${s.note} flex items-start gap-2`}>
            <IconLock size={16} className="mt-0.5 flex-none" />
            <span>{t("promise", { name: ownerName })}</span>
          </p>
        )}

        {/* ГЛАВНОЕ ДЕЙСТВИЕ: бирка на нити и тихая строка справа от неё.
            ЗАНЯТАЯ ВЕЩЬ: бирки нет, вместо неё «уже дарят» и дорога к
            свободным (contract → guest.taken.instead). */}
        {!isWant ? null : isMine ? (
          <p className={s.takenTitle} style={{ color: accent }}>
            {tb("takenByYou")}
          </p>
        ) : isTaken ? (
          <>
            <p className={s.takenTitle}>{tg("guestTakenTitle")}</p>
            <Link href={roomHref} className={`pressable ${s.takenHint}`}>
              {tg("guestTakenHint")}
            </Link>
          </>
        ) : item.isDemo ? null : (
          <>
            <div className={s.tagRow}>
              <GiftTag
                size="sheet"
                label={tb("tagAction")}
                onClick={() => setBooking(true)}
              />
              <p className={s.quiet}>{tField("cardQuietHint")}</p>
            </div>

            {/* Складчина СТРОКОЙ, пока участников нет (contract → guest.pool).
                Блок прогресса — Phase 2 вместе с самой складчиной; хозяйке не
                видно ни строки, ни блока (инвариант №1, ADR-0008). */}
            {sum && <p className={s.pool}>{tField("cardPoolNote")}</p>}
          </>
        )}
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
