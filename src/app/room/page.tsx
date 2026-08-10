import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getOwnerProfile, getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { hallCountsByZone, listZoneItems } from "@/server/services/items";
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
import { MONEY_ZONE_KEY, rooms, zoneInfo, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { SceneStage } from "@/components/scene/SceneStage";
import { asLightColor, asTimeOfDay, NATIVE_TIME_OF_DAY } from "@/components/scene/grading";
import { immersiveLayout } from "@/components/scene/immersive-layout";
import {
  CornerMark,
  CORNER_ICON_SIZE,
  SceneCorner,
} from "@/components/scene/scene-corner";
import { ZoneIndexProvider } from "@/components/scene/zone-index-context";
import { ZoneRail } from "@/components/scene/zone-rail";
import { IconPeople, IconSettings, IconTreasury } from "@/components/icons";
import { TabBar } from "@/components/tab-bar/tab-bar";
import { visibleZones } from "@/components/scene/zones";
import { SHEET_TILES, ZoneGrid } from "@/components/zone/ZoneGrid";
import { zoneDisplayItems } from "@/components/zone/zone-display-items";
import { RoomListView, type RoomListGroup } from "@/components/room-list/room-list-view";
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
  // Слово «Сокровищница» для знака в углу берётся из её собственного словаря
  // (тикет 119): своей строки вход не заводит — она бы разошлась с названием
  // раздела при следующем переименовании.
  const tHall = await getTranslations("Hall");
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
  /**
   * ПРАВИЛО ПУСТОЙ КОМНАТЫ (тикет 137, макет 41a — второй экран, что человек
   * видит в продукте): **пустая комната показывает только то, что РОЖДАЕТ
   * первую вещь; всё, что живёт после вещей, появляется вместе с ними.**
   *
   * Отсюда всё, что ниже завязано на этот признак, и три убыли поимённо:
   * - плашки «ссылку лучше отдавать от пяти вещей» нет: отдавать пока нечего,
   *   она живёт от ПЕРВОЙ вещи до пятой;
   * - перечня пустых полок нет (`empty` у полосы) — тринадцать строк «Пока
   *   пусто» это таблица, а не комната;
   * - знака «Списком» в полосе нет (там же): пустой список — бессмыслица.
   *
   * Шер и значок «поделиться» сюда же: доска 41a называет их в том же ряду —
   * «всё, что живёт ПОСЛЕ вещей (шер, список, счётчики), появляется вместе с
   * ними». Дорога к адресу комнаты не закрывается — он живёт в настройках,
   * рядом с ником (тикет 24).
   */
  const emptyRoom = itemCount === 0;

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
            empty={emptyRoom}
            // Наезд на ПУСТУЮ зону гасит сцену под панелью (35b, турн 25c):
            // «полка на месте, вещей на ней нет». Список считает сервер — он
            // и так прошёл по зонам за вещами.
            emptyZones={zones?.emptyKeys}
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

            {/* Служебные входы (тикеты 10, 11, 13) — в углу полосы. ТОЛЬКО НА
                ДЕСКТОПЕ (тикет 65): на телефоне те же пункты стоят в постоянном
                баре внизу, и владелец на приёмке попросил убрать слова с кадра.

                «Сокровищницы» здесь больше нет (тикет 119): рядом, в том же
                углу той же полосы, стоит знак витрины — а два входа в одно
                место на одном экране это и есть дважды нарисованная дверь.
                На телефоне её нет и в баре, дорога одна — знак.

                СЛОВА СТАЛИ ЗНАКАМИ (тикет 135, приёмка владельца 09.08:
                «в десктопе надо наверху в правом углу всё превратить в
                иконки»). Ряд из двух слов и картинки читался как две разные
                панели, случайно поставленные рядом; теперь он одного рода.

                ЗНАКИ ИЗ ОДНОГО МЕСТА: `IconPeople` — это `tab-friends.svg`
                канона, ими же рисуется таб-бар телефона. Два разных знака для
                одного места разошлись бы при первой правке.

                «НАСТРОЙКИ» РИСУЕТ ШЕСТЕРНЯ (тикет 147, приёмка владельца
                10.08: «Друзья и настройки выглядят одинаково, настройки пусть
                будет классика шестерёнка»). Прежде здесь стоял `IconPerson` —
                тот же круг головы и та же дуга плеч, что у соседа слева,
                только нарисованные один раз вместо двух; на 22 px это одно и
                то же пятно. Шестерня приехала ФАЙЛОМ НАБОРА в раунде 36
                (`tab-settings.svg`, тикет 149) и сверяется путь в путь, как
                весь остальной канон: сутки она была нашим рисунком, но в
                допуск дизайна 0.3 мы не прошли четырьмя числами из восьми.

                СЛОВО НЕ ПОТЕРЯНО: оно ушло в `aria-label` и всплывающую
                подсказку — знак без слова обязан называть себя читалке. Плашка,
                размер и цель нажатия — те же, что у соседа справа (тикет 119),
                и берутся из общего `CornerMark`, а не набиваются здесь. */}
            <nav className="imm-area-actions imm-desktop-only">
              <CornerMark href="/connections" label={t("connectionsLink")}>
                <IconPeople size={CORNER_ICON_SIZE} />
              </CornerMark>
              <CornerMark href="/settings" label={t("settingsLink")}>
                <IconSettings size={CORNER_ICON_SIZE} />
              </CornerMark>
            </nav>

            {/* Знаки в правом верхнем углу сцены (тикеты 118, 119): «Списком»
                и «Сокровищница». Прежде оба стояли пилюлями СО СЛОВОМ под
                оглавлением зон; владелец на приёмке 09.08 попросил знаки и
                угол, дизайн прислал их турном 36c. У гостя ровно то же место
                и тот же вид — разница только в том, что там шкатулки может не
                быть вовсе (закрытая витрина, ADR-0011).

                СТОЯТ В ШАПКЕ, А НЕ ОТДЕЛЬНЫМ СЛОЕМ: на телефоне они выпадают
                из её сетки в самый угол (absolute 12/14 по доске — там
                пусто), а на десктопе занимают её четвёртую колонку и встают в
                один ряд со служебными ссылками. Слоем поверх на широком
                экране они легли бы прямо на этот ряд: он идёт от того же
                правого края и на той же высоте. Числа и обе ветки —
                globals.css → .imm-corner. */}
            {/* ЗНАК «СПИСКОМ» ОТСЮДА УШЁЛ (тикет 129, приёмка 09.08): он
                переехал в полосу под кадром, к правому краю, и переключает
                содержимое той же полосы вместо того, чтобы уводить на
                отдельную страницу. В углу осталась одна шкатулка. */}
            <SceneCorner>
              <CornerMark href="/room/hall" label={tHall("toHall")}>
                <IconTreasury size={CORNER_ICON_SIZE} />
              </CornerMark>
            </SceneCorner>
          </div>
        </header>

        {/* Нижняя полоса: действия и под ними ЛИБО указатель зон, ЛИБО все
            вещи комнаты списком (тикеты 34 и 129). Переключает знак справа в
            той же строке — зеркально «поделиться» слева. */}
        <div className="imm-rail imm-rail-bottom">
          <ZoneRail
            zones={preset?.zones ?? []}
            zonesOff={room.zonesOff}
            summaries={zones?.summaries}
            viewer="owner"
            accent={accent}
            roomList={
              <RoomListView
                groups={zones?.listGroups ?? []}
                accent={accent}
                embedded
                zoneHrefBase="/room/zone/"
              />
            }
            // БЛОКИ ПУСТОЙ КОМНАТЫ СТОЯТ ЗДЕСЬ, В ПОТОКЕ (починка наложения,
            // приёмка 09.08). Прежде «Или начни с готового» и плашка про пять
            // вещей были `position: fixed` с высотами, отмеренными на глаз от
            // таб-бара, и ложились прямо на строки зон: в пустой комнате на
            // одном месте оказывались три слоя, ничего не знающих друг о
            // друге. Теперь они дети той же стопки — список отдаёт им место.
            // ПУСТАЯ КОМНАТА И КОМНАТА С ПЕРВЫМИ ВЕЩАМИ — ДВА РАЗНЫХ СОДЕРЖИМЫХ
            // этого слота, а не одно с дырками (тикет 137). До него блоки
            // стояли стопкой вместе, и в пустой комнате плашка про пять вещей
            // предлагала отдать ссылку на комнату, в которой нечего смотреть.
            below={
              emptyRoom ? (
                <div className="imm-empty-slot">
                  {/* ЗАГОЛОВОК И ОДНА ПОЛОСА СВЕТА (макет 41a). Одно действие,
                      не два: вторая полоса «Добавить вещь» из строки действий
                      в пустой комнате снята — обе вели в /room/add, и две
                      главные кнопки подряд читаются как выбор, которого нет.
                      На телефоне рядом остаётся кружок «＋» постоянного бара:
                      он часть бара, а не этого экрана (так и в макете). */}
                  <div className="imm-empty-start">
                    <h2 className="imm-empty-title">{t("emptyTitle")}</h2>
                    <p className="imm-empty-body">{t("emptyBody")}</p>
                    <Link
                      href="/room/add"
                      className="pressable imm-empty-cta"
                      style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
                    >
                      <span className="imm-empty-cta-label">{t("emptyAdd")}</span>
                      {/* Стрелка типографская, а не знак набора: ровно так же
                          её пишут остальные полосы света (турн 12a оговаривает
                          это отдельно — часть текста, не иконка). */}
                      <span aria-hidden>→</span>
                    </Link>
                  </div>
                  {/* «Или начни с готового · +N» (тикет 100, доска Б23) —
                      только в ПУСТОЙ комнате: как только появилась первая
                      вещь, человек уже умеет, и предлагать ему чужую подборку
                      поверх своей нечего. */}
                  {preset && (
                    <StarterPack
                      size={starterPackSize(preset.id, room.zonesOff)}
                      accent={accent}
                    />
                  )}
                </div>
              ) : itemCount < SHARE_READY_ITEMS ? (
                <div className="imm-empty-slot">
                  {/* «Ссылку лучше отдавать, когда наберётся хотя бы пять
                      вещей» (решение владельца 09.08, task15.json →
                      emptyStates.sharePlaque). Не запрет и не счётчик
                      достижений: тихая строка, которая живёт от ПЕРВОЙ вещи
                      до пятой. В пустой комнате её нет — отдавать нечего. */}
                  <p className="imm-share-plaque">{t("sharePlaque")}</p>
                </div>
              ) : null
            }
            // Ни строк зон, ни знака «Списком», пока вещей нет (тикет 137).
            empty={emptyRoom}
          >
            {/* Вход в добавление вещи (полировка 16). «Полоса света» — главная
                кнопка везде (турн 22), здесь тихого размера. ТОЛЬКО НА
                ДЕСКТОПЕ (тикет 65): на телефоне в добавление ведёт кружок «＋»
                посреди постоянного бара — тот же маршрут /room/add.

                В ПУСТОЙ КОМНАТЕ ЕЁ НЕТ (тикет 137, 41a: «ОДНА полоса света…
                одно действие, не два»): там ту же дорогу открывает полоса
                «Вставить ссылку из магазина» в слоте `below`, и она видна на
                обоих размерах экрана. */}
            {!emptyRoom && (
              <Link
                href="/room/add"
                className="pressable imm-desktop-only border-b-2 px-4 text-sm font-semibold text-text-primary"
                style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
              >
                {t("addItem")} →
              </Link>
            )}
            {/* Слева в строке — значок «поделиться», справа знак «Списком»
                (тикет 129). По центру той же полосы висит подсказка «коснись
                зоны», и середина занята ею: тикет 73 поставил туда «Списком →»
                словом, и подсказка легла прямо на него (приёмка 07.08). Адрес
                комнаты живёт в «Настройках», рядом с ником (тикет 24).

                В ПУСТОЙ КОМНАТЕ ЗНАЧКА НЕТ (тикет 137): шер — из того, что
                живёт ПОСЛЕ вещей, а комната без вещей не смотрится. Ссылка не
                заперта: адрес по-прежнему в настройках. */}
            {!emptyRoom && <ShareButton path={sharePath} accent={accent} harden={harden} />}
          </ZoneRail>
        </div>
      </ZoneIndexProvider>

      {/* Постоянный таб-бар на телефоне (тикет 65, приёмка 07.08): «поднимаем
          снизу всегда видимый нижний сайд-бар — базовая подготовка для будущей
          вёрстки приложения». Оверлей: раскладку сцены не двигает
          (immersive-layout как был), нижняя полоса встаёт над ним сама.
          На десктопе бара нет — там те же ссылки стоят строкой в шапке.

          БЛОКОВ ПУСТОЙ КОМНАТЫ ЗДЕСЬ БОЛЬШЕ НЕТ: они переехали в слот `below`
          нижней полосы, в общий поток со списком зон. Стоя рядом с баром
          отдельными `fixed`-слоями, они ложились на строки зон. */}
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
  /**
   * Зоны без единой своей вещи — по ним гаснет сцена при наезде (35b).
   *
   * Зона «Просто деньги» сюда не попадает никогда: пустой она не бывает —
   * в ней стоит копилка на мечту (тикет 44), а не пустая полка, и гасить
   * сцену под карточкой цели было бы неправдой.
   */
  emptyKeys: string[];
  /**
   * Те же вещи, сгруппированные по зонам, — второе положение переключателя
   * полосы (тикет 129: «все вещи комнаты списком»). Собирается из ТОГО ЖЕ
   * прохода по зонам: второй раз ходить в базу за теми же строками незачем.
   * Пустые зоны секциями не рисуются — правило дизайна (task31.json →
   * headers.roomList): «список про вещи, полки живут в комнате».
   */
  listGroups: RoomListGroup[];
}> {
  const tZone = await getTranslations("ZoneGrid");
  const tScene = await getTranslations("Scene");
  const tHall = await getTranslations("Hall");
  const zones = visibleZones(preset.zones, zonesOff);
  // Мост из зоны в витрину (раунд 29): сколько вещей ЭТОЙ зоны лежит в
  // сокровищнице. Один запрос на всю комнату, а не по зоне.
  const hallByZone = await hallCountsByZone(roomId);

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
      // Мост подвалом зоны — ТОЛЬКО хозяйке и только если в витрине правда
      // есть вещи этой зоны (task31.json → treasuryBridge.whenShown). Это
      // ответ на послемиграционное «куда делась половина моих вещей»: комната
      // после отмены состояний похудела вдвое, а карточек витрины в зоне мы
      // не показываем — чутьё дизайн принял, место размывать нечем.
      const inTreasury = hallByZone[zone.key] ?? 0;
      const node = (
        <div key={zone.key}>
          {/* ДЕЙСТВИЯ ЗОНЫ СТОЯТ НАД ВЕЩАМИ (тикет 139, приёмка владельца
              10.08: «управляющие кнопки лежат внизу под предметами… до них ты
              просто не дойдёшь или не увидишь. Надо кнопки поднять наверх»).
              Строка лежит ВНУТРИ прокрутки листа, и под сеткой на телефоне
              она уезжала за нижнюю границу: потолок листа считается от кадра,
              и уже при двух рядах плиток пилюль не видно.

              Оба перехода — тихие пилюли акцентом комнаты (тикет 86): текст
              со стрелкой владелец на приёмке 07.08 прочитал как подпись, а не
              как кнопку. */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
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
              ownerEmpty
              footer={
                inTreasury > 0 ? (
                  <Link href="/room/hall" className="pressable imm-zone-bridge">
                    {tHall("zoneBridge", { count: inTreasury })}
                  </Link>
                ) : null
              }
            />
          )}
        </div>
      );
      const group: RoomListGroup | null =
        own.length === 0
          ? null
          : {
              key: zone.key,
              label: zoneInfo(zone.key)?.label ?? zone.label,
              pool: zone.pool,
              items: own,
            };
      return [zone.key, node, summary, own.length, group] as const;
    }),
  );

  return {
    content: Object.fromEntries(entries.map(([key, node]) => [key, node])),
    summaries: Object.fromEntries(entries.map(([key, , summary]) => [key, summary])),
    ownCount: entries.reduce((sum, [, , , count]) => sum + count, 0),
    emptyKeys: entries
      .filter(([key, , , count]) => count === 0 && key !== MONEY_ZONE_KEY)
      .map(([key]) => key),
    listGroups: entries
      .map(([, , , , group]) => group)
      .filter((group): group is RoomListGroup => group !== null),
  };
}
