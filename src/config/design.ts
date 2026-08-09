// Типизированный доступ к handoff-контрактам дизайн-пакета.
// Значения не копируются в код — импортируются из единственного источника.
import roomsJson from "@design/rooms.json";
import zonesJson from "@design/zones.json";
import motionJson from "@design/motion.json";

export type ZoneRect = { x: number; y: number; w: number; h: number };

export type RoomZone = {
  key: string;
  label: string;
  pool: string;
  rect: ZoneRect;
  /** Кадр «открыто»; null у зон, которым отдельной фотографии не снимали. */
  openFrame?: string | null;
  openVerb?: string | null;
  /**
   * Форма светового пятна метки зоны (пакет раунда 2, tokens.json → zoneMarker):
   * AR — «вытянутость» эллипса в процентах (30…120), Rot — поворот в градусах.
   * Выведены дизайном из w/h; рисует их тикет 23.
   */
  bloomAR: number;
  bloomRot: number;
  /**
   * Как размещён прямоугольник: `"composition"` — по формуле композиции кадра,
   * без замера по картинке (28 зон раунда 2, сверка — тикет 26). Отсутствие
   * поля означает измеренную зону.
   */
  placedBy?: "composition";
  /**
   * МАШИНА: `x + w < 400` в ПРЕЖНЕЙ системе координат — «прямоугольник не попал
   * под обрезку окна 430». И только это: про то, тот ли предмет внутри, флаг не
   * говорит ничего. Раунд 4 переразметки заменил им `verified`, который врал
   * названием (`handoff/coords-fix.md`, поправка в конце).
   */
  notClamped?: boolean;
  /** ЧЕЛОВЕК посмотрел на кадр и подтвердил: предмет тот. 38 зон из 130. */
  eyeChecked?: boolean;
  /** ЧЕЛОВЕК посмотрел и увидел, что предмет НЕ тот. Переразметить обязательно. */
  wrongTarget?: boolean;
  wrongNote?: string;
  /**
   * Предмета нет в интерьере вовсе — зону раскрытием не обеспечить ничем.
   * Восемь зон после осмотра раунда 5. Продукт их прячет, список и причины —
   * `zonesHiddenByProduct`.
   */
  objectAbsent?: boolean;
  absentNote?: string;
  /**
   * Предмет зоны — тот же, что у соседней (туалетный столик на «Красоту» и
   * «Парфюм», пол на «Деньги» и «Что угодно»). Раскрытие можно снять один раз
   * и подставить обеим; в расчётах сцены не участвует.
   */
  sharedObjectWith?: string;
  /** В каком раунде прямоугольник переразмечен: 4 у 35 зон, 5 у 14. */
  remappedRound?: number;
  /** Прежний прямоугольник до переразметки — контракт держит его для сверки. */
  rectOld?: ZoneRect;
  /**
   * «Кадр прошёл НАШ порог приёмки и подключён». Флаг ставит не пакет, а наше
   * измерение (`scripts/check-frames.mjs`, тикет 46): пакеты трёх раундов
   * подряд присылали его расходящимся с собственными данными — раунд 5 оставил
   * `accepted: true` у шести зон без кадра, раунд 7 прислал `accepted: false`
   * у зоны, чей кадр порог прошёл.
   *
   * Поэтому с приёмки 46 снова выполняется `accepted ⟺ openFrame`, и тест
   * `design-contract` это правило сторожит. Сколько зон его несут — считается
   * по файлу, а не по этому комментарию: тикет 46 оставил 30, аудит раскрытий
   * (тикет 49, `identityCheck` в rooms.json) сократил до 7 — подмену предмета
   * и пропажу содержимого порог локальности не ловит, ловят только глаза.
   * Единственный источник истины про раскрытие по-прежнему `openFrame`: код
   * смотрит только на него.
   *
   * СКОЛЬКО ИХ БУДЕТ — ОТКРЫТЫЙ ВОПРОС (ADR-0010). Утром 07.08 съёмка была
   * остановлена на десяти (ADR-0009: «0 из 7» в последней партии), вечером
   * того же дня возобновлена: дизайн прислал 4 честных чемодана от наших баз,
   * и «0 из 7» оказалось следствием съёмки с архивных копий, а не свойством
   * метода. Что бы ни вышло дальше, кадров будет заметное меньшинство от 130 —
   * остальным зонам даёт жизнь отклик светом (тикет 64), и это не затычка.
   */
  accepted?: boolean;
  /**
   * Кадр «открыто» порог не прошёл (openFrame: null). Флаг несут 112 зон;
   * очередью он не является — снимаются только зоны из брифа, по правилу
   * «один цельный предмет с крышкой». Код на него не смотрит вовсе — решает
   * только `openFrame`.
   */
  reshoot?: boolean;
  reshootReason?: string;
  /** В каком раунде снят подключённый кадр. Раунд 7 добавил ровно один. */
  frameRound?: number;
  /**
   * Обратное `notClamped`; контракт оставил ключ «для совместимости» и проставил
   * его лишь у двух зон. В расчётах не участвует — обрезки как явления больше
   * нет, координаты живут в кадре 630 (ADR-0006).
   */
  clamped?: boolean;
};

