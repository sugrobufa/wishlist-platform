import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { getGuestRoom } from "@/server/services/guest-room";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { SceneStage } from "@/components/scene/SceneStage";
import { asLightColor, asTimeOfDay } from "@/components/scene/grading";
import { immersiveLayout } from "@/components/scene/immersive-layout";
import { ZoneIndexProvider } from "@/components/scene/zone-index-context";
import { ZoneRail } from "@/components/scene/zone-rail";
import { IconLock } from "@/components/icons";
import { GuestBookingProvider } from "./booking/booking-context";
import { FreeGifts } from "./booking/free-gifts";
import { GuestZoneGrid } from "./booking/guest-zone-grid";
import { MyBookingsLink } from "./booking/my-bookings-link";
import { daysUntilOccasion } from "./welcome";

// Страница одинакова для всех и не читает auth()/cookies (регистрация гостя
// «по пути» — тикет 08), поэтому кэшируема ЦЕЛИКОМ — полностраничный ISR
// (план тикета 07, включено полировкой 16, когда revalidateTag зовут ВСЕ
// мутации хозяйки: вещи — 04/06/10, настройки — 13):
// - тег `room-{id}` привязывается к странице через unstable_cache в
//   guest-room.ts: смена ника/пресета/зон, скрытие вещи и т.д. инвалидируют
//   и данные, и HTML — гость видит свежее со следующего запроса;
// - динамика броней НЕ в этом кэше: «занято»/«занято тобой»/«Мои брони»
//   приезжают отдельным некэшируемым GET /api/v1/rooms/{slug}/taken, визиты —
//   некэшируемым POST …/visit (контракты тикетов 08/11);
// - revalidate — страховочное окно: воркер image.ingest пишет photoKey из
//   другого процесса и до кэша Next не достаёт (Comments тикета 06) — фото
//   магазина доедет к гостю не позже, чем через это окно.
export const revalidate = 300;

// Пустой список включает ISR-машинерию: без generateStaticParams Next 16
// рендерит динамический сегмент на каждый запрос (в build-таблице ƒ и
// Cache-Control: no-store — проверено на next start). С ним слаги не
// пререндерятся на билде (комнаты живут в БД), но каждый запрошенный слаг
// кэшируется с первого запроса — до revalidateTag мутации или конца окна.
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

// Один запрос на рендер: generateMetadata и страница делят результат.
const getRoom = cache(getGuestRoom);

type Params = { params: Promise<{ slug: string }> };

/** Абсолютный URL для OG: мессенджеры не понимают относительных путей. */
function absoluteUrl(path: string): string {
  return new URL(path, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();
}

// Комната гостя доступна по ссылке и не индексируется (инвариант №7) —
// noindex стоит и на живой комнате, и на неизвестном слаге.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [room, t, brand] = await Promise.all([
    getRoom(slug),
    getTranslations("GuestRoom"),
    getTranslations("Brand"),
  ]);
  const robots = { index: false, follow: false };
  if (!room) return { title: t("metaTitle", { name: t("ownerFallback") }), robots };

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const title = t("metaTitle", { name: room.ownerName ?? t("ownerFallback") });
  const description = t("metaDescription");
  // Кадр комнаты уже раздаёт маршрут /rooms/ — мессенджерам нужен полный адрес.
  const image = preset ? absoluteUrl(roomImageUrl(preset.base)) : undefined;

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      // Единственная ссылка продукта, которую пересылают, — комната гостя.
      // Имя площадки в карточке одним ключом Brand.name (тикет 58); свой
      // openGraph перекрывает корневой целиком, поэтому siteName нужен здесь.
      siteName: brand("name"),
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * Комната глазами гостя (тикет 07): та же сцена и зоны, что у хозяйки, но
 * данные уже отфильтрованы сервером (guest-room.ts) — без спрятанных вещей,
 * без выключенных зон, цены — по priceVisibility. Демо-призраки видны и
 * помечены «пример».
 *
 * Тихая бронь (тикет 08): страница по-прежнему НЕ читает cookie — HTML
 * одинаков для всех. Всё гостевое-личное («занято», «занято тобой»,
 * «Мои брони · N») приезжает после рендера отдельным некэшируемым запросом
 * GET /api/v1/rooms/{slug}/taken внутри GuestBookingProvider.
 */
