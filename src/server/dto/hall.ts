// DTO сокровищницы — что видно на витрине и как показать цену ХОЗЯЙКЕ
// (тикет 35, ADR-0004; переписано тикетом 124).
//
// ЦЕНА В СОКРОВИЩНИЦЕ ГОСТЮ НЕ ПОКАЗЫВАЕТСЯ ВОВСЕ (инвариант №8 в новой
// редакции, модель v2 дизайна раунда 24). Раньше это решала настройка зала из
// четырёх положений; после отмены состояний решать стало нечего:
// - цена ЖИВЁТ у вещи комнаты и подчиняется её `priceVisibility`. Уезжая на
//   витрину, вещь цену не теряет — её просто перестают показывать; возврат
//   «в комнату» показывает её снова (подсказка «цена снова видна»);
// - витрина рассказывает о человеке, а не продаёт: там подпись «Подарок
//   {year} года · от {giver}» (имя — только хозяйке) либо заметка-цитата.
// ХОЗЯЙКЕ ЕЁ СОБСТВЕННЫЕ ЦЕНЫ ВИДНЫ ВСЕГДА — эта половина инварианта №8 не
// менялась ни разу, и на её собственной витрине цена остаётся.
//
// Здесь живёт вся арифметика показа: округление и сумма витрины хозяйки.
// Деньги — Decimal, никогда float (CLAUDE.md); сумма считается по ТОЧНЫМ
// значениям, округление — только на показе.
import { Prisma, type Item, type Room } from "@prisma/client";
import type { PriceVisibilityDto } from "@/server/dto/items";

type Decimal = Prisma.Decimal;

/** Настройки витрины одной комнаты (доска, турн 12d). */
export type HallSettings = {
  /**
   * Четыре положения, а не тумблер: «стоимость — это чувствительно».
   *
   * ГОСТЯ БОЛЬШЕ НЕ КАСАЕТСЯ (тикет 124): цену вещи сокровищницы он не видит
   * ни при каком положении. Колонка и настройка оставлены — сносить их
   * решением сервера нельзя, это экран настроек и отдельный заход; сегодня
   * они не влияют ни на один ответ гостю.
   */
  priceVisibility: PriceVisibilityDto;
  /** «18 вещей на 340 000 ₽» в шапке витрины ХОЗЯЙКИ — самостоятельный тумблер. */
  totalShown: boolean;
  /** Имя дарителя под вещью. */
  giverShown: boolean;
  /** «около 60 000» вместо 62 000. */
  roundPrices: boolean;
};

/** Настройки зала из строки комнаты. */
export function hallSettingsOf(
  room: Pick<
    Room,
    "hallPriceVisibility" | "hallTotalShown" | "hallGiverShown" | "hallRoundPrices"
  >,
): HallSettings {
  return {
    priceVisibility: room.hallPriceVisibility,
    totalShown: room.hallTotalShown,
    giverShown: room.hallGiverShown,
    roundPrices: room.hallRoundPrices,
  };
}

/**
 * Кому адресована цена вещи на витрине — подпись значка рядом с ценой
 * («хозяйка не должна лезть в настройки, чтобы вспомнить», доска 12d).
 *
 * После тикета 124 у этого вопроса ОДИН ответ, и он не зависит ни от чего:
 * цену вещи сокровищницы не видит ни один гость. Тип оставлен прежним, чтобы
 * значок остался тем же элементом; значение всегда `"NONE"`.
 */
export type HallPriceAudience = PriceVisibilityDto | "ITEM";

/**
 * Значок рядом с ценой — перечёркнутый глаз, то есть «от гостей цена закрыта».
 * `ME`/`NONE`/`ITEM` — «гость не увидит»; `ALL` и `FRIENDS` описывают, кто
 * цену ВИДИТ. На витрине сегодня всегда первое (см. `hallItemForOwner`).
 */
export function priceAudienceHidden(audience: HallPriceAudience): boolean {
  return audience === "ITEM" || audience === "ME" || audience === "NONE";
}

/**
 * Видит ли ГОСТЬ цену вещи в сокровищнице. Ответ — НЕТ, всегда и у любой
 * вещи (тикет 124, модель v2 дизайна: «сокровищница: цена не показывается
 * вовсе»).
 *
 * Функция оставлена именем правила, а не выпилена в пользу голого `false` по
 * месту вызова: правило одно, и жить оно обязано в одном месте — иначе
 * следующая цена на витрине откроется мимо него. Аргументов у неё нет
 * сознательно: любая настройка в сигнатуре читалась бы как дверь, которой
 * больше нет.
 *
 * Цена вещи КОМНАТЫ этим правилом не задета: она подчиняется
 * `Item.priceVisibility` (guest-items.guestSeesPrice), и переезд «Вернуть в
 * комнату» показывает её снова.
 */
export function guestSeesHallPrice(): boolean {
  return false;
}

// ---------- Округление «около 60 000» ----------

