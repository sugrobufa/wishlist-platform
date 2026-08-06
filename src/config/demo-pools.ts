// Демо-призраки первого входа (решение гриллинга №4): курируемый набор
// демо-вещей по ключам пулов zones.json/rooms.json. Названия и цены — по
// пулам макета (Main Screen.dc.html → POOL), состояния сбалансированы
// «люблю»/«хочу», чтобы новичок увидел язык комнаты целиком: плотная плитка,
// пунктирный контур, серая заливка без фото, подпись дарителя.
//
// В БД демо-призраки НЕ пишутся: генерируются на лету, показываются только
// пока в зоне нет ни одной своей вещи (монтаж — src/app/room). Фото — только
// предметные кадры дизайн-пакета p-*.jpg через roomImageUrl; у части вещей
// фото нет намеренно — плитка честно рисует серую заливку.
import type { OwnerItemDto, OwnerLoveItemDto, OwnerWantItemDto } from "@/server/dto/items";
import { roomImageUrl } from "@/app/rooms/room-image";

type DemoSeed =
  | {
      state: "LOVE";
      title: string;
      /** Путь пакета вида "refs/p-vinyl.jpg"; без него — серая заливка. */
      photo?: string;
      giverName?: string;
      /** Год «Подарен в {год}»; сериализуется серединой года (без сдвига в чужих таймзонах). */
      receivedYear?: number;
    }
  | { state: "WANT"; title: string; photo?: string; priceRub: number };

const LOVE = (title: string, photo?: string, giverName?: string, receivedYear?: number) =>
  ({ state: "LOVE", title, photo, giverName, receivedYear }) satisfies DemoSeed;
const WANT = (title: string, priceRub: number, photo?: string) =>
  ({ state: "WANT", title, priceRub, photo }) satisfies DemoSeed;

/**
 * Все 19 ключей пулов из items.json → demoPools.poolKeys (и zones.json).
 * Девятнадцатый (`grooming`) приехал раундом 8 (тикет 53): до него зона «Уход»
 * в четырёх мужских комнатах смотрела в `perfume` и показывала «Свечу с
 * инжиром» и «Диффузор для дома».
 */
export const demoPools: Record<string, readonly DemoSeed[]> = {
  fashionF: [
    LOVE("Кашемировый джемпер", "refs/p-cashmere.jpg"),
    LOVE("Шёлковый платок"),
    WANT("Пальто-халат", 39_000, "refs/p-cottage.jpg"),
    WANT("Слип-платье", 8_700),
  ],
  fashionM: [
    LOVE("Кашемировый свитер", "refs/p-cashmere.jpg"),
    LOVE("Ботинки челси", "refs/p-runners.jpg"),
    WANT("Шерстяное пальто", 46_000),
    WANT("Льняная рубашка", 7_900),
  ],
  jewel: [
    LOVE("Теннисный браслет", "refs/p-lux.jpg", "мама", 2024),
    LOVE("Цепочка", "refs/p-cream.jpg"),
    WANT("Колье с жемчугом", 48_000, "refs/p-emerald.jpg"),
    WANT("Серьги-кольца", 7_900, "refs/p-earrings.jpg"),
    WANT("Кольцо с топазом", 14_200),
  ],
  beauty: [
    LOVE("Ночной крем", "refs/p-cream.jpg"),
    LOVE("Набор кистей", "refs/p-emerald.jpg"),
    WANT("Сыворотка", 4_300, "refs/p-serum.jpg"),
    WANT("Крем для рук", 1_200),
    WANT("Палетка теней", 6_100, "refs/p-cottage.jpg"),
  ],
  perfume: [
    LOVE("Парфюм Nº7", "refs/p-warm.jpg"),
    LOVE("Свеча с инжиром"),
    WANT("Дорожный флакон", 5_200),
    WANT("Диффузор для дома", 7_600),
  ],
  // Пул дизайна (ОТВЕТ-раунд-8 §4), два «люблю» намеренно: «в пуле должно быть
  // видно оба состояния». Предметных кадров мужского ухода в пакете нет —
  // все пять честно без фото (серая заливка, а не чужая картинка).
  grooming: [
    WANT("Станок и лезвия", 6_400),
    WANT("Триммер для бороды", 11_900),
    LOVE("Масло для бороды"),
    WANT("Кожаный несессер", 9_200),
    LOVE("Одеколон, 100 мл"),
  ],
  bags: [
    LOVE("Тоут из кожи", "refs/p-tote.jpg"),
    LOVE("Плетёная корзинка"),
    WANT("Стёганая сумка", 62_000, "refs/p-bag.jpg"),
    WANT("Клатч к вечернему", 19_000),
  ],
  tech: [
    LOVE("Умные часы", "refs/p-watch.jpg"),
    LOVE("Механическая клавиатура"),
    WANT("Наушники с шумодавом", 34_900, "refs/p-headphones.jpg"),
    WANT("Экшн-камера", 41_000),
  ],
  watches: [
    LOVE("Дайвер, механика", "refs/p-watch.jpg", "папа", 2023),
    LOVE("Полевые часы"),
    WANT("Хронограф", 140_000),
    WANT("Подставка для часов", 6_000),
  ],
  music: [
    LOVE("Пластинка Coltrane — Blue Train", "refs/p-vinyl.jpg"),
    LOVE("Наушники открытые", "refs/p-headphones.jpg"),
    WANT("Стойка для пластинок", 18_000),
    WANT("Винил Nina Simone — первопресс", 12_000),
    WANT("Второй динамик", 46_000),
  ],
  sneakers: [
    LOVE("Ретро-раннеры", "refs/p-runners.jpg"),
    LOVE("Городской рюкзак"),
    WANT("Платформы", 11_400, "refs/p-bold.jpg"),
    WANT("Высокие кеды", 14_900),
  ],
  sport: [
    LOVE("Беговые кроссовки", "refs/p-runners.jpg"),
    LOVE("Коврик для йоги"),
    WANT("Гантели 12 кг", 11_000),
    WANT("Фитнес-браслет", 16_000),
  ],
  gaming: [
    LOVE("Ретро-приставка"),
    LOVE("Второй геймпад"),
    WANT("Игра года", 5_400),
    WANT("Игровое кресло", 54_000),
  ],
  books: [
    LOVE("Монография о свете"),
    LOVE("Сборник рассказов Довлатова"),
    WANT("Лампа для чтения", 9_600),
    WANT("Подписка на книги", 1_900),
  ],
  events: [
    LOVE("Абонемент в филармонию"),
    LOVE("Карта музеев"),
    WANT("Билеты в оперу", 9_400),
    WANT("Фотосессия", 18_000),
  ],
  travel: [
    LOVE("Чемодан 55 см"),
    LOVE("Дорожная подушка"),
    WANT("Три дня в Тбилиси", 34_000),
    WANT("Поход в Дагестан", 48_000),
  ],
  home: [
    LOVE("Керамика ручной работы", "refs/p-ceramic.jpg"),
    LOVE("Плед крупной вязки"),
    WANT("Постель из льна", 18_000),
    WANT("Свечи для ужина", 3_400),
  ],
  anything: [
    LOVE("Ваза с букетом", "refs/p-cottage.jpg"),
    LOVE("Настольная игра"),
    WANT("Сертификат в гончарную мастерскую", 7_000),
    WANT("Подписка на кофе", 3_600),
  ],
  flowers: [
    LOVE("Букет пионов", "refs/p-cottage.jpg"),
    LOVE("Орхидея"),
    WANT("Подписка на цветы", 4_200),
    WANT("Ваза для букетов", 6_800),
  ],
};

