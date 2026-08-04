import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getGuestRoom } from "@/server/services/guest-room";
import { rooms, scene } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { SceneStage } from "@/components/scene/SceneStage";
import { GuestBookingProvider } from "./booking/booking-context";
import { GuestZoneGrid } from "./booking/guest-zone-grid";
import { MyBookingsLink } from "./booking/my-bookings-link";

// Страница одинакова для всех и не читает auth()/cookies (регистрация гостя
// «по пути» — тикет 08). Рендер — SSR на каждый запрос: свежие preset/zonesOff
// комнаты; тяжёлое чтение вещей кэшировано в сервисе тегом `room-{id}`.
// Полностраничный ISR отложен (см. Comments тикета 07).
export const dynamic = "force-dynamic";

// Один запрос на рендер: generateMetadata и страница делят результат.
const getRoom = cache(getGuestRoom);

type Params = { params: Promise<{ slug: string }> };

/** Абсолютный URL для OG: мессенджеры не понимают относительных путей. */
function absoluteUrl(path: string): string {
  return new URL(path, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();
}

// Комната гостя доступна по ссылке и не индексируется (инвариант №7) —
// noindex стоит и на живой комнате, и на неизвестном слаге.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [room, t] = await Promise.all([getRoom(slug), getTranslations("GuestRoom")]);
  const robots = { index: false, follow: false };
  if (!room) return { title: t("metaTitle", { name: t("ownerFallback") }), robots };

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const title = t("metaTitle", { name: room.ownerName ?? t("ownerFallback") });
  const description = t("metaDescription");
  // Кадр комнаты уже раздаёт маршрут /rooms/ — мессенджерам нужен полный адрес.
  const image = preset ? absoluteUrl(roomImageUrl(preset.base)) : undefined;

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * Комната глазами гостя (тикет 07): та же сцена и зоны, что у хозяйки, но
 * данные уже отфильтрованы сервером (guest-room.ts) — без спрятанных вещей,
 * без выключенных зон, цены — по priceVisibility. Демо-призраки видны и
 * помечены «пример».
 *
 * Тихая бронь (тикет 08): страница по-прежнему НЕ читает cookie — HTML
 * одинаков для всех. Всё гостевое-личное («занято», «занято тобой»,
 * «Мои брони · N») приезжает после рендера отдельным некэшируемым запросом
 * GET /api/v1/rooms/{slug}/taken внутри GuestBookingProvider.
 */
export default async function GuestRoomPage({ params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) notFound();

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("GuestRoom");
  const ownerName = room.ownerName ?? t("ownerFallback");

  // Сетки зон проходят client-границу пропом zoneContent (контракт тикета 02).
  // GuestZoneGrid — та же ZoneGrid, но со слотом действия: бирка «Подарить»
  // у WANT && !isDemo, тихое «занято» у забронированных (тикет 08).
  const zoneContent: Record<string, ReactNode> = Object.fromEntries(
    Object.entries(room.itemsByZone).map(([zoneKey, items]) => [
      zoneKey,
      <GuestZoneGrid
        key={zoneKey}
        items={items}
        accent={preset.accent}
        ink={preset.ink}
        ownerName={ownerName}
      />,
    ]),
  );

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full" style={{ maxWidth: scene.desktop.w }}>
        <header className="px-5 pb-4 pt-6 lg:px-0 lg:pt-10">
          <p className="overline text-text-muted">{t("overline")}</p>
          <h1 className="display mt-2 text-2xl lg:text-4xl">{ownerName}</h1>
        </header>

        <GuestBookingProvider slug={slug}>
          <SceneStage preset={preset} zonesOff={room.zonesOff} zoneContent={zoneContent} />

          {/* Мягкий призыв внизу: гость пришёл смотреть, не регистрироваться. */}
          <footer className="mt-10 px-5 lg:px-0">
            <div className="flex max-w-md flex-col gap-2 border border-surface-hairline bg-surface-fill p-5">
              <p className="text-sm text-text-muted">{t("ctaHint")}</p>
              <Link
                href="/"
                className="pressable inline-block text-sm font-semibold"
                style={{ color: preset.accent }}
              >
                {t("cta")} →
              </Link>
            </div>
            {/* «Мои брони · N» — появляется после клиентского fetch, если cookie непуст. */}
            <MyBookingsLink />
          </footer>
        </GuestBookingProvider>
      </div>
    </main>
  );
}
