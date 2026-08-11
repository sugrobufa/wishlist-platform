import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { zonesByDeeds } from "@/server/services/zone-order";
import { rooms, zoneInfo } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { AddItemFlow, type ZoneOption } from "./add-item-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AddItem");
  return { title: t("overline"), robots: { index: false, follow: false } };
}

type SearchParams = { searchParams: Promise<{ zone?: string; hall?: string }> };

/**
 * Добавление вещи (тикет 04, турн 8). Страница тонкая: собирает видимые
 * зоны комнаты с подписями из zones.json и отдаёт клиентскому флоу;
 * ?zone=… предвыбирает зону (невидимые ключи молча игнорируются).
 *
 * ДВА ВХОДА, И РАЗЛИЧАЕТ ИХ МЕСТО (тикет 124). Без параметра вещь встаёт В
 * КОМНАТУ — то есть в список желаний; `?hall=1` (тикет 89) кладёт её сразу в
 * сокровищницу. Состояния у вещи нет, и вопроса «люблю или хочу» на экране не
 * задаётся ни в одном из входов. Зону спрашиваем в обоих: витрина зоне не
 * замена, а слой поверх, и `zone` у витринной вещи сохраняется — иначе
 * «Вернуть в комнату» некуда возвращать.
 */
export default async function AddItemPage({ searchParams }: SearchParams) {
  const { zone: zoneParam, hall: hallParam } = await searchParams;
  const toHall = hallParam === "1";

  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const preset = rooms.find((candidate) => candidate.id === room.preset);
  if (!preset) redirect("/room");

  // ПОРЯДОК ЗОН — ПО ДЕЛАМ, А НЕ ПО АНКЕТЕ (тикет 189, решение владельца
  // 11.08.2026). Прежде первыми шли категории, выбранные в вопросе «что чаще
  // всего хочется»; вопрос снят — он был единственной анкетой продукта, и
  // человек не видел от неё ничего. Теперь первыми идут зоны, куда он УЖЕ КЛАЛ
  // ВЕЩИ, остальные — контрактным порядком пресета. Это только сортировка:
  // список зон не меняется ни на одну (правило — services/zone-order).
  //
  // Поле `room.wants` здесь больше не читается и не читается нигде: данные
  // живых комнат целы, поле мёртвое до отдельного решения.
  //
  // Прямоугольник зоны сюда больше не едет: он был нужен кропу комнаты на шаге
  // «что это для тебя», а шага не стало (тикет 124).
  const ordered = await zonesByDeeds(room.id, visibleZones(preset.zones, room.zonesOff));
  const zones: ZoneOption[] = ordered.map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
  }));
  const preselected = zones.find((zone) => zone.key === zoneParam)?.key;
  const initialZone = preselected ?? zones[0]?.key ?? "";

  return (
    <AddItemFlow
      zones={zones}
      initialZone={initialZone}
      // Пришли «добавить в эту зону» (?zone=…) — подсказка парсера зону не двигает.
      zonePreselected={preselected !== undefined}
      toHall={toHall}
      // Выход из карточки ведёт туда, откуда пришли: с витрины (?hall=1) на
      // витрину, со страницы зоны (?zone=…) обратно в неё, иначе в комнату
      // (приёмка п.1).
      exitHref={toHall ? "/room/hall" : preselected ? `/room/zone/${preselected}` : "/room"}
      accent={preset.accent}
      ink={preset.ink}
    />
  );
}
