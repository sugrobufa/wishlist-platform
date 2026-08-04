// Классификатор вида плитки — чистая функция, отдельно от JSX, чтобы
// инвариант №3 (CLAUDE.md) был закреплён юнит-тестом:
// ПУНКТИР КОДИРУЕТ СОСТОЯНИЕ «ХОЧУ», А НЕ ОТСУТСТВИЕ ФОТО.
// В первой версии прототипа это перепутали (items.json → commonMistake):
// вещь «люблю» без фотографии — серая заливка БЕЗ пунктира.

/** Минимум, который нужен для вида плитки (структурно совместим с DTO). */
export type TileItemLike = {
  state: "LOVE" | "WANT";
  photoUrl: string | null;
  isDemo: boolean;
};

export type TileAppearance = {
  /** Пунктирный контур акцентом комнаты — только у «хочу». */
  dashed: boolean;
  /** Сплошная полоса 2px акцентом по нижнему краю — спутник пунктира (tokens.json → ghostItem.bar). */
  accentBar: boolean;
  /** Серая заливка вместо фото — техническое «нет фотографии», состояние не кодирует. */
  greyFill: boolean;
  /** Демо-призрак: полупрозрачность и бейдж «пример». */
  ghost: boolean;
};

export function tileAppearance(item: TileItemLike): TileAppearance {
  const dashed = item.state === "WANT";
  return {
    dashed,
    accentBar: dashed,
    greyFill: item.photoUrl === null,
    ghost: item.isDemo,
  };
}
