import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import {
  getOwnerProfile,
  getRoomForUser,
  getSessionUserId,
} from "@/server/services/rooms";
import { rooms, zoneInfo } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { signOutAction } from "./actions";
import { DELETE_ACCOUNT_PHRASE } from "@/server/services/account";
import {
  DataSection,
  DemoGhostsSection,
  NickSection,
  OccasionSection,
  PresetSection,
  ProfileSection,
  ZonesSection,
  type PresetCard,
} from "./settings-sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Настройки хозяйки (тикет 13): профиль (имя, аватар), красивый ник,
 * смена пресета без потери вещей, набор зон и вкл/выкл отдельных зон,
 * дата праздника, демо-призраки, выход. Скрытие/удаление вещей живёт на
 * плитках зоны (/room/zone/[zone]) — здесь только настройки комнаты.
 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const profile = await getOwnerProfile(userId);
  if (!profile) redirect("/signin");

  const t = await getTranslations("Settings");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const accent = preset?.accent ?? "#E7C9A9";

  const presetCards: PresetCard[] = rooms.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    sex: candidate.sex,
    accent: candidate.accent,
    ink: candidate.ink,
    imageUrl: roomImageUrl(candidate.base),
  }));

  // Чекбокс-плитки — зоны ТЕКУЩЕГО пресета (подписи из zones.json).
  const zones = (preset?.zones ?? []).map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
  }));

  const zoneSet = room.zoneSet === "F" || room.zoneSet === "M" ? room.zoneSet : "ALL";
  const occasionDate = room.occasionDate ? room.occasionDate.toISOString().slice(0, 10) : null;

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-5 text-3xl lg:text-4xl">{t("title")}</h1>
        </header>

        <ProfileSection
          displayName={profile.displayName}
          avatarUrl={profile.avatarUrl}
          accent={accent}
        />
        <NickSection nick={room.nick} shareSlug={room.shareSlug} accent={accent} />
        <PresetSection
          presets={presetCards}
          currentPreset={room.preset}
          zoneSet={zoneSet}
          accent={accent}
        />
        <ZonesSection zones={zones} zonesOff={room.zonesOff} accent={accent} />
        <OccasionSection occasionDate={occasionDate} accent={accent} />
        <DemoGhostsSection off={room.demoGhostsOff} accent={accent} />

        {/* Выход — тихий, в самом низу; signOut из @/server/auth (тикет 01). */}
        <section className="flex items-center justify-between border border-surface-hairline bg-surface-fill p-5">
          <p className="text-sm text-text-muted">{t("signedInAs", { email: profile.email })}</p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="pressable text-sm font-semibold text-text-muted hover:text-text-strong"
            >
              {t("signOut")}
            </button>
          </form>
        </section>

        {/* Данные (тикет 14, GDPR): экспорт и удаление аккаунта — после выхода. */}
        <DataSection deletePhrase={DELETE_ACCOUNT_PHRASE} accent={accent} />
      </div>
    </main>
  );
}
