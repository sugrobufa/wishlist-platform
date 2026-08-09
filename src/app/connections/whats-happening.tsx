// Лента «Что происходит» на экране «Друзья» (тикет 114, часть 2 · макет 35a).
//
// СЕКЦИЯ РИСУЕТСЯ ТОЛЬКО ПРИ ≥1 СТРОКЕ — и это первое, что делает компонент.
// Правило задания 19 (feedNewbie): у новичка ленты нет ВОВСЕ, заголовок без
// строк не рисуется тоже. `Feed.empty` дизайн снял сам: две пустоты на одном
// экране не нужны, а «связи есть, но молчат» — не проблема, которую надо
// озвучивать. Экран держат карточки друзей и пустое состояние СВЯЗЕЙ.
//
// Серверный компонент: тапать здесь нечего, кроме ссылки, а весь текст —
// это next-intl и справочник зон. Клиентского состояния у ленты нет.
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { rooms, zoneInfo } from "@/config/design";
import type { FeedRowDto } from "@/server/dto/feed";

type WhatsHappeningProps = {
  rows: FeedRowDto[];
  /** «Сейчас» для relativeTime — один момент на рендер, с сервера. */
  now: number;
};

export async function WhatsHappening({ rows, now }: WhatsHappeningProps) {
  // Ни строк — ни секции. Раньше любого заголовка и любого запроса словаря.
  if (rows.length === 0) return null;

  const t = await getTranslations("Feed");
  const tConnections = await getTranslations("Connections");
  const format = await getFormatter();

  /**
   * Строка события. Текст собирается ключами дизайна: события формулируются
   * от вещи и комнаты, а не от глагола человека, — поэтому род не склоняется
   * и подстановкой имени строка не ломается.
   */
  function line(row: FeedRowDto): string {
    const name = row.name ?? tConnections("nameFallback");
    switch (row.kind) {
      case "ITEMS_ADDED":
        return t("itemsAdded", { name, count: row.wants });
      case "SHELF_OPENED":
        // Подпись зоны живёт в контракте (zones.json), а не в словаре: зон
        // девятнадцать, они принадлежат зоне, а не экрану. Сервис уже
        // отбросил зоны, которых в справочнике нет.
        return t("shelfOpened", { name, zone: zoneInfo(row.zone ?? "")?.label ?? "" });
      case "TREASURY_OPENED":
        return t("treasuryOpened", { name });
      case "ROOM_CHANGED":
        return t("roomChanged", {
          name,
          room: rooms.find((candidate) => candidate.id === row.preset)?.name ?? "",
        });
      case "BECAME_MUTUAL":
        return t("becameMutual", { name });
    }
  }

  return (
    <section className="mt-9">
      <h2 className="overline text-text-faint">{t("title")}</h2>
      <ul className="mt-1">
        {rows.map((row) => {
          // Точка строки — акцент комнаты друга (макет 35a: три строки трёх
          // друзей окрашены акцентами их интерьеров).
          const accent =
            rooms.find((candidate) => candidate.id === row.roomPreset)?.accent ?? "#E7C9A9";
          const body = (
            <>
              <span
                aria-hidden
                className="h-[5px] w-[5px] flex-none rounded-full"
                style={{ background: accent }}
              />
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-text-body">
                {line(row)}
                {/* Хвост склейки — цветом времени: веха дня плюс желания того
                    же дня. Вторая веха сгорает (правило задания 19). */}
                {row.wants > 0 && row.kind !== "ITEMS_ADDED" && (
                  <span className="text-text-faint">{t("mergedTail", { count: row.wants })}</span>
                )}
              </span>
              <span className="flex-none text-[11px] text-text-faint">
                {format.relativeTime(new Date(row.at), now)}
              </span>
            </>
          );

          return (
            <li key={row.id} className="border-t border-surface-hairline">
              {/* Тап — комната друга при любой склейке. Адреса нет — строка
                  остаётся строкой: ссылку на чужую комнату лента не выдаёт
                  тому, кому её не давали (решение владельца 08.08, тикет 95). */}
              {row.roomSlug === null ? (
                <span className="flex min-h-14 items-center gap-[11px] py-3">{body}</span>
              ) : (
                <Link
                  href={`/r/${row.roomSlug}`}
                  className="pressable flex min-h-14 items-center gap-[11px] py-3"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
