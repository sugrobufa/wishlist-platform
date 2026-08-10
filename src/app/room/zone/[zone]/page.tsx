import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { ownerSummaryItem, zoneSummaryForOwner } from "@/server/dto/zone-summary";
import { MONEY_ZONE_KEY, rooms, zoneInfo } from "@/config/design";
import { visibleZones, zonePosition } from "@/components/scene/zones";
import { zoneDisplayItems } from "@/components/zone/zone-display-items";
import { MoneyGoalCard } from "@/components/zone/money-goal-card";
import { EmptyZone } from "@/components/zone/empty-zone";
import { OwnerZoneGrid } from "./owner-zone-grid";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ zone: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { zone } = await params;
  // Ключа зоны нет в пакете — тайтл не выдумываем: без него страница берёт
  // `title.default` корневого layout, то есть имя площадки (тикет 58).
  return {
    title: zoneInfo(zone)?.label,
    robots: { index: false, follow: false },
  };
}

/**
 * «Зона целиком списком» (P0-экран из 19b): та же сетка вещей, что в панели
 * сцены, но без сцены — с заголовком и подписью зоны из zones.json и кнопкой
 * назад в комнату. Ключ зоны, которого нет среди видимых зон комнаты
 * (включая выключенные через zonesOff — они исчезают с мебелью), — 404.
 */
export default async function ZoneListPage({ params }: Params) {
  const { zone: zoneKey } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const zone = visibleZones(preset.zones, room.zonesOff).find((z) => z.key === zoneKey);
  if (!zone) notFound();

  // «полка 02 из 13» — место зоны среди видимых (тикет 99); zone найдена в
  // том же списке, поэтому null здесь невозможен.
  const position = zonePosition(preset.zones, room.zonesOff, zone.key) ?? undefined;

  const t = await getTranslations("ZoneGrid");
  const info = zoneInfo(zone.key);

  const rows = await listZoneItems(room.id, zone.key);
  const own = rows.map(itemForOwner);
  const items = zoneDisplayItems(own);

  // Живые счётчики своих вещей вместо счётчика-заглушки пакета (полировка 16):
  // формат тот же, что в zones.json («N вещей · M в подарок»), числа настоящие.
  // Пустая зона (в сетке только демо-призраки с бейджем «пример») — без подписи.
  //
  // Считает их сводка зоны (тикет 34) — ровно та же, что кормит панель сцены
  // в /room: спрятанные вещи и демо-призраки в неё не входят (инвариант №5,
  // dto/zone-summary). Своего подсчёта здесь больше нет: два независимых
  // счётчика уже разъехались однажды — шапка считала и спрятанное.
  const summary = zoneSummaryForOwner(zone.key, rows.map(ownerSummaryItem));

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-5 text-3xl lg:text-4xl">{info?.label ?? zone.label}</h1>
          {summary.count > 0 && (
            <p className="mt-2 text-sm text-text-muted">
              {/* Хозяйке — только «N вещей» (тикет 124): `want: 0` гасит вторую
                  половину строки словаря. */}
              {t("zoneCounts", { total: summary.count, want: 0 })}
            </p>
          )}
        </header>

        {/* Копилка на мечту (тикет 44) — только в зоне «Просто деньги». Здесь
            хозяйка её и задаёт: на что копит и сколько. Прогресса сбора она не
            видит ни здесь, ни где-либо ещё (инвариант №1). */}
        {zone.key === MONEY_ZONE_KEY && <MoneyGoalCard accent={preset.accent} ink={preset.ink} />}

        {/* Сетка хозяйки со слотом действий (тикет 13): «Спрятать/Показать»
            и «Удалить» на своих вещах; у демо-призраков меню нет. Оттуда же
            открывается карточка вещи (тикет 39).
            В зоне «Просто деньги» без своих вещей сетки нет вовсе: пула
            демо-вещей у неё не будет, а пустые вкладки под карточкой копилки
            — шум (тикет 44). */}
        {items.length === 0 && zone.key !== MONEY_ZONE_KEY ? (
          // Пустая зона (тикет 99, доска Б27): три места вместо сетки на
          // двадцать пустых клеток и выход из полки прямо отсюда. Копилка
          // сюда не попадает: у зоны «Просто деньги» пустота — это карточка
          // цели выше, а не полка без вещей.
          <EmptyZone
            zoneKey={zone.key}
            accent={preset.accent}
            position={position}
            removable
          />
        ) : (
          <>
            {/* Добавить вещь прямо в эту зону (полировка 16): ?zone=…
                предвыбирает её в карточке добавления (контракт тикета 04).

                СТОИТ НАД СПИСКОМ, А НЕ ПОД НИМ — то же правило, что тикет 139
                применил к листу зоны в сцене (приёмка владельца 10.08,
                замечание 2: «управляющие кнопки лежат внизу под предметами,
                до них ты просто не дойдёшь»). Здесь ссылка уезжала вниз
                ровно так же: строка вещи 93 px, при двенадцати вещах
                «Добавить» оказывалась на 1368 px от верха — почти два
                телефонных экрана прокрутки. Витрина (`/room/hall`) свою
                дорогу «+ Добавить» держит над вещами с самого начала. */}
            <Link
              href={`/room/add?zone=${zone.key}`}
              className="pressable mb-6 inline-block text-xs font-semibold"
              style={{ color: preset.accent }}
            >
              + {t("addItem")}
            </Link>

            {(zone.key !== MONEY_ZONE_KEY || items.length > 0) && (
              <OwnerZoneGrid
                items={items}
                accent={preset.accent}
                ink={preset.ink}
                zoneKey={zone.key}
                pool={zone.pool}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