export type Room = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  base: string;
  /**
   * РОДНОЕ время суток базы — как она снята (раунд 21, турн 32b: дизайн
   * пересмотрел все десять глазами). Дневная только `cottage`; пять сняты
   * в сумерках, четыре ночью.
   *
   * Это не настройка, а свойство фотографии, и от него зависит вся ручка
   * времени суток: родное положение — идентичность, остальные три считаются
   * от него (`transitionTable`). До раунда 21 мы считали дневными все десять
   * и накладывали ночь на ночную базу дважды — `gamer` уходил в 0.095
   * светлоты при 0.183 у самой базы.
   */
  tod: "morning" | "day" | "dusk" | "night";
  /**
   * Светлота интерьера 0…1 (пакет раунда 2). Одно число на комнату решает,
   * чем метка зоны обозначается: светом (тёмная комната) или тенью вокруг
   * предмета (светлая). Формулы весов — tokens.json → zoneMarker.lightnessMix.
   */
  roomLightness: number;
  zones: RoomZone[];
};

type RoomsContract = {
  scene: {
    /**
     * `image` — кадр 630×351 и его место в ТЕЛЕФОННОЙ СЦЕНЕ 430×352: `x: -12`.
     * Прямоугольники зон при этом заданы в координатах САМОГО КАДРА (раунд 4,
     * `note` рядом), поэтому окно телефона показывает кадр с 12 по 442 и ездит
     * по нему, а не обрезает его. Перевод — `zoneRectFor` (ADR-0006).
     */
    phone: {
      w: number;
      h: number;
      image: { w: number; h: number; x: number; y: number };
      note: string;
    };
    desktop: { w: number; h: number; factorFromPhone: number };
  };
  /**
   * Раунд 4 пометил блок УСТАРЕВШИМ и убрал ключ `desktop`: источник истины по
   * масштабу наезда — `motion.json → cameraScale` (формула с потолком 2.05),
   * на неё сцена перешла ещё в тикете 22. Здесь остались `phone: 1.72` и
   * прежний десктопный множитель под именем `desktopLegacy` — как эталон того,
   * от чего ушли; в расчётах сцены не участвуют.
   */
  cameraScale: {
    note: string;
    phone: number;
    desktopLegacy: number;
    desktopCeiling: number;
  };
  hitTargetMin: number;
  /** Словарь флагов зоны словами контракта — читается тестом, не кодом сцены. */
  flags: Record<string, string>;
  /**
   * Итог НАШЕЙ приёмки 130 кадров раунда 7 (тикет 46) — числами, в том же
   * файле, где стоят флаги. Пакет порог не прогонял и прислал 130 кадров
   * «принято»; прошло 12, подключён 1.
   */
  round7: {
    shot: number;
    passedOurThreshold: number;
    connected: number;
    note: string;
    /** Восемь `placeBased`-прямоугольников пакета не применены — почему. */
    rectsNotApplied: string;
    /** Комнаты, чей базовый кадр разошёлся с нынешним сильнее 0.05. */
    roomsSkippedByComposition: string;
  };
  /** Правило, по которому проставлен `accepted`. Читает тест, не код сцены. */
  acceptedRule: string;
  rooms: Room[];
};

export const roomsContract = roomsJson as unknown as RoomsContract;

// ---------- Справочник зон (zones.json) ----------

type ZonesContract = {
  note: string;
  format: string;
  keys: Record<string, [string, string, string, string, string]>;
};

const zonesContract = zonesJson as unknown as ZonesContract;

/**
 * Зона существует для продукта только если она есть в справочнике zones.json:
 * там живут подпись, глагол раскрытия и ключ пула демо-вещей.
 *
 * Раунд 4 дописал единственный ключ, которого не хватало (`money`), так что
 * сейчас справочник покрывает все 130 зон и фильтр никого не отсеивает.
 * Правило оставлено: следующая недостающая запись снова спрячет зону, а не
 * выведет на экран подпись, выдуманную кодом.
 *
 * Решение зафиксировано в docs/adr/0003-design-package-round-2.md.
 */
