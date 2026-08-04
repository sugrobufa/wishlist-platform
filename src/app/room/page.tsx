import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Комната хозяйки — пока заглушка: имя пресета, кадр комнаты фоном и адрес
 * /r/{slug}. Живая сцена с зонами придёт тикетом 02.
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
  const sharePath = `/r/${room.shareSlug}`;

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
            "linear-gradient(0deg, rgba(11,8,6,.94) 0%, rgba(11,8,6,.55) 45%, rgba(11,8,6,.2) 100%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-end gap-4 px-6 pb-12 pt-24">
        <p className="overline text-text-muted">{t("overline")}</p>
        <h1 className="display text-4xl md:text-6xl">{preset?.name ?? room.preset}</h1>
        <p className="max-w-md text-text-body">{t("sceneSoon")}</p>

        <div className="mt-4 flex max-w-md flex-col gap-3 border border-surface-hairline bg-surface-fill p-5 backdrop-blur-sm">
          <p className="overline text-text-muted">{t("shareOverline")}</p>
          <p className="font-mono text-lg text-text-primary">{sharePath}</p>
          <p className="text-sm text-text-muted">{t("shareHint")}</p>
          <CopyButton path={sharePath} accent={preset?.accent ?? "#E7C9A9"} />
        </div>
      </div>
    </main>
  );
}
