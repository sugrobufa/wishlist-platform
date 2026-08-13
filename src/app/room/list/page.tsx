import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listZoneItems } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { RoomListView, type RoomListGroup } from "@/components/room-list/room-list-view";
import { TabBar } from "@/components/tab-bar/tab-bar";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RoomList");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Вся комната списком глазами ХОЗЯЙКИ (тикет 67).
 *
 * Второй вход в то же содержимое, что и сцена: кто не хочет гулять по комнате,
 * видит все свои вещи разом, сгруппированные по зонам. Сцену не заменяет.
 *
 * КАК СЮДА ПОПАДАЮТ (долг тикета 129, закрыт 10.08). Основной взгляд на список
 * — знак «Списком» в полосе под кадром: он переключает содержимое ТОЙ ЖЕ
 * полосы, и кадр с экрана не уходит. Сюда ведёт одна ссылка, с другого
 * экрана — настройки, секция «Полки в комнате». Это запасная лестница по
 * образцу сокровищницы (тикет 119, турн 36c), и она не спорит с решением
 * владельца: знак в углу СЦЕНЫ снят и не возвращается.
 *
 * ЧТО СТРАНИЦА УМЕЕТ ТАКОГО, ЧЕГО НЕ УМЕЕТ ПОЛОСА, — три вещи, все замерены:
 * на десктопе окно списка в полосе 64 px при 3809 px самого списка (высота
 * полосы входит в расчёт раскладки сцены, взять больше неоткуда); положение
 * переключателя — взгляд на сессию, оно никуда не пишется, и переслать его
 * адресом нельзя; полоса клиентская — до гидратации и без JS списка в разметке
 * нет вовсе, а эта страница серверная. Разбор целиком — в шапке `ZonesSection`
 * (src/app/settings/settings-sections.tsx).
 *
 * ДЕМО-ПРИЗРАКОВ ЗДЕСЬ НЕТ. Они объясняют язык ЗОНЫ в сцене («вот так выглядит
 * „хочу", а вот так „люблю"»); в плоском перечне всей комнаты они читались бы
 * как чужие вещи. Пустая комната показывает пустое состояние — это честнее.
 *
 * Спрятанные вещи хозяйке видны (это её экран, и `hidden` у неё — пометка, а
 * не запрет); гостю их не отдаёт сервис (инвариант №5, свой маршрут).
 */
export default async function RoomAsListPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const t = await getTranslations("RoomList");

  // Порядок зон — тот же, что в комнате и в оглавлении: номер группы совпадает
  // с номером зоны, которую человек видел на сцене.
  //
  // ЗДЕСЬ ВСЕ ПОЛКИ, А НЕ ТОЛЬКО ТЕ, ЧТО ЕСТЬ В КАДРЕ (тикет 235). У живой полки
  // без места на кадре нет метки, и этот список — её единственная дорога:
  // заголовок группы ведёт на `/room/zone/{ключ}`, где она работает целиком.
  // Ради этого владелец и просил третье состояние — «лёгкий переезд во все
  // комнаты без потерь»: вещь не пропадает с экрана оттого, что в новом
  // интерьере полке не нашлось предмета.
  // ПУСТАЯ ПОЛКА ТОЖЕ ЗДЕСЬ (тикет 239). Здесь стояло `if (rows.length === 0)
  // continue` — список был «про вещи». Пока у каждой полки была метка в кадре,
  // это ничего не стоило: пустую полку человек видел в комнате. С семью
  // полками без места на кадре пустая полка перестала быть видна где бы то ни
  // было — ни в кадре, ни в списке. Полка есть, и в списке она есть.
  const zones = visibleZones(preset.zones, room.zonesOff);
  const groups: RoomListGroup[] = [];
  for (const zone of zones) {
    const rows = await listZoneItems(room.id, zone.key);
    groups.push({
      key: zone.key,
      label: zoneInfo(zone.key)?.label ?? zone.label,
      pool: zone.pool,
      items: rows.map(itemForOwner),
    });
  }

  // Счётчики шапки — как на 29a, но ДВА числа из трёх. Третье, «N забраны»,
  // владелец решил не ставить (приёмка 07.08): комната остаётся единственным
  // местом счётчика забранных во всём продукте, и правило проще сторожить,
  // пока место одно. Расхождение с доской осознанное.
  // «N вещей», и только оно (тикет 124): второе число говорило, сколько вещей
  // помечено «хочу», а в комнате теперь всё — желание, и оно всегда равнялось
  // бы первому. `want: 0` гасит вторую половину строки словаря (ветка `=0`).
  // Гостевое «M свободно» придёт из канала «занято» — заход про экраны.
  const items = groups.reduce((sum, group) => sum + group.items.length, 0);
  const tGrid = await getTranslations("ZoneGrid");

  return (
    // Нижний отступ освобождает место постоянному таб-бару: в переменной с
    // тикета 182 лежит полоса знаков 86 плюс нижний инсет, так что прибавлять
    // его здесь не нужно. Низ страницы — 100dvh, а не 100vh: во встроенном
    // браузере Телеграма 100vh не знает про его обвязку и уезжает под неё.
    <main className="min-h-[100dvh] pb-[calc(var(--imm-tab-bar)+30px)]">
      <div className="mx-auto w-full max-w-3xl px-5 lg:px-0">
        <header className="pb-2 pt-6 lg:pt-10">
          <h1 className="display text-3xl lg:text-4xl">{t("title")}</h1>
          {items > 0 && (
            <p className="overline mt-2 text-text-muted">
              {tGrid("zoneCounts", { total: items, want: 0 })}
            </p>
          )}
        </header>

        <RoomListView
          groups={groups}
          accent={preset.accent}
          roomHref="/room"
          zoneHrefBase="/room/zone/"
        />
      </div>

      <TabBar active="room" accent={preset.accent} ink={preset.ink} />
    </main>
  );
}
