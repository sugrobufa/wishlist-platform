// Сервис «посев стенда» (тикет 61): наполнить комнату владельца ТЕСТОВОГО
// СТЕНДА настоящими вещами. До него в комнате было ноль вещей, и каждая зона
// рисовала демо-призраков с бейджем «пример» (src/config/demo-pools →
// demoGhostsFor): продукт работал, показывать было нечего.
//
// ЕДИНСТВЕННЫЙ ВЫЗЫВАЮЩИЙ — быстрый вход (src/server/quick-login.ts), и он
// передаёт сюда ровно QUICK_LOGIN_EMAIL из окружения. Модель защиты взята у
// соседней операции того же рода — сброса стенда (services/stand-reset.ts) —
// и повторена дословно: работает только при QUICK_LOGIN_ENABLED=true и только
// для почты из окружения. Ни один параметр запроса не выбирает, кого наполнять.
//
// ЧЕМ СЕЮТ (тикет 175). Комната — КОНТРАКТОМ ДИЗАЙНА, сокровищница —
// демо-пулами, и граница между половинами — признак зерна:
//
//   • ЖЕЛАНИЯ берутся `livePoolSeeds` из `handoff/seeds/seeds.json` — ровно
//     те же 19 пулов по 5 зёрен, что достаются живому человеку по кнопке
//     «начни с готового». Иначе владелец смотрит на стенде вещи, которые
//     придумали МЫ, а человек получает вещи из пакета: две разные комнаты, и
//     стенд показывает не продукт, а наш черновик;
//
//   • «УЖЕ СВОЁ» — из `src/config/demo-pools.ts`, и только зёрна с признаком
//     `mine` (даритель, год, предметный кадр `refs/p-*.jpg`). Витрине
//     сокровищницы без них нечего показывать, а в контракте такого зерна нет
//     и быть не должно: живому человеку имя дарителя достаётся ровно одним
//     путём — через «Дошло» (инвариант №2). Всё остальное из демо-пулов
//     посев больше не берёт.
//
// Обе половины складывает `standPoolSeeds` (services/pack-seeds) — там же
// живёт и сторож контракта: зерно без цены или с полем «уже моё» в комнату не
// поедет, а кадр, которого нет файлом в `design/package/refs/`, отбрасывается
// вместе с картинкой, но не с вещью (число — в `contractPhotosMissing`).
//
// ЧЕМ НЕ СЕЮТ. Прямой записи в prisma.item здесь нет ни одной: вещи создаёт
// `createItem` — тот же сервис, что стоит за формой «Добавить вещь», с той же
// Zod-схемой, теми же проверками зоны и photoKey и той же инвалидацией кэша.
// В сокровищницу вещь кладёт сам `createItem` (вход «сразу в сокровищницу»,
// тикет 89) — той же дверью, которой пользуется хозяйка. Посев ходит по
// продуктовым дверям, а не мимо них.
//
// ПОСЕВ ТОЛЬКО ДОБАВЛЯЕТ. Ни одного удаления и ни одного update чужого поля:
// стирание — отдельная существующая операция (stand-reset, /dev-login?fresh=1).
//
// ИДЕМПОТЕНТНОСТЬ — «сеем только в пустую зону». Зона, где есть хоть одна
// вещь, пропускается целиком. Правило выбрано под уже существующее правило
// продукта: демо-призраки показываются ровно до первой своей вещи в зоне
// (components/zone/zone-display-items), то есть «зона пуста» — это и есть та
// граница, на которой продукт уже принимает решения. Побочные выгоды: посев
// не трогает то, что владелец завёл руками, и повторный клик по ссылке
// (двойной тап, префетч браузера) не плодит дубли.
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets, type RoomZone } from "@/config/design";
import { createItem } from "@/server/services/items";
import { putObjectViaPresign } from "@/server/s3";
import {
  createInputFor,
  packSeedsPhotosMissing,
  standPoolKeys,
  standPoolSeeds,
  storePackagePhoto,
  type PackStorage,
} from "@/server/services/pack-seeds";

/** Шов хранилища — тестам (как StandResetStorage в services/stand-reset). */
export type StandSeedStorage = PackStorage;

