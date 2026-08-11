// Миниатюра КАДРА для строки полки в карточке вещи (тикет 196, контракт
// `round45/item-card.json` → owner.order: «полка миниатюрой кадра 76×48 +
// „Полка целиком"»).
//
// ЗАЧЕМ ОТДЕЛЬНЫМ МОДУЛЕМ. Это арифметика проекции, а не разметка: она обязана
// проверяться вызовом, а не глазами по скриншоту, и жить рядом с остальными
// переводами координат зоны. Прежде на этом месте стоял значок пула — он
// отвечал «какая это полка», а вопрос хозяйки другой: «ТАМ ЛИ ОНА СТОИТ».
// Кусок её собственного интерьера отвечает на него точнее любого значка.
//
// КООРДИНАТЫ — ТОЛЬКО ИЗ `rooms.json`, в системе кадра 630×351 (ADR-0006,
// конвенция CLAUDE.md). Своей карты здесь нет и быть не может: функция берёт
// прямоугольник зоны как есть и переводит его в фон коробки 76×48.
import type { ZoneRect } from "@/config/design";

/** Кадр комнаты — та же система, что у прямоугольников зон (ADR-0006). */
export const FRAME = { w: 630, h: 351 } as const;

/** Коробка миниатюры — 76×48 из контракта. Абсолютная, как цели нажатия. */
export const SHELF_THUMB = { w: 76, h: 48 } as const;

/**
 * Фон коробки `SHELF_THUMB`, показывающий прямоугольник зоны целиком и без
 * пустых полей: кадр масштабируется «по накрытию» (максимум из двух отношений)
 * и сдвигается так, чтобы центр зоны встал в центр коробки. Сдвиг зажимается
 * краями кадра — иначе у зон на краю комнаты вылезала бы пустота.
 *
 * Возвращает готовые значения CSS, а не объект стилей: вызывающая сторона сама
 * решает, чем их подставить (у карточки это `style` строки полки).
 */
export function shelfFrameBackground(
  rect: ZoneRect,
  url: string,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const scale = Math.max(SHELF_THUMB.w / rect.w, SHELF_THUMB.h / rect.h);
  const width = FRAME.w * scale;
  const height = FRAME.h * scale;
  const clamp = (value: number, min: number) => Math.min(0, Math.max(min, value));
  const x = clamp(
    (SHELF_THUMB.w - rect.w * scale) / 2 - rect.x * scale,
    SHELF_THUMB.w - width,
  );
  const y = clamp(
    (SHELF_THUMB.h - rect.h * scale) / 2 - rect.y * scale,
    SHELF_THUMB.h - height,
  );
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${round(width)}px ${round(height)}px`,
    backgroundPosition: `${round(x)}px ${round(y)}px`,
  };
}

/** Десятые доли пикселя: длинный хвост в разметке ничего не решает. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
