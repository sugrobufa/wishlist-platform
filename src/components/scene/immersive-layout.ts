// Раскладка «комната во весь экран» (тикет 24) — числа и геометрия.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Раскладку рисует CSS (scene.module.css → .viewport,
// globals.css → полосы), а проверяет тест: все 130 зон обязаны остаться
// достижимыми, а комната — заполнять экран без рамки вокруг неё.
// Чтобы тест проверял ту же раскладку, что видит человек, формула живёт
// здесь одна: CSS берёт числа из `tokens.css` (те же ключи tokens.json),
// а тест — отсюда. Разъедутся — упадёт `tests/immersive-layout.test.ts`.
//
// РАЗВИЛКА КОНТРАКТА («во весь экран» против пропорции 430:352) закрыта
// тикетом 42 в пользу буквы контракта: комната заполняет экран, а пропорцию
// держит КРОП, а не поля. До него сцена вписывалась целиком, и на 1920 вокруг
// неё стояла чёрная рамка в 234 px с каждой стороны — владелец трижды просил
// комнату во весь экран, и рамка была ровно тем, что он видел.
//
// Раскладок теперь две, и обе описаны одним словом `fit` (см. `SceneFit`):
// телефон вписывает кадр в окно и прижимает к ВЕРХУ экрана, десктоп заполняет
// им окно и режет лишнее. Карта зон при этом не меняется ни на пиксель —
// меняется показ.
//
// ТЕЛЕФОН ПОВТОРИЛ ДВИЖЕНИЕ ДЕСКТОПА (тикет 57). До него кадр стоял ПОД верхней
// полосой (top = railTop = 190), и между шапкой и комнатой лежала мёртвая
// тёмная зона в 190 px — владелец увидел её на стенде: «огромное пространство
// сверху не используется». Теперь кадр начинается от верха экрана, а полосы
// лежат НА нём — ровно то, что тикет 42 сделал на десктопе (турны 17a/23c).
// Кадр при этом НЕ растянут: его размер не изменился ни на пиксель (на телефоне
// он всегда во всю ширину экрана, высота = ширина ÷ пропорция), он ПЕРЕЕХАЛ.
// Освободившиеся 190 px достались низу — панель зоны и указатель дышат
// свободнее (scene.module.css → .panel).
//
// У КРОПА ЕСТЬ ПРЕДЕЛ (тикет 45). Глубину кропа задаёт пропорция ОКНА против
// пропорции кадра, и на 4:3 (1024×768 — айпад в альбоме, он же порог
// десктопной раскладки) она съедала по 12.8% ширины с каждой стороны: 25 зон
// теряли цель нажатия, 13 срезались в ноль. Поэтому окно у́же эталонного
// 1280×800 считается так, будто оно и есть 1280×800 (`minWindowAr`): кроп
// упирается в предел, а остаток высоты уходит в поле сверху и снизу. См.
// `sceneBand`.
// ПАН ОКНА ПО КАДРУ (тикет 55) — тоже здесь: «окно 430 ездит по кадру 630»
// (ADR-0006) из свойства контракта стало жестом, и вся арифметика позиции
// окна собрана в одном месте (см. блок «Пан окна» в конце файла). Пан —
// свойство ПОКАЗА, как кроп: карта координат не меняется ни на пиксель.
import tokensJson from "@design/tokens.json";
import { hitTargetMin, scene, type ZoneRect } from "@/config/design";
import { round4, zoneScenePercent, type FrameGap, type SceneView } from "./camera";

type ImmersiveContract = {
  layout: {
    phoneImmersive: {
      topVeil: number;
      bottomVeil: number;
      titleTop: number;
      railBottom: number;
      tabBar: number;
      hitTargetMin: number;
    };
    desktopImmersive: { topVeil: number; bottomVeil: number; sidePad: number };
  };
  spacing: { gutter: number };
};