/**
 * Зона-витрина: единственная зона, которую посев наполняет ДВУМЯ пулами.
 *
 * Заведена под правило тикета 59 («ещё N» в подписи ссылки и честная кромка
 * прокрутки): оно включается, когда своих вещей в зоне больше пяти, а самый
 * большой демо-пул давал ровно пять — и увидеть правило было негде. С тикета
 * 175 больше пяти даёт КАЖДАЯ зона — семь: пять желаний контракта плюс два
 * «уже своё» демо-пула, — так что добор перестал быть единственным способом.
 * Он остался ради запаса: в витрине четырнадцать вещей против семи в соседних,
 * и разница между полкой и полкой, которая не влезла, видна глазами.
 *
 * Витриной выбрана «Что угодно»: она есть в каждом из десяти пресетов
 * (это же проверяет rooms.changeRoomPreset) и по замыслу пакета «ловит всё,
 * что не влезло в категории» (комментарий zonesHiddenByProduct в
 * config/design). Добор — целый пул категории, которой в ЭТОМ интерьере не
 * досталось полки: это ровно то, что зона и означает.
 */
const SHOWCASE_ZONE_KEY = "anything";

/**
 * Какой пул брать в добор. Первые два — единственные пулы, чьё зерно «уже
 * своё» приходит с дарителем и годом («Теннисный браслет» от мамы, «Дайвер»
 * от папы). Женским пресетам не достаётся полка `watches`, мужским — `jewel`,
 * поэтому один из двух свободен всегда, и зал славы получает ДВЕ вещи с
 * историей подарка вместо одной. Если оба уже с полками — берём первый
 * свободный пул в порядке объявления (в нынешних десяти пресетах такого не
 * бывает). Добор приезжает целиком, обеими половинами: желания пула — из
 * контракта, «уже своё» — из демо-пула.
 */
const SPILLOVER_PREFERENCE = ["watches", "jewel"] as const;

/** Почему зона осталась без посева. */
export type StandSeedSkip = "has-items" | "no-pool";

export type StandSeedZoneReport = {
  zone: string;
  /** Ключ пула из rooms.json; для зоны без пула (`money`) — он же, пустой. */
  pool: string;
  /** null — сеяли; иначе почему пропустили. */
  skipped: StandSeedSkip | null;
  created: number;
  /** Сколько вещей зоны легло СРАЗУ В СОКРОВИЩНИЦУ («уже своё»). */
  hall: number;
  /** Сколько осталось в комнате — желания с ценой. */
  room: number;
  /** Сколько вещей зоны получили настоящее фото в нашем S3. */
  photos: number;
};

export type StandSeedResult = {
  /** false — пользователя с такой почтой ещё нет: наполнять нечего. */
  userFound: boolean;
  /** false — комнаты нет (владелец ещё не прошёл онбординг). */
  roomFound: boolean;
  itemsCreated: number;
  photosStored: number;
  /** Фото, которое не доехало до S3: вещь всё равно создана, но без фото. */
  photosFailed: number;
  /**
   * Кадров контракта, которых нет файлом в `design/package/refs/` (тикет 175).
   * Это свойство ПАКЕТА, а не прогона: такие зёрна приезжают без кадра, вещи
   * из них создаются, просто с серой заливкой. Ноль — норма; больше нуля —
   * контракт назвал файл, которого у нас нет, и это видно в отчёте, а не
   * только в логе.
   */
  contractPhotosMissing: number;
  /** Сколько вещей «уже своё» легло в витрину сокровищницы. */
  hallItems: number;
  /** Зона-витрина, если её сеяли в этот раз (иначе null). */
  showcaseZone: string | null;
  /** Пул, доехавший в витрину сверх её собственного (иначе null). */
  spilloverPool: string | null;
  zones: StandSeedZoneReport[];
};

function emptyResult(overrides: Partial<StandSeedResult> = {}): StandSeedResult {
  return {
    userFound: false,
    roomFound: false,
    itemsCreated: 0,
    photosStored: 0,
    photosFailed: 0,
    contractPhotosMissing: packSeedsPhotosMissing.length,
    hallItems: 0,
    showcaseZone: null,
    spilloverPool: null,
    zones: [],
    ...overrides,
  };
}

/** Пул для добора витрины — первый, у которого нет своей полки в комнате. */
function spilloverPoolFor(zones: readonly RoomZone[]): string | null {
  const taken = new Set(zones.map((zone) => zone.pool));
  const candidates = [...SPILLOVER_PREFERENCE, ...standPoolKeys];
  return candidates.find((key) => !taken.has(key) && standPoolSeeds(key).length > 0) ?? null;
}

