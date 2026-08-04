import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getRoomByShareSlug } from "@/server/services/rooms";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";

// Один запрос на рендер: generateMetadata и страница делят результат.
const getRoom = cache(getRoomByShareSlug);

type Params = { params: Promise<{ slug: string }> };

// Комната гостя доступна по ссылке и не индексируется (инвариант CLAUDE.md §7).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const room = await getRoom(slug);
  const preset = room ? rooms.find((candidate) => candidate.id === room.preset) : undefined;
  return {
    title: preset?.name ?? "Wishlist Platform",
    robots: { index: false, follow: false },
  };
}

/**
 * Комната глазами гостя — пока заглушка: кадр пресета и имя хозяйки.
 * Полноценная сцена, зоны и тихая бронь придут следующими тикетами.
 */
export default async function GuestRoomPage({ params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) notFound();

  const t = await getTranslations("GuestRoom");
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const ownerName = room.user.displayName ?? room.user.name ?? t("ownerFallback");

  return (
    <main className="relative min-h-screen">
      {preset && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${roomImageUrl(preset.base)})`,
            backgroundSize: "cover",
            backgroundPosition: "50% 40%",
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(0deg, rgba(11,8,6,.94) 0%, rgba(11,8,6,.5) 50%, rgba(11,8,6,.2) 100%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-end gap-4 px-6 pb-16 pt-24">
        <p className="overline text-text-muted">{t("overline")}</p>
        <h1 className="display text-4xl md:text-6xl">{ownerName}</h1>
        {preset && <p className="text-text-strong">{preset.name}</p>}
        <p className="max-w-md text-text-body">{t("sceneSoon")}</p>
      </div>
    </main>
  );
}