export default async function GuestRoomPage({ params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) notFound();

  // Ник занят, а пришли по другому адресу (короткому коду) — навсегда
  // уводим на красивый /r/{nick} (тикет 13; permanentRedirect = 308).
  // Старый код так работает вечно, а канонический адрес один.
  if (room.nick && slug !== room.nick) {
    permanentRedirect(`/r/${room.nick}`);
  }

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("GuestRoom");
  const tList = await getTranslations("RoomList");
  const tHall = await getTranslations("Hall");
  const ownerName = room.ownerName ?? t("ownerFallback");

  // Ссылка на витрину (тикет 93) — только когда витрине есть что показать:
  // звать гостя в пустую комнату-в-комнате незачем. Считается по уже отданным
  // вещам, своего запроса не заводим; `inHall` у гостя значит «видна в
  // сокровищнице» и уже учитывает глазок хозяйки (тикет 89). Демо-призраки
  // отброшены: витрина показывает только настоящие вещи.
  const hasHall = Object.values(room.itemsByZone).some((items) =>
    items.some((item) => item.state === "LOVE" && !item.isDemo && item.inHall),
  );

  // Приветствие холодному гостю (тикет 38, турн 12b): три тихие строки над
  // сценой. Первое, что человек видит, — всё ещё чужая комната; приветствие
  // только отвечает на три вопроса, которые он задал бы сам: «когда у неё
  // праздник», «есть ли тут вообще что дарить» и «меня не заставят
  // регистрироваться?».
  //
  // Отсчёт считается ЗДЕСЬ, при рендере, а не в сервисе: он про сегодняшний
  // день, а не про комнату. Прошедший праздник строки не даёт.
  const daysLeft = daysUntilOccasion(room.occasionDate, new Date());
  const occasionLine =
    daysLeft === null
      ? null
      : daysLeft === 0
        ? t("occasionToday")
        : daysLeft === 1
          ? t("occasionTomorrow")
          : t("occasionIn", { days: daysLeft });

  // Сетки зон проходят client-границу пропом zoneContent (контракт тикета 02).
  // GuestZoneGrid — та же ZoneGrid, но со слотом действия: бирка «Подарить»
  // у WANT && !isDemo, тихое «занято» у забронированных (тикет 08).
  const zoneContent: Record<string, ReactNode> = Object.fromEntries(
    Object.entries(room.itemsByZone).map(([zoneKey, items]) => [
      zoneKey,
      <GuestZoneGrid
        key={zoneKey}
        items={items}
        accent={preset.accent}
        ink={preset.ink}
        ownerName={ownerName}
        pool={preset.zones.find((zone) => zone.key === zoneKey)?.pool}
        roomSlug={room.nick ?? room.shareSlug}
      />,
    ]),
  );

  return (
    <main
      className="imm"
      style={
        {
          "--imm-gutter": `${immersiveLayout.phone.gap}px`,
          // Высота кадра на телефоне — соседнему слою: нижняя полоса
          // начинается ровно под комнатой (тикет 66, та же формула, что
          // у сцены). Пропорция из контракта.
          "--imm-scene-h": `min(calc(100vw / (${immersiveLayout.phone.ar})), 100dvh)`,
          "--room-image": `url(${roomImageUrl(preset.base)})`,
        } as CSSProperties
      }
    >
      {/* Та же раскладка «во весь экран», что у хозяйки (тикет 24): размытый
          кадр фоном, сцена посередине, интерфейс двумя полосами на вуалях. */}
      <div className="imm-backdrop" aria-hidden />
      <div className="imm-veil imm-veil-top" aria-hidden />
      <div className="imm-veil imm-veil-bottom" aria-hidden />

      <GuestBookingProvider slug={slug}>
        {/* Указатель зон в нижней полосе (тикет 34) делит со сценой состояние
            «какая зона подсвечена и какая открыта» — отсюда провайдер. */}
        <ZoneIndexProvider>
          {/* `drift` — только у гостя (тикет 72, турн 28b): комната сама едет
              от края до края, пока её не тронули, и показывает 33 зоны,
              которые в покое стоят за правым краем окна. Первое касание
              останавливает проезд до конца сессии. */}
          <SceneStage
            preset={preset}
            zonesOff={room.zonesOff}
            zoneContent={zoneContent}
            drift
            // Гость видит свет, который выбрала ХОЗЯЙКА (тикет 96): своей
            // ручки у него нет и не будет — это её комната.
            timeOfDay={asTimeOfDay(room.timeOfDay)}
            lightColor={asLightColor(room.lightColor)}
          />

          <header className="imm-rail imm-rail-top">
            {/* Та же сетка полосы, что у хозяйки (globals.css → .imm-top-grid):
                на телефоне тихие строки уходят под имя, на десктопе встают с
                ним в один ряд — иначе полоса не укладывается в свою высоту и
                наезжает на комнату. */}
            <div className="imm-top-grid">
              <div className="imm-area-titles">
                <p className="overline text-text-muted">{t("overline")}</p>
                {/* Имя хозяйки + маленький аватар, если загружен (тикет 13).
                  Фон-div, как у плиток вещей: раздача /media, alt не нужен. */}
                <div className="mt-1 flex items-center gap-3">
                  {room.ownerAvatarUrl && (
                    <div
                      aria-hidden
                      className="h-9 w-9 flex-none rounded-full border border-surface-hairline bg-surface-fill lg:h-11 lg:w-11"
                      style={{
                        backgroundImage: `url(${room.ownerAvatarUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                  )}
                  <h1 className="display imm-title text-2xl lg:text-4xl">{ownerName}</h1>
                </div>
              </div>

              <div className="imm-area-quiet">
                {/* «Праздник через 12 дней» — дата и так уехала гостю в
                    приглашении; без неё строки просто нет. */}
                {occasionLine && <p className="overline text-text-muted">{occasionLine}</p>}
                {/* «7 подарков ещё свободны» — про желания, а не про брони
                    (services/guest-room.countFreeGifts объясняет, почему это
                    не ломает тихую бронь). Число считает сервер, а строка —
                    клиентская: она вычитает брони, сделанные этим же гостем за
                    этот заход, иначе кэш страницы обещал бы уже занятое. */}
                <FreeGifts count={room.freeGiftCount} accent={preset.accent} />
                {/* Честная строка (турн 12b): человек имеет право знать, что
                    его не считают и не заставят заводить аккаунт.
                    ТОЛЬКО НА ДЕСКТОПЕ (тикет 77): на телефоне владелец назвал
                    её лишней на первом экране — там и так три строки над
                    комнатой. Обещание не выброшено, оно переехало туда, где
                    работает: в лист брони, прямо над полем имени. */}
                <p className="imm-desktop-only flex items-center gap-1.5 text-xs text-text-faint">
                  {/* Замок — канон 25a «Приватность» (тикет 52): наш и был
                      теми же путями, только контур 1.8 против канонных 1.7. */}
                  <IconLock size={13} className="flex-none" />
                  {t("noSignup", { name: ownerName })}
                </p>
              </div>
            </div>
          </header>

          {/* Мягкий призыв внизу и под ним указатель зон (тикет 34): гость
              пришёл смотреть, и список — его единственный способ узнать, как
              зоны называются, с телефона. */}
          <footer className="imm-rail imm-rail-bottom">
            <ZoneRail
              zones={preset.zones}
              zonesOff={room.zonesOff}
              summaries={room.summariesByZone}
              viewer="guest"
              accent={preset.accent}
              below={
                // Всё, что словами, — ПОД оглавлением (тикет 77, расширен
                // тикетом 85). Прошёл зоны — получил и другой вход в них, и
                // предложение собрать свою. В строке НАД оглавлением места
                // тексту нет: там по центру висит подсказка «коснись зоны»,
                // и на 430 ей остаётся по 60 px с краёв (globals.css).
                <>
                  <div className="flex min-w-0 items-center gap-4">
                    {/* Второй вход в то же содержимое (тикет 67): гость,
                        который пришёл выбрать подарок за минуту, смотрит
                        вещи списком. */}
                    <Link
                      href={`/r/${room.nick ?? room.shareSlug}/list`}
                      className="pressable btn-quiet"
                    >
                      {tList("toList")}
                    </Link>
                    {/* Витрина хозяйки (тикет 93, доска А5): не «что подарить»,
                        а «кто она» — вещи, которые у неё уже есть. */}
                    {hasHall && (
                      <Link
                        href={`/r/${room.nick ?? room.shareSlug}/hall`}
                        className="pressable btn-quiet"
                      >
                        {tHall("toHall")}
                      </Link>
                    )}
                    {/* «Мои брони · N» — появляется после клиентского fetch,
                        если cookie непуст. */}
                    <MyBookingsLink />
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <p className="min-w-0 text-xs text-text-muted">{t("ctaHint")}</p>
                    <Link
                      href="/"
                      className="pressable btn-quiet"
                      style={{ "--pill-accent": preset.accent } as React.CSSProperties}
                    >
                      {t("cta")}
                    </Link>
                  </div>
                </>
              }
            >
              {/* Строка НАД оглавлением у гостя пуста: её полоса отдана
                  подсказке целиком (тикет 85). Высоту держит CSS, чтобы
                  список не подъехал под пилюлю. */}
              <div className="imm-actions" />
            </ZoneRail>
          </footer>
        </ZoneIndexProvider>
      </GuestBookingProvider>
    </main>
  );
}
