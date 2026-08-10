// Общее ядро «положить курируемый набор в комнату» — то, чем пользуются
// посев стенда (тикет 61) и «начни с готового» (тикет 100).
//
// ОТКУДА ЗЁРНА. Источника два, и это не дубль, а две разные задачи:
//
//   • НАБОР ЖИВОМУ ЧЕЛОВЕКУ — КОНТРАКТ ДИЗАЙНА `handoff/seeds/seeds.json`
//     (тикет 136): 19 пулов ровно по 5 зёрен вида `{ name, price, photo? }`.
//     Значения пакета живут в пакете, а не в коде, — как rooms.json,
//     zones.json и tokens.json (CLAUDE.md: расхождение с пакетом = баг).
//     До тикета 136 эти зёрна лежали в коде, и их было 42 — по два на пул:
//     человек жал «начни с готового» и получал по две вещи на полку, то есть
//     комнату не наполненную, а начатую и брошенную;
//
//   • ПОСЕВ СТЕНДА — по-прежнему `src/config/demo-pools.ts`. Стенду нужны ОБА
//     МЕСТА — и вещи комнаты, и сокровищница с дарителем и годом, — иначе
//     витрине нечего показывать. Зёрен «уже своё» в контракте набора нет и
//     быть не должно: живому человеку они не достаются никогда (инвариант №2),
//     а выдумывать их для стенда — дело стенда, а не дизайна.
//
// Вещи создаёт `createItem` — тот же сервис, что стоит за формой «Добавить
// вещь», с той же Zod-схемой, проверкой зоны и инвалидацией кэша. Прямой
// записи в prisma.item здесь нет ни одной.
import { readFile } from "node:fs/promises";
import path from "node:path";
import seedsJson from "@design/seeds/seeds.json";
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
 * Пул СТЕНДА по ключу; hasOwn — чтобы ключи прототипа не пролезали как
 * «найденный пул» (тот же приём, что в demoGhostsFor). Ключа нет — пустой
 * список: пула `money` не существует ни в демо-пулах, ни в контракте набора,
 * и содержимое его мы не выдумываем — там копилка на мечту, а не вещи.
 *
 * Живому человеку эти зёрна не достаются: у набора свой вход — `livePoolSeeds`.
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
 * фото и рисует честную серую заливку со значком пула (тикет 82).
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

// ---------------------------- контракт набора (handoff/seeds/seeds.json) ----

/** Строка контракта: поля читаем поимённо, на чужие смотрит сторож. */
type SeedRow = Record<string, unknown>;

/** Карта пулов контракта; ключ пула — тот же, что в zones.json и rooms.json. */
const contractPools = ((seedsJson as unknown as { pools?: Record<string, readonly SeedRow[]> })
  .pools ?? {}) as Record<string, readonly SeedRow[]>;

/**
 * «39 000 ₽» → 39000. Контракт называет цену человеческой строкой, в БД она
 * ложится строкой под Decimal (float запрещён, CLAUDE.md). Разделители
 * разрядов и знак валюты выбрасываем, запятую считаем десятичной точкой.
 * Не число, ноль или минус — null: у такого зерна цены НЕТ.
 */
