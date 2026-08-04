import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { demoGhostsFor } from "@/config/demo-pools";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { ZoneGrid } from "@/components/zone/ZoneGrid";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ zone: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { zone } = await params;
  return {
    title: zoneInfo(zone)?.label ?? "Wishlist Platform",
    robots: { index: false, follow: false },
  };
}

/**
 * «Зона целиком списком» (P0-экран из 19b): та же сетка вещей, что в панели
 * сцены, но без сцены — с заголовком и подписью зоны из zones.json и кнопкой
 * назад в комнату. Ключ зоны, которого нет среди видимых зон комнаты
 * (включая выключенные через zonesOff — они исчезают с мебелью), — 404.
 */
export default async function ZoneListPage({ params }: Params) {
  const { zone: zoneKey } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const zone = visibleZones(preset.zones, room.zonesOff).find((z) => z.key === zoneKey);
  if (!zone) notFound();

  const t = await getTranslations("ZoneGrid");
  const info = zoneInfo(zone.key);

  const own = (await listZoneItems(room.id, zone.key)).map(itemForOwner);
  const items = own.length > 0 ? own : demoGhostsFor(zone.key, zone.pool);

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-5 text-3xl lg:text-4xl">{info?.label ?? zone.label}</h1>
          {/* Подпись зоны из справочника zones.json (счётчик-заглушка пакета);
              живые счётчики — во вкладках сетки ниже. */}
          {info?.subtitle && <p className="mt-2 text-sm text-text-muted">{info.subtitle}</p>}
        </header>

        <ZoneGrid items={items} accent={preset.accent} ink={preset.ink} enterDelay="none" />
      </div>
    </main>
  );
}
