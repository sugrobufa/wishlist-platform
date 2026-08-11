// Курируемый набор демо-вещей по ключам пулов zones.json/rooms.json. Названия
// и цены — по пулам макета (Main Screen.dc.html → POOL).
//
// СОСТОЯНИЙ У ВЕЩИ БОЛЬШЕ НЕТ (тикет 124). Раньше пулы делились на «люблю» и
// «хочу», чтобы новичок увидел оба знака языка комнаты; теперь семя говорит о
// МЕСТЕ: `MINE(...)` — вещь, которая уже своя (посев стенда уводит её в
// сокровищницу), `WISH(...)` — желание с ценой. Содержимое пулов — вопрос
// отдельного захода (демо-наборы и посев стенда), здесь только форма.
//
// ЭТО БОЛЬШЕ НЕ СТАРТОВЫЙ НАБОР И БОЛЬШЕ НЕ НАБОР СТЕНДА. С тикета 136 зёрна
// «начни с готового» приезжают КОНТРАКТОМ ДИЗАЙНА (`handoff/seeds/seeds.json`,
// 19 пулов по 5 желаний), а с тикета 175 тем же контрактом сеется и комната
// стенда: читает их `src/server/services/pack-seeds.ts`. Отсюда посев берёт
// РОВНО ОДНО — зёрна `MINE(...)`: витрине сокровищницы нужны вещи с дарителем
// и годом, а такого зерна в контракте нет и быть не должно (живому человеку
// имя дарителя достаётся только через «Дошло», инвариант №2). Зёрна `WISH(...)`
// посев больше не берёт — их читают только призраки (форма owner-DTO, показ
// снят тикетом 104). Новые желания — в контракт, не сюда.
//
// В БД призраки НЕ пишутся: генерируются на лету. Показ призраков снят
// тикетом 104; сам набор остался — в комнату из него попадают только зёрна
// `MINE(...)`, и только на стенде (тикет 61). Фото — только предметные кадры
// дизайн-пакета p-*.jpg через roomImageUrl; у части вещей фото нет намеренно —
// плитка честно рисует серую заливку.
import type { OwnerItemDto, OwnerRoomItemDto } from "@/server/dto/items";
import { roomImageUrl } from "@/app/rooms/room-image";

type DemoSeed =
  | {
      /** Вещь уже своя: на стенде уезжает в сокровищницу. */
      mine: true;
      title: string;
      /** Путь пакета вида "refs/p-vinyl.jpg"; без него — серая заливка. */
      photo?: string;
      giverName?: string;
      /** Год «Подарен в {год}»; сериализуется серединой года (без сдвига в чужих таймзонах). */
      receivedYear?: number;
    }
  | { mine: false; title: string; photo?: string; priceRub: number };

const MINE = (title: string, photo?: string, giverName?: string, receivedYear?: number) =>
  ({ mine: true, title, photo, giverName, receivedYear }) satisfies DemoSeed;
const WISH = (title: string, priceRub: number, photo?: string) =>
  ({ mine: false, title, priceRub, photo }) satisfies DemoSeed;

/**
 * Все 19 ключей пулов из items.json → demoPools.poolKeys (и zones.json).
 * Девятнадцатый (`grooming`) приехал раундом 8 (тикет 53): до него зона «Уход»
 * в четырёх мужских комнатах смотрела в `perfume` и показывала «Свечу с
 * инжиром» и «Диффузор для дома».
 */
