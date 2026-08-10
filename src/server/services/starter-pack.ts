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
// ЧТО В НАБОРЕ. Зёрна берутся из контракта дизайна
// `design/package/handoff/seeds/seeds.json` (тикет 136) — 19 пулов ровно по
// пять желаний с ценой. В коде их больше нет: значения пакета живут в пакете.
//
// ЧЕГО НАБОР НЕ ПРИНОСИТ. Дарителей и годов («Подарок от мамы, 2024») и
// вещей сокровищницы: выдуманное воспоминание — не стартовый контент.
// Имя дарителя попадает в комнату ровно одним путём — через «Дошло»
// (инвариант №2). За это отвечает `livePoolSeeds` (сторож контракта в
// pack-seeds: только желания и только с ценой) и `withGiftHistory: false`.
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets, zoneInfo } from "@/config/design";
import { createItem } from "@/server/services/items";
import { putObjectViaPresign } from "@/server/s3";
import {
  createInputFor,
  livePoolSeeds,
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
 * Порядок наполнения по ответу «что чаще всего хочется» (тикет 113, доска
 * 34b): выбранные категории идут ПЕРВЫМИ. Комнату это не меняет — полки
 * стоят там же и в том же порядке; меняется только очередь, в которой
 * подборка их наполняет, и потому первые вещи человек видит там, где сам
 * попросил. Пустой ответ (вопрос пропущен) — порядок пресета как был.
 */
function orderedByWants<T extends { key: string }>(zones: T[], wants: readonly string[]): T[] {
  if (wants.length === 0) return zones;
  const wanted = new Set(wants);
  return [
    ...zones.filter((zone) => wanted.has(zone.key)),
    ...zones.filter((zone) => !wanted.has(zone.key)),
  ];
}

/**
 * Сколько вещей принесёт набор — то самое «+N» с доски. Число СЧИТАЕТСЯ по
 * пулам видимых зон, а не пишется в строку: у мужских и женских наборов зон
 * пулы разные, и обещать всем одно и то же число значит обмануть половину.
 *
 * Контракт зёрен (тикет 136) дал каждому пулу ровно по пять желаний, и число
 * выросло с 27 до 60 у полной женской комнаты (13 зон, из них 12 с пулом:
 * у `money` зёрен нет — там копилка). Мужские интерьеры дают 50…60, женские
 * 55…60 — каждый своё, и потому оно и считается. Макет 41a рисует «+91»;
 * такого числа при пяти зёрнах на пул не выходит ни у одного из десяти
 * интерьеров (потолок — 13 зон × 5 = 65), и в строку оно не переписывается.
 *
 * Функция чистая — экран зовёт её при рендере, БД для этого не нужна.
 */
export function starterPackSize(preset: string, zonesOff: readonly string[]): number {
  return visiblePresetZones(preset, zonesOff).reduce(
    (sum, zone) => sum + livePoolSeeds(zone.pool).length,
    0,
  );
}

// ---------- Вопрос «что чаще всего хочется» (переехал сюда, письмо 33) ------
//
// Был четвёртым шагом онбординга (тикет 113, доска 34b) и стоял целым экраном
// между человеком и его комнатой. Дизайн согласился перенести и назвал причину
// сам: «причина шага была в подборке; после v2 её стартовый набор ужался вдвое
// — цена целого экрана выше пользы». Теперь вопрос звучит ЗДЕСЬ, при первом
// открытии набора, — там, где ответ сразу видно.
//
// Названная причина с тех пор отпала: контракт зёрен (тикет 136) вернул набору
// объём и сделал его вдвое больше прежнего. Переносить вопрос обратно всё
// равно незачем — на своём новом месте он лучше не потому, что подборка была
// короткой, а потому, что ответ здесь сразу виден в том, что человек получит.
//
// Что НЕ менялось: состав чипов, предел «3–4» и главное — ответ НЕ ТРОГАЕТ
// КОМНАТУ. Полки не переставляются и не выключаются; он красит порядок
// наполнения подборкой (`orderedByWants`) и порядок зон в форме добавления.

/**
 * Чипами не бывают две зоны. «Что угодно» ловит всё, что не влезло в
 * категории, «Просто деньги» — копилка, а не вещи: как ответ на «что хочется»
 * обе не значат ничего.
 */
const WANTS_EXCLUDED = new Set(["anything", "money"]);

export type StarterWants = {
  /** Чипы вопроса — зоны СВОЕЙ комнаты подписями из zones.json. */
  chips: Array<{ key: string; label: string }>;
  /** Уже сохранённый ответ (пусто — вопрос ещё не отвечали). */
  wants: string[];
  /** Чернила выбранного чипа — из данных комнаты (rooms.json), не из кода. */
  ink: string;
};

/**
 * Чипы вопроса для СВОЕЙ комнаты — чужую спросить нечем: комната берётся по
 * userId сессии. Комнаты нет (онбординг не пройден) — вопроса нет.
 */
export async function starterPackWants(userId: string): Promise<StarterWants | null> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { preset: true, zonesOff: true, wants: true },
  });
  if (!room) return null;

  return {
    chips: visiblePresetZones(room.preset, room.zonesOff)
      .filter((zone) => !WANTS_EXCLUDED.has(zone.key))
      .map((zone) => ({ key: zone.key, label: zoneInfo(zone.key)?.label ?? zone.label })),
    wants: room.wants,
    ink: roomPresets.find((candidate) => candidate.id === room.preset)?.ink ?? "#0B0806",
  };
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
    select: { id: true, preset: true, zonesOff: true, wants: true },
  });
  if (!room) return { roomFound: false, created: 0, photos: 0 };

  const result: StarterPackResult = { roomFound: true, created: 0, photos: 0 };

  for (const zone of orderedByWants(visiblePresetZones(room.preset, room.zonesOff), room.wants)) {
    const seeds = livePoolSeeds(zone.pool);
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
