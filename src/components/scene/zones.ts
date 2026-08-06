// Зоны сцены: фильтр выключенных и подписи из справочника zones.json.
import { zoneInfo, type RoomZone } from "@/config/design";

/**
 * Выключенные зоны (Room.zonesOff) исчезают вместе с мебелью — в список
 * рендера не попадают вовсе (инвариант CLAUDE.md §5).
 */
export function visibleZones<T extends { key: string }>(
  zones: readonly T[],
  zonesOff: readonly string[] | null | undefined,
): T[] {
  const off = new Set(zonesOff ?? []);
  return zones.filter((zone) => !off.has(zone.key));
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