/**
 * Как сцена заполняет экран (тикет 42).
 *
 * `fit` — телефон: кадр целиком помещается в окно, по бокам он ровно в ширину
 *   экрана, и прижат к ВЕРХУ (тикет 57). Полосы лежат НА кадре, как на
 *   десктопе: верхняя вуаль накрывает верхнюю треть комнаты, нижняя до кадра
 *   не достаёт вовсе (кадр кончается высоко над ней). Прежде кадр стоял ПОД
 *   верхней полосой, и над ним была мёртвая тёмная зона в 190 px.
 * `cover` — десктоп: кадр заполняет окно целиком и лишнее срезается кропом по
 *   центру композиции. Полос­ы лежат НА кадре — так и рисовал макет (турны
 *   17a/23c), и так исчезает чёрная рамка вокруг комнаты. По ширине кадр
 *   заполняет окно ВСЕГДА; по высоте — пока окно не у́же эталона `minWindowAr`
 *   (тикет 45): дальше кроп упирается в предел и внизу с верхом остаётся поле.
 *
 * Кроп — свойство ПОКАЗА: карта координат не меняется ни на пиксель, зона
 * остаётся на том же месте картинки. Зона, срезанная краем окна, достижима
 * указателем зон (он строится по данным) и камерой (доводит любую зону в
 * середину экрана) — те же две дороги, что у телефона с его окном 430 из 630.
 */
export type SceneFit = "fit" | "cover";

const tokens = tokensJson as unknown as ImmersiveContract;

export type Box = { left: number; top: number; width: number; height: number };
export type Screen = { w: number; h: number };

/**
 * Эталонное десктопное окно приёмки — 1280×800 (тикет 42: «на эталонном
 * десктопе 1280×800 — 125 пальцем, 5 указателем»; тот же вьюпорт стоит
 * константой `DESKTOP` в тесте и в живой проверке).
 *
 * Тикет 45 сделал его ещё и ПРЕДЕЛОМ ГЛУБИНЫ КРОПА: глубже, чем здесь, кадр не
 * режется ни на одном окне. Число не выдумано и не взято из дизайн-пакета
 * (пакет задаёт только холст 1120×625) — это тот вьюпорт, на котором раскладку
 * принимали, и обещание звучит как «уже эталона не станет».
 */
export const desktopReference: Screen = { w: 1280, h: 800 };

/**
 * Пропорция эталона — 1.6 (16:10). Окно у́же неё считается так, будто оно 16:10.
 * То же число живёт в `scene.module.css` (`--band-ar-min: 1280 / 800`), их
 * совпадение проверяет тест.
 */
export const minWindowAr = desktopReference.w / desktopReference.h;

/**
 * Высота, от которой считается кроп: своя высота окна, но не больше той, при
 * которой окно оказывается у́же эталона. Остаток высоты в кадр не превращается —
 * он и есть поле сверху и снизу (`sceneGap`).
 */
function coverHeight(screen: Screen): number {
  return Math.min(screen.h, screen.w / minWindowAr);
}

/**
 * Полосы интерфейса и зазор до сцены — всё из пакета.
 *
 * `railTop` — высота верхней полосы: в контракте это «вуаль сверху»
 * (190 телефон / 132 десктоп), и теперь на ОБОИХ видах это именно вуаль —
 * градиент, лежащий на комнате, а не отступ до неё (тикет 57 убрал последний
 * отступ, телефонный). В коробку сцены это число больше не входит ни на одном
 * виде: оно говорит, где стоит полоса, а не где начинается кадр.
 *
 * `railBottom` — 116 из `phoneImmersive.railBottom`, единственное число полосы
 * в пакете; на десктопе в полосе те же кнопки, поэтому число то же.
 * `gap` — `spacing.gutter`: воздух между кадром и интерфейсом. В формулу
 * коробки сцены он больше не входит (тикет 57: кадр упирается в верх экрана, а
 * до нижней полосы ему на телефоне ~460 px — резервировать нечего); остаётся
 * числом контракта, которым страница задаёт `--imm-gutter` — внутренний отступ
 * полос.
 */
export const immersiveLayout = {
  phone: {
    railTop: tokens.layout.phoneImmersive.topVeil,
    railBottom: tokens.layout.phoneImmersive.railBottom,
    titleTop: tokens.layout.phoneImmersive.titleTop,
    gap: tokens.spacing.gutter,
    /** Внутренний отступ полосы: на телефоне это `spacing.gutter`. */
    sidePad: tokens.spacing.gutter,
    /** Пропорция сцены (rooms.json → scene): телефон 430:352. */
    ar: scene.phone.w / scene.phone.h,
    fit: "fit",
  },
  desktop: {
    railTop: tokens.layout.desktopImmersive.topVeil,
    railBottom: tokens.layout.phoneImmersive.railBottom,
    titleTop: tokens.layout.desktopImmersive.sidePad,
    gap: tokens.spacing.gutter,
    /** `desktopImmersive.sidePad` — те самые 44 от края. */
    sidePad: tokens.layout.desktopImmersive.sidePad,
    /** Десктоп 1120:625 — тот же кадр целиком, без телефонного кропа. */
    ar: scene.desktop.w / scene.desktop.h,
    fit: "cover",
  },
} as const;