export function zoneHasCatalogEntry(key: string): boolean {
  return Object.hasOwn(zonesContract.keys, key);
}

/** Ключи зон из rooms.json, которых нет в zones.json (после раунда 4 — пусто). */
export const zoneKeysWithoutCatalogEntry: readonly string[] = [
  ...new Set(
    roomsContract.rooms
      .flatMap((room) => room.zones.map((zone) => zone.key))
      .filter((key) => !zoneHasCatalogEntry(key)),
  ),
].sort();

/**
 * Ключ зоны «Просто деньги» в справочнике zones.json. В ней живёт копилка на
 * мечту (ADR-0008): цель хозяйки и участие гостей БЕЗ денежных переводов.
 * Единственное место, где этот ключ записан строкой, — отсюда его берут и
 * панель зоны, и сервис копилки.
 */
export const MONEY_ZONE_KEY = "money";

/**
 * Зоны, которые продукт не показывает во ВСЕХ комнатах по решению владельца.
 *
 * Сейчас список ПУСТ, и это тоже решение владельца, а не забывчивость.
 *
 * До 06.08.2026 в нём стоял `money` («Просто деньги»): ADR-0004 спрятал зону,
 * потому что за ней не было ни экрана, ни сценария, а единственное, что она
 * обещала, — денежный перевод — запрещено PRD §12а. Тот же ADR назвал условие
 * возврата: «либо зона получает продуктовый смысл без денежных переводов».
 *
 * ADR-0008 это условие выполнил: внутри зоны — копилка на мечту. Хозяйка
 * называет цель, гость говорит «я участвую», деньги идут МИМО СЕРВИСА. PRD §12а
 * не изменился — сервис по-прежнему не принимает, не хранит и не переводит
 * деньги. Зона показывается во всех десяти комнатах.
 *
 * Список оставлен намеренно: он — рабочая дверь «спрятать категорию целиком»,
 * и следующее такое решение владельца пишется одной строкой, а не новым
 * механизмом. Адресные исключения (комната/ключ) живут ниже, отдельно.
 */
export const zoneKeysHiddenByProduct: readonly string[] = [];

/**
 * Зоны, скрытые НЕ во всех комнатах, а в конкретных — потому что предмета нет
 * в интерьере этой комнаты. Адрес «комната/ключ», причина — рядом.
 *
 * Дизайн осмотрел все 130 зон глазами (раунд 5, `handoff/eyecheck-round5.md`)
 * и нашёл восемь мест, где обводить нечего — `objectAbsent: true` в контракте:
 *
 *   warm/music     — вертушки в кадре нет: шкаф с книгами и ваза с розами;
 *   lux/music      — вертушки нет: мраморные полки с книгами и орхидеи;
 *   sport/watches  — часовницы нет: на столе поднос с уходом;
 *   emerald/beauty — отдельного места для косметики нет, есть туалетный
 *                    столик с парфюмом (прямоугольник стоял на зеркале);
 *   sport/gaming   — консоли в минималистичной спальне нет;
 *   study/tech     — техники в кабинете нет;
 *   study/gaming   — консоли в кабинете нет;
 *   loft/gaming    — в лофте синтезатор и гитара, консоли нет.
 *
 * ПОЧЕМУ НЕ ОСТАВИТЬ. Камера подъедет к пустой стене, метка зоны загорится на
 * пустом месте, а подпись пообещает «ящики винила выезжают». Зона, которая не
 * может открыться никогда, хуже её отсутствия. Набор зон и не обязан быть
 * одинаковым во всех интерьерах — у мужских комнат он и так свой, и дизайн
 * предлагает довести это до правила: набор зависит от интерьера, а не от пола.
 * Потери функции нет — «что угодно» ловит всё, что не влезло в категории.
 *
 * ПОЧЕМУ ЭТО ОБРАТИМО. Дизайн может дорисовать предмет в интерьер — тогда
 * строка отсюда убирается, и зона возвращается вместе со своим
 * прямоугольником. Дизайн, впрочем, отсоветовал: правка базового кадра
 * обнуляет все тринадцать прямоугольников комнаты.
 *
 * ЧТО С ВЕЩАМИ ВНУТРИ. Зона исчезает вместе с мебелью (инвариант №5), но вещи
 * в базе остаются: `Item.zone` — свободная строка без внешнего ключа. Разбор
 * последствий и что с ними делать — ADR-0006, раздел «Вещи в скрытой зоне».
 */
