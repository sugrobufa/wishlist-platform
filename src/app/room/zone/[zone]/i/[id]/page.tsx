import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { getOwnItem } from "@/server/services/items";
import { itemForOwner } from "@/server/dto/items";
import { hallItemForOwner, hallSettingsOf } from "@/server/dto/hall";
import { rooms, zoneInfo } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { visibleZones } from "@/components/scene/zones";
import { ItemCard, type ZoneOption } from "./item-card";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ zone: string; id: string }> };

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
 * Карточка вещи глазами хозяйки (тикет 39, турны 11e и 8c; P0-экран из 19b):
 * правка полей, перенос на другую полку, «спрятать» и «удалить». У вещи
 * «люблю» сверху — её история: «В комнате с {год}», «Подарок от {кто}»,
 * цена и заметка, которая до сих пор не показывалась нигде (Б21).
 *
 * Страница тонкая: читает свою вещь (чужая и несуществующая одинаково — 404,
 * существование чужого id не подтверждаем), собирает видимые зоны комнаты и
 * отдаёт клиентской карточке. Про бронь здесь не знает никто — DTO хозяйки
 * booking не содержит (инвариант №1).
 *
 * ЦЕНА ВЕЩИ «ЛЮБЛЮ» идёт ОТДЕЛЬНЫМ путём, а не через `itemForOwner`. Форма
 * LOVE в owner-DTO цены не несёт — так задумано (ADR-0004: «цена „люблю"
 * появляется ровно на одном экране и ровно по настройке»), и ослаблять её
 * ради этой карточки нельзя: снапшот ключей owner-DTO под тестом. Поэтому
 * цену считает `hallItemForOwner` — тот же расчёт, что в зале славы, включая
 * округление и подпись «кто её видит». Хозяйке цена видна всегда.
 */
export default async function OwnerItemPage({ params }: Params) {
  const { zone: zoneKey, id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) notFound();

  const item = await getOwnItem(userId, id);
  if (!item) notFound();

  // Вещь переехала (или пришли по старой ссылке) — канонический адрес один:
  // тот, где вещь лежит сейчас.
  if (item.zone !== zoneKey) redirect(`/room/zone/${item.zone}/i/${item.id}`);

  const zones: ZoneOption[] = visibleZones(preset.zones, room.zonesOff).map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
  }));

  // Полка выключена или её нет в этом интерьере — карточка недоступна ровно
  // так же, как сама полка (страница зоны на такой ключ отвечает 404).
  const zone = zones.find((candidate) => candidate.key === item.zone);
  if (!zone) notFound();

  // Фотография здесь своя, из карточки; витрине зала она в этом месте не нужна.
  const hall = item.inHall ? hallItemForOwner(item, hallSettingsOf(room), null) : null;

  const presetZone = preset.zones.find((candidate) => candidate.key === item.zone);
  const zoneRect = presetZone?.withoutRect ? null : (presetZone?.rect ?? null);

  return (
    <ItemCard
      item={itemForOwner(item)}
      hall={
        hall === null
          ? null
          : {
              price: hall.price,
              currency: hall.currency,
              rounded: hall.rounded,
              priceAudience: hall.priceAudience,
              hiddenFromObservers: hall.hiddenFromObservers,
            }
      }
      zones={zones}
      zoneLabel={zone.label}
      // Знак ПУЛА зоны (тикет 82): у вещи категории нет, у зоны есть всегда.
      // Встаёт на месте отсутствующей фотографии.
      zonePool={zoneInfo(item.zone)?.pool ?? null}
      // Полка миниатюрой КАДРА 76×48 (тикет 196, contract round45 →
      // owner.order). Прямоугольник — только из `rooms.json`, в системе кадра
      // 630×351 (ADR-0006): своей карты координат у карточки нет.
      //
      // У ПОЛКИ БЕЗ МЕСТА НА КАДРЕ МИНИАТЮРЫ НЕТ (тикет 235). Прямоугольник в
      // контракте у неё лежит, но стоит он на поверхности, где предмет стоял
      // бы, а не на предмете: вырезка показала бы кусок пустой полки и сказала
      // бы «вот твоя полка» про то, чего в интерьере нет. `null` карточка умеет.
      zoneRect={zoneRect}
      frameUrl={roomImageUrl(preset.base)}
      accent={preset.accent}
      ink={preset.ink}
    />
  );
}
