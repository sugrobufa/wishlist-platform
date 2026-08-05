// Сервис «сброс стенда» (тикет 31): вернуть аккаунт владельца ТЕСТОВОГО
// СТЕНДА в состояние «первый раз», чтобы онбординг можно было пройти заново.
// Онбординг показывается ровно один раз в жизни аккаунта — только пока у
// человека нет комнаты (src/app/onboarding/page.tsx: `if (room) redirect`).
// Значит «пройти заново» = убрать комнату со всем её содержимым.
//
// ЕДИНСТВЕННЫЙ ВЫЗЫВАЮЩИЙ — быстрый вход (src/server/quick-login.ts), и он
// передаёт сюда ровно QUICK_LOGIN_EMAIL из окружения. Ни один параметр
// запроса на этот адрес не влияет: «кого стереть» снаружи не выбирают.
// Операция необратима, поэтому она узкая по построению — один пользователь,
// одна его комната.
//
// ЧТО УДАЛЯЕТСЯ (список сверен со схемой, а не «на глаз»):
//   • Room владельца — и по каскадам схемы вместе с ней:
//       Item (Item.room onDelete: Cascade)
//         → Booking (Booking.item onDelete: Cascade)
//             → PoolContribution (PoolContribution.booking onDelete: Cascade)
//         → PriceSnapshot (PriceSnapshot.item onDelete: Cascade)
//   • OccasionSummary — ЯВНО по roomId: у модели нет FK на Room (сводки
//     праздников живут отдельно), каскад её не заденет;
//   • Connection обеих сторон — ЯВНО по aUserId/bUserId: каскад у связей
//     висит на User, а User мы намеренно оставляем живым;
//   • ParseJob и RecognitionJob — ЯВНО по userId: у обеих моделей FK нет.
//
// ЧТО ОСТАЁТСЯ НЕТРОНУТЫМ:
//   • User (и его displayName/avatarKey/locale), Session, Account — иначе
//     сброс разлогинил бы владельца прямо посреди операции;
//   • VerificationToken — им как раз в этот момент оплачивается вход;
//   • аватар в S3 (`avatars/{userId}/`) — он принадлежит User, а User цел;
//   • чужие пользователи, комнаты, вещи и брони — их фильтры не касаются.
//
// Порядок как у GDPR-удаления (src/server/services/account.ts): сначала
// собрать ключи S3, потом одна транзакция в БД, и только после коммита —
// хранилище. Отказ S3 операцию не валит: комнаты уже нет, честнее вернуть
// s3Cleaned:false и написать в лог, чем притвориться, что сброс не удался.
import { z } from "zod";
import { prisma } from "@/server/db";
import { deleteObjects, listKeysByPrefix } from "@/server/s3";

/** Шов хранилища — тестам (как AccountStorage в services/account). */
export type StandResetStorage = {
  listKeysByPrefix: (prefix: string) => Promise<string[]>;
  deleteObjects: (keys: string[]) => Promise<void>;
};

export type StandResetResult = {
  /** false — пользователя с такой почтой ещё нет: сбрасывать нечего. */
  userFound: boolean;
  /** false — комнаты не было (владелец и так «в первый раз»). */
  roomDeleted: boolean;
  /** Сколько строк снесли — для одной строки в журнале стенда. */
  removed: {
    items: number;
    occasionSummaries: number;
    connections: number;
    parseJobs: number;
    recognitionJobs: number;
  };
  /** false — БД чиста, но фото вещей остались в S3 (залогировано). */
  s3Cleaned: boolean;
};

function emptyResult(overrides: Partial<StandResetResult> = {}): StandResetResult {
  return {
    userFound: false,
    roomDeleted: false,
    removed: {
      items: 0,
      occasionSummaries: 0,
      connections: 0,
      parseJobs: 0,
      recognitionJobs: 0,
    },
    s3Cleaned: true,
    ...overrides,
  };
}

/**
 * Стереть комнату владельца стенда со всем содержимым. Идемпотентно: нет
 * пользователя или нет комнаты — тихо возвращаем «нечего было делать».
 *
 * @param ownerEmail почта ВЛАДЕЛЬЦА СТЕНДА (QUICK_LOGIN_EMAIL, уже
 *        нормализованная). Другой почты сюда приходить неоткуда — см. шапку.
 */
export async function resetStandRoom(
  ownerEmail: string,
  storage: StandResetStorage = { listKeysByPrefix, deleteObjects },
): Promise<StandResetResult> {
  const email = z.string().min(3).max(320).parse(ownerEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      room: {
        select: {
          id: true,
          items: { where: { photoKey: { not: null } }, select: { photoKey: true } },
        },
      },
    },
  });
  if (!user) return emptyResult();

  const roomId = user.room?.id ?? null;
  // Только ключи НАШЕГО хранилища: чужой формы photoKey не бывает по
  // валидации, но в S3-запрос он всё равно не попадёт (заслон в глубину).
  const knownKeys = (user.room?.items ?? [])
    .map((item) => item.photoKey)
    .filter((key): key is string => typeof key === "string" && key.startsWith("items/"));

  // Одна транзакция: полусброса «комнаты нет, а сводки праздников остались»
  // не бывает. Вещи/брони/вклады/снимки цен уносит каскад самой схемы.
  const removed = await prisma.$transaction(async (tx) => {
    const items = roomId ? await tx.item.count({ where: { roomId } }) : 0;
    const occasionSummaries = roomId
      ? (await tx.occasionSummary.deleteMany({ where: { roomId } })).count
      : 0;
    const connections = (
      await tx.connection.deleteMany({
        where: { OR: [{ aUserId: user.id }, { bUserId: user.id }] },
      })
    ).count;
    const parseJobs = (await tx.parseJob.deleteMany({ where: { userId: user.id } })).count;
    const recognitionJobs = (await tx.recognitionJob.deleteMany({ where: { userId: user.id } }))
      .count;
    if (roomId) await tx.room.delete({ where: { id: roomId } });
    return { items, occasionSummaries, connections, parseJobs, recognitionJobs };
  });

  // Дальше только S3 — БД уже чиста, и никакой отказ хранилища это не отменит.
  let s3Cleaned = true;
  if (roomId) {
    try {
      const listed = await storage.listKeysByPrefix(`items/${roomId}/`);
      const keys = [...new Set([...knownKeys, ...listed])];
      if (keys.length > 0) await storage.deleteObjects(keys);
    } catch (error) {
      console.error(
        `[сброс стенда] комната ${roomId} удалена, но фото из S3 убрать не удалось — ` +
          "ключи осиротели, добрать вручную или джобой (тикет 16)",
        error,
      );
      s3Cleaned = false;
    }
  }

  console.info(
    `\n🧹 [сброс стенда] комната владельца стёрта: вещей ${removed.items}, ` +
      `сводок ${removed.occasionSummaries}, связей ${removed.connections}, ` +
      `заданий парсера ${removed.parseJobs}/${removed.recognitionJobs}. ` +
      `Пользователь и его сессии не тронуты.\n`,
  );

  return { userFound: true, roomDeleted: roomId !== null, removed, s3Cleaned };
}