/**
 * Наполнить комнату владельца стенда. Идемпотентно: нет пользователя, нет
 * комнаты или все зоны уже с вещами — тихо возвращаем «нечего было делать».
 *
 * @param ownerEmail почта ВЛАДЕЛЬЦА СТЕНДА (QUICK_LOGIN_EMAIL, уже
 *        нормализованная). Другой почты сюда приходить неоткуда — см. шапку.
 */
export async function seedStandRoom(
  ownerEmail: string,
  storage: StandSeedStorage = { putObject: putObjectViaPresign },
): Promise<StandSeedResult> {
  const email = z.string().min(3).max(320).parse(ownerEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, room: { select: { id: true, preset: true, zonesOff: true } } },
  });
  if (!user) return emptyResult();
  const room = user.room;
  if (!room) return emptyResult({ userFound: true });

  // Видимые зоны комнаты — как их считает сам продукт: пресет из rooms.json
  // (уже без скрытых продуктом зон) минус выключенные хозяйкой. Ту же проверку
  // повторит createItem, отказом ZONE_NOT_VISIBLE.
  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  const zones = (preset?.zones ?? []).filter((zone) => !room.zonesOff.includes(zone.key));

  const spilloverPool = spilloverPoolFor(zones);
  const result = emptyResult({ userFound: true, roomFound: true, spilloverPool });

  for (const zone of zones) {
    const isShowcase = zone.key === SHOWCASE_ZONE_KEY;
    const seeds = [
      ...standPoolSeeds(zone.pool),
      ...(isShowcase && spilloverPool ? standPoolSeeds(spilloverPool) : []),
    ];
    const report: StandSeedZoneReport = {
      zone: zone.key,
      pool: zone.pool,
      skipped: null,
      created: 0,
      hall: 0,
      room: 0,
      photos: 0,
    };
    result.zones.push(report);

    if (seeds.length === 0) {
      report.skipped = "no-pool";
      continue;
    }
    // ИДЕМПОТЕНТНОСТЬ: зона с вещами не трогается вовсе — ни своих вещей
    // владельца не тронем, ни дублей не наделаем.
    if ((await prisma.item.count({ where: { roomId: room.id, zone: zone.key } })) > 0) {
      report.skipped = "has-items";
      continue;
    }
    if (isShowcase) result.showcaseZone = zone.key;

    for (const seed of seeds) {
      let photoKey: string | null = null;
      if (seed.photo) {
        try {
          photoKey = await storePackagePhoto(room.id, seed.photo, storage);
        } catch (error) {
          console.error(
            `[посев стенда] фото ${seed.photo} для «${seed.title}» не доехало в S3 — ` +
              "вещь создаётся без фото (серая заливка)",
            error,
          );
        }
        if (photoKey) result.photosStored += 1;
        else result.photosFailed += 1;
      }

      // Стенду даритель и год НУЖНЫ: без них витрине сокровищницы нечего
      // показывать. Живому человеку набор их не приносит (тикет 100).
      // С тикета 124 семя «уже своё» ложится на витрину самим createItem —
      // отдельного toggleHall после создания не нужно.
      await createItem(
        user.id,
        createInputFor(zone.key, seed, photoKey, { withGiftHistory: true }),
      );
      result.itemsCreated += 1;
      report.created += 1;
      if (photoKey) report.photos += 1;
      if (!seed.mine) {
        report.room += 1;
        continue;
      }
      report.hall += 1;
      result.hallItems += 1;
    }
  }

  const filled = result.zones.filter((zone) => zone.created > 0).length;
  console.info(
    `\n🌱 [посев стенда] комната владельца наполнена: вещей ${result.itemsCreated} ` +
      `в ${filled} зонах, фото в S3 ${result.photosStored}` +
      (result.photosFailed > 0 ? ` (не доехало ${result.photosFailed})` : "") +
      `, в зале славы ${result.hallItems}` +
      (result.contractPhotosMissing > 0
        ? `. Кадров контракта нет в пакете: ${result.contractPhotosMissing} ` +
          `(${packSeedsPhotosMissing.join(", ")}) — эти вещи без фото`
        : "") +
      `. Зоны с вещами пропущены — посев только добавляет.\n`,
  );

  return result;
}