/**
 * Где на экране лежит сцена (`.viewport` из scene.module.css). Правила ровно
 * те же, что в CSS, — по одному на каждый `fit`.
 *
 * ТЕЛЕФОН (`fit`), тикет 57:
 *   width = min(100vw, 100dvh × пропорция)
 *   top   = 0, по центру по горизонтали.
 * Сцена берёт всю ширину экрана, пока её высота помещается в экран, и стоит у
 * самого верха. Полосы её больше не подпирают — они на ней лежат.
 *
 * Что изменилось числами (эталон 430×932): коробка была 430×352 при top 190,
 * стала 430×352 при top 0. РАЗМЕР ТОТ ЖЕ — кадр переехал, а не растянулся
 * (пропорция 430:352 неприкосновенна, ADR-0006). На всех телефонах обхода
 * ширину задаёт экран, а не высота: 390 → 319.3, 375 → 307, 360 → 294.7 —
 * до прежнего ограничителя «между полосами» ни одному не близко.
 *
 * ПОЧЕМУ ПОЛОСЫ ВЫШЛИ ИЗ ФОРМУЛЫ. Пока они в ней стояли, высота кадра зависела
 * от высоты экрана дважды — и на низком экране (932 → 745 → 640) кадр не просто
 * мельчал, а мельчал БЫСТРЕЕ экрана: 190 + 116 + 22 съедались целиком. В
 * альбомной ориентации телефона (932×430, десктопная раскладка включается
 * только с 1024) это доходило до абсурда — кадр 124.6×102 при экране 932×430.
 * Теперь ограничитель один и честный: кадр не больше окна.
 *
 * ДЕСКТОП (`cover`), тикет 42 + предел из тикета 45:
 *   h′     = min(100dvh, 100vw ÷ minWindowAr)     ← вот и весь предел
 *   width  = max(100vw, h′ × пропорция),  height = width ÷ пропорция
 *   и всё это по центру экрана в обе стороны.
 * Кадр заполняет окно и вылезает за него с той стороны, где пропорция окна
 * не совпадает с пропорцией комнаты; лишнее режет `overflow: hidden`. На 16:9
 * (1920×1080) за краем остаётся по 7.7 px, на 16:10 (1280×800) — по 76.8.
 *
 * ПОЧЕМУ КРОП, А НЕ ВПИСЫВАНИЕ. Вписанный кадр держал пропорцию за счёт полей:
 * на 1920 комната занимала 1452 из 1920, и вокруг неё стояла чёрная рамка
 * в 234 px с каждой стороны — «маленькая картинка в пустоте», третий отказ
 * владельца. Кроп убирает рамку, ничего не меняя в карте зон: см. `SceneFit`.
 *
 * ПОЧЕМУ У КРОПА ПОЯВИЛСЯ ПРЕДЕЛ (тикет 45). Кроп — свойство ОКНА: сколько
 * срежется, решает его пропорция. На 16:9 и 16:10 это 0.8–11% ширины, а на 4:3
 * уже 25.6% — четверть комнаты, 13 зон в ноль. `h′` останавливает счёт на
 * пропорции эталона: окно 4:3 получает ровно тот же кроп, что 1280×800, и ни
 * пикселем больше. Поле, которое при этом остаётся сверху и снизу, — цена;
 * на реальных альбомных окнах оно целиком прячется под полосами интерфейса
 * (64 px против полос в 132 и 116 на 1024×768) и того же цвета, что фон сцены.
 * Окна 16:10 и шире не меняются ни на пиксель: там `h′` = высота окна.
 */
export function sceneBand(view: SceneView, screen: Screen): Box {
  const l = immersiveLayout[view];
  const width =
    l.fit === "cover"
      ? Math.max(screen.w, coverHeight(screen) * l.ar)
      : Math.min(screen.w, Math.max(0, screen.h) * l.ar);
  const height = width / l.ar;
  return {
    left: round4((screen.w - width) / 2),
    top: l.fit === "cover" ? round4((screen.h - height) / 2) : 0,
    width: round4(width),
    height: round4(height),
  };
}

