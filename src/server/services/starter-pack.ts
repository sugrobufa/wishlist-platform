// «Или начни с готового» (тикет 100, доска Б23 · турны 12c и 14a;
// `task15.json → emptyStates.emptyRoom.starterPack`).
//
// Первый экран новичка — комната, в которой ещё ничего нет. Вставить ссылку
// из магазина умеет не каждый и не сразу; доска даёт второй вход: взять
// готовую подборку и дальше менять её под себя.
//
// ЧТО ЭТО НЕ ТАКОЕ. Не призраки: те рисовались поверх пустых зон сами и
// сняты тикетом 104 — «пример — замени на своё» в личной комнате читался как
// чужой выбор. Набор попадает в комнату ТОЛЬКО по нажатию, вещи настоящие,
// свои, редактируются и удаляются как любые другие. Вердикт дизайна
// (`emptyStates.verdict`) разрешает ровно это: «стартовый контент — только
// подборка „начни с готового" по согласию».
//
// ЧЕГО НАБОР НЕ ПРИНОСИТ. Дарителей и годов («Подарок от мамы, 2024») и
// витрины сокровищницы: выдуманное воспоминание — не стартовый контент.
// Имя дарителя попадает в комнату ровно одним путём — через «Дошло»
// (инвариант №2). За это отвечает `withGiftHistory: false` в pack-seeds.
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { createItem } from "@/server/services/items";
import { putObjectViaPresign } from "@/server/s3";
import {
  createInputFor,
  poolSeeds,
  storePackagePhoto,
  type PackStorage,
} from "@/server/services/pack-seeds";

const idSchema = z.string().min(1).max(64);

/** Видимые зоны комнаты: пресет минус выключенные хозяйкой (инвариант №5). */
function visiblePresetZones(preset: string, zonesOff: readonly string[]) {
  const found = roomPresets.find((candidate) => candidate.id === preset);
  return (found?.zones ?? []).filter((zone) => !zonesOff.includes(zone.key));
}

/**
 * Сколько вещей принесёт набор — то самое «+40» с доски. Число СЧИТАЕТСЯ по
 * пулам видимых зон, а не пишется в строку: у мужских и женских наборов зон
 * пулы разные, и обещать всем одно и то же число значит обмануть половину.
 *
 * Функция чистая — экран зовёт её при рендере, БД для этого не нужна.
 */
export function starterPackSize(preset: string, zonesOff: readonly string[]): number {
  return visiblePresetZones(preset, zonesOff).reduce(
    (sum, zone) => sum + poolSeeds(zone.pool).length,
    0,
  );
}

export type StarterPackResult = {
  /** false — комнаты нет (человек ещё не прошёл онбординг). */
  roomFound: boolean;
  created: number;
  photos: number;
};

/**
 * Положить набор в СВОЮ комнату. Идемпотентно тем же правилом, что посев
 * стенда: зона, в которой уже есть хоть одна вещь, пропускается целиком —
 * повторное нажатие (двойной тап, префетч) не плодит дублей и не трогает
 * того, что человек завёл руками.
 */
export async function applyStarterPack(
  userId: string,
  storage: PackStorage = { putObject: putObjectViaPresign },
): Promise<StarterPackResult> {
  const id = idSchema.parse(userId);
  const room = await prisma.room.findUnique({
    where: { userId: id },
    select: { id: true, preset: true, zonesOff: true },
  });
  if (!room) return { roomFound: false, created: 0, photos: 0 };

  const result: StarterPackResult = { roomFound: true, created: 0, photos: 0 };

  for (const zone of visiblePresetZones(room.preset, room.zonesOff)) {
    const seeds = poolSeeds(zone.pool);
    if (seeds.length === 0) continue; // у зоны нет пула (money) — не выдумываем
    if ((await prisma.item.count({ where: { roomId: room.id, zone: zone.key } })) > 0) continue;

    for (const seed of seeds) {
      let photoKey: string | null = null;
      if (seed.photo) {
        try {
          photoKey = await storePackagePhoto(room.id, seed.photo, storage);
        } catch {
          // Фото не доехало — вещь всё равно появится, с серой заливкой.
          photoKey = null;
        }
        if (photoKey) result.photos += 1;
      }
      await createItem(id, createInputFor(zone.key, seed, photoKey));
      result.created += 1;
    }
  }

  return result;
}
