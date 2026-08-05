/**
 * Кроп зоны из БАЗОВОГО кадра комнаты (tokens.json → stateChoice.crop).
 *
 * Экрану добавления нужен кусок настоящего интерьера — то место, куда встанет
 * вещь. Своих картинок для этого не существует и заводить их нельзя (кадры
 * комнат неприкосновенны, CLAUDE.md): кроп считается из уже имеющегося кадра
 * `room.base` и прямоугольника зоны из `rooms.json`.
 *
 * КАК СОГЛАСОВАНЫ ДВЕ ПРОПОРЦИИ. Контракт требует кроп 1.35:1, а прямоугольник
 * зоны бывает какой угодно — от 22×26 (духи) до 83×191 (шкаф во всю стену).
 * Содержимое НЕ растягивается: коробка кропа расширяется вокруг ЦЕНТРА зоны,
 * пока не получит нужную пропорцию. Ширина берётся как бо́льшая из двух:
 *
 *   1. «обзор камеры» — `sceneW / zoneCameraScale(rect)`, ровно тот кусок
 *      кадра, который человек видит, когда камера подходит к этой зоне
 *      (motion.json → cameraScale). Это и есть ответ дизайна на вопрос
 *      «сколько интерьера вокруг предмета показывать»; заодно clamp 1.45…2.6
 *      не даёт крошечной зоне превратить кроп в мыло;
 *   2. наименьшая коробка 1.35:1, в которую прямоугольник зоны влезает целиком
 *      — чтобы высокий шкаф не оказался обрезан по пояс.
 *
 * Дальше коробка зажимается границами кадра и вдвигается внутрь него, если
 * зона стоит у самого края. Наружу отдаются готовые `background-size` и
 * `background-position` в процентах: масштаб при этом равномерный по обеим
 * осям, картинка не искажается (вывод — в `zoneCrop`).
 *
 * КООРДИНАТЫ. Кроп режет КАДР, и прямоугольники зон после раунда 4 заданы в
 * координатах кадра же — поэтому здесь нет ни своего перевода, ни своих чисел:
 * весь пересчёт делает `zoneFramePercent`, тот же, что ставит хотспоты. Смена
 * системы (ADR-0006) прошла через него и достала сюда сама: у 32 зон правой
 * трети кадра кроп теперь берёт настоящий предмет, а не участок окна.
 */
import tokensJson from "@design/tokens.json";
import { scene, zoneCameraScale, type ZoneRect } from "@/config/design";
import { round4, zoneFramePercent, type RectPercent } from "./camera";

type StateChoiceContract = { crop: string };

const stateChoice = (tokensJson as unknown as { stateChoice: StateChoiceContract }).stateChoice;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) throw new Error(`design/tokens.json: не удалось разобрать ${what}: "${value}"`);
  return match;
}

/**
 * Пропорция кропа — из прозы контракта («…, 1.35:1, …»), а не число в коде.
 * Тот же разбор делает `scripts/tokens.mjs` для `--state-choice-ar`: CSS держит
 * коробку, JS считает, что в неё положить, — и оба читают одну строку пакета.
 */
export const cropAspect = Number(
  requireMatch(stateChoice.crop, /([\d.]+)\s*:\s*1/u, "stateChoice.crop")[1],
);

export type ZoneCrop = {
  /** `background-size` коробки кропа, проценты. */
  size: string;
  /** `background-position` коробки кропа, проценты. */
  position: string;
  /** Прямоугольник зоны ВНУТРИ коробки кропа — там и стоит вещь. */
  spot: RectPercent;
  /** Сама вырезка в px кадра 630×351 — для тестов и отладки, в CSS не уходит. */
  box: ZoneRect;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Кроп зоны в виде CSS-фона.
 *
 * ПОЧЕМУ ПРОЦЕНТЫ, А НЕ ПИКСЕЛИ. Коробка кропа резиновая (две панели делят
 * ширину экрана), поэтому пиксельного размера у неё нет. Проценты
 * `background-size` считаются от коробки, и при `w` px кадра на ширину коробки
 * B масштаб равен s = B/w; по вертикали коробка равна B/AR = h·s — та же s.
 * Значит `100%·img.w/w` и `100%·img.h/h` дают РАВНОМЕРНЫЙ масштаб: картинка
 * не растягивается, что бы ни случилось с шириной экрана.
 *
 * Процентная `background-position` смещает картинку на p·(коробка − картинка),
 * поэтому левый край кадра встаёт на −x·s ровно при p = x/(img.w − w).
 *
 * Кадр отображается на коробку 630×351 контракта так же, как в сцене
 * (`.frame` там стоит с `background-size: 100% 100%`): файлы в `refs/` —
 * 1200×670, то есть с точностью 0.2% пропорциональны контрактным габаритам.
 */
export function zoneCrop(rect: ZoneRect): ZoneCrop {
  const img = scene.phone.image;
  // Положение зоны в долях КАДРА — единственный перевод координат сцены в
  // координаты картинки, он же считает хотспоты (camera.ts).
  const p = zoneFramePercent(rect);
  // Прямоугольник обрезается кадром: сцена на пиксель выше картинки (352 против
  // 351), и у нижних зон низ уходит за её край — пикселей там просто нет.
  const zx = clamp((p.left / 100) * img.w, 0, img.w);
  const zy = clamp((p.top / 100) * img.h, 0, img.h);
  const zw = clamp(zx + (p.width / 100) * img.w, 0, img.w) - zx;
  const zh = clamp(zy + (p.height / 100) * img.h, 0, img.h) - zy;

  // Ширина: обзор камеры этой зоны против «зона обязана влезть целиком».
  const cameraView = scene.phone.w / zoneCameraScale(rect, "phone");
  const holdsZone = Math.max(zw, zh * cropAspect);
  const w = Math.min(Math.max(cameraView, holdsZone), img.w, img.h * cropAspect);
  const h = w / cropAspect;

  // Коробка центрируется на зоне и вдвигается внутрь кадра у самого края.
  const x = clamp(zx + zw / 2 - w / 2, 0, img.w - w);
  const y = clamp(zy + zh / 2 - h / 2, 0, img.h - h);

  // Кроп во всю сторону кадра — двигать некуда, любая позиция равна нулю.
  const freeX = img.w - w;
  const freeY = img.h - h;

  return {
    size: `${round4((img.w / w) * 100)}% ${round4((img.h / h) * 100)}%`,
    position: `${round4(freeX > 0 ? (x / freeX) * 100 : 50)}% ${round4(
      freeY > 0 ? (y / freeY) * 100 : 50,
    )}%`,
    spot: {
      left: round4(((zx - x) / w) * 100),
      top: round4(((zy - y) / h) * 100),
      width: round4((zw / w) * 100),
      height: round4((zh / h) * 100),
    },
    box: { x: round4(x), y: round4(y), w: round4(w), h: round4(h) },
  };
}
