// DTO зала славы — стоимость подарков и настройки к ней (тикет 35).
// Решение записано в ADR-0004: инвариант №8 защищал не цену как таковую, а
// ГОСТЯ от чужой цены по умолчанию. Точная формулировка:
//
//   Цена вещи «люблю» не показывается ГОСТЮ, пока хозяйка не разрешила это
//   настройкой. Хозяйке её собственные цены видны всегда. В зале славы показ
//   управляется настройкой из четырёх положений, дефолт — «только друзьям».
//
// Здесь живёт вся арифметика показа: кто видит цену, как её округлить и как
// сложить сумму зала. Деньги — Decimal, никогда float (CLAUDE.md); сумма
// считается по ТОЧНЫМ значениям, округление — только на показе.
import { Prisma, type Item, type Room } from "@prisma/client";
import type { PriceVisibilityDto } from "@/server/dto/items";

type Decimal = Prisma.Decimal;

/** Настройки зала одной комнаты (доска, турн 12d). */
export type HallSettings = {
  /** Четыре положения, а не тумблер: «стоимость — это чувствительно». */
  priceVisibility: PriceVisibilityDto;
  /** «18 вещей на 340 000 ₽» в шапке зала — самостоятельный тумблер. */
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
 * Кому адресована цена этой вещи в зале — подпись значка рядом с ценой
 * («хозяйка не должна лезть в настройки, чтобы вспомнить», доска 12d).
 * `ITEM` — цена скрыта у ОТДЕЛЬНОЙ вещи и перекрывает настройку зала:
 * «у любой вещи можно скрыть цену отдельно — даже если весь зал её
 * показывает».
 */
export type HallPriceAudience = PriceVisibilityDto | "ITEM";

/**
 * Значок рядом с ценой — перечёркнутый глаз, то есть «от гостей цена закрыта».
 *
 * Считается по АДРЕСАТУ, а не только по скрытию у вещи: при `NONE` открытый
 * глаз стоял рядом с подписью «цену не видит никто» и спорил с ней. `ME` и
 * `NONE` — это тоже «гость не увидит», просто решение принято настройкой зала,
 * а не у отдельной вещи. `ALL` и `FRIENDS` описывают, кто цену ВИДИТ.
 *
 * Отдельно от `hallItemPriceHidden`: тот отвечает на вопрос «спрятана ли цена
 * у самой вещи» и управляет тумблером «Скрыть цену», а этот — только показом
 * значка.
 */
export function priceAudienceHidden(audience: HallPriceAudience): boolean {
  return audience === "ITEM" || audience === "ME" || audience === "NONE";
}

/**
 * Скрыта ли цена у самой вещи. Отдельной колонки для этого не заводили:
 * `Item.priceVisibility` уже описывает «кто видит цену этой вещи», переживает
 * переход «хочу → люблю» и читается зала теми же четырьмя значениями, что и
 * комнатой. ME/NONE = «скрыта»; хозяйке цена видна всё равно.
 */
export function hallItemPriceHidden(visibility: PriceVisibilityDto): boolean {
  return visibility === "ME" || visibility === "NONE";
}

/**
 * Видит ли ГОСТЬ цену вещи в зале славы при такой настройке зала.
 *
 * FRIENDS в Phase 1 читается ЗАКРЫТО — и это сознательно расходится с
 * `guestSeesPrice` для «хочу», где FRIENDS временно приравнен к ALL:
 * - дефолт настройки зала — FRIENDS (ADR-0004 требует «только друзьям», а не
 *   «всем»). Приравняй мы FRIENDS к ALL — дефолт по факту стал бы «всем», и
 *   миграция молча открыла бы цены подарков во всех существующих комнатах;
 * - цена «хочу» нужна гостю по делу (он выбирает подарок), цена «люблю» —
 *   рассказ о хозяйке. Новую дверь открываем закрытой.
 *
 * TODO(Phase 2, градация связей): когда Connection научится отличать «своих»
 * (взаимно / слежу / смотрели), FRIENDS обязан сверяться со связью гостя и
 * хозяйки — и тогда это правило станет общим с `guestSeesPrice`.
 */
export function guestSeesHallPrice(visibility: PriceVisibilityDto): boolean {
  return visibility === "ALL";
}

/**
 * Видит ли ГОСТЬ цену конкретной вещи в зале: настройка зала И собственная
 * видимость вещи. Скрытие у вещи перекрывает открытый зал, но не наоборот —
 * открыть вещь шире, чем открыт зал, нельзя.
 */
export function guestSeesHallItemPrice(
  hallVisibility: PriceVisibilityDto,
  itemVisibility: PriceVisibilityDto,
): boolean {
  return guestSeesHallPrice(hallVisibility) && !hallItemPriceHidden(itemVisibility);
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
 * (services/connections.ts) и будущий гостевой зал (тикет 93).
 *
 * Три условия, и все три — про вещь, а не про цену: у цены свои правила
 * (`guestSeesHallItemPrice`), смешивать их нельзя.
 */
export function hallItemShownToObservers(
  item: Pick<Item, "state" | "inHall" | "hiddenFromHall">,
): boolean {
  return item.state === "LOVE" && item.inHall && !item.hiddenFromHall;
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
    giverName: settings.giverShown ? item.giverName : null,
    receivedYear: item.receivedAt ? String(item.receivedAt.getUTCFullYear()) : null,
    price: shown.price,
    currency: shown.price === null ? null : (item.currency ?? "RUB"),
    rounded: shown.rounded,
    priceAudience: hallItemPriceHidden(item.priceVisibility)
      ? "ITEM"
      : settings.priceVisibility,
    hiddenFromObservers: item.hiddenFromHall,
  };
}