/**
 * Поля вокруг сцены: сколько экрана она НЕ закрывает с каждой стороны.
 * Ноль со всех четырёх — комната от края до края, рамки нет. Это и есть
 * требование тикета 42, записанное числом.
 *
 * По бокам на десктопе всегда ноль. Сверху и снизу — тоже ноль, пока окно не
 * у́же эталона (`minWindowAr`); на 4:3 там стоит поле, в которое упёрся кроп
 * (тикет 45): 64 px на 1024×768, 112 на 1280×1024. Поле делится поровну, и на
 * альбомных окнах оно меньше полос интерфейса, которые его накрывают.
 */
export function sceneGap(view: SceneView, screen: Screen): FrameGap {
  const band = sceneBand(view, screen);
  return {
    left: round4(Math.max(0, band.left)),
    right: round4(Math.max(0, screen.w - (band.left + band.width))),
    top: round4(Math.max(0, band.top)),
    bottom: round4(Math.max(0, screen.h - (band.top + band.height))),
  };
}

/**
 * Видимая часть сцены: коробка сцены, обрезанная краями экрана. На телефоне
 * совпадает с самой сценой (она вписана), на десктопе — это весь экран по
 * ширине и вся его высота, пока окно не у́же эталона; на 4:3 по высоте остаётся
 * поле (тикет 45). Именно по этой коробке равняется интерфейс: полоса лежит на
 * комнате, а не на окне.
 */
export function sceneVisible(view: SceneView, screen: Screen): Box {
  const band = sceneBand(view, screen);
  const left = Math.max(0, band.left);
  const top = Math.max(0, band.top);
  return {
    left: round4(left),
    top: round4(top),
    width: round4(Math.min(screen.w, band.left + band.width) - left),
    height: round4(Math.min(screen.h, band.top + band.height) - top),
  };
}

/**
 * Коробка полосы интерфейса — то, что задаёт CSS (`.imm-rail`): полоса лежит
 * во всю ширину окна. Тест сверяет её с `sceneVisible`: полоса обязана лежать
 * на комнате, иначе интерфейс снова обрамляет окно, а не комнату (тикет 42).
 */
export function railBand(_view: SceneView, screen: Screen): { left: number; width: number } {
  return { left: 0, width: screen.w };
}

/** Содержимое полосы: та же коробка минус внутренний отступ `sidePad`. */
export function railContent(view: SceneView, screen: Screen): { left: number; width: number } {
  const pad = immersiveLayout[view].sidePad;
  const band = railBand(view, screen);
  return { left: round4(band.left + pad), width: round4(Math.max(0, band.width - pad * 2)) };
}

/**
 * Прямоугольник зоны в пикселях экрана. Считается тем же путём, что рисует
 * браузер: доля сцены (`zoneScenePercent`, тикет 22) × коробка сцены. Своей
 * карты координат здесь нет — `rooms.json` остаётся единственной.
 */
export function zoneOnScreen(rect: ZoneRect, view: SceneView, screen: Screen): Box {
  const band = sceneBand(view, screen);
  const p = zoneScenePercent(rect, view);
  return {
    left: round4(band.left + (p.left / 100) * band.width),
    top: round4(band.top + (p.top / 100) * band.height),
    width: round4((p.width / 100) * band.width),
    height: round4((p.height / 100) * band.height),
  };
}

/**
 * Настоящая цель нажатия зоны: прямоугольник добит до `hitTargetMin`
 * (`.hotspot::after`, 44 px реальных пикселей экрана) и обрезан ВИДИМОЙ частью
 * сцены — `.viewport` режет всё, что вылезло за кадр, а `.imm` режет всё, что
 * вылезло за окно (`overflow: hidden` у обоих), и обе обрезки действуют на
 * попадание пальцем одинаково.
 *
 * До тикета 42 обрезка была одна: вписанная сцена целиком лежала в окне.
 * С cover край окна режет кадр, и учитывать его обязательно — иначе функция
 * обещала бы цель нажатия там, где пикселей уже нет.
 */
