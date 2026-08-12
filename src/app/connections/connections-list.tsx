"use client";

// Список связей с фильтрами (тикет 11, турн 21). Чисто читающий клиент:
// данные приходят DTO с сервера (без email — allowlist listConnections),
// здесь только фильтр по kind и сборка подписи происхождения из структуры
// origin (все строки — через next-intl, CLAUDE.md). Никаких форм и мутаций:
// связи не добавляются руками (инвариант №4).
import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { IconPerson } from "@/components/icons";
import { HOLIDAY_LABEL } from "@/components/occasion/occasion-offer";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import type { ConnectionOriginDto, ConnectionRowDto } from "@/server/services/connections";
import { countdownShown, orderFeed, urgent, type FeedRow } from "./feed-order";
import s from "./feed.module.css";

type Filter = "ALL" | "MUTUAL" | "FOLLOW" | "VIEWED";

const FILTERS: Filter[] = ["ALL", "MUTUAL", "FOLLOW", "VIEWED"];

type ConnectionsListProps = {
  rows: ConnectionRowDto[];
  accent: string;
  ink: string;
  /** «Сейчас» для relativeTime — с сервера (страница force-dynamic): один
   * момент на рендер, сервер и клиент считают от него одинаково (без
   * next-intl ENVIRONMENT_FALLBACK в консоли и без гидрационных расхождений). */
  now: number;
};

/** Аватар собеседника: фото — или тихий силуэт, если аватара нет. */
function Avatar({ url }: { url: string | null }) {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-surface-hairline bg-surface-fill"
      style={
        url ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined
      }
    >
      {/* Силуэт — канон 25a «Профиль» (тикет 52): наш и был этими путями,
          теперь из общего набора. */}
      {!url && <IconPerson size={20} className="text-text-faint" />}
    </span>
  );
}

/**
 * Карточка друга (тикет 95, доска Б7 · турн 11e): живой кадр её комнаты,
 * имя, отсчёт до праздника и «сколько ещё можно подарить».
 *
 * Кадр показывается только тем, кто в этой комнате уже был, — решение о
 * приватности принято на сервере (`ConnectionRowDto.room === null` у
 * остальных), здесь только показ. Ближайшая карточка выше ростом: экран
 * должен сам говорить, что пора действовать.
 *
 * Свет комнаты друг выбирает сам (`lightAndTime`, тикет 96) — когда грейдинг
 * появится, он ляжет на этот же кадр и трогать карточку не придётся.
 */
function FeedCard({ item, tall }: { item: FeedRow; tall: boolean }) {
  const t = useTranslations("Connections");
  // Праздники называет их собственный раздел словаря (тикет 198): имена общих
  // дат и «День рождения» заведены там, и второй пары имён у продукта нет.
  const tOccasion = useTranslations("Occasion");
  const format = useFormatter();
  const { row, daysLeft } = item;
  const room = row.room;
  if (room === null) return null;

  const occasion = room.occasion;
  // ИМЯ ПРАЗДНИКА ЕДЕТ ВМЕСТЕ С ДАТОЙ (тикет 204). «Через 5 дней» было терпимо,
  // пока праздник был один; теперь это может быть и день рождения, и 23
  // февраля — для того, кто выбирает подарок, разница существенная. Строка
  // собирается тем же `nearestLine`, которым комната подписывает свой
  // ближайший праздник: два экрана про один праздник говорят одинаково.
  const holiday =
    occasion === null
      ? null
      : occasion.kind === "birthday"
        ? tOccasion("birthdayLabel")
        : occasion.key !== null
          ? tOccasion(HOLIDAY_LABEL[occasion.key])
          : occasion.title;

  // Когда именно: отсчёт внутри окна, дата — раньше. Само окно живёт в
  // feed-order.ts — «через сколько дней» это свойство сегодняшнего дня, а не
  // связи.
  const when =
    occasion === null || daysLeft === null
      ? null
      : !countdownShown(daysLeft)
        ? format.dateTime(new Date(`${occasion.date}T12:00:00.000Z`), {
            day: "numeric",
            month: "long",
          })
        : daysLeft === 0
          ? t("feedToday")
          : t("feedInDays", { days: daysLeft });

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const accent = preset?.accent ?? "#E7C9A9";

  return (
    <Link
      href={`/r/${room.slug}`}
      className={`pressable ${s.card} ${tall ? s.cardTall : ""}`}
      style={
        {
          "--feed-accent": accent,
          ...(preset ? { "--feed-image": `url(${roomImageUrl(preset.base)})` } : {}),
        } as CSSProperties
      }
    >
      <span className={s.frame} aria-hidden />
      <span className={s.veil} aria-hidden />

      {/* Чип срока — единственное, что торопит. Точка пульсирует, только
          когда праздник совсем близко. */}
      {daysLeft !== null && when !== null && (
        <span className={s.chip}>
          <span
            className={`${s.dot} ${urgent(daysLeft) ? s.dotUrgent : ""}`}
            aria-hidden
          />
          {/* Имя своего повода пишет хозяйка, и оно бывает длинным: строка
              обрезается многоточием, а не уезжает за край кадра. */}
          <span className={s.chipText}>
            {holiday ? tOccasion("nearestLine", { holiday, date: when }) : when}
          </span>
        </span>
      )}

      <span className={s.body}>
        <span className={s.name}>{row.displayName ?? t("nameFallback")}</span>
        {/* Счётчик гостевой: сколько ЕЩЁ можно подарить. Обратного числа —
            сколько уже забрали — не существует (инвариант №1). */}
        <span className={s.sub}>{t("feedFree", { count: room.freeGifts })}</span>
      </span>
    </Link>
  );
}

