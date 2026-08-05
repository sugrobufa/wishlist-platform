// Сводка по зоне (тикет 34) — то, что человек узнаёт о зоне, НЕ входя в неё:
// сколько вещей, сколько из них ждут подарка, три миниатюры, вилка цен, марки.
// Сериализация живёт здесь, а не в компоненте (CLAUDE.md → DTO-слой), потому
// что вся ценность этого файла — правила утечки, и все они проверяются тестом
// (tests/zone-summary.dto.test.ts).
//
// ПРАВИЛА АГРЕГАТОВ (ответ дизайна, handoff/answers-04.md → «Агрегаты цен и
// марок»). Три условия, и все три обязательны:
//   1. считать только по «хочу», чью цену ЭТОТ зритель имеет право видеть;
//   2. не показывать вилку цен, если таких вещей меньше трёх;
//   3. не показывать марки, если РАЗЛИЧНЫХ марок меньше трёх.
// Третье не косметика: одна марка при двух вещах в зоне — это адрес конкретной
// вещи, и правило про цены без правила про марки не работает.
// Вещь «люблю» в агрегат не входит НИКОГДА, даже если её цена открыта: она уже
// подарена, её незачем оценивать (и инвариант №8 — цена «люблю» не
// показывается никому; в обеих формах DTO вещи у LOVE ключей price/currency
// нет в принципе, так что «только по хочу» здесь не проверка, а следствие).
//
// СЧЁТЧИКИ (та же записка, таблица «142 желания · 19 в подарок»):
//   всего вещей     — хозяйке и гостю;
//   помечено «хочу» — хозяйке и гостю, разными словами («в подарок» /
//                     «можно подарить»): это про желания, а не про брони;
//   СКОЛЬКО ЗАБРАЛИ — НИКОГДА и никому, кроме шапки комнаты хозяйки.
// Поэтому ключа про брони в этой форме не существует вовсе — ни в какой её
// разновидности. Хозяйке про брони по-прежнему видно ровно одно число ПО
// КОМНАТЕ (services/bookings → ownerTakenCount), и сюда оно не приезжает:
// сводка по зоне — самый удобный способ превратить «N вещей уже забрали» в
// «забрали ВОТ ЭТУ», а тихая бронь (инвариант №1) обещает обратное.
//
// СПРЯТАННЫЕ ВЕЩИ (инвариант №5) не входят никуда: ни в счётчики, ни в
// миниатюры, ни в агрегаты. Гостю спрятанное не доезжает ещё из сервиса
// (guest-room.ts), у хозяйки оно в списке есть — фильтр стоит здесь и работает
// на обе формы.
//
// Демо-призраки в сводку не входят: они помечены «пример» в самой сетке, а в
// карточке сводки такой пометки нет — числа и вилка цен по выдуманным вещам
// читались бы как настоящие. Зона без единой своей вещи честно пуста.
import type { Item } from "@prisma/client";
import { itemForGuest, type GuestItemDto } from "@/server/dto/guest-items";
import { itemForOwner, type OwnerItemDto } from "@/server/dto/items";

/** Сколько миниатюр помещается в карточку (макет 17a: три и плитка «ещё»). */
export const ZONE_SUMMARY_THUMBS = 3;

/** Меньше трёх видимых цен — вилки нет вовсе. */
export const ZONE_SUMMARY_PRICE_MIN = 3;

/** Меньше трёх РАЗЛИЧНЫХ марок — марок нет вовсе. */
export const ZONE_SUMMARY_BRANDS_MIN = 3;

/**
 * Миниатюра: фотография и состояние. Состояние нужно, потому что пунктир
 * кодирует «хочу», а не отсутствие фото (инвариант №3) — тот же классификатор,
 * что у плитки (components/zone/tile-appearance.ts).
 */
export type ZoneSummaryThumbDto = {
  photoUrl: string | null;
  /** «Хочу» — пунктирный контур и полоса акцентом; «люблю» — ровная плитка. */
  want: boolean;
};

/** Вилка цен: деньги строкой Decimal, валюта отдельным полем (CLAUDE.md). */
export type ZoneSummaryPriceDto = {
  low: string;
  high: string;
  /** ISO 4217. */
  currency: string;
};

/**
 * Сводка зоны. Форма ОДНА на хозяйку и гостя, и это осознанно: разница между
 * ними не в наборе ключей сводки, а в том, какие вещи в неё приехали — цену,
 * которую зритель видеть не вправе, форма вещи (dto/guest-items.ts) отрезала
 * ещё до нас. Ключа про брони нет ни в одной разновидности — см. шапку файла.
 */
