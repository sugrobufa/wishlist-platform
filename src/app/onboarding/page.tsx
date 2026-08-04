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

  return <OnboardingFlow presets={presets} />;
}
