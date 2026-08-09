import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { rooms, zoneInfo } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { GUEST_INTRO_COOKIE, parseGuestIntro } from "./guest-intro";
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
    // Зоны комнаты подписями (доска В3, турн 14a): выбирают-то не картинку,
    // а набор полок, и до сих пор человек узнавал их состав уже внутри.
    // Подписи из zones.json — те же слова, что он потом увидит в комнате.
    zoneLabels: room.zones.map((zone) => zoneInfo(zone.key)?.label ?? zone.label),
    zoneKeys: room.zones.map((zone) => zone.key),
  }));

  // Предзаполнение из брони (тикет 38): холодный гость только что назвал имя
  // (обязательное поле брони) и, если захотел, свой день рождения — в
  // предложении «Собрать свою комнату». Спрашивать это второй раз невежливо.
  //
  // Источник — cookie самого человека (guest-intro.ts), поставленная его же
  // нажатием; хозяйке она не видна ни при каком стечении обстоятельств, а
  // мусор в ней молча читается как «ничего не известно». Ничего не приехало —
  // онбординг открывается пустым, ровно как раньше.
  const intro = parseGuestIntro((await cookies()).get(GUEST_INTRO_COOKIE)?.value);

  return (
    <OnboardingFlow
      presets={presets}
      initialOccasionDate={intro.occasionDate}
      initialName={intro.name}
      // Почта из брони: по ней человек только что вошёл, ею же он войдёт
      // потом. Показываем, а не спрашиваем — пароля в продукте нет.
      signInEmail={session.user.email ?? null}
    />
  );
}
