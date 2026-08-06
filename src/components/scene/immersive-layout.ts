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
// телефон вписывает кадр между полосами, десктоп заполняет им окно и режет
// лишнее. Карта зон при этом не меняется ни на пиксель — меняется показ.
//
// У КРОПА ЕСТЬ ПРЕДЕЛ (тикет 45). Глубину кропа задаёт пропорция ОКНА против
// пропорции кадра, и на 4:3 (1024×768 — айпад в альбоме, он же порог
// десктопной раскладки) она съедала по 12.8% ширины с каждой стороны: 25 зон
// теряли цель нажатия, 13 срезались в ноль. Поэтому окно у́же эталонного
// 1280×800 считается так, будто оно и есть 1280×800 (`minWindowAr`): кроп
// упирается в предел, а остаток высоты уходит в поле сверху и снизу. См.
// `sceneBand`.
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
 * `fit` — телефон: кадр целиком помещается между полосами, по бокам он ровно
 *   в ширину экрана. Полосы стоят НАД и ПОД кадром, зон под ними нет.
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
 * (190 телефон / 132 десктоп). В нашей раскладке вуаль превратилась в отступ:
 * фон экрана и так цвета вуали (`surface.app.ground` = #0B0806), градиенту
 * поверх пустоты темнеть не по чему — темнеет он на самом кадре (`.scrim`).
 *
 * `railBottom` — 116 из `phoneImmersive.railBottom`, единственное число полосы
 * в пакете; на десктопе в полосе те же кнопки, поэтому число то же.
 * `gap` — `spacing.gutter`: воздух между кадром и полосами, он же запас,
 * который держит зону нижнего края от заезда под нижнюю полосу.
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
 * ТЕЛЕФОН (`fit`), без изменений с тикета 24:
 *   width = min(100%, (100dvh − railTop − railBottom − gap) × пропорция)
 *   top   = railTop, по центру по горизонтали.
 * Сцена берёт всю ширину экрана, пока её высота помещается между полосами;
 * на низком экране сжимается. Верх прижат к нижнему краю верхней полосы:
 * пустоты между заголовком и комнатой нет (пункт 2 приёмки).
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
      : Math.min(screen.w, Math.max(0, screen.h - l.railTop - l.railBottom - l.gap) * l.ar);
  const height = width / l.ar;
  return {
    left: round4((screen.w - width) / 2),
    top: l.fit === "cover" ? round4((screen.h - height) / 2) : l.railTop,
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
 * На ТЕЛЕФОНЕ это по-прежнему граница для зон: сцена вписана между полосами,
 * и зона под полосой была бы видна, но не нажимаема. На ДЕСКТОПЕ полосы лежат
 * НА комнате (тикет 42, макет 17a/23c), поэтому зона под ними — норма: сама
 * полоса нажатий не берёт (`.imm-rail { pointer-events: none }`), берут только
 * её ссылки и кнопки. Функция осталась описанием того, где стоят полосы.
 */
export function clearBand(view: SceneView, screen: Screen): { top: number; bottom: number } {
  const l = immersiveLayout[view];
  return { top: l.railTop, bottom: screen.h - l.railBottom };
}