export const demoPools: Record<string, readonly DemoSeed[]> = {
  fashionF: [
    MINE("Кашемировый джемпер", "refs/p-cashmere.jpg"),
    MINE("Шёлковый платок"),
    WISH("Пальто-халат", 39_000, "refs/p-cottage.jpg"),
    WISH("Слип-платье", 8_700),
  ],
  fashionM: [
    MINE("Кашемировый свитер", "refs/p-cashmere.jpg"),
    MINE("Ботинки челси", "refs/p-runners.jpg"),
    WISH("Шерстяное пальто", 46_000),
    WISH("Льняная рубашка", 7_900),
  ],
  jewel: [
    MINE("Теннисный браслет", "refs/p-lux.jpg", "мама", 2024),
    MINE("Цепочка", "refs/p-cream.jpg"),
    WISH("Колье с жемчугом", 48_000, "refs/p-emerald.jpg"),
    WISH("Серьги-кольца", 7_900, "refs/p-earrings.jpg"),
    WISH("Кольцо с топазом", 14_200),
  ],
  beauty: [
    MINE("Ночной крем", "refs/p-cream.jpg"),
    MINE("Набор кистей", "refs/p-emerald.jpg"),
    WISH("Сыворотка", 4_300, "refs/p-serum.jpg"),
    WISH("Крем для рук", 1_200),
    WISH("Палетка теней", 6_100, "refs/p-cottage.jpg"),
  ],
  perfume: [
    MINE("Парфюм Nº7", "refs/p-warm.jpg"),
    MINE("Свеча с инжиром"),
    WISH("Дорожный флакон", 5_200),
    WISH("Диффузор для дома", 7_600),
  ],
  // Пул дизайна (ОТВЕТ-раунд-8 §4). Два семени «уже своё» стояли здесь ради
  // прежних двух состояний; после тикета 124 они просто вещи без цены и
  // содержимое пула — вопрос захода про демо-наборы. Кадров мужского ухода в
  // пакете нет — все пять честно без фото (серая заливка, а не чужая картинка).
  grooming: [
    WISH("Станок и лезвия", 6_400, "refs/p-razor.jpg"),
    WISH("Триммер для бороды", 11_900, "refs/p-trimmer.jpg"),
    MINE("Масло для бороды", "refs/p-beard-oil.jpg"),
    WISH("Кожаный несессер", 9_200, "refs/p-dopp.jpg"),
    MINE("Одеколон, 100 мл", "refs/p-cologne.jpg"),
  ],
  bags: [
    MINE("Тоут из кожи", "refs/p-tote.jpg"),
    MINE("Плетёная корзинка"),
    WISH("Стёганая сумка", 62_000, "refs/p-bag.jpg"),
    WISH("Клатч к вечернему", 19_000),
  ],
  tech: [
    MINE("Умные часы", "refs/p-watch.jpg"),
    MINE("Механическая клавиатура"),
    WISH("Наушники с шумодавом", 34_900, "refs/p-headphones.jpg"),
    WISH("Экшн-камера", 41_000),
  ],
  watches: [
    MINE("Дайвер, механика", "refs/p-watch.jpg", "папа", 2023),
    MINE("Полевые часы"),
    WISH("Хронограф", 140_000),
    WISH("Подставка для часов", 6_000),
  ],
  music: [
    MINE("Пластинка Coltrane — Blue Train", "refs/p-vinyl.jpg"),
    MINE("Наушники открытые", "refs/p-headphones.jpg"),
    WISH("Стойка для пластинок", 18_000),
    WISH("Винил Nina Simone — первопресс", 12_000),
    WISH("Второй динамик", 46_000),
  ],
  sneakers: [
    MINE("Ретро-раннеры", "refs/p-runners.jpg"),
    MINE("Городской рюкзак"),
    WISH("Платформы", 11_400, "refs/p-bold.jpg"),
    WISH("Высокие кеды", 14_900),
  ],
  sport: [
    MINE("Беговые кроссовки", "refs/p-runners.jpg"),
    MINE("Коврик для йоги"),
    WISH("Гантели 12 кг", 11_000),
    WISH("Фитнес-браслет", 16_000),
  ],
  gaming: [
    MINE("Ретро-приставка", "refs/p-console.jpg"),
    MINE("Второй геймпад", "refs/p-gamepad.jpg"),
    WISH("Игра года", 5_400, "refs/p-game-box.jpg"),
    WISH("Игровое кресло", 54_000, "refs/p-gaming-chair.jpg"),
  ],
  books: [
    MINE("Монография о свете", "refs/p-artbook.jpg"),
    MINE("Сборник рассказов Довлатова", "refs/p-paperback.jpg"),
    WISH("Лампа для чтения", 9_600, "refs/p-reading-lamp.jpg"),
    WISH("Подписка на книги", 1_900, "refs/p-book-sub.jpg"),
  ],
  // Шесть впечатлений сняты СИМВОЛОМ, а не событием (задание 09): плитка
  // 160 px, на ней читается один предмет. Конверт с сургучом вместо пейзажа
  // Тбилиси, тиснёный лавр вместо зала филармонии, камера вместо съёмки.
  events: [
    MINE("Абонемент в филармонию", "refs/p-philharmonic.jpg"),
    MINE("Карта музеев", "refs/p-museum-card.jpg"),
    WISH("Билеты в оперу", 9_400, "refs/p-opera-tickets.jpg"),
    WISH("Фотосессия", 18_000, "refs/p-photoshoot.jpg"),
  ],
  travel: [
    MINE("Чемодан 55 см", "refs/p-suitcase.jpg"),
    MINE("Дорожная подушка", "refs/p-travel-pillow.jpg"),
    WISH("Три дня в Тбилиси", 34_000, "refs/p-tbilisi.jpg"),
    WISH("Поход в Дагестан", 48_000, "refs/p-hike.jpg"),
  ],
  home: [
    MINE("Керамика ручной работы", "refs/p-ceramic.jpg"),
    MINE("Плед крупной вязки"),
    WISH("Постель из льна", 18_000),
    WISH("Свечи для ужина", 3_400),
  ],
  anything: [
    MINE("Ваза с букетом", "refs/p-cottage.jpg"),
    MINE("Настольная игра"),
    WISH("Сертификат в гончарную мастерскую", 7_000),
    WISH("Подписка на кофе", 3_600),
  ],
  flowers: [
    MINE("Букет пионов", "refs/p-cottage.jpg"),
    MINE("Орхидея"),
    WISH("Подписка на цветы", 4_200),
    WISH("Ваза для букетов", 6_800),
  ],
};