export const zonesHiddenByProduct: readonly string[] = [
  "warm/music",
  "lux/music",
  "emerald/beauty",
  "sport/watches",
  "sport/gaming",
  "study/tech",
  "study/gaming",
  "loft/gaming",
];

/** Скрыта ли зона в этой комнате — ключом или адресом «комната/ключ». */
export function zoneHiddenByProduct(roomId: string, key: string): boolean {
  return zoneKeysHiddenByProduct.includes(key) || zonesHiddenByProduct.includes(`${roomId}/${key}`);
}

/**
 * Комнаты, для которых кадры пакета НЕ приняты: базовый кадр разошёлся с
 * нынешним сильнее порога композиции 0.05 — мебель поехала, значит все 13
 * прямоугольников комнаты к новым кадрам не подходят.
 *
 * Замер (`scripts/refs-from-masters.mjs`, средний модуль разности яркости с
 * нынешним кадром, оба в сером 1200×670): warm 0.0727, loft 0.0685 — против
 * 0.029…0.045 у восьми принятых. Глазами видно то же: в warm ваза с пионами
 * выросла и закрыла вертушку с креслом, в loft уехали стеллаж и стол.
 *
 * Поэтому у этих двух комнат ни базовый кадр, ни «открыто» из пакета не
 * подключены: кроссфейд между кадрами РАЗНЫХ комплектов — это и есть «вся
 * комната поплыла», что контракт прямо запрещает. Зона без обещания честнее.
 * Разбор и числа — docs/adr/0005-design-package-round-4.md.
 */
const ROOMS_WITHOUT_ACCEPTED_FRAMES: readonly string[] = ["warm", "loft"];

/**
 * Путь кадра из контракта (`refs-2x/cream/v4-cream.jpg`) → путь раздачи
 * (`refs/v4-cream.jpg`).
 *
 * Пакет раскладывает кадры по папкам комнат, а продукт раздаёт их плоским
 * списком из `design/package/refs` (`src/app/rooms/[image]/route.ts`: имя без
 * слэшей, обход каталога невозможен по построению). Имя файла в обеих схемах
 * одно и то же, поэтому перевод — это отбрасывание папок, а не своя карта имён.
 */
export function framePath(ref: string): string {
  return `refs/${ref.slice(ref.lastIndexOf("/") + 1)}`;
}

/**
 * Комнаты, как их видит продукт: полный контракт минус скрытые зоны, с путями
 * кадров, приведёнными к схеме раздачи, и без кадров «открыто» у комнат, чьи
 * кадры не приняты. Сырой контракт (все 130 зон, пути пакета) —
 * `roomsContract.rooms`; он нужен тестам контракта и сверке прямоугольников,
 * но не рендеру.
 */
/**
 * С какого раунда кадры «открыто» снимались ОТ НАШИХ БАЗ (тикет 81).
 *
 * Запрет `ROOMS_WITHOUT_ACCEPTED_FRAMES` стоял на комнатах, чей базовый кадр
 * в ПАКЕТЕ разошёлся с нашим (warm 0.0727, loft 0.0685): кроссфейд между
 * кадрами разных комплектов — это «вся комната поплыла».
 *
 * К кадру, снятому от нашей базы, это рассуждение не относится по построению:
 * пара «наша база ↔ этот кадр» согласована, потому что вторая половина пары
 * из первой и сделана. Раунд 14 был затеян ровно ради этого — дизайну
 * отправили восемь баз 2800×1563 с хэшами, и он сверил их до съёмки.
 *
 * Поэтому запрет снимается не с комнаты целиком, а с конкретных кадров: у
 * `warm/travel` и `loft/travel` `frameRound` 14 и 15. Остальные зоны этих
 * комнат кадров по-прежнему не получают — там снимать пока нечего.
 */
const OUR_BASE_FROM_ROUND = 14;

export const rooms: Room[] = roomsContract.rooms.map((room) => {
  const roomFramesAccepted = !ROOMS_WITHOUT_ACCEPTED_FRAMES.includes(room.id);
  return {
    ...room,
    base: framePath(room.base),
    zones: room.zones
      .filter((zone) => zoneHasCatalogEntry(zone.key) && !zoneHiddenByProduct(room.id, zone.key))
      .map((zone) => ({
        ...zone,
        openFrame:
          zone.openFrame &&
          (roomFramesAccepted || (zone.frameRound ?? 0) >= OUR_BASE_FROM_ROUND)
            ? framePath(zone.openFrame)
            : null,
      })),
  };
});

