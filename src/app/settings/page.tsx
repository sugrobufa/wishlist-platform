import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { birthdayOf, nextOccasion } from "@/server/birthday";
import { isHolidayKey } from "@/server/holidays";
import { listRoomOccasions } from "@/server/services/room-occasions";
import { HOLIDAY_LABEL } from "@/components/occasion/occasion-offer";
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
import { RoomStudio } from "./room-studio";
import type { PresetCard } from "./room-preview";
import {
  AccessSection,
  BirthdaySection,
  DataSection,
  LightSection,
  HallSection,
  NickSection,
  PresetSection,
  ProfileSection,
  ZonesSection,
  type HallSettingsView,
  type OccasionRow,
} from "./settings-sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Настройки хозяйки (тикет 13): профиль (имя, аватар), красивый ник,
 * смена пресета без потери вещей, набор зон и вкл/выкл отдельных зон,
 * день рождения, зал славы (тикет 35), демо-призраки, выход. Скрытие и
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
    // Родное время суток базы (тикет 107): от него крупный кадр считает
    // грейдинг — так же, как сама комната. Без него превью чужого интерьера
    // показывало бы одно, а комната после переезда стала бы другой.
    tod: candidate.tod,
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
  // День рождения так, как он лежит в комнате: день и месяц (тикет 187).
  // Год экран не показывает — продукт им не пользуется.
  const birthday = birthdayOf(room);
  // ОСТАЛЬНЫЕ ПРАЗДНИКИ — ЗДЕСЬ И БОЛЬШЕ НИГДЕ (тикет 198): принятые общие
  // даты («Показать») и свои поводы. В комнате виден только ближайший, поэтому
  // перечень живёт на этом экране; отказанные («Не в этом году») в него не
  // входят — отказ был про плашку, а не про праздник.
  const tOccasion = await getTranslations("Occasion");
  const locale = await getLocale();
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const occasionRows = await listRoomOccasions(userId);
  const occasions: OccasionRow[] = occasionRows.rows
    .filter((row) => row.accepted)
    .map((row) => ({
      id: row.id,
      label: isHolidayKey(row.key) ? tOccasion(HOLIDAY_LABEL[row.key]) : (row.title ?? ""),
      date: dayMonth.format(nextOccasion({ day: row.day, month: row.month, year: null }, new Date())),
    }));
  // Настройки сокровищницы: показ цены и прочее — из DTO зала (тикет 35), а
  // «кто видит витрину» приезжает прямо из строки комнаты (тикет 116).
  // В DTO цены оно НЕ переехало сознательно: настройки про разное, и общий
  // тип означал бы, что их можно перепутать местами (ADR-0011).
  const hallSettings: HallSettingsView = {
    ...hallSettingsOf(room),
    visibility: room.hallVisibility,
  };
  // Чем держится комната: почта основного входа и второй способ (тикет 94).
  const harden = await getHardenState(userId);

  return (
    // Нижний отступ освобождает место постоянному таб-бару (86 px, фикс).
    <main className="min-h-[100dvh] pb-[calc(var(--imm-tab-bar)+30px)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-5 text-3xl lg:text-4xl">{t("title")}</h1>
        </header>

        {/* ПОРЯДОК РАЗДЕЛОВ — РЕШЕНИЕ ВЛАДЕЛЬЦА (тикет 180, постановка
            11.08.2026), а не сложившаяся случайность. Две ручки, к которым
            человек возвращается чаще всего, стоят первыми: «Интерьер» и «Свет
            и время суток». «Адрес комнаты» уехал ниже выбора комнаты — короткое
            имя задают один раз и почти никогда не меняют, это настройка ссылки,
            а не комнаты.

            Остальные пять разделов относительно друг друга не двигались:
            владелец про них не говорил. Порядок держит тест
            `tests/settings-order.test.ts` — он обязан упасть при следующем
            нечаянном переезде. */}
        {/* КРУПНЫЙ КАДР НА ДВЕ РУЧКИ (тикет 181, та же постановка 11.08.2026).
            Обёртка не трогает порядок разделов: «Интерьер» и «Свет» стоят в ней
            ровно так же, как стояли, — она добавляет им общий липкий кадр
            сверху и общее состояние («что человек смотрит»), потому что
            обработчики не пересекают RSC-границу. Кадр показывает ВЫБРАННОЕ,
            комнату по-прежнему меняет только «Переехать». */}
        <RoomStudio
          cards={presetCards}
          currentPreset={room.preset}
          timeOfDay={asTimeOfDay(room.timeOfDay)}
          lightColor={asLightColor(room.lightColor)}
        >
          <PresetSection zoneSet={zoneSet} accent={accent} />
          {/* Свет и время суток (тикет 96) — сразу за интерьером: это
              продолжение выбора комнаты. Раздел условный и обязан таким
              остаться: без знакомого пресета считать грейдинг не от чего. */}
          {preset && (
            <LightSection accent={accent} ink={preset.ink} />
          )}
        </RoomStudio>
        <ProfileSection
          displayName={profile.displayName}
          avatarUrl={profile.avatarUrl}
          accent={accent}
        />
        <NickSection nick={room.nick} shareSlug={room.shareSlug} accent={accent} />
        <ZonesSection zones={zones} zonesOff={room.zonesOff} accent={accent} />
        <BirthdaySection birthday={birthday} occasions={occasions} accent={accent} />
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
