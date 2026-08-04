import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { rooms, scene } from "@/config/design";
import { SceneStage } from "@/components/scene/SceneStage";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Комната хозяйки — живая сцена (тикет 02): кадр, зоны-хотспоты, наезд
 * камеры, кадры «открыто». Мобильный вид — сцена сверху, остальное ниже;
 * на десктопе сцена крупно по центру (ширина — из rooms.json → scene.desktop).
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
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full" style={{ maxWidth: scene.desktop.w }}>
        <header className="px-5 pb-4 pt-6 lg:px-0 lg:pt-10">
          <p className="overline text-text-muted">{t("overline")}</p>
          <h1 className="display mt-2 text-2xl lg:text-4xl">{preset?.name ?? room.preset}</h1>
        </header>

        {preset && <SceneStage preset={preset} zonesOff={room.zonesOff} />}

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
