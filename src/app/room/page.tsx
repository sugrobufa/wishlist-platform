import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { ownerTakenCount } from "@/server/services/bookings";
import { occasionBannerVisible } from "@/server/services/occasions";
import { itemForOwner } from "@/server/dto/items";
import { rooms, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { SceneStage } from "@/components/scene/SceneStage";
import { immersiveLayout } from "@/components/scene/immersive-layout";
import { visibleZones } from "@/components/scene/zones";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import { zoneDisplayItems } from "@/components/zone/zone-display-items";
import { ShareButton } from "./share-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Комната хозяйки — живая сцена (тикет 02) с сеткой вещей в открытой зоне
 * (тикет 03): вкладки «Люблю»/«Хочу», демо-призраки в зонах без своих вещей.
 *
 * Раскладка «во весь экран» (тикет 24): страница не листается и не собрана
 * стопкой. Слоями снизу вверх — размытый кадр комнаты на весь экран, сцена с
 * картой зон посередине, две полосы интерфейса на вуалях. Числа полос —
 * tokens.json → layout.phoneImmersive/desktopImmersive; геометрия и проверка
 * видимости зон — components/scene/immersive-layout.ts.
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

  const accent = preset?.accent ?? "#E7C9A9";

  return (
    <main
      className="imm"
      style={
        {
          "--imm-gutter": `${immersiveLayout.phone.gap}px`,
          ...(preset ? { "--room-image": `url(${roomImageUrl(preset.base)})` } : {}),
        } as CSSProperties
      }
    >
      {/* Комната на весь экран: тот же кадр фоном, размытый до состояния
          света в помещении. Резкая часть с зонами — сцена посередине. */}
      <div className="imm-backdrop" aria-hidden />
      <div className="imm-veil imm-veil-top" aria-hidden />
      <div className="imm-veil imm-veil-bottom" aria-hidden />

      {preset && <SceneStage preset={preset} zonesOff={room.zonesOff} zoneContent={zoneContent} />}

      <header className="imm-rail imm-rail-top">
        <div className="imm-top-grid">
          <div className="imm-area-titles">
            <p className="overline text-text-muted">{t("overline")}</p>
            <h1 className="display imm-title mt-1 text-2xl lg:text-4xl">
              {preset?.name ?? room.preset}
            </h1>
          </div>

          <div className="imm-area-quiet">
            {/* Тихий счётчик движения (турн 11d): только число, никаких намёков,
                какие вещи. Спокойный оверлайн без акцента; при нуле — тишина. */}
            {takenCount > 0 && (
              <p className="overline text-text-muted">{t("takenCount", { count: takenCount })}</p>
            )}
            {/* Праздник прошёл — тихая строка-ссылка на «что подарили»
                (тикет 10): без баннерной яркости, тем же тоном, что счётчик. */}
            {showOccasionBanner && (
              <Link
                href="/room/occasion"
                className="pressable text-sm font-semibold"
                style={{ color: accent }}
              >
                {t("occasionBanner")} →
              </Link>
            )}
          </div>

          {/* Служебные ссылки (тикеты 10, 11, 13) — тихим тоном, в углу полосы. */}
          <nav className="imm-area-actions">
            <Link
              href="/connections"
              className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
            >
              {t("connectionsLink")}
            </Link>
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
          </nav>
        </div>
      </header>

      <div className="imm-rail imm-rail-bottom">
        <div className="imm-row">
          {/* Вход в добавление вещи (полировка 16). «Полоса света» — главная
              кнопка везде (турн 22), здесь тихого размера. */}
          <Link
            href="/room/add"
            className="pressable border-b-2 px-4 text-sm font-semibold text-text-primary"
            style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
          >
            {t("addItem")} →
          </Link>
          {/* Вместо карточки с адресом — один значок (тикет 24). Сам адрес
              живёт в «Настройках», рядом с ником, которым его и меняют. */}
          <ShareButton path={sharePath} accent={accent} />
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
          <div className="mt-4 flex items-center gap-5">
            <Link
              href={`/room/zone/${zone.key}`}
              className="pressable inline-block text-xs font-semibold"
              style={{ color: preset.accent }}
            >
              {tZone("openFull")} →
            </Link>
            {/* Добавить вещь сразу в открытую зону (полировка 16): ?zone=…
                предвыбирает её в карточке добавления (контракт тикета 04). */}
            <Link
              href={`/room/add?zone=${zone.key}`}
              className="pressable inline-block text-xs font-semibold"
              style={{ color: preset.accent }}
            >
              + {tZone("addItem")}
            </Link>
          </div>
        </div>
      );
      return [zone.key, node] as const;
    }),
  );

  return Object.fromEntries(entries);
}