export type ZoneSummaryDto = {
  /** Ключ зоны из zones.json. */
  zone: string;
  /** Всего вещей — без спрятанных и без демо-призраков. */
  count: number;
  /** Сколько из них помечено «хочу». Про брони не говорит ничего. */
  wantCount: number;
  /** До трёх миниатюр в порядке сетки зоны. */
  thumbs: ZoneSummaryThumbDto[];
  /** Сколько вещей осталось за миниатюрами (плитка «ещё N»); 0 — плитки нет. */
  more: number;
  /** Ключа нет вовсе, пока видимых цен меньше трёх. */
  price?: ZoneSummaryPriceDto;
  /** Ключа нет вовсе, пока различных марок меньше трёх. */
  brands?: string[];
};

/**
 * Общий знаменатель обеих форм вещи. `hidden` необязателен намеренно: у гостя
 * такого ключа не существует, и его отсутствие означает «не спрятана» —
 * спрятанное до гостя не доезжает (guest-room.ts).
 *
 * `brand` — единственное поле сверх формы вещи. Марки в самой вещи нет: в
 * модели есть только `Item.domain` (адрес магазина, откуда вещь приехала по
 * ссылке), и вызывающая сторона подставляет его сюда. Наружу поштучно он не
 * уходит ни в одной форме — только агрегатом и только по правилу трёх.
 */
type SummarySource = {
  state: "LOVE" | "WANT";
  photoUrl: string | null;
  isDemo: boolean;
  hidden?: boolean;
  /** Ключ есть, только если ЭТОТ зритель имеет право видеть цену. */
  price?: string | null;
  currency?: string | null;
  /** Домен магазина вещи (`Item.domain`) — сырьё для марок. */
  brand?: string | null;
};

/** Вещь плюс марка: то, что сводка принимает на вход от вызывающей стороны. */
export type OwnerSummaryItem = OwnerItemDto & { brand?: string | null };
export type GuestSummaryItem = GuestItemDto & { brand?: string | null };

/**
 * Вещь из БД → вход сводки хозяйки. Форма вещи берётся готовой (itemForOwner),
 * сверху — только домен магазина: сериализация вещи остаётся в одном месте,
 * а сводка не начинает читать поля Item сама.
 */
export function ownerSummaryItem(item: Item): OwnerSummaryItem {
  return { ...itemForOwner(item), brand: item.domain };
}

/** То же для гостя: цену отрежет itemForGuest, если гостю её видеть нельзя. */
export function guestSummaryItem(item: Item): GuestSummaryItem {
  return { ...itemForGuest(item), brand: item.domain };
}

/** Десятичная строка денег: «14900», «14900.50»; отрицательных цен не бывает. */
const MONEY = /^\d+(\.\d+)?$/;

/** Хвосты доменов, которые сами по себе марку не называют. */
const DOMAIN_TAIL = new Set(["co", "com", "net", "org", "shop", "store"]);

/**
 * Сравнение денег без float (CLAUDE.md: деньги — Decimal, никогда float).
 * Сначала длина целой части, потом посимвольно; дробные части выравниваются
 * нулями. Number() здесь был бы точен на наших порядках, но у правила про float
 * нет исключения «когда точно влезет» — иначе оно перестаёт работать.
 */
function compareMoney(a: string, b: string): number {
  const [aInt = "0", aFrac = ""] = a.split(".");
  const [bInt = "0", bFrac = ""] = b.split(".");
  const left = aInt.replace(/^0+(?=\d)/, "");
  const right = bInt.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length - right.length;
  if (left !== right) return left < right ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const aPad = aFrac.padEnd(width, "0");
  const bPad = bFrac.padEnd(width, "0");
  if (aPad === bPad) return 0;
  return aPad < bPad ? -1 : 1;
}

/**
 * Марка из домена: «www.atelier-perle.fr» → «Atelier-perle»,
 * «shop.nike.com» → «Nike». Настоящего поля марки в модели вещи нет, и пока
 * его нет, ближайшая честная замена — имя магазина, из которого вещь приехала.
 */
export function brandFromDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const parts = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter((part) => part !== "");
  if (parts.length === 0) return null;
  // Домен верхнего уровня марку не называет — он всегда последний.
  if (parts.length > 1) parts.pop();
  // …как и «co» в co.uk или «shop» в shop.nike.com.
  while (parts.length > 1) {
    const tail = parts[parts.length - 1];
    if (tail === undefined || !DOMAIN_TAIL.has(tail)) break;
    parts.pop();
  }
  const name = parts[parts.length - 1];
  if (name === undefined || name === "") return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Вещи, по которым СЧИТАЮТСЯ ОБА агрегата: «хочу» + ключ price ПРИСУТСТВУЕТ.
 * Ровно в этом ключе и живёт разница между хозяйкой и гостем — форма вещи уже
 * решила её за нас (тикет 07): у гостя при priceVisibility ME/NONE ключа нет,
 * у «люблю» его нет ни у кого. Второй раз ту же развилку мы не изобретаем.
 */
