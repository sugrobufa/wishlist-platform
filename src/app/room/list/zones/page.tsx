import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { MONEY_ZONE_KEY, rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { IconBack } from "@/components/icons";
import { ZoneListView, type ZoneListRow } from "@/components/room-list/zone-list-view";
import s from "@/components/room-list/zone-list.module.css";

export const dynamic = "force-dynamic";

/** Знак «В комнату» — 20 + слово, цель 44 (контракт → header.back). */
const BACK_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ZoneList");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * ПОЛКИ КОМНАТЫ СПИСКОМ — экран 57a (тикет 239, контракт
 * `design/package/handoff/round51/zone-list.json`).
 *
 * ЗАЧЕМ ОН ОБЯЗАТЕЛЕН. Решением владельца 14.08.2026 семь полок из 134 живут
 * без места на кадре (`zonesWithoutRect`, тикет 235): метки нет, камера не
 * едет — и этот список их ЕДИНСТВЕННАЯ дорога. До того он был удобством.
 *
 * ОН НИЧЕГО НЕ ПОМЕЧАЕТ. Ни значка, ни подписи, ни особого порядка у этих
 * семи: «человек не знает, что у полки бывает место на кадре, и узнавать ему
 * незачем». Разбор — в шапке `zone-list-view.tsx`; здесь важно лишь то, что
 * страница отдаёт ВСЕ полки комнаты одним правилом `visibleZones` и не смотрит
 * ни на `withoutRect`, ни на число вещей.
 *
 * ЭТО НЕ «КОМНАТА СПИСКОМ» (`/room/list`, турн 29a). Там перечень ВЕЩЕЙ,
 * сгруппированный по полкам, с миниатюрами и ценами; здесь — перечень ПОЛОК
 * строкой 56, и все 14 умещаются на телефон без прокрутки. Два экрана в одном
 * вердикте пакета имеют разные формы, поэтому у этого своя строка и свой
 * модуль стилей, а «комната списком» этим тикетом не переписывается.
 *
 * ТАБ-БАРА ЗДЕСЬ НЕТ НАРОЧНО: замер контракта — 56 шапка + 84 заголовок + 14×56
 * строк = 924 из 932. Полоса знаков (86) отняла бы две строки, и список поехал
 * бы прокруткой ровно на том экране, ради которого он и мерился. Дорога назад —
 * «В комнату» в шапке.
 *
 * СПРЯТАННЫЕ ВЕЩИ хозяйке видны и считаются: это её экран, и `hidden` у неё —
 * пометка, а не запрет. Число берётся тем же `listZoneItems`, что кормит
 * «комнату списком», — второго счётчика с другим правилом здесь не заводится.
 */
export default async function RoomZoneListPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("ZoneList");

  // ВСЕ полки комнаты, включая пустые и включая те, у кого нет места на кадре.
  // Отсеивает только `zonesOff` — выключенная хозяйкой полка исчезает вместе с
  // мебелью (инвариант №5), и её в списке быть не должно.
  //
  // Запросы идут разом, а не по очереди: полок четырнадцать, и на экране,
  // который стал единственной дорогой, четырнадцать последовательных поездок в
  // базу — это её задержка, помноженная на четырнадцать. Считает их тот же
  // `listZoneItems`, что кормит «комнату списком»: вещи КОМНАТЫ, без витрины.
  const zones = visibleZones(preset.zones, room.zonesOff);
  const rows: ZoneListRow[] = await Promise.all(
    zones.map(async (zone) => ({
      key: zone.key,
      label: zoneInfo(zone.key)?.label ?? zone.label,
      href: `/room/zone/${zone.key}`,
      total: (await listZoneItems(room.id, zone.key)).length,
    })),
  );

  const items = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <main className="min-h-[100dvh] pb-10">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header>
          <div className={s.head}>
            <Link href="/room" className={`pressable ${s.back}`}>
              <IconBack size={BACK_SIZE} />
              {t("backToRoom")}
            </Link>
          </div>
          <div className={s.title}>
            <h1 className={s.titleWord}>{t("title")}</h1>
            {/* «{полок} · {вещей}» — обе половины из контракта. */}
            <p className={s.sub}>
              {t("count", { count: rows.length })} · {t("itemsTotal", { count: items })}
            </p>
          </div>
        </header>

        <ZoneListView rows={rows} moneyKey={MONEY_ZONE_KEY} />
      </div>
    </main>
  );
}