/**
 * Шаг округления — «красивое» число (1, 2 или 5 на порядок), не крупнее
 * десятой части суммы. На доске 62 000 → «около 60 000»: десятая часть —
 * 6 200, ближайшее красивое снизу — 5 000, 62 000 / 5 000 = 12,4 → 60 000.
 * Ошибка показа при таком шаге не больше 5% — «около» остаётся правдой.
 */
function niceStep(value: Decimal): Decimal {
  const tenth = value.div(10);
  if (tenth.lessThan(1)) return new Prisma.Decimal(1);
  // Порядок берём по длине целой части — без Math.log10 и без float.
  const digits = tenth.floor().toFixed(0).length;
  const pow = new Prisma.Decimal(10).pow(digits - 1);
  for (const factor of [5, 2, 1]) {
    const step = pow.mul(factor);
    if (step.lessThanOrEqualTo(tenth)) return step;
  }
  return pow;
}

/**
 * «Около» — цена, округлённая для показа (тумблер «Округлять цены»).
 * Только показ: сумма зала складывается по точным значениям и округляется
 * уже готовой (критерий тикета «округление не искажает сумму зала»).
 */
export function roundHallPrice(value: Decimal): Decimal {
  if (value.lessThanOrEqualTo(0)) return value;
  const step = niceStep(value);
  return value.div(step).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(step);
}

/** Округление изменило число — значит показываем «около …», а не точную цену. */
export function isRounded(value: Decimal, rounded: Decimal): boolean {
  return !value.equals(rounded);
}

// ---------- Сумма всего зала ----------

/** Одна валюта суммы: «340 000 ₽». Сумма — строка Decimal, не float. */
export type HallTotalDto = { currency: string; amount: string };

/**
 * Сумма зала по валютам. Складываем ТОЧНЫЕ значения (Decimal), и только
 * готовую сумму при надобности округляем — иначе «около» каждой вещи
 * накопилось бы в заметную ошибку итога.
 *
 * Валюта — отдельное поле (CLAUDE.md), складывать рубли с евро нельзя:
 * получается по строке на валюту, крупная валюта первой. Валюты нет —
 * считаем рублями (как формат цены в плитке зоны).
 */
export function hallTotals(
  priced: ReadonlyArray<{ price: Decimal | null; currency: string | null }>,
  options: { round?: boolean } = {},
): HallTotalDto[] {
  const sums = new Map<string, Decimal>();
  for (const row of priced) {
    if (row.price === null) continue;
    const currency = row.currency ?? "RUB";
    sums.set(currency, (sums.get(currency) ?? new Prisma.Decimal(0)).add(row.price));
  }

  return [...sums]
    .map(([currency, exact]) => ({
      currency,
      amount: (options.round === true ? roundHallPrice(exact) : exact).toString(),
    }))
    .sort((a, b) => new Prisma.Decimal(b.amount).comparedTo(new Prisma.Decimal(a.amount)));
}

// ---------- Кого сокровищница показывает наблюдателям (тикет 89) ----------

/**
 * Видна ли вещь сокровищницы НАБЛЮДАТЕЛЮ — всем, кроме самой хозяйки.
 *
 * Единственное место, где живёт этот фильтр. До тикета 89 он стоял прямо в
 * выборке `listHallItems`, а та обслуживает страницу ХОЗЯЙКИ: глазок,
 * написанный «в лоб», прятал бы вещь и от неё — вернуть её было бы нечем.
 * Поэтому выборка хозяйки фильтр потеряла, а он переехал сюда, к ответу
 * наблюдателю: строка «последнее в сокровищнице» в «Друзьях»
 * (services/connections.ts) и гостевая витрина (тикет 93).
 *
 * Условий два (третье, «вещь — „люблю"», умерло вместе с состояниями,
 * тикет 124), и оба — про ВЕЩЬ, а не про цену: цены на витрине гость не
 * видит вовсе (`guestSeesHallPrice`), и смешивать эти правила нельзя.
 */
export function hallItemShownToObservers(item: Pick<Item, "inHall" | "hiddenFromHall">): boolean {
  return item.inHall && !item.hiddenFromHall;
}

// ---------- Витрина глазами хозяйки ----------

/**
 * Вещь зала для хозяйки: allowlist, как и остальные DTO. Цена у неё видна
 * всегда (ADR-0004) — значок рядом честно говорит, кто видит её КРОМЕ неё.
 */