/** Демо-призрак — та же форма, что owner-DTO, но isDemo: true. */
export type DemoGhostDto = OwnerItemDto & { isDemo: true };

/** Дата «появления» призрака — фиксированная (см. комментарий в demoGhostsFor). */
const DEMO_CREATED_AT = "2026-01-01T12:00:00.000Z";

/**
 * Демо-призраки зоны: DTO-совместимые объекты с isDemo: true. Пометку
 * «пример — замени на своё» и бейдж «пример» рисует плитка по isDemo
 * (строки — messages, ns ZoneGrid). Не бронируются, в БД не пишутся,
 * показываются только пока у зоны нет ни одной своей вещи.
 *
 * Незнакомый ключ пула — не исключение, а пустой список: контракт живёт
 * отдельно от кода и приезжает раньше него. Раунд 2 привёз зону `money`
 * с пулом `money`, которого в пакете нет; содержимое такого пула мы не
 * выдумываем — это вопрос к дизайну (ADR-0003). Проверка `hasOwn` вместо
 * `?? []` нужна, чтобы ключи прототипа (`constructor`, `toString`) не
 * пролезали как «найденный пул».
 */
export function demoGhostsFor(zoneKey: string, poolKey: string): DemoGhostDto[] {
  const seeds = (Object.hasOwn(demoPools, poolKey) ? demoPools[poolKey] : undefined) ?? [];
  return seeds.map((seed, index) => {
    const base = {
      id: `demo:${zoneKey}:${index}`,
      zone: zoneKey,
      title: seed.title,
      note: null,
      photoUrl: seed.photo ? roomImageUrl(seed.photo) : null,
      hidden: false,
      isDemo: true as const,
      // «В комнате с» у призрака смысла не имеет: он не в БД и карточки у
      // него нет. Дата постоянная — иначе один и тот же призрак приезжал бы
      // разным при каждом рендере (SSR и клиент разошлись бы).
      createdAt: DEMO_CREATED_AT,
    };

    if (seed.state === "WANT") {
      const want: OwnerWantItemDto & { isDemo: true } = {
        ...base,
        state: "WANT",
        price: String(seed.priceRub),
        currency: "RUB",
        priceVisibility: "ALL",
        size: null,
        color: null,
        desire: null,
      };
      return want;
    }

    const love: OwnerLoveItemDto & { isDemo: true } = {
      ...base,
      state: "LOVE",
      giverName: seed.giverName ?? null,
      // Середина года: год не «уезжает» при переводе в локальное время.
      receivedAt: seed.receivedYear ? `${seed.receivedYear}-06-15T12:00:00.000Z` : null,
      inHall: false,
    };
    return love;
  });
}
