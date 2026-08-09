import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getOwnerProfile, getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { getHardenState, shouldAskToHarden } from "@/server/services/harden";
import { ownerTakenTotal } from "@/server/services/goal";
import { occasionBannerVisible } from "@/server/services/occasions";
import { starterPackSize } from "@/server/services/starter-pack";
import { itemForOwner } from "@/server/dto/items";
import {
  ownerSummaryItem,
  zoneSummaryForOwner,
  type ZoneSummaryDto,
} from "@/server/dto/zone-summary";
import { MONEY_ZONE_KEY, rooms, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { SceneStage } from "@/components/scene/SceneStage";
import { asLightColor, asTimeOfDay, NATIVE_TIME_OF_DAY } from "@/components/scene/grading";
import { immersiveLayout } from "@/components/scene/immersive-layout";
import { ZoneIndexProvider } from "@/components/scene/zone-index-context";
import { ZoneRail } from "@/components/scene/zone-rail";
import { TabBar } from "@/components/tab-bar/tab-bar";
import { visibleZones } from "@/components/scene/zones";
import { SHEET_TILES, ZoneGrid } from "@/components/zone/ZoneGrid";
import { zoneDisplayItems } from "@/components/zone/zone-display-items";
import { ShareButton } from "./share-button";
import { StarterPack } from "./starter-pack";

export const dynamic = "force-dynamic";

/**
 * С какого числа вещей комната готова к шеру (task15.json → emptyStates).
 * Не запрет: ссылка работает всегда, меняется только приоритет подсказки.
 */
export const SHARE_READY_ITEMS = 5;
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Комната хозяйки — живая сцена (тикет 02) с сеткой вещей в открытой зоне
 * (тикет 03): вкладки «Люблю»/«Хочу». Пустые зоны стоят пустыми (тикет 104).
 *
 * Раскладка «во весь экран» (тикет 24): страница не листается и не собрана
 * стопкой. Слоями снизу вверх — размытый кадр комнаты на весь экран, сцена с
 * картой зон У ВЕРХА экрана (тикет 57), две полосы интерфейса на вуалях, и
 * верхняя лежит НА комнате. Числа полос — tokens.json →
 * layout.phoneImmersive/desktopImmersive; геометрия и проверка видимости зон —
 * components/scene/immersive-layout.ts. Порядок слоёв — globals.css (.imm).
 */
export default async function RoomPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const t = await getTranslations("Room");
  const tList = await getTranslations("RoomList");
  // Подписи времени суток — те же, что у ручки в настройках (тикет 96).
  const tSettings = await getTranslations("Settings");
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  // Красивый адрес с ником, когда он занят (тикет 13); короткий код
  // продолжает работать редиректом.
  const sharePath = `/r/${room.nick ?? room.shareSlug}`;

  // Просьба укрепить аккаунт перед ПЕРВЫМ шером (тикет 94, доска Б8).
  // Решает сервер: просим, только когда есть что предложить, ещё не привязано
  // и мы ещё не спрашивали. Кнопка шера просьбу только показывает.
  const hardenState = await getHardenState(userId);
  const harden =
    hardenState !== null &&
    shouldAskToHarden({
      providers: hardenState.available,
      secondAuth: hardenState.secondAuth,
      askedAt: hardenState.asked ? new Date() : null,
    })
      ? { providers: hardenState.available }
      : null;

  // Счётчик «N вещей уже забраны» (тикет 09) — ЕДИНСТВЕННОЕ, что хозяйка
  // знает о бронях до праздника (инвариант №1). Страница force-dynamic,
  // поэтому сервис зовётся напрямую — отдельный fetch не нужен; сам роут
  // /api/v1/room/taken-count живёт для клиентских обновлений.
  //
  // Копилка на мечту (тикет 44) входит в это же число ОДНОЙ вещью при любом
  // числе участников: прогресс сбора хозяйке не показывается ничем, в том
  // числе счётчиком, который рос бы на каждого нового участника.
  const takenCount = await ownerTakenTotal(userId);
  // Тихая строка «праздник прошёл» (тикет 10): дата прошла без итога или
  // в «что подарили» остались неотмеченные подарки. Голый boolean — о бронях
  // он говорит не больше счётчика.
  const showOccasionBanner = await occasionBannerVisible(userId);

  // Сетки вещей для панелей зон и сводки для указателя зон (тикет 34) —
  // одним проходом по зонам: вещи из БД читаются один раз.
  const zones = preset
    ? await buildZoneContent(room.id, preset, room.zonesOff)
    : undefined;

  const accent = preset?.accent ?? "#E7C9A9";
  // Время суток комнаты — и в сцену, и в чип шапки (доска В1).
  const roomTod = asTimeOfDay(room.timeOfDay);
  // Сколько своих вещей в комнате: 0 — сцена гаснет (тикет 104), меньше пяти
  // — над таб-баром висит тихая плашка «ссылку лучше отдавать от пяти вещей»
  // (решение владельца 09.08, task15.json → emptyStates).
  const itemCount = zones?.ownCount ?? 0;

  // В шапке — ИМЯ хозяйки, а не название пресета (тикет 57). Владелец с
  // телефона: «там должна быть не комната, а имя». Доска говорит то же самое:
  // турн 23c подписывает телефонную шапку «Мила», турн 15a — переменной
  // `rOwner`, и у гостя (/r/[slug]) шапка давно говорит именем хозяйки.
  //
  // ФОЛБЭК ЧЕСТНЫЙ, А НЕ ПУСТОТА: пока имя не заполнено (оно необязательное —
  // онбординг его пропускает), в шапке остаётся имя пресета, как было. Само
  // название пресета из продукта никуда не делось — оно живёт в настройках и в
  // смене интерьера, где им и выбирают комнату.
  const profile = await getOwnerProfile(userId);
  const presetName = preset?.name ?? room.preset;
  const roomTitle = profile?.displayName?.trim() || presetName;

  return (
    <main
      className="imm"
      style={
        {
          "--imm-gutter": `${immersiveLayout.phone.gap}px`,
          // Высота кадра на телефоне — та же формула, что у сцены
          // (scene.module.css → --band-h). Она нужна соседнему слою: с тикета
          // 66 нижняя полоса начинается ровно под комнатой. Пропорция берётся
          // из контракта, руками не набивается.
          "--imm-scene-h": `min(calc(100vw / (${immersiveLayout.phone.ar})), 100dvh)`,
          ...(preset ? { "--room-image": `url(${roomImageUrl(preset.base)})` } : {}),
        } as CSSProperties
      }
    >
      {/* Комната на весь экран: тот же кадр фоном, размытый до состояния
          света в помещении. Резкая часть с зонами — сцена у верха экрана
          (тикет 57); ниже неё этот же слой и есть фон под панелью зоны. */}
      <div className="imm-backdrop" aria-hidden />
      <div className="imm-veil imm-veil-top" aria-hidden />
      <div className="imm-veil imm-veil-bottom" aria-hidden />

      {/* Провайдер связывает сцену и указатель зон в нижней полосе (тикет 34):
          они лежат в соседних слоях раскладки, а состояние у них общее —
          какая зона подсвечена и какая открыта. */}
      <ZoneIndexProvider>
        {preset && (
          <SceneStage
            preset={preset}
            zonesOff={room.zonesOff}
            zoneContent={zones?.content}
            // Комната сама едет от края до края (тикет 103, решение владельца):
            // на телефоне это единственное, что говорит «кадр шире окна».
            // До этого проезд был только у гостя.
            drift
            // Свет и время суток комнаты (тикет 96) — грейдинг поверх кадра.
            timeOfDay={roomTod}
            lightColor={asLightColor(room.lightColor)}
            // Пустая комната гаснет (тикет 104): темнота вместо чужих вещей.
            empty={itemCount === 0}
          />
        )}

        <header className="imm-rail imm-rail-top">
          <div className="imm-top-grid">
            <div className="imm-area-titles">
              {/* Чип времени суток (доска В1, турны 6 · 9a · 10). Доска
                  писала его с часами — «вечер · 21:40», — но время суток у
                  нас РУЧКА комнаты (тикет 96), а не часы: показать 21:40
                  рядом с выбранным «утром» значило бы соврать дважды.
                  Поэтому чип говорит выбранное положение, и только когда оно
                  не родное: «день» — это кадр как снят, о нём сообщать
                  нечего. */}
              <p className="overline text-text-muted">
                {t("overline")}
                {roomTod !== NATIVE_TIME_OF_DAY && ` · ${tSettings(`tod_${roomTod}`)}`}
              </p>
              <h1 className="display imm-title mt-1 text-2xl lg:text-4xl">{roomTitle}</h1>
            </div>

            <div className="imm-area-quiet">
              {/* Тихий счётчик движения (турн 11d): только число, никаких намёков,
                  какие вещи. Спокойный оверлайн без акцента; при нуле — тишина.
                  ЕДИНСТВЕННОЕ место счётчика забранных вещей во всём продукте:
                  ни в сводке по зоне, ни у гостя его нет (инвариант №1). */}
              {takenCount > 0 && (
                <p className="overline text-text-muted">{t("takenCount", { count: takenCount })}</p>
              )}
              {/* Праздник прошёл — тихая строка-ссылка на «что подарили»
                  (тикет 10): без баннерной яркости, тем же тоном, что счётчик. */}
              {showOccasionBanner && (
                <Link
                  href="/room/occasion"
                  className="pressable text-sm font-semibold"
                  style={{ color: accent }}
                >
                  {t("occasionBanner")} →
                </Link>
              )}
            </div>

            {/* Служебные ссылки (тикеты 10, 11, 13) — тихим тоном, в углу
                полосы. ТОЛЬКО НА ДЕСКТОПЕ (тикет 65): на телефоне те же три
                пункта стоят в постоянном баре внизу, и владелец на приёмке
                попросил убрать слова с кадра. */}
            <nav className="imm-area-actions imm-desktop-only">
              <Link
                href="/connections"
                className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
              >
                {t("connectionsLink")}
              </Link>
              <Link
                href="/room/hall"
                className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
              >
                {t("hallLink")}
              </Link>
              <Link
                href="/settings"
                className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
              >
                {t("settingsLink")}
              </Link>
            </nav>
          </div>
        </header>

        {/* Нижняя полоса: действия и под ними указатель зон (тикет 34). */}
        <div className="imm-rail imm-rail-bottom">
          <ZoneRail
            zones={preset?.zones ?? []}
            zonesOff={room.zonesOff}
            summaries={zones?.summaries}
            viewer="owner"
            accent={accent}
            below={
              // Второй вход в то же содержимое (тикет 67) — ПОД оглавлением,
              // как у гостя (тикет 77): прошёл зоны — вот другой способ их
              // посмотреть. Слот стоит вне прокрутки списка, поэтому ссылка
              // видна без листания.
              <Link href="/room/list" className="pressable btn-quiet">
                {tList("toList")}
              </Link>
            }
          >
            {/* Вход в добавление вещи (полировка 16). «Полоса света» — главная
                кнопка везде (турн 22), здесь тихого размера. ТОЛЬКО НА
                ДЕСКТОПЕ (тикет 65): на телефоне в добавление ведёт кружок «＋»
                посреди постоянного бара — тот же маршрут /room/add. */}
            <Link
              href="/room/add"
              className="pressable imm-desktop-only border-b-2 px-4 text-sm font-semibold text-text-primary"
              style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
            >
              {t("addItem")} →
            </Link>
            {/* В строке НАД оглавлением — только значок «поделиться». По центру
                той же полосы висит подсказка «коснись зоны», и второй вещи там
                места нет: тикет 73 поставил рядом «Списком →», и подсказка
                легла прямо на неё (приёмка 07.08). Адрес комнаты живёт в
                «Настройках», рядом с ником, которым его и меняют (тикет 24). */}
            <ShareButton path={sharePath} accent={accent} harden={harden} />
          </ZoneRail>
        </div>
      </ZoneIndexProvider>

      {/* Постоянный таб-бар на телефоне (тикет 65, приёмка 07.08): «поднимаем
          снизу всегда видимый нижний сайд-бар — базовая подготовка для будущей
          вёрстки приложения». Оверлей: раскладку сцены не двигает
          (immersive-layout как был), нижняя полоса встаёт над ним сама.
          На десктопе бара нет — там те же ссылки стоят строкой в шапке. */}
      {/* «Ссылку лучше отдавать, когда наберётся хотя бы пять вещей»
          (решение владельца 09.08, task15.json → emptyStates.sharePlaque).
          Не запрет и не счётчик достижений: тихая строка над таб-баром,
          которая исчезает с пятой вещью. */}
      {itemCount < SHARE_READY_ITEMS && (
        <p className="imm-share-plaque">{t("sharePlaque")}</p>
      )}

      {/* «Или начни с готового · +40» (тикет 100, доска Б23) — только в ПУСТОЙ
          комнате: как только появилась первая вещь, человек уже умеет, и
          предлагать ему чужую подборку поверх своей нечего. */}
      {itemCount === 0 && preset && (
        <StarterPack
          size={starterPackSize(preset.id, room.zonesOff)}
          accent={accent}
        />
      )}

      <TabBar active="room" accent={accent} ink={preset?.ink ?? "#241A0E"} phoneOnly />
    </main>
  );
}