export const scene = roomsContract.scene;
export const cameraScale = roomsContract.cameraScale;
export const zoneCatalog = zonesJson as Record<string, unknown>;
export const motion = motionJson as Record<string, unknown>;

/**
 * Прямоугольник зоны из координат КАДРА в координаты десктопной сцены.
 *
 * Десктоп показывает кадр целиком и от нуля: 630 · 1.7778 = 1120, ровно ширина
 * сцены. Поэтому весь перевод — один множитель, БЕЗ слагаемого.
 *
 * Слагаемое `+12` здесь было и ушло вместе с прежней системой координат. Оно не
 * было ошибкой арифметики: пока прямоугольники задавались в координатах ОКНА
 * 430, а кадр стоял в окне со сдвигом −12, перевод «окно → кадр» и был `+12`.
 * Раунд 4 перенёс разметку в координаты кадра (`scene.phone.note`), и теперь
 * то же слагаемое сдвигало бы каждую зону на 12 px вправо. Разбор — ADR-0006.
 *
 * Отдельной десктопной карты координат не существует и не должно появиться
 * (CLAUDE.md): десктоп выводится отсюда, а не размечается заново.
 */
export function toDesktopRect(rect: ZoneRect): ZoneRect {
  const f = roomsContract.scene.desktop.factorFromPhone;
  return { x: rect.x * f, y: rect.y * f, w: rect.w * f, h: rect.h * f };
}

/** Минимальная цель нажатия из rooms.json (px). */
export const hitTargetMin = roomsContract.hitTargetMin;

export type ZoneInfo = {
  label: string;
  subtitle: string;
  openVerb: string;
  pool: string;
  moreLabel: string;
};

/** Подпись/глагол раскрытия зоны из zones.json (формат [label, subtitle, openVerb, poolKey, moreLabel]). */
export function zoneInfo(key: string): ZoneInfo | null {
  const row = zonesContract.keys[key];
  if (!row) return null;
  const [label, subtitle, openVerb, pool, moreLabel] = row;
  return { label, subtitle, openVerb, pool, moreLabel };
}

/**
 * Глагол главной кнопки для зоны — «Уложить в чемодан», «Приколоть к
 * билетам» (доска В12 · турн 8e; значения — `zones.json → cta`, раунд 21).
 *
 * ЭТО НЕ `openVerb`. Тот описывает, что показывает КАДР раскрытия («чемодан
 * раскрывается»), нужен нам с дизайном для приёмки кадров и человеку не
 * показывается никогда (тикет 59). Этот — наоборот, живёт ровно на кнопке:
 * каждый глагол называет мебель зоны из кадра, и кнопка продолжает метафору
 * комнаты вместо общего «Поставить».
 *
 * Строки берутся из КОНТРАКТА, а не из `messages/*.json`, — по той же
 * причине, что и подписи зон: их девятнадцать, они принадлежат зоне, а не
 * экрану, и меняются вместе с набором зон. `null` — зоны нет или глагола
 * для неё не прислали: экран покажет общую надпись.
 */
export function zoneCta(key: string): string | null {
  const cta = (zonesContract as { cta?: Record<string, string> }).cta;
  return (cta && Object.hasOwn(cta, key) ? cta[key] : null) ?? null;
}

// ---------- Партитура движения (motion.json) ----------

type Ms = number | { phone: number; desktop: number };

type OpenPhase = {
  at: Ms;
  what: string;
  prop?: string;
  duration?: Ms;
  easing?: string;
  from?: string;
  to?: string;
  step?: number;
  perTile?: { opacity: number; transform: number };
  /** Точка вращения слоя; вернулась в контракт в раунде 4 (см. CAMERA_ORIGIN). */
  origin?: string;
  /** Формула сдвига камеры словами контракта (фаза «Шаг: сдвиг к зоне»). */
  dx?: string;
  dy?: string;
};

type MotionContract = {
  easing: { out: string; walk: string; settle: string };
  cameraScale: {
    formula: string;
    phone: { min: number; max: number; sceneW: number };
    desktop: { min: number; max: number; sceneW: number };
  };
  openZone: OpenPhase[];
  closeZone: { at: Ms; what: string; duration?: Ms; easing?: string }[];
  ambient: {
    drift: { duration: { phone: number; desktop: number }; amplitude: string; amplitudeZoomed: number };
    /** Возврат дрейфа после покоя (тикеты 117/126, приехала раундом 26). */
    driftResume: { idleMs: number; easeInMs: number; curve: string };
    pulse: { duration: number; stagger: number };
  };
  hover: { glow: { duration: number } };
  reducedMotion: { transitions: string };
};