export type HallItemDto = {
  id: string;
  title: string;
  photoUrl: string | null;
  /**
   * Зона вещи — адрес её карточки (`/room/zone/{zone}/i/{id}`). Витрина до
   * тикета 92 никуда не вела: заметку было видно, но негде написать.
   */
  zone: string;
  /**
   * Заметка хозяйки цитатой (тикет 92, доска Б22: «Ждала её два года…»).
   * Пустая и пробельная — это отсутствие заметки, наружу уходит null.
   */
  note: string | null;
  /** null, когда тумблер «Кто подарил» выключен (показ, а не раскрытие). */
  giverName: string | null;
  /** Год «Подарок {year} года» строкой — или null. */
  receivedYear: string | null;
  /** Цена строкой Decimal — уже округлённая, если тумблер включён. */
  price: string | null;
  /** ISO 4217. */
  currency: string | null;
  /** Цена показана округлённой — подпись «около …». */
  rounded: boolean;
  /** Кому адресована цена: значок «кто видит цену». */
  priceAudience: HallPriceAudience;
  /**
   * Вещь скрыта глазком (тикет 89): у хозяйки она на витрине остаётся, но
   * приглушённой — наблюдатели её не видят. Про ВЕЩЬ, не про цену.
   */
  hiddenFromObservers: boolean;
};

/** Цена вещи как показать её хозяйке: округление + признак «около». */
function ownerPrice(
  price: Decimal | null,
  round: boolean,
): { price: string | null; rounded: boolean } {
  if (price === null) return { price: null, rounded: false };
  if (!round) return { price: price.toString(), rounded: false };
  const nice = roundHallPrice(price);
  return { price: nice.toString(), rounded: isRounded(price, nice) };
}

/**
 * Сериализация вещи витрины для хозяйки. Не пересекается с `itemForOwner`
 * намеренно: там форма LOVE вообще не знает цены (инвариант №8 в исходной
 * формулировке), и ослаблять её ради зала нельзя — цена «люблю» появляется
 * ровно на одном экране и ровно по настройке.
 */
export function hallItemForOwner(
  item: Item,
  settings: HallSettings,
  photoUrl: string | null,
): HallItemDto {
  const shown = ownerPrice(item.price, settings.roundPrices);
  return {
    id: item.id,
    title: item.title,
    photoUrl,
    zone: item.zone,
    note: item.note?.trim() ? item.note.trim() : null,
    giverName: settings.giverShown ? item.giverName : null,
    receivedYear: item.receivedAt ? String(item.receivedAt.getUTCFullYear()) : null,
    price: shown.price,
    currency: shown.price === null ? null : (item.currency ?? "RUB"),
    rounded: shown.rounded,
    // Всегда «от гостей закрыто» (тикет 124): цену вещи сокровищницы не видит
    // ни один гость, и значок обязан говорить об этом одинаково у любой вещи.
    priceAudience: "NONE",
    hiddenFromObservers: item.hiddenFromHall,
  };
}

// ---------- Витрина глазами гостя (тикет 93) ----------

/**
 * Вещь витрины для ГОСТЯ. Отдельная форма, а не хозяйкина с флажком: у
 * хозяйки цена видна всегда (ADR-0004), и ослаблять её форму ради гостя
 * нельзя. Здесь наоборот — ЦЕНЫ НЕТ ВОВСЕ, ни ключом, ни значением
 * (инвариант №8 в редакции тикета 124).
 *
 * Чего в форме нет вовсе: `priceAudience` (значок «кто видит цену» — разговор
 * хозяйки с собой), `hiddenFromObservers` (вещь, которую гость не видит, до
 * него не доезжает) и `zone` с `id` под правку. Следов броней тут нет по
 * построению — вещи «люблю» уже подарены, но и ключа такого в форме не
 * существует (инвариант №1).
 *
 * **ИМЕНИ ДАРИТЕЛЯ ТУТ НЕТ И БЫТЬ НЕ МОЖЕТ** (раунд 19, найдено дизайном в
 * нашей сборке — и справедливо). Тумблер «Кто подарил» решает, видит ли имя
 * ХОЗЯЙКА на своей витрине; распространить его на гостей значит назвать
 * третьего человека людям, которым он себя не называл. Даритель открывается
 * ровно один раз и ровно одной хозяйке — экран «что подарили» (инвариант №2).
 * Год остаётся: он про вещь, а не про человека.
 */
export type HallGuestItemDto = {
  id: string;
  title: string;
  photoUrl: string | null;
  receivedYear: string | null;
  /** Заметка-цитата хозяйки (тикет 92) — текст о вещи, своей настройки нет. */
  note: string | null;
};

/**
 * Сериализация вещи витрины гостю. Фильтр «показывать ли эту вещь вообще»
 * живёт в `hallItemShownToObservers` и отрабатывает ДО этой функции — сюда
 * скрытое приходить не должно, но и придя, наружу ничего не унесёт: ключей
 * `inHall`/`hiddenFromHall` в форме нет.
 *
 * Ключей price/currency в форме НЕ СУЩЕСТВУЕТ (тикет 124) — не «пусто при
 * закрытой настройке», а нет вовсе: настройки, которая могла бы их открыть,
 * больше не бывает. Поэтому и `settings` этой функции не нужны.
 */
export function hallItemForGuest(item: Item, photoUrl: string | null): HallGuestItemDto {
  return {
    id: item.id,
    title: item.title,
    photoUrl,
    receivedYear: item.receivedAt ? String(item.receivedAt.getUTCFullYear()) : null,
    note: item.note?.trim() ? item.note.trim() : null,
  };
}
