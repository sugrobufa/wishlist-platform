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
  title: string;
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
  /**
   * Буква названия на серой заливке — та же техническая пометка «фото нет»,
   * что и сама заливка, только видимая (тикет 68). null, когда фото есть.
   */
  monogram: string | null;
};

/**
 * Первая буква названия для заглушки. Разбор по code points, а не charAt:
 * названия приходят от людей, и суррогатная пара (эмодзи в начале) не должна
 * разъезжаться половинкой символа.
 */
function firstLetter(title: string): string | null {
  const letter = [...title.trim()][0];
  return letter ? letter.toLocaleUpperCase("ru") : null;
}

export function tileAppearance(item: TileItemLike): TileAppearance {
  const dashed = item.state === "WANT";
  const greyFill = item.photoUrl === null;
  return {
    dashed,
    accentBar: dashed,
    greyFill,
    ghost: item.isDemo,
    // ИНВАРИАНТ №3 НЕ ЗАТРОНУТ: буква приходит вместе с серой заливкой, то
    // есть кодирует ровно «фотографии нет», как заливка и кодировала. Пунктир
    // по-прежнему говорит «хочу» и ставится независимо — их пары в коде нет.
    monogram: greyFill ? firstLetter(item.title) : null,
  };
}