const motionContract = motionJson as unknown as MotionContract;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) {
    // Значения не копируются в код — если строка пакета изменилась, падаем громко.
    throw new Error(`design/motion.json: не удалось разобрать ${what}: "${value}"`);
  }
  return match;
}

/**
 * Фаза партитуры ищется по имени (`what`), а не по индексу.
 *
 * Раунд 2 переписал `openZone` с 4 фаз на 7 и переставил их местами: код,
 * который брал `openZone[1]` как «периферия темнеет», получил бы «шаг: масштаб»
 * и разъехался бы молча. Поиск по имени либо находит фазу, либо падает громко
 * при следующей правке контракта — второе честнее тихого разъезда.
 */
function phase(list: { what: string }[], what: string): OpenPhase {
  const found = list.find((item) => item.what === what);
  if (!found) {
    throw new Error(
      `design/motion.json: не найдена фаза «${what}» (есть: ${list.map((i) => i.what).join(" · ")})`,
    );
  }
  return found as OpenPhase;
}

function pair(value: Ms | undefined, what: string): { phone: number; desktop: number } {
  if (typeof value === "number") return { phone: value, desktop: value };
  if (value) return value;
  throw new Error(`design/motion.json: у фазы ${what} нет длительности`);
}

function flat(value: Ms | undefined, what: string): number {
  if (typeof value === "number") return value;
  throw new Error(`design/motion.json: у фазы ${what} ожидалось одно число, пришло ${JSON.stringify(value)}`);
}

const lead = phase(motionContract.openZone, "Вес переносится назад");
const stepScale = phase(motionContract.openZone, "Шаг: масштаб");
const stepMove = phase(motionContract.openZone, "Шаг: сдвиг к зоне");
const settle = phase(motionContract.openZone, "Оседание");
const veilPhase = phase(motionContract.openZone, "Периферия темнеет");
const openFramePhase = phase(motionContract.openZone, "Мебель раскрывается");
const gridPhase = phase(motionContract.openZone, "Вещи встают в сетку");
// Выход из зоны — три фазы `closeZone`, все три (долг ADR-0003 §4). Тикет 22
// распаковал одну «Сетку гаснет», а камера уезжала на числах ВХОДА
// (`camera.durationMs`, 720/810, кривая `out`) — правка design.ts была вне его
// территории. Теперь у выхода свои числа: 760/820, `settle`, старт +120 мс.
const closeGridPhase = phase(motionContract.closeZone, "Сетка гаснет");
const closeCameraPhase = phase(motionContract.closeZone, "Камера отходит");
const closeVeilPhase = phase(motionContract.closeZone, "Вуаль поднимается");

// "translate ±1.1%, scale 1.10→1.13"
const driftAmplitude = requireMatch(
  motionContract.ambient.drift.amplitude,
  /translate\s*±\s*([\d.]+)%.*scale\s*([\d.]+)\s*→\s*([\d.]+)/u,
  "ambient.drift.amplitude",
);
// "duration → 120ms"
const reducedTransition = requireMatch(
  motionContract.reducedMotion.transitions,
  /([\d.]+)\s*ms/u,
  "reducedMotion.transitions",
);
// "scale(target * 1.03)" — перелёт шага, ткань «походки» (тикет 22).
const overshoot = requireMatch(
  stepScale.to ?? "",
  /\*\s*([\d.]+)\s*\)/u,
  "openZone «Шаг: масштаб».to (множитель перелёта)",
);
// "scale = clamp(sceneW / (zone.w * 2.4), min, max)" — делитель ширины зоны.
const scaleDivisor = requireMatch(
  motionContract.cameraScale.formula,
  /zone\.w\s*\*\s*([\d.]+)/u,
  "cameraScale.formula",
);

/**
 * Точка, вокруг которой браузер крутит scale камеры.
 *
 * В раунде 1 она приезжала из контракта (`openZone[0].origin`); раунд 2 поле
 * убрал вместе со старой первой фазой, и код держал значение константой
 * (ADR-0003 §4) — с обещанием прочитать из контракта, как только поле вернут.
 * Раунд 4 вернул `origin` во все четыре фазы камеры, обещание исполнено.
 * Запасное значение то же самое: если поле снова исчезнет, поведение не
 * изменится, а расхождение не будет тихим — про него написано здесь.
 */
