import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { OnboardingFlow, type PresetCard } from "./onboarding-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  // Комната уже есть — онбординг больше не показываем.
  const room = await getRoomForUser(userId);
  if (room) redirect("/room");

  const presets: PresetCard[] = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    sex: room.sex,
    accent: room.accent,
    ink: room.ink,
    imageUrl: roomImageUrl(room.base),
  }));

  // Шов для тикета 38: сюда подставляется дата, уже известная о человеке
  // (турн 12c — гость назвал свой день рождения при бронировании), в виде
  // `YYYY-MM-DD`. Пока такого источника нет — шаг открывается пустым.
  const prefilledOccasionDate: string | null = null;

  return <OnboardingFlow presets={presets} initialOccasionDate={prefilledOccasionDate} />;
}