export function zoneHitBox(rect: ZoneRect, view: SceneView, screen: Screen): Box {
  const clip = sceneVisible(view, screen);
  const box = zoneOnScreen(rect, view, screen);
  const growX = Math.max(0, hitTargetMin - box.width) / 2;
  const growY = Math.max(0, hitTargetMin - box.height) / 2;
  const left = Math.max(clip.left, box.left - growX);
  const top = Math.max(clip.top, box.top - growY);
  const right = Math.min(clip.left + clip.width, box.left + box.width + growX);
  const bottom = Math.min(clip.top + clip.height, box.top + box.height + growY);
  return {
    left: round4(left),
    top: round4(top),
    width: round4(Math.max(0, right - left)),
    height: round4(Math.max(0, bottom - top)),
  };
}

/**
 * Полоса экрана, свободная от интерфейса: между верхней и нижней полосами.
 *
 * ЭТО ОПИСАНИЕ, А НЕ ГРАНИЦА — теперь на обоих видах. На десктопе так с тикета
 * 42 (полосы лежат НА комнате, макет 17a/23c), на телефоне — с тикета 57: кадр
 * поднялся к верху экрана, и верхняя вуаль накрыла его верхнюю треть. Зона под
 * полосой остаётся нажимаемой: сама полоса нажатий не берёт
 * (`.imm-rail { pointer-events: none }`), берут только её ссылки и кнопки, а
 * вуаль не берёт вовсе (`.imm-veil { pointer-events: none }`).
 *
 * Числа задетых зон записаны в `tests/immersive-layout.test.ts` — рост списка
 * обязан быть виден в диффе, а не приезжать молча. На телефоне 430×932 верхняя
 * вуаль задевает 75 зон из 130, нижняя — ни одной (кадр кончается на 352 при
 * полосе, начинающейся на 816).
 */
export function clearBand(view: SceneView, screen: Screen): { top: number; bottom: number } {
  const l = immersiveLayout[view];
  return { top: l.railTop, bottom: screen.h - l.railBottom };
}

// ---------------------------------------------------------------------------
// Пан окна по кадру (тикет 55) — только телефон.
// ---------------------------------------------------------------------------
//
// ADR-0006 говорит про телефон: «окно 430 ездит по кадру и показывает его с 12
// по 442». До тикета 55 «ездило» оно только наездом камеры; пан делает это
// буквально: горизонтальный драг в покое сдвигает окно по кадру. Позиция окна —
// ОДНО число `pan`: сдвиг окна ВПРАВО от покоя в px кадра (кадр и телефонная
// сцена в одном масштабе, ADR-0006). pan = 0 — покой (окно 12…442);
// pan = −12 — окно упёрлось в левый край кадра (0…430); pan = 188 — в правый
// (200…630). Карта зон не участвует: пан, как и кроп, — свойство показа.
//
// ДЕСКТОПА ЗДЕСЬ НЕТ НАМЕРЕННО: там кадр виден целиком (cover, тикет 42),
// панорамировать нечего — функции ниже принимают только телефонные величины,
// а CSS-слой пана на десктопе выключен (scene.module.css).

/**
 * Диапазон пана: окно ходит по всему кадру, от левого края до правого.
 * Числа не выдуманы: min = `scene.phone.image.x` (−12 — насколько окно в покое
 * НЕ у левого края), max = 630 − 430 − 12 = 188 (остаток кадра справа).
 */
export function phonePanRange(): { min: number; max: number } {
  const img = scene.phone.image;
  return { min: img.x, max: img.w - scene.phone.w + img.x };
}

/** Пан, обрезанный диапазоном, — окно не выезжает за кадр. */
export function clampPan(pan: number): number {
  const { min, max } = phonePanRange();
  return Math.min(max, Math.max(min, pan));
}

/** Какие колонки кадра видит окно при пане p: покой — [12, 442). */
export function phoneWindowOnFrame(pan: number): { left: number; right: number } {
  const img = scene.phone.image;
  return { left: -img.x + pan, right: -img.x + pan + scene.phone.w };
}

/**
 * Значение CSS-переменной `--win-pan`: сдвиг слоёв кадра и хотспотов в px
 * ЭКРАНА (окно едет вправо ⟹ содержимое влево, знак минус). Пан задан в px
 * кадра, экранный px другой (вьюпорт на телефоне равен ширине экрана —
 * 430/390/375…), масштаб — ширина вьюпорта ÷ 430. Именно px, а не проценты:
 * переменную читают ДВА слоя разной ширины (сани камеры — вьюпорт, слой
 * хотспотов — кадр, 146.5% вьюпорта), и процент значил бы у них разные
 * пиксели. Цена px — пересчёт при resize (use-scene-pan.ts его делает).
 */
