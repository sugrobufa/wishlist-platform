/**
 * Метка зоны — свет вместо рамки (tokens.json → zoneMarker).
 *
 * Тикет 21 разложил в CSS-переменные всё, что не зависит от данных: альфы
 * состояний, размер искры, длительности, кривую. Здесь живёт остальное — то,
 * что собирается из зоны (`bloomAR`, `bloomRot`) и комнаты (акцент,
 * `roomLightness`): шаблоны фигур с плейсхолдерами, рамка фокуса, веса света
 * против тени и правило переворота подписи.
 *
 * Значения не копируются в код: шаблоны и формулы читаются из пакета как есть.
 * Если дизайн перепишет контракт, правка либо доедет до экрана сама, либо
 * упадёт громко — молча подставить своё число нельзя (CLAUDE.md).
 */
import tokensJson from "@design/tokens.json";
import { round4 } from "./camera";

type ZoneMarkerContract = {
  lightnessMix: { bloomWeight: string; vignetteWeight: string };
  bloom: { shape: string };
  vignette: { shape: string; shadow: string };
  label: { position: string };
  focus: { outline: string };
};

const zoneMarker = (tokensJson as unknown as { zoneMarker: ZoneMarkerContract }).zoneMarker;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) throw new Error(`design/tokens.json: не удалось разобрать ${what}: "${value}"`);
  return match;
}

/**
 * Подстановка `{ключ}` в шаблон контракта. Отсутствие плейсхолдера — не мелочь:
 * незамеченный `{accent}` уехал бы в CSS строкой и молча погасил бы весь слой,
 * поэтому падаем громко.
 */
function fill(template: string, key: string, value: string, what: string): string {
  const token = `{${key}}`;
  if (!template.includes(token)) {
    throw new Error(`design/tokens.json: в ${what} нет плейсхолдера ${token}: "${template}"`);
  }
  return template.replaceAll(token, value);
}

export type MarkerWeights = {
  /** Вес тёплого пятна: множитель к альфе состояния bloom. */
  bloom: number;
  /** Вес тени: подставляется в АЛЬФУ цвета виньетки, так написан контракт. */
  vignette: number;
};

// "1 - roomLightness * 0.75" / "0.25 + roomLightness * 0.75"
function weight(formula: string, roomLightness: number, what: string): number {
  const parts = requireMatch(
    formula,
    /^\s*([\d.]+)\s*([+-])\s*roomLightness\s*\*\s*([\d.]+)\s*$/u,
    what,
  );
  const shift = Number(parts[3]) * roomLightness;
  return round4(Number(parts[1]) + (parts[2] === "-" ? -shift : shift));
}

/**
 * ГЛАВНОЕ РЕШЕНИЕ МЕТКИ: вес света против веса тени.
 *
 * Белое свечение пропадает на светлой комнате, поэтому механизма два — тёплое
 * пятно и мягкая тень по краям, — и их вес считает ОДНО число комнаты
 * (tokens.json → lightnessMix). Кремовая (0.82) получает свет 0.385 против
 * тени 0.865 и держится тенью; неоновая «Дерзкая» (0.15) — свет 0.8875 против
 * тени 0.3625 и держится светом. Ветка кода при этом одна: `if` тут нет и
 * быть не должно — меняется только число комнаты.
 *
 * ПОЧЕМУ ЧИСЛОМ, А НЕ CSS-переменной. tokens.css объявляет веса как `calc()`
 * от `--room-lightness` в `:root`. Но var() внутри значения пользовательского
 * свойства подставляется НА ТОМ ЖЕ элементе, где свойство объявлено: потомки
 * наследуют уже посчитанный `calc(1 - 0.5 * 0.75)`, и `--room-lightness`,
 * выставленный ниже по дереву (на сцене), на него уже не влияет — все комнаты
 * получили бы веса нейтральной 0.5. Поэтому вес считается здесь и приезжает
 * на сцену готовым числом; формула при этом всё равно берётся из пакета.
 */
export function markerWeights(roomLightness: number): MarkerWeights {
  const mix = zoneMarker.lightnessMix;
  return {
    bloom: weight(mix.bloomWeight, roomLightness, "zoneMarker.lightnessMix.bloomWeight"),
    vignette: weight(mix.vignetteWeight, roomLightness, "zoneMarker.lightnessMix.vignetteWeight"),
  };
}

/**
 * Тёплое пятно зоны. Центр смещён к верху прямоугольника — свет в комнате
 * падает сверху, пятно обязано совпадать с логикой освещения кадра; края
 * растворяются в прозрачность на 72% радиуса, поэтому границы пятна не видно
 * и оно читается как освещение, а не как фигура.
 *
 * Вытянутость — `bloomAR` зоны: два числа вместо силуэтной маски (вертикальное
 * пятно у шкафа, горизонтальное у полки). Акцент подставляется как
 * `var(--accent)` — цвет комнаты живёт в одной переменной на сцене.
 *
 * `…` в шаблоне — многоточие прозы («края растворяются»), а не стоп градиента.
 */
export function bloomShape(bloomAR: number): string {
  const shape = zoneMarker.bloom.shape.replace(/\s*…/gu, "");
  return fill(
    fill(shape, "ar", String(bloomAR), "zoneMarker.bloom.shape"),
    "accent",
    "var(--accent)",
    "zoneMarker.bloom.shape",
  );
}

/**
 * Мягкая тень по краям прямоугольника: предмет в центре остаётся освещённым,
 * а кадр вокруг него притемняется — на светлой комнате это и есть метка.
 * Вес тени идёт в АЛЬФУ цвета (`rgba(24,14,6,{weight})` — так написан
 * контракт), поэтому слою остаётся его собственная альфа состояния.
 */
export function vignetteShape(weights: MarkerWeights): string {
  const shadow = fill(
    zoneMarker.vignette.shadow,
    "weight",
    String(weights.vignette),
    "zoneMarker.vignette.shadow",
  );
  return fill(zoneMarker.vignette.shape, "shadow", shadow, "zoneMarker.vignette.shape");
}

/**
 * Пунктирная рамка фокуса. Единственное место, где рамка законна: фокус обязан
 * быть геометрически явным, свет для клавиатурного обхода не годится.
 */
export function focusOutline(): string {
  return fill(zoneMarker.focus.outline, "accent", "var(--accent)", "zoneMarker.focus.outline");
}

/**
 * Порог переворота подписи — из прозы контракта: «под нижней границей зоны,
 * слева; если зона ниже 70% высоты сцены — над верхней».
 */
const LABEL_FLIP_PCT = Number(
  requireMatch(zoneMarker.label.position, /(\d+)\s*%/u, "zoneMarker.label.position")[1],
);

/**
 * Подпись переезжает НАД зону, когда её нижняя граница уходит ниже порога —
 * иначе подпись уедет за кадр. Мерим именно нижнюю границу: у высокой зоны
 * (шкаф во всю стену) верх лежит высоко, а подпись всё равно рисуется под
 * низом, и решать обязан тот край, у которого она встанет.
 *
 * Мера — доля КАДРА: слой хотспотов повторяет геометрию кадра, а кадр по
 * вертикали занимает сцену целиком (351 из 352 на телефоне, 624 из 625 на
 * десктопе), поэтому «доля кадра» и «доля высоты сцены» совпадают с точностью
 * 0.3% — одно правило верно на обеих раскладках, без медиазапроса.
 */
export function labelAboveZone(box: { top: number; height: number }): boolean {
  return box.top + box.height > LABEL_FLIP_PCT;
}