function priced(
  items: readonly SummarySource[],
): Array<{ value: string; currency: string; brand: string | null }> {
  const rows: Array<{ value: string; currency: string; brand: string | null }> = [];
  for (const item of items) {
    if (item.state !== "WANT") continue;
    if (!("price" in item)) continue;
    const value = item.price;
    const currency = item.currency;
    if (typeof value !== "string" || !MONEY.test(value)) continue;
    if (typeof currency !== "string" || currency === "") continue;
    rows.push({ value, currency, brand: brandFromDomain(item.brand) });
  }
  return rows;
}

/**
 * Вилка цен зоны или `undefined`. Валюты не смешиваем: вилка строится по самой
 * частой валюте зоны, и порог в три вещи считается уже внутри неё — иначе три
 * вещи в трёх разных валютах давали бы «вилку» из двух чисел про разные деньги.
 */
function priceRange(
  rows: ReadonlyArray<{ value: string; currency: string }>,
): ZoneSummaryPriceDto | undefined {
  if (rows.length < ZONE_SUMMARY_PRICE_MIN) return undefined;

  const byCurrency = new Map<string, string[]>();
  for (const { value, currency } of rows) {
    const bucket = byCurrency.get(currency);
    if (bucket) bucket.push(value);
    else byCurrency.set(currency, [value]);
  }

  // Самая частая валюта; при равенстве — меньшая по коду, чтобы выдача не
  // зависела от порядка вещей в зоне.
  let currency = "";
  let values: string[] = [];
  for (const [code, bucket] of byCurrency) {
    if (bucket.length > values.length || (bucket.length === values.length && code < currency)) {
      currency = code;
      values = bucket;
    }
  }
  if (values.length < ZONE_SUMMARY_PRICE_MIN) return undefined;

  const sorted = [...values].sort(compareMoney);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (low === undefined || high === undefined) return undefined;
  return { low, high, currency };
}

/** Марки зоны или `undefined`: меньше трёх РАЗЛИЧНЫХ — не показываем ни одной. */
function brandList(rows: ReadonlyArray<{ brand: string | null }>): string[] | undefined {
  const names = new Set<string>();
  for (const { brand } of rows) {
    if (brand) names.add(brand);
  }
  if (names.size < ZONE_SUMMARY_BRANDS_MIN) return undefined;
  return [...names].sort((a, b) => a.localeCompare(b, "ru"));
}

/** Сводка пустой зоны: форма та же, числа нулевые. */
export function emptyZoneSummary(zoneKey: string): ZoneSummaryDto {
  return { zone: zoneKey, count: 0, wantCount: 0, thumbs: [], more: 0 };
}

/** Общее тело: все правила живут здесь, поэтому они одни на хозяйку и гостя. */
function summarize(zoneKey: string, items: readonly SummarySource[]): ZoneSummaryDto {
  // Спрятанное и примеры — вон, до всех подсчётов.
  const visible = items.filter((item) => item.hidden !== true && !item.isDemo);

  const thumbs = visible.slice(0, ZONE_SUMMARY_THUMBS).map((item) => ({
    photoUrl: item.photoUrl,
    want: item.state === "WANT",
  }));

  const summary: ZoneSummaryDto = {
    zone: zoneKey,
    count: visible.length,
    wantCount: visible.filter((item) => item.state === "WANT").length,
    thumbs,
    more: Math.max(0, visible.length - thumbs.length),
  };

  const rows = priced(visible);
  const price = priceRange(rows);
  if (price) summary.price = price;
  const brands = brandList(rows);
  if (brands) summary.brands = brands;
  return summary;
}

/** Сводка зоны для хозяйки: её собственные цены видны ей все. */
export function zoneSummaryForOwner(
  zoneKey: string,
  items: readonly OwnerSummaryItem[],
): ZoneSummaryDto {
  return summarize(zoneKey, items);
}

/**
 * Сводка зоны для гостя: в агрегаты попадут только те цены, которые форма
 * вещи гостю отдала (priceVisibility ALL | FRIENDS).
 */
export function zoneSummaryForGuest(
  zoneKey: string,
  items: readonly GuestSummaryItem[],
): ZoneSummaryDto {
  return summarize(zoneKey, items);
}