/**
 * Содержимое панелей зон для SceneStage (контракт тикета 02: узлы проходят
 * client-границу пропом zoneContent[zoneKey]) И сводка по каждой зоне для
 * указателя зон (тикет 34) — за один проход по зонам. Для каждой видимой
 * зоны — сетка её СВОИХ вещей. Демо-призраков больше нет (тикет 104):
 * пустоту держит темнота и пунктирные места, а не чужие вещи с пометкой
 * «пример».
 */
async function buildZoneContent(
  roomId: string,
  preset: Room,
  zonesOff: string[],
): Promise<{
  content: Record<string, ReactNode>;
  summaries: Record<string, ZoneSummaryDto>;
  /** Сколько СВОИХ вещей в комнате всего — по нему гаснет пустая (тикет 104). */
  ownCount: number;
}> {
  const tZone = await getTranslations("ZoneGrid");
  const tScene = await getTranslations("Scene");
  const zones = visibleZones(preset.zones, zonesOff);

  const entries = await Promise.all(
    zones.map(async (zone: RoomZone) => {
      const rows = await listZoneItems(roomId, zone.key);
      const own = rows.map(itemForOwner);
      const summary = zoneSummaryForOwner(zone.key, rows.map(ownerSummaryItem));
      const items = zoneDisplayItems(own);
      // Зона «Просто деньги» без своих вещей сетку не показывает (тикет 44):
      // пула демо-вещей у неё нет, и пустые вкладки «Люблю · 0 / Хочу · 0»
      // под карточкой копилки были бы шумом. Ссылки остаются — вещи в этой
      // зоне никто не запрещает, и первая же вернёт сетку.
      const showGrid = zone.key !== MONEY_ZONE_KEY || items.length > 0;
      // «А если вещей много?» (тикет 59). Дорога на экран «зона целиком
      // списком» из листа есть всегда — она же вход в саму зону, — но ГОВОРИТ
      // числом только тогда, когда вещей больше, чем лист держит на виду
      // (SHEET_TILES — правило доски, выведенное из `moreLabel` в zones.json).
      //
      // Число живое и своё: считает его сводка зоны (тикет 34), а значит без
      // спрятанных вещей и без демо-призраков — «ещё 1» про выдуманную вещь
      // читалось бы как настоящая. Счётчик-заглушку пакета («+26») в интерфейс
      // не несём по той же причине, по которой её не несёт заголовок экрана
      // зоны: там числа настоящие (полировка 16).
      const beyondSheet = Math.max(0, summary.count - SHEET_TILES);
      const node = (
        <div key={zone.key}>
          {/* zoneKey отдаётся ТОЛЬКО здесь, в комнате хозяйки: по нему пустая
              зона показывает три места вместо строки (тикет 99). Гостевая
              панель ключа не получает — чужая пустая полка не её забота. */}
          {showGrid && (
            <ZoneGrid
              items={items}
              accent={preset.accent}
              ink={preset.ink}
              pool={zone.pool}
              zoneKey={zone.key}
            />
          )}
          {/* Оба перехода — тихие пилюли акцентом комнаты (тикет 86): текст
              со стрелкой владелец на приёмке 07.08 прочитал как подпись, а не
              как кнопку. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/room/zone/${zone.key}`}
              className="pressable btn-quiet"
              style={{ "--pill-accent": preset.accent } as React.CSSProperties}
            >
              {beyondSheet > 0 ? tScene("summaryMore", { count: beyondSheet }) : tZone("openFull")}
            </Link>
            {/* Добавить вещь сразу в открытую зону (полировка 16): ?zone=…
                предвыбирает её в карточке добавления (контракт тикета 04). */}
            <Link
              href={`/room/add?zone=${zone.key}`}
              className="pressable btn-quiet"
              style={{ "--pill-accent": preset.accent } as React.CSSProperties}
            >
              + {tZone("addItem")}
            </Link>
          </div>
        </div>
      );
      return [zone.key, node, summary, own.length] as const;
    }),
  );

  return {
    content: Object.fromEntries(entries.map(([key, node]) => [key, node])),
    summaries: Object.fromEntries(entries.map(([key, , summary]) => [key, summary])),
    ownCount: entries.reduce((sum, [, , , count]) => sum + count, 0),
  };
}