const CAMERA_ORIGIN = stepMove.origin ?? "50% 50%";

/**
 * Формула сдвига камеры словами контракта — и признак того самого деления,
 * из-за которого зона не доезжала до центра.
 *
 * Раунды 1–3 писали `… * 100 / scale`, а браузер тем же `scale` сдвиг домножал:
 * камера приезжала ровно в S раз короче нужного (разбор — ADR-0002). Код считал
 * без деления, и это было наше единственное расхождение с пакетом. Раунд 4
 * формулу исправил и приписал `dxNote` со ссылкой на наш ADR — расхождения
 * больше нет, а флаг ниже сторожит, чтобы деление не вернулось молча.
 */
const panFormula = {
  dx: stepMove.dx ?? "",
  dy: stepMove.dy ?? "",
  dividesByScale: /\/\s*scale/u.test(`${stepMove.dx ?? ""} ${stepMove.dy ?? ""}`),
} as const;
const cameraOriginPct = requireMatch(
  CAMERA_ORIGIN,
  /^\s*([\d.]+)%\s+([\d.]+)%\s*$/u,
  "transform-origin камеры",
);

/** Партитура сцены, распакованная для SceneStage (тикет 02) и сетки вещей (тикет 03). */
export const sceneMotion = {
  easingOut: motionContract.easing.out,
  /** Кривые «походки» (раунд 2): шаг и оседание. Применяет тикет 22. */
  easingWalk: motionContract.easing.walk,
  easingSettle: motionContract.easing.settle,
  /**
   * Камера: origin и transform покоя.
   *
   * ОБЩЕЙ ДЛИТЕЛЬНОСТИ У КАМЕРЫ БОЛЬШЕ НЕТ, и это не потеря. Она была нужна,
   * пока камера ехала одним слоем с одним transition: тогда за неё брали
   * длительность сдвига (720/810). Тикет 22 разложил ВХОД на пять слоёв
   * (`walk`), а выход до сих пор ехал на том же входном числе с чужой кривой —
   * долг, который ADR-0003 §4 назвал сам. Теперь у каждой стороны свои числа
   * из контракта: вход — `walk`, выход — `close`, и одного числа «на камеру»
   * не существует.
   */
  camera: {
    origin: CAMERA_ORIGIN,
    /** Тот же origin числом (проценты сцены) — вход в расчёт наезда. */
    originPct: { x: Number(cameraOriginPct[1]), y: Number(cameraOriginPct[2]) },
    restTransform: lead.from ?? "scale(1.02)",
    /** Формула сдвига из контракта; `dividesByScale` — сторож отступления ADR-0002. */
    panFormula,
  },
  /**
   * Партитура «походки» целиком — семь фаз раунда 2, для тикета 22.
   * Сейчас код её не воплощает: наезд остаётся однослойным.
   */
  walk: {
    lead: {
      durationMs: flat(lead.duration, "Вес переносится назад"),
      easing: lead.easing ?? "out",
      from: lead.from ?? "",
      to: lead.to ?? "",
    },
    scale: {
      atMs: flat(stepScale.at, "Шаг: масштаб"),
      durationMs: pair(stepScale.duration, "Шаг: масштаб"),
      easing: stepScale.easing ?? "walk",
      /** Перелёт: подъезжаем на 3% ближе, потом оседаем. */
      overshoot: Number(overshoot[1]),
    },
    translate: {
      atMs: flat(stepMove.at, "Шаг: сдвиг к зоне"),
      durationMs: pair(stepMove.duration, "Шаг: сдвиг к зоне"),
      easing: stepMove.easing ?? "walk",
    },
    settle: {
      atMs: pair(settle.at, "Оседание"),
      durationMs: flat(settle.duration, "Оседание"),
      easing: settle.easing ?? "settle",
    },
  },
  /**
   * Масштаб наезда формулой (раунд 2): фиксированное ×1.72 дизайн признал
   * ошибкой — зоны шириной от 20 до 269 px требуют разного приближения.
   * Числа `rooms.json → cameraScale` пока остаются действующими, переключение
   * на формулу — тикет 22 (ADR-0003).
   */
  cameraScaleFormula: {
    divisor: Number(scaleDivisor[1]),
    phone: motionContract.cameraScale.phone,
    desktop: motionContract.cameraScale.desktop,
  },
  /** «Периферия темнеет» — радиальная вуаль. Старт сдвинут: темнота идёт следом за шагом. */
  veil: {
    delayMs: flat(veilPhase.at, "Периферия темнеет"),
    durationMs: flat(veilPhase.duration, "Периферия темнеет"),
  },
  /** «Мебель раскрывается» — кроссфейд в кадр «открыто». */
  openFrame: {
    delayMs: pair(openFramePhase.at, "Мебель раскрывается"),
    durationMs: flat(openFramePhase.duration, "Мебель раскрывается"),
  },
  /** «Вещи встают в сетку» — тикету 03. */
  gridEnter: {
    atMs: pair(gridPhase.at, "Вещи встают в сетку"),
    stepMs: gridPhase.step ?? 0,
    perTileMs: gridPhase.perTile ?? { opacity: 0, transform: 0 },
    from: gridPhase.from ?? "",
  },
  /**
   * ВЫХОД ИЗ ЗОНЫ — партитура `closeZone` целиком, три фазы.
   *
   * Контракт разводит вход и выход намеренно: «наружу спокойнее, чем внутрь
   * (620 против 760): внутрь ведёт намерение, наружу — просто отпустил», и
   * перелёта на выходе нет вовсе («отступать спиной с покачиванием — не
   * человеческий жест»). Отсюда одна фаза камеры вместо трёх слоёв жеста и
   * кривая `settle` вместо `walk`.
   *
   * СТАРТ +120 МС — не украшение: первой уходит сетка вещей (200 мс с нуля),
   * и камера трогается, пока лист ещё гаснет. Обе задержки живут в CSS
   * (`transition-delay`), таймер в JS отмеряет только первую фазу.
   */
  close: {
    /** «Сетка гаснет» — лист и подпись зоны уходят первыми. */
    grid: {
      atMs: flat(closeGridPhase.at, "Сетка гаснет"),
      durationMs: flat(closeGridPhase.duration, "Сетка гаснет"),
    },
    /** «Камера отходит» — вся стопка слоёв возвращается в покой. */
    camera: {
      atMs: flat(closeCameraPhase.at, "Камера отходит"),
      durationMs: pair(closeCameraPhase.duration, "Камера отходит"),
      easing: closeCameraPhase.easing ?? "settle",
    },
    /** «Вуаль поднимается» — радиальная вуаль отпускает периферию. */
    veil: {
      atMs: flat(closeVeilPhase.at, "Вуаль поднимается"),
      durationMs: flat(closeVeilPhase.duration, "Вуаль поднимается"),
      easing: closeVeilPhase.easing ?? "out",
    },
  },
  drift: {
    durationMs: motionContract.ambient.drift.duration,
    translatePct: Number(driftAmplitude[1]),
    scaleFrom: Number(driftAmplitude[2]),
    scaleTo: Number(driftAmplitude[3]),
    /** Вблизи размах дыхания срезается до 45% — иначе кадр качает (раунд 2). */
    zoomedFactor: motionContract.ambient.drift.amplitudeZoomed,
  },
  /**
   * Возврат дрейфа после того, как комнату тронули (тикеты 117 и 126).
   *
   * Жила эта пара чисел константами в `use-scene-pan.ts`: дизайн объявил фазу
   * в CHANGES раунда 24, а сам `motion.json` не прислал ни тогда, ни раундом
   * позже. Приехал раундом 26 — и машинный дифф показал, что новых ключей
   * ровно семь, а ни одно наше значение не тронуто. Теперь числа читаются
   * отсюда, как все остальные длительности сцены.
   */
  driftResume: {
    idleMs: motionContract.ambient.driftResume.idleMs,
    easeInMs: motionContract.ambient.driftResume.easeInMs,
  },
  pulse: {
    durationMs: motionContract.ambient.pulse.duration,
    staggerMs: motionContract.ambient.pulse.stagger,
  },
  hoverGlow: { durationMs: motionContract.hover.glow.duration },
  reducedTransitionMs: Number(reducedTransition[1]),
} as const;

/**
 * Масштаб наезда по формуле motion.json → cameraScale:
 * `clamp(sceneW / (zone.w * 2.4), min, max)`. Ширина зоны — в координатах
 * телефонной сцены (обе раскладки считаются от неё, `sceneW: 430`).
 *
 * В сцене пока НЕ применяется: действуют числа rooms.json (ADR-0003).
 * Переключение — тикет 22.
 */
export function zoneCameraScale(rect: ZoneRect, view: "phone" | "desktop"): number {
  const { divisor } = sceneMotion.cameraScaleFormula;
  const { min, max, sceneW } = sceneMotion.cameraScaleFormula[view];
  return Math.min(max, Math.max(min, sceneW / (rect.w * divisor)));
}