function rubFromContract(price: unknown): number | null {
  if (typeof price === "number") return Number.isFinite(price) && price > 0 ? price : null;
  if (typeof price !== "string") return null;
  const value = Number(price.replace(/[^\d,.]/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Поля «уже моё» — контракт набора их не присылает; сторож ловит появление. */
const FORBIDDEN_SEED_FIELDS = ["mine", "giverName", "receivedYear"] as const;

const rejected: string[] = [];

/**
 * СТОРОЖ НАБОРА. Зёрна переехали из кода в контракт (тикет 136), но оба
 * правила остались прежними — они про человека, а не про место хранения:
 *
 *   • ТОЛЬКО ЖЕЛАНИЯ. Ни «уже моё», ни дарителя, ни года. Комната — список
 *     желаний, а сокровищница — то, что уже своё; чужая выдумка туда попасть
 *     не может, имя дарителя приходит ровно одним путём — через «Дошло»
 *     (инвариант №2). Раньше правило держал фильтр `!seed.mine` по демо-пулам,
 *     теперь тот же вопрос задаётся контракту. Зерно с таким полем
 *     выбрасывается ЦЕЛИКОМ, а не «чинится» отбрасыванием поля: набор,
 *     который что-то молча правит в присланном, перестаёт быть контрактом;
 *
 *   • ЦЕНА У КАЖДОГО. Зерно, чью цену не прочесть числом, набор не понесёт:
 *     вещь комнаты без цены гостю нечем ни оценить, ни забронировать.
 *
 * Выброшенное — не тихая потеря: имя уходит в `packSeedsRejected`, и тест
 * держит этот список пустым.
 */
function seedFromContract(row: SeedRow): PackSeed | null {
  const title = typeof row.name === "string" ? row.name.trim() : "";
  if (title.length === 0) {
    rejected.push("(зерно без названия)");
    return null;
  }
  if (FORBIDDEN_SEED_FIELDS.some((field) => row[field] !== undefined && row[field] !== null)) {
    rejected.push(title);
    return null;
  }
  const priceRub = rubFromContract(row.price);
  if (priceRub === null) {
    rejected.push(title);
    return null;
  }
  // Кадр контракт называет ИМЕНЕМ ФАЙЛА (`p-scarf.jpg`); внутри продукта тот
  // же кадр живёт путём раздачи `refs/{файл}` — его понимают и хранилище
  // набора (`storePackagePhoto`), и `itemPhotoUrl`. Имя не той формы — зерно
  // остаётся без кадра и рисуется серой заливкой со значком пула (тикет 82):
  // вещь важнее картинки.
  const photo = typeof row.photo === "string" && SAFE_REF_NAME.test(row.photo) ? row.photo : null;
  return { mine: false, title, priceRub, ...(photo ? { photo: `refs/${photo}` } : {}) };
}

/**
 * Зёрна набора по пулам — контракт, пропущенный через сторожа. Считается один
 * раз при загрузке модуля (как `rooms` в config/design): `starterPackSize`
 * зовут на каждый рендер пустой комнаты, и разбирать ради этого json заново
 * незачем.
 */
const packSeeds: Record<string, readonly PackSeed[]> = Object.fromEntries(
  Object.entries(contractPools).map(([pool, rows]) => [
    pool,
    rows.map(seedFromContract).filter((seed): seed is PackSeed => seed !== null),
  ]),
);

/** Названия зёрен, которые сторож не пропустил. В здоровом контракте — пусто. */
export const packSeedsRejected: readonly string[] = rejected;

/**
 * Зёрна, которые набор приносит ЖИВОМУ человеку, — контракт дизайна, и в нём
 * только желания с ценой (см. сторожа выше).
 *
 * Ключа нет — пустой список, и это не исключение: контракт живёт отдельно от
 * кода и приезжает раньше него. Зона `money` пула не имеет намеренно — там
 * копилка на мечту, а не вещи, и выдумывать ей содержимое мы не станем.
 */
export function livePoolSeeds(poolKey: string): readonly PackSeed[] {
  return (Object.hasOwn(packSeeds, poolKey) ? packSeeds[poolKey] : undefined) ?? [];
}

/**
 * Семя пула → инпут createItem (ровно те же поля, что заполняет форма).
 *
 * Семя-желание ложится в КОМНАТУ с ценой; семя «уже своё» — СРАЗУ В
 * СОКРОВИЩНИЦУ (вход `inHall: true` у createItem свой, тикет 89), отдельного
 * `toggleHall` после создания не нужно.
 *
 * `withGiftHistory` решает только про историю подарка:
 * - стенд (true) — даритель и год нужны, иначе витрине нечего показывать;
 * - все остальные (false) — их не переносим. «Подарок от мамы, 2024» в чужой
 *   комнате — выдуманное воспоминание, а имя дарителя попадает в комнату
 *   ровно одним путём, через «Дошло» (инвариант №2).
 */
export function createInputFor(
  zoneKey: string,
  seed: PackSeed,
  photoKey: string | null,
  options: { withGiftHistory?: boolean } = {},
) {
  const common = { zone: zoneKey, title: seed.title, ...(photoKey ? { photoKey } : {}) };
  if (!seed.mine) {
    // Деньги строкой под Decimal — float запрещён (CLAUDE.md). Валюта пулов
    // рублёвая; своего поля валюты у комнаты нет.
    return { ...common, inHall: false as const, price: String(seed.priceRub), currency: "RUB" };
  }
  if (!options.withGiftHistory) return { ...common, inHall: true as const };
  return {
    ...common,
    inHall: true as const,
    ...(seed.giverName ? { giverName: seed.giverName } : {}),
    ...(seed.receivedYear ? { receivedYear: seed.receivedYear } : {}),
  };
}
