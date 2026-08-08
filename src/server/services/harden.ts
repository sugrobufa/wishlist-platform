// «Укрепление» аккаунта — второй способ войти (тикет 94, доска Б8, турн 13b).
//
// Комната держится на ОДНОЙ почте: потерял доступ к ящику — потерял комнату,
// историю подарков и сокровищницу. Доска просит сказать это ровно один раз и
// ровно в один момент — перед первым шером: «тот же экран на входе был бы
// бюрократией: терять ещё нечего, значит и привязывать незачем».
//
// Поле `User.secondAuth` лежало в схеме с первой миграции и не читалось нигде.
// Здесь оно наконец получает и читателя, и писателя.
import { prisma } from "@/server/db";

/** Второй способ входа, как он записан в `User.secondAuth`. */
export type SecondAuth = { provider: string; sub: string };

/**
 * Какие вторые способы входа вообще существуют в этой сборке. Читается из
 * тех же переменных, по которым провайдеры подключаются в `server/auth`:
 * список ПУСТ, пока ключей нет, и это честно — предлагать привязать то, чего
 * в сборке нет, значит вести человека в тупик.
 *
 * Apple и Telegram в коде не подключены (разбор доски, Б9): появятся —
 * добавятся сюда одной строкой, и просьба научится их показывать сама.
 */
export function availableSecondAuth(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const providers: string[] = [];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) providers.push("google");
  return providers;
}

/** Прочитать `User.secondAuth` из Json-колонки, не веря её содержимому. */
export function readSecondAuth(value: unknown): SecondAuth | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.provider !== "string" || row.provider === "") return null;
  return { provider: row.provider, sub: typeof row.sub === "string" ? row.sub : "" };
}

/**
 * Просить ли укрепить аккаунт ПЕРЕД ШЕРОМ. Чистая функция — вся политика
 * в одном месте и под тестом:
 *
 * - **нечего предложить** (в сборке нет второго способа) — не просим. Просьба
 *   без кнопки «привязать» была бы разговором ни о чём;
 * - **уже привязан** — не просим: укреплять нечего;
 * - **уже спрашивали** — не просим. Отказ это тоже ответ (доска: «Можно
 *   отказаться»), а вторая просьба — уже уговоры.
 */
export function shouldAskToHarden(input: {
  providers: readonly string[];
  secondAuth: SecondAuth | null;
  askedAt: Date | null;
}): boolean {
  if (input.providers.length === 0) return false;
  if (input.secondAuth !== null) return false;
  return input.askedAt === null;
}

/** Состояние раздела «Вход и доступ» в настройках. */
export type HardenState = {
  /** Почта основного входа — она же адрес, на который придёт ссылка. */
  email: string;
  /** Почта подтверждена входом по ссылке. */
  emailConfirmed: boolean;
  /** Привязанный второй способ — или null. */
  secondAuth: SecondAuth | null;
  /** Способы, которые можно привязать сейчас (пусто — предлагать нечего). */
  available: string[];
  /** Просьба перед шером уже была (отказом или согласием). */
  asked: boolean;
};

/** Состояние укрепления для настроек и для решения «просить ли». */
export async function getHardenState(userId: string): Promise<HardenState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true, secondAuth: true, hardenAskedAt: true },
  });
  if (!user) return null;

  return {
    email: user.email,
    emailConfirmed: user.emailVerified !== null,
    secondAuth: readSecondAuth(user.secondAuth),
    available: availableSecondAuth(),
    asked: user.hardenAskedAt !== null,
  };
}

/**
 * Отметить, что просьба состоялась. Зовётся ОБОИМИ исходами: и «Привязать»,
 * и «Поделиться без этого» — вопрос задан, ответ получен, второй раз не
 * спрашиваем. Повторный вызов дату не переписывает: важен первый раз.
 */
export async function markHardenAsked(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, hardenAskedAt: null },
    data: { hardenAskedAt: new Date() },
  });
}
