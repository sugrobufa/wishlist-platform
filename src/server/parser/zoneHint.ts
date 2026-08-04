// Эвристика зоны комнаты по ключам design/package/handoff/zones.json:
// хлебные крошки → путь URL → заголовок. Это ПОДСКАЗКА с confidence,
// не истина — пользователь подтверждает зону в карточке (ARCHITECTURE §12).

import zonesJson from "@design/zones.json";

const ZONE_KEYS = new Set(Object.keys((zonesJson as { keys: Record<string, unknown> }).keys));

export interface ZoneHint {
  /** Ключ зоны из zones.json (books, fashion, perfume, tech, …). */
  zone: string;
  /** 0..1 — сила совпадения (крошки > URL > заголовок). */
  confidence: number;
}

export interface ZoneHintInput {
  /** Нормализованный URL — сканируется путь. */
  url?: string;
  title?: string;
  breadcrumbs?: string[];
}

/**
 * Словарь «стем → зона». Порядок важен: более специфичные стемы выше
 * (кроссовки — обувь, а не спорт; наушники — tech, по решению тикета).
 * Все стемы сверяются подстрокой по нижнему регистру.
 */
const STEM_RULES: ReadonlyArray<readonly [string, string]> = [
  // книги
  ["книг", "books"],
  ["литератур", "books"],
  ["издательств", "books"],
  ["book", "books"],
  ["knig", "books"], // translit для URL-путей
  // парфюм — раньше beauty, чтобы «аромат» не утёк в косметику
  ["парфюм", "perfume"],
  ["аромат", "perfume"],
  ["духи", "perfume"],
  ["туалетная вода", "perfume"],
  ["парфюмерн", "perfume"],
  ["fragrance", "perfume"],
  ["parfum", "perfume"],
  ["parfyum", "perfume"],
  ["perfume", "perfume"],
  ["dukhi", "perfume"],
  // уход/бритьё (мужской набор) — до beauty
  ["бритв", "grooming"],
  ["бритьё", "grooming"],
  ["бритья", "grooming"],
  ["груминг", "grooming"],
  ["aftershave", "grooming"],
  // красота
  ["косметик", "beauty"],
  ["помад", "beauty"],
  ["тушь", "beauty"],
  ["сыворотк", "beauty"],
  ["шампун", "beauty"],
  ["крем", "beauty"],
  ["макияж", "beauty"],
  ["makeup", "beauty"],
  ["beauty", "beauty"],
  ["kosmetik", "beauty"],
  // украшения и часы
  ["украшен", "jewelry"],
  ["ювелир", "jewelry"],
  ["кольц", "jewelry"],
  ["серьг", "jewelry"],
  ["браслет", "jewelry"],
  ["кулон", "jewelry"],
  ["jewel", "jewelry"],
  ["ukrasheni", "jewelry"],
  ["часы", "watches"],
  ["смарт-час", "watches"],
  ["наручн", "watches"],
  ["watch", "watches"],
  ["chasy", "watches"],
  // сумки
  ["сумк", "bags"],
  ["клатч", "bags"],
  ["портфел", "bags"],
  ["handbag", "bags"],
  // обувь и рюкзаки (зона sneakers)
  ["кроссовк", "sneakers"],
  ["кеды", "sneakers"],
  ["ботин", "sneakers"],
  ["сапог", "sneakers"],
  ["туфл", "sneakers"],
  ["обув", "sneakers"],
  ["рюкзак", "sneakers"],
  ["sneaker", "sneakers"],
  ["obuv", "sneakers"],
  ["krossovk", "sneakers"],
  // одежда
  ["плать", "fashion"],
  ["юбк", "fashion"],
  ["куртк", "fashion"],
  ["пальто", "fashion"],
  ["джинс", "fashion"],
  ["футболк", "fashion"],
  ["рубашк", "fashion"],
  ["свитер", "fashion"],
  ["худи", "fashion"],
  ["брюк", "fashion"],
  ["одежд", "fashion"],
  ["dress", "fashion"],
  ["jacket", "fashion"],
  ["odezhd", "fashion"],
  ["platye", "fashion"],
  ["kurtk", "fashion"],
  // игры — до tech, чтобы «игровая консоль» была gaming
  ["playstation", "gaming"],
  ["xbox", "gaming"],
  ["nintendo", "gaming"],
  ["геймпад", "gaming"],
  ["консол", "gaming"],
  ["видеоигр", "gaming"],
  ["настольная игр", "gaming"],
  ["настольные игр", "gaming"],
  ["игров", "gaming"],
  // техника
  ["наушник", "tech"],
  ["смартфон", "tech"],
  ["ноутбук", "tech"],
  ["планшет", "tech"],
  ["телевизор", "tech"],
  ["гаджет", "tech"],
  ["электроник", "tech"],
  ["компьютер", "tech"],
  ["видеокарт", "tech"],
  ["колонк", "tech"],
  ["iphone", "tech"],
  ["laptop", "tech"],
  ["headphone", "tech"],
  ["smartfon", "tech"],
  ["naushnik", "tech"],
  ["noutbuk", "tech"],
  // музыка
  ["винил", "music"],
  ["пластинк", "music"],
  ["гитар", "music"],
  ["синтезатор", "music"],
  ["музык", "music"],
  ["vinyl", "music"],
  // спорт
  ["гантел", "sport"],
  ["йога", "sport"],
  ["йоги", "sport"],
  ["велосипед", "sport"],
  ["фитнес", "sport"],
  ["тренаж", "sport"],
  ["спорт", "sport"],
  // дом
  ["посуд", "home"],
  ["свеч", "home"],
  ["плед", "home"],
  ["подушк", "home"],
  ["декор", "home"],
  ["интерьер", "home"],
  ["кухон", "home"],
  ["для дома", "home"],
  // впечатления и путешествия
  ["билет", "events"],
  ["концерт", "events"],
  ["сертификат", "events"],
  ["мастер-класс", "events"],
  ["впечатлен", "events"],
  ["чемодан", "travel"],
  ["путешеств", "travel"],
  ["багаж", "travel"],
  // цветы (узкие стемы: «цвет» — это ещё и color)
  ["букет", "flowers"],
  ["цветы", "flowers"],
  ["тюльпан", "flowers"],
  ["пионы", "flowers"],
];