/** Демо-призрак — та же форма, что owner-DTO, но isDemo: true. */
export type DemoGhostDto = OwnerItemDto & { isDemo: true };

/**
 * Примеры с фотографией — вперёд, внутри групп порядок пула сохраняется
 * (тикет 68). Предметных кадров в пакете 15 на 19 пулов, и без сортировки
 * зона нередко открывалась заглушкой в первой же плитке.
 *
 * ПОРЯДОК ПУЛА ТУТ НЕ ПЕРЕПИСЫВАЕТСЯ: сортируется копия, сами массивы
 * `demoPools` остаются как объявлены — по ним же идёт посев стенда
 * (services/stand-seed), и менять ему порядок создания вещей незачем.
 * Сортировка устойчивая (`Array.prototype.sort` таким и обязан быть), значит
 * порядок внутри групп по-прежнему такой, как задумано пулом.
 */
function orderByPhotoFirst(seeds: readonly DemoSeed[]): DemoSeed[] {
  return [...seeds].sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)));
}

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
  return orderByPhotoFirst(seeds).map((seed, index) => {
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

    if (!seed.mine) {
      const wish: OwnerRoomItemDto & { isDemo: true } = {
        ...base,
        inHall: false,
        price: String(seed.priceRub),
        currency: "RUB",
        priceVisibility: "ALL",
        size: null,
        color: null,
        desire: null,
        // Магазина у призрака нет и быть не может: он выдуман, адреса у него
        // нет — та же причина, по которой у него нет ключа `shop` в гостевой
        // форме. «Где купить» на нём не рисуется.
        shop: null,
        eventWhen: null,
        eventWhere: null,
        validUntil: null,
      };
      return wish;
    }

    // Призрак «уже своей» вещи показывается В ЗОНЕ, а не на витрине: он
    // никуда не переезжает и в БД не живёт. Поэтому форма — вещь комнаты без
    // цены, а не витринная (тикет 124).
    const mine: OwnerRoomItemDto & { isDemo: true } = {
      ...base,
      inHall: false,
      price: null,
      currency: null,
      priceVisibility: "ALL",
      size: null,
      color: null,
      desire: null,
      shop: null,
      eventWhen: null,
      eventWhere: null,
      validUntil: null,
    };
    return mine;
  });
}
