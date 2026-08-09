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
import { TabBar } from "@/components/tab-bar/tab-bar";
import { signOutAction } from "./actions";
import { DELETE_ACCOUNT_PHRASE } from "@/server/services/account";
import { hallSettingsOf } from "@/server/dto/hall";
import { countItemsByZone } from "@/server/services/items";
import { getHardenState } from "@/server/services/harden";
import { asLightColor, asTimeOfDay } from "@/components/scene/grading";
import {
  AccessSection,
  DataSection,
  LightSection,
  HallSection,
  NickSection,
  OccasionSection,
  PresetSection,
  ProfileSection,
  ZonesSection,
  type HallSettingsView,
  type PresetCard,
} from "./settings-sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Настройки хозяйки (тикет 13): профиль (имя, аватар), красивый ник,
 * смена пресета без потери вещей, набор зон и вкл/выкл отдельных зон,
 * дата праздника, зал славы (тикет 35), демо-призраки, выход. Скрытие и
 * удаление вещей живёт на плитках зоны (/room/zone/[zone]), скрытие цены
 * отдельной вещи — на её карточке в зале; здесь только настройки комнаты.
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

  // Чекбокс-плитки — зоны ТЕКУЩЕГО пресета (подписи из zones.json) со
  // счётчиком своих вещей (доска В2, турн 11e: «Красота и уход · 31»).
  // Число живое и одним запросом: выключая полку, человек должен видеть,
  // сколько на ней стоит, — это и есть цена решения.
  const countByZone = await countItemsByZone(room.id);
  const zones = (preset?.zones ?? []).map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
    count: countByZone.get(zone.key) ?? 0,
  }));

  const zoneSet = room.zoneSet === "F" || room.zoneSet === "M" ? room.zoneSet : "ALL";
  const occasionDate = room.occasionDate ? room.occasionDate.toISOString().slice(0, 10) : null;
  // Настройки зала славы (тикет 35) — форма клиента совпадает с DTO зала.
  const hallSettings: HallSettingsView = hallSettingsOf(room);
  // Чем держится комната: почта основного входа и второй способ (тикет 94).
  const harden = await getHardenState(userId);

  return (
    // Нижний отступ освобождает место постоянному таб-бару (86 px, фикс).
    <main className="min-h-screen pb-[calc(var(--imm-tab-bar)+30px)]">
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
        {/* Свет и время суток (тикет 96) — между интерьером и набором зон,
            как просит доска: это продолжение выбора комнаты. */}
        {preset && (
          <LightSection
            roomImage={roomImageUrl(preset.base)}
            timeOfDay={asTimeOfDay(room.timeOfDay)}
            lightColor={asLightColor(room.lightColor)}
            accent={accent}
            nativeTod={preset.tod}
          />
        )}
        <ZonesSection zones={zones} zonesOff={room.zonesOff} accent={accent} />
        <OccasionSection occasionDate={occasionDate} accent={accent} />
        <HallSection settings={hallSettings} accent={accent} />
        {/* Секции «Примеры» здесь больше нет (тикет 104): демо-призраки
            сняты целиком, и тумблеру «Убрать примеры» стало нечего убирать.
            Колонка `Room.demoGhostsOff` оставлена в схеме — сносить её
            отдельной миграцией нечего ради, и она хранит прежний выбор
            человека, если призраки когда-нибудь вернутся. */}

        {/* «Вход и доступ» (тикет 94): чем держится комната — вопрос, на
            который человеку до этого никто не отвечал. */}
        {harden !== null && (
          <AccessSection
            email={harden.email}
            emailConfirmed={harden.emailConfirmed}
            secondAuth={harden.secondAuth}
          />
        )}

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

      {/* Таб-бар «в списках — постоянный» (тикет 52, турн 25a). Вкладка этой
          страницы в 25a звалась «Профилем» — слово не прошло памятку тона,
          временная подпись и TODO — components/tab-bar/tabs.ts. */}
      <TabBar active="settings" accent={accent} ink={preset?.ink ?? "#241A0E"} />
    </main>
  );
}
