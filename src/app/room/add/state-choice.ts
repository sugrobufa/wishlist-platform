/**
 * «Что это для тебя» — модель двух панелей выбора (tokens.json → stateChoice,
 * турн 23a макета: «Выбор показывает комнату, а не абстракцию»).
 *
 * Обе панели показывают ОДИН И ТОТ ЖЕ кроп комнаты — одно место интерьера,
 * разница только в обработке. В этом весь смысл экрана: человек видит не две
 * абстракции, а одну свою полку в двух состояниях.
 *
 * ИНВАРИАНТ №3 (CLAUDE.md). Призрачный контур с полосой света кодирует «хочу»,
 * а НЕ отсутствие фотографии. У панели «люблю» пунктира нет ни при каких
 * обстоятельствах; ниже это одно поле `ghost`, а не производная от чего-либо
 * ещё, и на него есть тест (`state-choice.test.ts`).
 */
import type { ZoneRect } from "@/config/design";
import tokensJson from "@design/tokens.json";
import { zoneCrop, type ZoneCrop } from "@/components/scene/zone-crop";

export type ItemState = "WANT" | "LOVE";

type StateChoiceContract = { transition: string };

const stateChoice = (tokensJson as unknown as { stateChoice: StateChoiceContract }).stateChoice;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) throw new Error(`design/tokens.json: не удалось разобрать ${what}: "${value}"`);
  return match;
}

/**
 * Длительность перехода «выбрано/не выбрано» (contract: «opacity 240ms,
 * filter 240ms — easeOut»). CSS берёт её из `--state-choice-ms`; здесь она
 * нужна числом — ровно столько панель успевает показать выбор до того, как
 * экран сменится формой.
 */
export const stateChoiceMs = Number(
  requireMatch(stateChoice.transition, /([\d.]+)\s*ms/u, "stateChoice.transition")[1],
);

export type StateChoicePanel = {
  state: ItemState;
  /** Кроп зоны; null — зоны в комнате нет вовсе (панель остаётся без кадра). */
  crop: ZoneCrop | null;
  /** Призрачный контур + светящаяся полоса. Только «хочу» — инвариант №3. */
  ghost: boolean;
};

/**
 * Две панели по прямоугольнику зоны, куда вещь попадёт. Порядок — как в
 * макете: «люблю» слева, «хочу» справа.
 *
 * `rect` — зона, выбранная на форме, а пока она не выбрана — та, куда вещь
 * встанет по умолчанию (`?zone=…` или первая видимая зона комнаты). Отдельного
 * «пустого» состояния у экрана нет: место в комнате есть всегда.
 */
export function stateChoicePanels(rect: ZoneRect | null): StateChoicePanel[] {
  const crop = rect ? zoneCrop(rect) : null;
  return [
    { state: "LOVE", crop, ghost: false },
    { state: "WANT", crop, ghost: true },
  ];
}
