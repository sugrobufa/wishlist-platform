// Общее ядро «положить курируемый набор в комнату» — то, чем пользуются
// посев стенда (тикет 61) и «начни с готового» (тикет 100).
//
// Набор один на оба случая: `src/config/demo-pools.ts` — названия, цены,
// состояния «люблю/хочу» и предметные кадры пакета. Раньше он рисовался
// призраками поверх пустых зон; тикет 104 показ призраков снял, а сам набор
// оставил — теперь он попадает в комнату только по согласию человека.
//
// Вещи создаёт `createItem` — тот же сервис, что стоит за формой «Добавить
// вещь», с той же Zod-схемой, проверкой зоны и инвалидацией кэша. Прямой
// записи в prisma.item здесь нет ни одной.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { demoPools } from "@/config/demo-pools";
import { newItemPhotoKey } from "@/server/services/items";

/** Семя пула — форма из config/demo-pools (тип там не экспортирован). */
export type PackSeed = (typeof demoPools)[string][number];

/** Шов хранилища — тестам (как StandResetStorage в services/stand-reset). */
export type PackStorage = {
  putObject: (key: string, contentType: string, body: Uint8Array) => Promise<void>;
};

/** Предметные кадры пакета лежат там же, откуда их раздаёт /rooms/{имя}. */
const REFS_DIR = path.join(process.cwd(), "design", "package", "refs");

/** Все p-*.jpg пакета — один тип. Он же решает расширение ключа в S3. */
const PHOTO_CONTENT_TYPE = "image/jpeg";

/** Плоское имя файла пакета — та же форма, что у маршрута раздачи кадров. */
const SAFE_REF_NAME = /^[a-z0-9][a-z0-9-]*\.jpg$/;

/**
 * Пул по ключу; hasOwn — чтобы ключи прототипа не пролезали как «найденный
 * пул» (тот же приём, что в demoGhostsFor). Ключа нет — пустой список: пула
 * `money` в пакете не существует, и содержимое его мы не выдумываем.
 */
export function poolSeeds(poolKey: string): readonly PackSeed[] {
  return (Object.hasOwn(demoPools, poolKey) ? demoPools[poolKey] : undefined) ?? [];
}

/**
 * Фото семени — в НАШЕ S3 (инвариант №6: чужие изображения не хотлинкуем).
 * Путь ровно тот же, каким кладёт фото обычная загрузка из браузера:
 * `newItemPhotoKey` даёт ключ `items/{roomId}/{random}.{ext}`, дальше
 * подписанный PUT. Второго способа записи в хранилище не заводится.
 *
 * Возвращает ключ или null — «фото не доехало». Вещь при этом создаётся без
 * фото и рисует честную серую заливку: пунктир кодирует «хочу», а не
 * отсутствие фото (инвариант №3).
 */
export async function storePackagePhoto(
  roomId: string,
  ref: string,
  storage: PackStorage,
): Promise<string | null> {
  const name = ref.replace(/^refs\//, "");
  if (!SAFE_REF_NAME.test(name)) return null;
  const key = newItemPhotoKey(roomId, PHOTO_CONTENT_TYPE);
  if (!key) return null;
  const body = await readFile(path.join(REFS_DIR, name));
  await storage.putObject(key, PHOTO_CONTENT_TYPE, body);
  return key;
}

/**
 * Семя пула → инпут createItem (ровно те же поля, что заполняет форма).
 *
 * `withGiftHistory` разводит два случая, и разница здесь не косметическая:
 * - стенд (true) — подарок с дарителем и годом нужен, чтобы витрина зала
 *   славы вообще было чем показать;
 * - живой человек (false) — дарителя и год НЕ переносим. «Подарок от мамы,
 *   2024» в чужой комнате — выдуманное воспоминание, а сокровищница держит
 *   настоящие: имя дарителя туда попадает ровно одним путём, через «Дошло»
 *   (инвариант №2).
 */
export function createInputFor(
  zoneKey: string,
  seed: PackSeed,
  photoKey: string | null,
  options: { withGiftHistory?: boolean } = {},
) {
  const common = { zone: zoneKey, title: seed.title, ...(photoKey ? { photoKey } : {}) };
  if (seed.state === "WANT") {
    // Деньги строкой под Decimal — float запрещён (CLAUDE.md). Валюта пулов
    // рублёвая; своего поля валюты у комнаты нет.
    return { ...common, state: "WANT" as const, price: String(seed.priceRub), currency: "RUB" };
  }
  if (!options.withGiftHistory) return { ...common, state: "LOVE" as const };
  return {
    ...common,
    state: "LOVE" as const,
    ...(seed.giverName ? { giverName: seed.giverName } : {}),
    ...(seed.receivedYear ? { receivedYear: seed.receivedYear } : {}),
  };
}
