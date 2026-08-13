// Зоны сцены: фильтр выключенных и подписи из справочника zones.json.
import { zoneInfo, type RoomZone } from "@/config/design";

/**
 * Полки комнаты, какие у неё есть: пресет минус выключенные хозяйкой
 * (`Room.zonesOff` — исчезают вместе с мебелью, инвариант CLAUDE.md §5).
 *
 * ЭТО СПИСОК ПОЛОК, А НЕ СПИСОК МЕТОК В КАДРЕ (тикет 235). Живая полка без
 * места на кадре сюда входит: страница у неё есть, вещи на месте, добавление
 * работает — нет только прямоугольника. Кому нужен кадр, тот зовёт `sceneZones`.
 */
export function visibleZones<T extends { key: string }>(
  zones: readonly T[],
  zonesOff: readonly string[] | null | undefined,
): T[] {
  const off = new Set(zonesOff ?? []);
  return zones.filter((zone) => !off.has(zone.key));
}

/**
 * Зоны СЦЕНЫ — те, у кого есть место на кадре (тикет 235).
 *
 * Метка живёт на прямоугольнике, а у полки без места его нет: рисовать нечего и
 * ехать камере некуда. Тем же списком живёт указатель зон — номер его пункта
 * есть номер метки в кадре, и разъехаться этим двум нельзя.
 *
 * Вход в такую полку — список зон комнаты (`/room/list` → `/room/zone/{ключ}`);
 * это его второе назначение, и с этого тикета оно несущее.
 */
export function sceneZones<T extends { key: string; withoutRect?: boolean }>(
  zones: readonly T[],
  zonesOff: readonly string[] | null | undefined,
): T[] {
  return visibleZones(zones, zonesOff).filter((zone) => !zone.withoutRect);
}

/**
 * «Полка 02 из 13» — место зоны среди тех, что ЕСТЬ В КАДРЕ (тикет 99, доска
 * Б27).
 *
 * Считается по списку сцены, а не по пресету: выключенная зона исчезает с
 * мебелью, и если считать по пресету, номера поедут через дыры — человек увидит
 * «полка 07 из 13» там, где перед ней стоит пятая. Тем же доводом сюда не идёт
 * и полка без места на кадре (тикет 235): её метки в кадре нет, и всё, что
 * стоит за ней, поехало бы на единицу.
 *
 * `null` — номера у зоны нет: она выключена, чужая или как раз без места на
 * кадре. Последняя честно остаётся без строки «полка N из M»: места в кадре у
 * неё нет, называть его числом нечем.
 */
export function zonePosition<T extends { key: string; withoutRect?: boolean }>(
  zones: readonly T[],
  zonesOff: readonly string[] | null | undefined,
  key: string,
): { index: number; total: number } | null {
  const shown = sceneZones(zones, zonesOff);
  const at = shown.findIndex((zone) => zone.key === key);
  return at === -1 ? null : { index: at + 1, total: shown.length };
}

/** Подпись зоны — из справочника zones.json; запасной путь — label пресета. */
export function zoneLabel(zone: RoomZone): string {
  return zoneInfo(zone.key)?.label ?? zone.label;
}

/**
 * Глагол раскрытия: у зоны с кадром «открыто» — свой (rooms.json),
 * у остальных — общий из справочника zones.json.
 *
 * ЧЕЛОВЕКУ ЭТО СЛОВО НЕ ПОКАЗЫВАЕТСЯ (тикет 59): «чемодан раскрывается»
 * описывает, что показывает КАДР раскрытия, — это язык съёмки, нужный нам с
 * дизайнером. Функция осталась и остаётся намеренно: глагол — данные контракта,
 * по ним идёт приёмка кадров («делает ли кадр то, что обещает глагол»,
 * tests/design-contract.test.ts). Не удалять как мёртвый код.
 */
export function zoneVerb(zone: RoomZone): string | null {
  return zone.openVerb ?? zoneInfo(zone.key)?.openVerb ?? null;
}