export function phonePanShiftPx(pan: number, viewportWidth: number): number {
  // `|| 0` съедает минус-ноль (−pan при pan = 0): в CSS уехало бы «-0px».
  return round4((-pan * viewportWidth) / scene.phone.w) || 0;
}

/**
 * Люфт намёка на край: зона считается «за краем», если спрятано БОЛЬШЕ этого.
 * Число не выдумано: 12 = |image.x| — ровно столько кадра окно в покое не
 * показывает слева, и это никогда не считалось «скрытой зоной» (ADR-0006
 * описывает покой как «видно с 12 по 442», а заоконными зовёт зоны за 442).
 * Порог симметричен: слева в покое намёк не горит ни в одной комнате
 * (min x = 0), справа горит во всех десяти (3–5 зон за краем).
 */
export const EDGE_HINT_SLACK = -scene.phone.image.x;

/**
 * Намёк «за краем есть ещё»: с какой стороны окна стоят зоны, спрятанные
 * больше чем на люфт. Правая кромка в покое горит всегда (33 зоны из 130 за
 * правым краем — свойство кадра, тест immersive-layout), левая загорается,
 * когда окно уехало вправо. Считается по ДАННЫМ видимых зон, не по пикселям.
 */
export function phoneEdgeHints(
  zones: ReadonlyArray<{ rect: ZoneRect }>,
  pan: number,
): { left: boolean; right: boolean } {
  const win = phoneWindowOnFrame(clampPan(pan));
  return {
    left: zones.some(({ rect }) => win.left - rect.x > EDGE_HINT_SLACK),
    right: zones.some(({ rect }) => rect.x + rect.w - win.right > EDGE_HINT_SLACK),
  };
}

/**
 * Пан, который ставит центр зоны в центр окна (обрезан диапазоном). Дорога
 * «достижимо паном»: самая широкая зона контракта (269) у́же окна (430),
 * поэтому у КАЖДОЙ из 130 зон есть позиция окна с полной целью 44×44 —
 * это разбиение теста immersive-layout («97 в покое + 33 паном»).
 */
export function phonePanToZone(rect: ZoneRect): number {
  const img = scene.phone.image;
  return clampPan(round4(rect.x + rect.w / 2 - scene.phone.w / 2 + img.x));
}

/** Прямоугольник зоны на экране при пане p — тот же расчёт, что zoneOnScreen. */
export function phoneZoneOnScreenAtPan(rect: ZoneRect, screen: Screen, pan: number): Box {
  const band = sceneBand("phone", screen);
  const img = scene.phone.image;
  return {
    left: round4(band.left + ((rect.x + img.x - pan) / scene.phone.w) * band.width),
    top: round4(band.top + ((rect.y + img.y) / scene.phone.h) * band.height),
    width: round4((rect.w / scene.phone.w) * band.width),
    height: round4((rect.h / scene.phone.h) * band.height),
  };
}

/**
 * Цель нажатия зоны при пане p: та же добивка до 44 и та же обрезка видимой
 * сценой, что в `zoneHitBox` (при p = 0 они совпадают — под тестом). Этим
 * числом тест и говорит «зона достижима паном»: существует p, при котором
 * цель полная.
 */
export function phoneZoneHitBoxAtPan(rect: ZoneRect, screen: Screen, pan: number): Box {
  const clip = sceneVisible("phone", screen);
  const box = phoneZoneOnScreenAtPan(rect, screen, pan);
  const growX = Math.max(0, hitTargetMin - box.width) / 2;
  const growY = Math.max(0, hitTargetMin - box.height) / 2;
  const left = Math.max(clip.left, box.left - growX);
  const top = Math.max(clip.top, box.top - growY);
  const right = Math.min(clip.left + clip.width, box.left + box.width + growX);
  const bottom = Math.min(clip.top + clip.height, box.top + box.height + growY);
  return {
    left: round4(left),
    top: round4(top),
    width: round4(Math.max(0, right - left)),
    height: round4(Math.max(0, bottom - top)),
  };
}