const SOURCE_WEIGHT = { breadcrumbs: 0.8, url: 0.7, title: 0.6 } as const;

function scanText(
  text: string,
  weight: number,
  scores: Map<string, number>,
): void {
  const lower = text.toLowerCase();
  for (const [stem, zone] of STEM_RULES) {
    if (!ZONE_KEYS.has(zone)) continue; // защита от рассинхрона с zones.json
    if (!lower.includes(stem)) continue;
    const previous = scores.get(zone);
    // первый матч даёт вес источника, повторные — небольшой буст
    scores.set(zone, previous === undefined ? weight : Math.min(0.9, previous + 0.05));
  }
}

/** Подсказка зоны. null — «не понял», зону не навязываем. */
export function zoneHintFor(input: ZoneHintInput): ZoneHint | null {
  const scores = new Map<string, number>();

  for (const crumb of input.breadcrumbs ?? []) {
    scanText(crumb, SOURCE_WEIGHT.breadcrumbs, scores);
  }
  if (input.url) {
    try {
      const url = new URL(input.url);
      scanText(decodeURIComponent(url.pathname), SOURCE_WEIGHT.url, scores);
    } catch {
      // не URL — пропускаем источник
    }
  }
  if (input.title) scanText(input.title, SOURCE_WEIGHT.title, scores);

  let bestZone: string | undefined;
  let bestScore = 0;
  for (const [zone, score] of scores) {
    if (score > bestScore) {
      bestZone = zone;
      bestScore = score;
    }
  }
  if (!bestZone) return null;
  return { zone: bestZone, confidence: Math.round(bestScore * 100) / 100 };
}
