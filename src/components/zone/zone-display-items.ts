// Что показывает зона хозяйки: свои вещи, а при их отсутствии — демо-призраки
// пула (гриллинг №4), ЕСЛИ хозяйка не убрала примеры скопом (Room.demoGhostsOff,
// тикет 13). Чистая функция — общая для /room и /room/zone/[zone] и под
// unit-тестом (гость решает то же самое в services/guest-room по своим DTO).
import { demoGhostsFor, type DemoGhostDto } from "@/config/demo-pools";
import type { OwnerItemDto } from "@/server/dto/items";

export function zoneDisplayItems(
  own: OwnerItemDto[],
  zoneKey: string,
  poolKey: string,
  demoGhostsOff: boolean,
): Array<OwnerItemDto | DemoGhostDto> {
  if (own.length > 0 || demoGhostsOff) return own;
  return demoGhostsFor(zoneKey, poolKey);
}
