import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getGuestRoom } from "@/server/services/guest-room";
import { MONEY_ZONE_KEY, rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { IconBack } from "@/components/icons";
import { type ZoneListRow } from "@/components/room-list/zone-list-view";
import s from "@/components/room-list/zone-list.module.css";
import { GuestZoneList } from "./guest-zone-list";

type Params = { params: Promise<{ slug: string }> };

/** Знак «В комнату» — 20 + слово, цель 44 (контракт → header.back). */
const BACK_SIZE = 20;

// Только generateMetadata: рядом с ним `export const metadata` Next запрещает,
// и сборка падает — ловит это лишь `next build`.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ZoneList");
  // Комната гостя не индексируется (инвариант №7) — как и сама /r/{slug}.
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * ПОЛКИ КОМНАТЫ СПИСКОМ ГЛАЗАМИ ГОСТЯ — экран 57a (тикет 239).
 *
 * СТОИТ У ХОЗЯЙКИ И У ГОСТЯ ОДИНАКОВО, и это условие контракта, а не симметрия
 * ради симметрии: «гость без него не найдёт полки без места вообще — он не
 * знает, что они есть. Расхождение между своим и чужим здесь было бы дырой в
 * подарке» (`zone-list.json` → entry.bothRooms).
 *
 * КУДА ВЕДЁТ СТРОКА. У хозяйки — на экран полки (`/room/zone/{ключ}`); своего
 * экрана полки у гостя в продукте нет (его полка живёт плитками в сцене), и
 * строка ведёт в «комнату списком» к нужной полке — единственное место, где
 * гость видит вещи полки вне кадра. Полка без места на кадре и в сцене-то не
 * показывается, так что для семи из них это вся дорога целиком.
 *
 * СЧЁТЧИК СПРАВА — гостевой: «3 из 4 свободны». Второе число считает ЭКРАН по
 * некэшируемому каналу «занято» (тикет 08), а не страница: её HTML кэшируется
 * полностраничным ISR, хозяйка открывает свою же ссылку и получила бы тот же
 * кэшированный ответ — инвариант №1.
 *
 * ЧТО ВИДНО ГОСТЮ, РЕШАЕТ НЕ ЭТОТ ФАЙЛ: `getGuestRoom` уже отфильтровал
 * спрятанные вещи и выключенные зоны (инвариант №5). Здесь только раскладка.
 * Демо-призраки отброшены по `isDemo` — они объясняют язык зоны в сцене, а в
 * счётчике полки читались бы как вещи хозяйки.
 */
export default async function GuestRoomZoneListPage({ params }: Params) {
  const { slug } = await params;
  const room = await getGuestRoom(slug);
  if (!room) notFound();

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("ZoneList");
  const address = room.nick ?? room.shareSlug;

  // ВСЕ полки комнаты, включая пустые и включая те, у кого нет места на кадре.
  const rows: ZoneListRow[] = visibleZones(preset.zones, room.zonesOff).map((zone) => {
    const items = (room.itemsByZone[zone.key] ?? []).filter((item) => !item.isDemo);
    return {
      key: zone.key,
      label: zoneInfo(zone.key)?.label ?? zone.label,
      href: `/r/${address}/list#zone-${zone.key}`,
      total: items.length,
      itemIds: items.map((item) => item.id),
    };
  });

  const items = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <main className="min-h-[100dvh] pb-10">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header>
          <div className={s.head}>
            <Link href={`/r/${address}`} className={`pressable ${s.back}`}>
              <IconBack size={BACK_SIZE} />
              {t("backToRoom")}
            </Link>
          </div>
          <div className={s.title}>
            <h1 className={s.titleWord}>{t("title")}</h1>
            <p className={s.sub}>
              {t("count", { count: rows.length })} · {t("itemsTotal", { count: items })}
            </p>
          </div>
        </header>

        <GuestZoneList slug={address} rows={rows} moneyKey={MONEY_ZONE_KEY} />
      </div>
    </main>
  );
}
