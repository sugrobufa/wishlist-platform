import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { ownerTakenCount } from "@/server/services/bookings";
import { occasionBannerVisible } from "@/server/services/occasions";
import { itemForOwner } from "@/server/dto/items";
import { rooms, scene, type Room, type RoomZone } from "@/config/design";
import { SceneStage } from "@/components/scene/SceneStage";
import { visibleZones } from "@/components/scene/zones";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import { zoneDisplayItems } from "@/components/zone/zone-display-items";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Комната хозяйки — живая сцена (тикет 02) с сеткой вещей в открытой зоне
 * (тикет 03): вкладки «Люблю»/«Хочу», демо-призраки в зонах без своих вещей.
 * Мобильный вид — сцена сверху, остальное ниже; на десктопе сцена крупно
 * по центру (ширина — из rooms.json → scene.desktop).
 */
export default async function RoomPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const t = await getTranslations("Room");
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  // Красивый адрес с ником, когда он занят (тикет 13); короткий код
  // продолжает работать редиректом.
  const sharePath = `/r/${room.nick ?? room.shareSlug}`;

  // Счётчик «N вещей уже забраны» (тикет 09) — ЕДИНСТВЕННОЕ, что хозяйка
  // знает о бронях до праздника (инвариант №1). Страница force-dynamic,
  // поэтому сервис зовётся напрямую — отдельный fetch не нужен; сам роут
  // /api/v1/room/taken-count живёт для клиентских обновлений.
  const takenCount = await ownerTakenCount(userId);
  // Тихая строка «праздник прошёл» (тикет 10): дата прошла без итога или
  // в «что подарили» остались неотмеченные подарки. Голый boolean — о бронях
  // он говорит не больше счётчика.
  const showOccasionBanner = await occasionBannerVisible(userId);

  const zoneContent = preset
    ? await buildZoneContent(room.id, preset, room.zonesOff, room.demoGhostsOff)
    : undefined;

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full" style={{ maxWidth: scene.desktop.w }}>
        <header className="px-5 pb-4 pt-6 lg:px-0 lg:pt-10">
          <div className="flex items-start justify-between gap-4">
            <p className="overline text-text-muted">{t("overline")}</p>
            {/* Тихая ссылка в настройки (тикет 13) — без акцента, на месте
                служебных действий шапки. */}
            <div className="flex items-center gap-4">
              {/* Зал славы (тикет 10) — рядом с настройками, тем же тоном. */}
              <Link
                href="/room/hall"
                className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
              >
                {t("hallLink")}
              </Link>
              <Link
                href="/settings"
                className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
              >
                {t("settingsLink")}
              </Link>
            </div>
          </div>
          <h1 className="display mt-2 text-2xl lg:text-4xl">{preset?.name ?? room.preset}</h1>
          {/* Тихий счётчик движения (турн 11d): только число, никаких намёков,
              какие вещи. Спокойный оверлайн без акцента; при нуле — тишина. */}
          {takenCount > 0 && (
            <p className="overline mt-3 text-text-muted">
              {t("takenCount", { count: takenCount })}
            </p>
          )}
          {/* Праздник прошёл — тихая строка-ссылка на «что подарили»
              (тикет 10): без баннерной яркости, тем же тоном, что счётчик. */}
          {showOccasionBanner && (
            <Link
              href="/room/occasion"
              className="pressable mt-3 inline-block text-sm font-semibold"
              style={{ color: preset?.accent ?? "#E7C9A9" }}
            >
              {t("occasionBanner")} →
            </Link>
          )}
        </header>

        {preset && (
          <SceneStage preset={preset} zonesOff={room.zonesOff} zoneContent={zoneContent} />
        )}

        <div className="mt-6 px-5 lg:px-0">
          <div className="flex max-w-md flex-col gap-3 border border-surface-hairline bg-surface-fill p-5">
            <p className="overline text-text-muted">{t("shareOverline")}</p>
            <p className="font-mono text-lg text-text-primary">{sharePath}</p>
            <p className="text-sm text-text-muted">{t("shareHint")}</p>
            <CopyButton path={sharePath} accent={preset?.accent ?? "#E7C9A9"} />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Содержимое панелей зон для SceneStage (контракт тикета 02: узлы проходят
 * client-границу пропом zoneContent[zoneKey]). Для каждой видимой зоны —
 * сетка её вещей; зоне без единой своей вещи достаются демо-призраки пула
 * (в БД не пишутся, исчезают с первой своей вещью — гриллинг №4; тумблер
 * «Убрать примеры» гасит их скопом — тикет 13, zoneDisplayItems).
 */
async function buildZoneContent(
  roomId: string,
  preset: Room,
  zonesOff: string[],
  demoGhostsOff: boolean,
): Promise<Record<string, ReactNode>> {
  const tZone = await getTranslations("ZoneGrid");
  const zones = visibleZones(preset.zones, zonesOff);

  const entries = await Promise.all(
    zones.map(async (zone: RoomZone) => {
      const own = (await listZoneItems(roomId, zone.key)).map(itemForOwner);
      const items = zoneDisplayItems(own, zone.key, zone.pool, demoGhostsOff);
      const node = (
        <div key={zone.key}>
          <ZoneGrid items={items} accent={preset.accent} ink={preset.ink} />
          <Link
            href={`/room/zone/${zone.key}`}
            className="pressable mt-4 inline-block text-xs font-semibold"
            style={{ color: preset.accent }}
          >
            {tZone("openFull")} →
          </Link>
        </div>
      );
      return [zone.key, node] as const;
    }),
  );

  return Object.fromEntries(entries);
}