export function ConnectionsList({ rows, accent, ink, now }: ConnectionsListProps) {
  const t = useTranslations("Connections");
  // Подпись односторонней строки живёт в секции согласия (доска 32a прислала
  // её вместе с экранами вопроса), а не в «Друзьях»: строка про тот же ответ.
  const tConsent = useTranslations("Consent");
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>("ALL");

  // Односторонние строки («знакомы · подарок в истории») видны в «Все», но не
  // под фильтрами видов связи: отказ ни «взаимно», ни «слежу», ни «смотрели».
  const visible = useMemo(
    () =>
      filter === "ALL"
        ? rows
        : rows.filter((row) => row.consent === "active" && row.kind === filter),
    [rows, filter],
  );

  // Порядок ленты считается ЗДЕСЬ, при рендере: «через сколько дней» —
  // свойство сегодняшнего дня, а не связи (feed-order.ts).
  const { upcoming, rest } = useMemo(() => orderFeed(visible, new Date(now)), [visible, now]);

  /** Строка под именем ВСЕГДА объясняет, откуда связь (README турн 21). */
  function originLabel(origin: ConnectionOriginDto): string {
    switch (origin.type) {
      case "gift":
        if (origin.received > 0 && origin.given > 0) {
          return t("originGiftBoth", { received: origin.received, given: origin.given });
        }
        if (origin.received === 1 && origin.lastTitle) {
          return origin.lastInHall
            ? t("originGiftOneHall", { title: origin.lastTitle })
            : t("originGiftOne", { title: origin.lastTitle });
        }
        if (origin.received > 0) return t("originGiftMany", { count: origin.received });
        return t("originGiftGiven", { count: origin.given });
      case "visit":
        return t("originVisits", { count: origin.visits });
      default:
        return t("originLink");
    }
  }

  function filterLabel(key: Filter): string {
    if (key === "ALL") return t("filterAll", { count: rows.length });
    return t(`filter${key}`);
  }

  return (
    <div>
      {/* Фильтры — чипы турна 21: активный залит акцентом комнаты. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filtersAria")}>
        {FILTERS.map((key) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={`pressable flex min-h-11 items-center px-3.5 text-[11px] font-semibold ${
                active ? "" : "border border-surface-hairline bg-surface-fill text-text-muted"
              }`}
              style={active ? { background: accent, color: ink } : undefined}
            >
              {filterLabel(key)}
            </button>
          );
        })}
      </div>

      {/* Лента (тикет 95): у кого праздник ближе — тот выше, и у самого
          ближнего карточка крупнее. Кадр комнаты показывается ТОЛЬКО тем,
          кто в ней уже был (решение владельца 08.08): ссылка на комнату и
          есть ключ доступа. */}
      {upcoming.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {upcoming.map((item, index) => (
            <li key={item.row.id}>
              <FeedCard item={item} tall={index === 0} />
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 0 && rest.length > 0 && (
        <p className="overline mt-6 mb-1 text-text-faint">{t("feedNoDate")}</p>
      )}

      {rest.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {rest
            .filter((item) => item.row.room !== null)
            .map((item) => (
              <li key={item.row.id}>
                <FeedCard item={item} tall={false} />
              </li>
            ))}
        </ul>
      )}

      {visible.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-px bg-surface-hairline">
          {rest
            .filter((item) => item.row.room === null)
            .map(({ row }) => (
            <li
              key={row.id}
              className={`flex items-center gap-3 bg-surface-app-ground py-3.5 ${
                row.kind === "VIEWED" || row.consent === "declined" ? "opacity-75" : ""
              }`}
            >
              <Avatar url={row.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text-primary">
                    {row.displayName ?? t("nameFallback")}
                  </span>
                  {/* Односторонняя строка значка вида связи НЕ получает: она
                      ни «взаимно», ни «слежу» — весь её смысл сказан подписью
                      ниже (доска 32a). */}
                  {row.consent === "active" && (
                    <span
                      className={`flex-none px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] ${
                        row.kind === "MUTUAL" ? "" : "bg-surface-fill text-text-muted"
                      }`}
                      style={
                        row.kind === "MUTUAL"
                          ? { background: `${accent}2E`, color: accent }
                          : undefined
                      }
                    >
                      {t(`badge${row.kind}`)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-text-muted">
                  {/* «знакомы · подарок в истории»: отказ не стирает факт
                      подарка — он только не делает связь взаимной. */}
                  {row.consent === "declined"
                    ? tConsent("declinedRow")
                    : originLabel(row.origin)}
                </p>
              </div>
              {/* «N дней назад» — последнее событие связи. */}
              <span className="flex-none text-right text-[11px] font-medium text-text-muted">
                {format.relativeTime(new Date(row.lastAt), now)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-text-muted">{t("emptyFiltered")}</p>
      )}
    </div>
  );
}
