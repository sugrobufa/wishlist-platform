// Сервис «Аккаунт» (тикет 14, GDPR): два права пользователя — забрать свои
// данные одним JSON-файлом и полностью исчезнуть (каскад в БД + чистка S3).
//
// ИНВАРИАНТ №1 (CLAUDE.md) распространяется и на ЭКСПОРТ: имена и почты
// гостей активных (нераскрытых) броней хозяйке НЕ отдаются нигде — экспорт
// содержит только агрегат {takenCount}. Раскрытые дарители уже живут в самих
// вещах (Item.giverName после «Дошло») и входят в экспорт естественно.
// Сериализация — только allowlist, как в DTO-слое: у объектов экспорта
// ключей guestName/guestEmail/cancelToken не существует (под тест-регексом).
import { z } from "zod";
import { prisma } from "@/server/db";
import { ownerTakenCount } from "@/server/services/bookings";
import { deleteObjects, listKeysByPrefix } from "@/server/s3";

const idSchema = z.string().min(1).max(64);

/**
 * Фраза подтверждения удаления аккаунта. Канон один на все локали: клиент
 * требует ввести её точно, сервер перепроверяет (deleteAccountAction).
 */
export const DELETE_ACCOUNT_PHRASE = "удалить комнату";

export class AccountError extends Error {
  constructor(
    readonly code: "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

// ====================================================================
// Экспорт: «скачать мои данные» — один JSON-объект
// ====================================================================

export type AccountExport = {
  /** Когда собран файл (ISO). */
  exportedAt: string;
  user: {
    email: string;
    displayName: string | null;
    locale: string;
    avatarKey: string | null;
    createdAt: string;
  };
  room: {
    preset: string;
    zoneSet: string;
    zonesOff: string[];
    shareSlug: string;
    nick: string | null;
    occasionDate: string | null;
    demoGhostsOff: boolean;
    createdAt: string;
  } | null;
  /** Все вещи, включая спрятанные: их видит только хозяйка — это её данные. */
  items: Array<{
    id: string;
    zone: string;
    state: "LOVE" | "WANT";
    title: string;
    note: string | null;
    photoKey: string | null;
    url: string | null;
    canonicalUrl: string | null;
    domain: string | null;
    price: string | null;
    currency: string | null;
    priceVisibility: "ALL" | "FRIENDS" | "ME" | "NONE";
    size: string | null;
    color: string | null;
    desire: number | null;
    /** Раскрытый даритель («что подарили») — уже данные хозяйки. */
    giverName: string | null;
    receivedAt: string | null;
    inHall: boolean;
    hiddenFromHall: boolean;
    hidden: boolean;
    source: string;
    createdAt: string;
  }>;
  /**
   * О бронях моей комнаты — ТОЛЬКО счётчик (инвариант тихой брони №1):
   * ни имён, ни почт, ни токенов гостей в экспорте хозяйки не существует.
   */
  bookings: { takenCount: number };
  /** Связи — без чужих email: только вид, происхождение и дата. */
  connections: Array<{
    kind: "MUTUAL" | "FOLLOW" | "VIEWED";
    origin: string;
    createdAt: string;
  }>;
};

/**
 * Собрать экспорт данных пользователя. null — пользователя нет (сессия
 * пережила аккаунт). Комнаты может не быть (до онбординга) — это не отказ:
 * user-часть отдаётся всегда.
 */
export async function buildExport(userId: string): Promise<AccountExport | null> {
  const id = idSchema.parse(userId);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      email: true,
      displayName: true,
      locale: true,
      avatarKey: true,
      createdAt: true,
    },
  });
  if (!user) return null;

  const room = await prisma.room.findUnique({
    where: { userId: id },
    select: {
      id: true,
      preset: true,
      zoneSet: true,
      zonesOff: true,
      shareSlug: true,
      nick: true,
      occasionDate: true,
      demoGhostsOff: true,
      createdAt: true,
    },
  });

  const items = room
    ? await prisma.item.findMany({
        where: { roomId: room.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  // Единственный канал хозяйки о бронях — голое число (тикет 09).
  const takenCount = room ? await ownerTakenCount(id) : 0;

  const connections = await prisma.connection.findMany({
    where: { OR: [{ aUserId: id }, { bUserId: id }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { kind: true, origin: true, createdAt: true },
  });

  return {
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      avatarKey: user.avatarKey,
      createdAt: user.createdAt.toISOString(),
    },
    room: room
      ? {
          preset: room.preset,
          zoneSet: room.zoneSet,
          zonesOff: room.zonesOff,
          shareSlug: room.shareSlug,
          nick: room.nick,
          occasionDate: room.occasionDate ? room.occasionDate.toISOString() : null,
          demoGhostsOff: room.demoGhostsOff,
          createdAt: room.createdAt.toISOString(),
        }
      : null,
    items: items.map((item) => ({
      id: item.id,
      zone: item.zone,
      state: item.state,
      title: item.title,
      note: item.note,
      photoKey: item.photoKey,
      url: item.url,
      canonicalUrl: item.canonicalUrl,
      domain: item.domain,
      price: item.price === null ? null : item.price.toString(),
      currency: item.currency,
      priceVisibility: item.priceVisibility,
      size: item.size,
      color: item.color,
      desire: item.desire,
      giverName: item.giverName,
      receivedAt: item.receivedAt ? item.receivedAt.toISOString() : null,
      inHall: item.inHall,
      hiddenFromHall: item.hiddenFromHall,
      hidden: item.hidden,
      source: item.source,
      createdAt: item.createdAt.toISOString(),
    })),
    bookings: { takenCount },
    connections: connections.map((connection) => ({
      kind: connection.kind,
      origin: connection.origin,
      createdAt: connection.createdAt.toISOString(),
    })),
  };
}

// ====================================================================
// Удаление аккаунта: каскад в БД + чистка S3
// ====================================================================

/** Шов хранилища — для тестов S3-чистки (как putObject в image-ingest). */
export type AccountStorage = {
  listKeysByPrefix: (prefix: string) => Promise<string[]>;
  deleteObjects: (keys: string[]) => Promise<void>;
};

export type DeleteAccountResult = {
  /** false — аккаунт удалён, но S3-чистка не удалась (залогировано). */
  s3Cleaned: boolean;
};

/**
 * Полное удаление аккаунта.
 *
 * Порядок:
 * 1. ДО удаления собираем roomId и известные S3-ключи (photoKey вещей,
 *    avatarKey) — после каскада их будет не у кого спросить.
 * 2. Одна транзакция: user.delete (каскад схемы сносит Account/Session/
 *    Room→Item→Booking→PoolContribution/PriceSnapshot и Connection ОБЕИХ
 *    сторон — удаление пользователя рвёт и чужие связи С ним, это правильно)
 *    плюс явные deleteMany по моделям БЕЗ FK-связи с User: OccasionSummary
 *    (по roomId), ParseJob/RecognitionJob (по userId), VerificationToken
 *    (по identifier=email — невостребованные magic-link'и).
 * 3. ПОСЛЕ коммита — S3: удаляем СПИСОК известных ключей плюс всё по
 *    префиксам items/{roomId}/ и avatars/{userId}/ (осиротевшие от смен
 *    аватара/фото — заметка тикета 13). Ошибка S3 операцию НЕ валит:
 *    аккаунт уже удалён, честно вернуть {s3Cleaned:false} и залогировать.
 */
export async function deleteAccount(
  userId: string,
  storage: AccountStorage = { listKeysByPrefix, deleteObjects },
): Promise<DeleteAccountResult> {
  const id = idSchema.parse(userId);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      email: true,
      avatarKey: true,
      room: {
        select: {
          id: true,
          items: { where: { photoKey: { not: null } }, select: { photoKey: true } },
        },
      },
    },
  });
  if (!user) {
    throw new AccountError("NOT_FOUND", "пользователя уже нет — удалять нечего");
  }

  const roomId = user.room?.id ?? null;
  // Только ключи НАШЕГО хранилища: photoKey чужой формы (не бывает по
  // валидации, но заслон в глубину) в S3-запрос не попадает.
  const knownKeys = [
    ...(user.room?.items ?? []).map((item) => item.photoKey),
    user.avatarKey,
  ].filter(
    (key): key is string =>
      typeof key === "string" && (key.startsWith("items/") || key.startsWith("avatars/")),
  );

  await prisma.$transaction([
    ...(roomId ? [prisma.occasionSummary.deleteMany({ where: { roomId } })] : []),
    prisma.parseJob.deleteMany({ where: { userId: id } }),
    prisma.recognitionJob.deleteMany({ where: { userId: id } }),
    prisma.verificationToken.deleteMany({ where: { identifier: user.email } }),
    prisma.user.delete({ where: { id } }),
  ]);

  // Дальше только S3 — БД уже чиста, и никакой отказ хранилища это не отменит.
  let s3Cleaned = true;
  try {
    const prefixes = [...(roomId ? [`items/${roomId}/`] : []), `avatars/${id}/`];
    const listed = await Promise.all(prefixes.map((prefix) => storage.listKeysByPrefix(prefix)));
    const keys = [...new Set([...knownKeys, ...listed.flat()])];
    if (keys.length > 0) await storage.deleteObjects(keys);
  } catch (error) {
    console.error(
      `[account] аккаунт ${id} удалён, но S3-чистка не удалась (roomId=${roomId ?? "—"}) — ` +
        "ключи осиротели, добрать вручную или джобой (тикет 16)",
      error,
    );
    s3Cleaned = false;
  }

  return { s3Cleaned };
}
