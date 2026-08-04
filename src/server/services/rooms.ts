// Сервис «Комната» (Room): создание при онбординге, чтение для хозяйки и гостя.
// Бизнес-логика живёт здесь, роуты/экшены остаются тонкими (CLAUDE.md).
import { randomBytes } from "node:crypto";
import { Prisma, type Room } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";

// ---------- Валидация входов (Zod) ----------

const presetIds = roomPresets.map((room) => room.id);

/** «Набор зон» — предустановка видимых зон, не свойство человека (CONTEXT.md). */
export const zoneSetSchema = z.enum(["F", "M", "ALL"]);
export type ZoneSet = z.infer<typeof zoneSetSchema>;

/** Пресет — только один из 10 интерьеров rooms.json. */
export const presetSchema = z.enum(presetIds as [string, ...string[]]);

export const createRoomInputSchema = z.object({
  preset: presetSchema,
  zoneSet: zoneSetSchema,
});
export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;

// ---------- Короткий адрес комнаты ----------

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 6;
// 252 = 7 × 36: байты выше порога отбрасываем, чтобы все 36 символов
// алфавита выпадали равновероятно (rejection sampling).
const SLUG_BYTE_LIMIT = 252;

/**
 * Короткий код комнаты вида `x7k2m9` (решение гриллинга №3): 6 символов
 * [a-z0-9] через node:crypto — без внешних зависимостей.
 */
export function generateShareSlug(length: number = SLUG_LENGTH): string {
  let slug = "";
  while (slug.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= SLUG_BYTE_LIMIT) continue;
      slug += SLUG_ALPHABET.charAt(byte % SLUG_ALPHABET.length);
      if (slug.length === length) break;
    }
  }
  return slug;
}

// ---------- Создание и чтение ----------

const SLUG_CREATE_ATTEMPTS = 5;

/**
 * Создаёт комнату пользователю. Идемпотентно: комната одна на пользователя
 * (Room.userId @unique) — повторный вызов возвращает существующую комнату,
 * не меняя её. Гонка параллельных запросов гасится обработкой P2002.
 */
export async function createRoomForUser(
  userId: string,
  input: { preset: string; zoneSet: string },
): Promise<Room> {
  const { preset, zoneSet } = createRoomInputSchema.parse(input);

  const existing = await prisma.room.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < SLUG_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.room.create({
        data: { userId, preset, zoneSet, shareSlug: generateShareSlug() },
      });
    } catch (error) {
      if (isUniqueViolation(error, "userId")) {
        // Параллельный запрос успел первым — возвращаем его комнату.
        return prisma.room.findUniqueOrThrow({ where: { userId } });
      }
      if (isUniqueViolation(error, "shareSlug")) {
        continue; // коллизия короткого кода — пробуем новый
      }
      throw error;
    }
  }
  throw new Error("rooms.createRoomForUser: не удалось подобрать свободный shareSlug");
}

/** Комната хозяйки (или null — тогда путь лежит в /onboarding). */
export async function getRoomForUser(userId: string): Promise<Room | null> {
  return prisma.room.findUnique({ where: { userId } });
}

/**
 * Комната для публичного маршрута /r/{slug}. Из владельца отдаём только
 * имя — email и прочие поля гостю не текут.
 */
export async function getRoomByShareSlug(shareSlug: string) {
  return prisma.room.findUnique({
    where: { shareSlug },
    include: { user: { select: { displayName: true, name: true } } },
  });
}

/**
 * Auth.js с database-сессией по умолчанию кладёт в session.user только
 * name/email/image — без id (каркас Phase 0 не настраивал session callback).
 * Резолвим владельца по email; если id однажды появится — используем его.
 */
export async function getSessionUserId(
  sessionUser: { id?: string | null; email?: string | null } | undefined,
): Promise<string | null> {
  if (!sessionUser) return null;
  if (sessionUser.id) return sessionUser.id;
  if (!sessionUser.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: sessionUser.email },
    select: { id: true },
  });
  return user?.id ?? null;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === "string" && target.includes(field);
}
