// Сервис «Связи» (тикет 11). ИНВАРИАНТ №4 (CLAUDE.md, никогда не нарушать):
// друзья НЕ добавляются — в API нет и не будет поиска людей и импорта
// контактов. Связь рождается сама: из подарка (receiveGift тикета 10 зовёт
// upsertGiftConnection в СВОЕЙ транзакции) или из открытой ссылки
// (recordVisit — залогиненный гость посмотрел комнату). Поэтому поверхность
// сервиса — ровно три функции, и ни одна не «создаёт связь по вводу»:
// у recordVisit оба id приходят из сессии и слага комнаты, у
// upsertGiftConnection — из брони; произвольного add/create здесь нет
// (закрыто негативным тестом tests/connections.test.ts).
//
// Модель: ОДНА строка Connection на пару людей, в любой ориентации (a,b).
// Уникальность (aUserId,bUserId) держит схема; зеркальная пара (b,a) НЕ
// заводится — перед созданием ищем обе ориентации (дедуп зеркала — контракт
// Comments тикета 10). Счётчики history направленные (giftsToA/giftsToB,
// visitsByA/visitsByB), поэтому одна строка честно обслуживает оба взгляда.
// Односторонняя подписка — законное состояние (README пакета), взаимность
// выводится (kind MUTUAL), а не запрашивается.
//
// СОГЛАСИЕ (тикет 98 → перестроено тикетом 98b по доске 32a). Связь из
// подарка не заводится молча, но и вопросов после праздника больше двух не
// задаётся: ГОСТЬ отвечает в момент брони («остаться в связях с Милой?» —
// тихой плашкой после действия), ХОЗЯЙКА — на «что подарили», и только про
// тех дарителей, кто сам предложил. Не предложил — связь рождается
// односторонней и хозяйку ни о чём не спрашивают. Вопрос живёт
// в трёх полях строки (consentAskedAt/consentA/consentB), а не в kind: kind
// отвечает на «какая это связь» (взаимно/слежу/смотрели), согласие — на
// «состоялась ли она вообще». Развести их было обязательно: иначе отказ
// пришлось бы кодировать четвёртым видом связи, и каждый читатель kind начал
// бы врать. Инвариант №4 цел: ответ «да» НИЧЕГО не создаёт — он отвечает про
// уже существующую строку, рождённую подарком (негативный тест сторожит и
// поверхность сервиса, и то, что экшен страницы не умеет create).
import { Prisma, type Connection, type ConnectionKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { itemPhotoUrl } from "@/server/dto/items";
import { hallItemShownToObservers } from "@/server/dto/hall";
import { rooms as roomPresets } from "@/config/design";
import { countFreeGiftsByRoom } from "@/server/services/guest-room";

const idSchema = z.string().min(1).max(64);

/** Спам-заслон визитов: history инкрементится не чаще раза в час на направление. */
const VISIT_THROTTLE_MS = 60 * 60 * 1000;

// ---------- history: направленные счётчики пары ----------

/**
 * История связи (Connection.history, JSON). a/b — стороны строки Connection
 * (aUserId/bUserId), все счётчики направленные — строка одна на пару, а
 * читается с двух сторон (listConnections переворачивает перспективу).
 */
export type ConnectionHistory = {
  /** Подарков получила сторона a от стороны b («Дарил(а) тебе N раз»). */
  giftsToA?: number;
  /** Подарков получила сторона b от стороны a (роли наоборот — «ты в ответ»). */
  giftsToB?: number;
  /** ISO последнего подарка в любую сторону. */
  lastGiftAt?: string;
  /** Последний подарок: id вещи — для «она в зале славы» на странице связей. */
  lastGiftItemId?: string;
  /** Название вещи на момент дарения — переживает удаление вещи. */
  lastGiftTitle?: string;
  /** Визитов стороны b в комнату a («Смотрел(а) · N визитов» у a). */
  visitsByB?: number;
  /** ISO последнего засчитанного визита b в комнату a (заслон 1/час). */
  lastVisitByBAt?: string;
  /** Визиты стороны a в комнату b — зеркальная ориентация строки. */
  visitsByA?: number;
  lastVisitByAAt?: string;
};

/** Недоверенный JSON из БД → history: не-объект и мусорные типы отбрасываются. */
function readHistory(value: Prisma.JsonValue | null): ConnectionHistory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const history: ConnectionHistory = {};
  for (const key of ["giftsToA", "giftsToB", "visitsByA", "visitsByB"] as const) {
    const count = raw[key];
    if (typeof count === "number" && Number.isFinite(count) && count > 0) history[key] = count;
  }
  for (const key of [
    "lastGiftAt",
    "lastGiftItemId",
    "lastGiftTitle",
    "lastVisitByAAt",
    "lastVisitByBAt",
  ] as const) {
    const text = raw[key];
    if (typeof text === "string" && text.length > 0) history[key] = text;
  }
  return history;
}

/** Обе ориентации пары одним заходом: строка Connection одна на пару людей. */
async function findPairRow(
  db: Prisma.TransactionClient,
  aUserId: string,
  bUserId: string,
): Promise<Connection | null> {
  const direct = await db.connection.findUnique({
    where: { aUserId_bUserId: { aUserId, bUserId } },
  });
  if (direct) return direct;
  return db.connection.findUnique({
    where: { aUserId_bUserId: { aUserId: bUserId, bUserId: aUserId } },
  });
}

// ---------- Согласие обеих сторон (тикет 98, доска Б12) ----------

/** Строка согласия — ровно те поля, из которых считается состояние. */
type ConsentFields = {
  consentAskedAt: Date | null;
  consentA: boolean | null;
  consentB: boolean | null;
};

/**
 * Состояние связи по согласию:
 * - `active` — связь состоялась. Сюда же попадают связи, которых вопрос НЕ
 *   касается: из визита и все строки до тикета 98 (`consentAskedAt === null`).
 *   Задним числом мы никого не переспрашиваем — это отняло бы у людей связи,
 *   которые у них уже есть;
 * - `pending` — спросили, ответили не все;
 * - `declined` — хоть одна сторона сказала «не в этот раз». Строка живёт
 *   дальше (история подарков не теряется), но из списков уходит у ОБОИХ и
 *   молча: кто отказался — не сообщается никому, объясняться никто не должен.
 */
export type ConnectionStatus = "active" | "pending" | "declined";

export function connectionStatus(row: ConsentFields): ConnectionStatus {
  if (row.consentAskedAt === null) return "active";
  if (row.consentA === false || row.consentB === false) return "declined";
  if (row.consentA === true && row.consentB === true) return "active";
  return "pending";
}

/**
 * Считается ли связь состоявшейся дружбой — ЕДИНСТВЕННЫЙ ответ на вопрос
 * «кто такой друг» для всего продукта.
 *
 * Здесь два условия, и оба обязательны: согласие получено (или вопроса не
 * было) И связь не «смотрели» — заглянувший в комнату по ссылке человек
 * другом не становится, сколько бы раз он ни заходил.
 *
 * Отдельно про цены (ADR-0004, инвариант №8): `priceVisibility: FRIENDS` в
 * Phase 1 со связями ещё не сверяется (`dto/guest-items.guestSeesPrice`
 * читает его как ALL, `dto/hall` — закрыто). Когда сверка появится, она
 * обязана спрашивать ЭТУ функцию, а не `kind`: иначе цену увидит тот, кто
 * на связь не согласился.
 */
export function isConsentedConnection(row: ConsentFields & { kind: ConnectionKind }): boolean {
  return connectionStatus(row) === "active" && row.kind !== "VIEWED";
}

/**
 * Нужно ли спрашивать согласие у пары, к которой пришёл подарок.
 *
 * `history` и `origin` читаются ДО инкремента этого подарка — то есть
 * описывают пару такой, какой она была до него:
 * - подарки уже были → дружба состоялась раньше, второй подарок не повод
 *   переспрашивать (сюда же попадают связи, заведённые до тикета 98);
 * - спросили и ждём ответа → вопрос уже висит, второй не заводим;
 * - спросили и отказали → новый подарок спрашивает заново: прошлое «нет»
 *   было про прошлый раз.
 */
function shouldAskConsent(
  row: ConsentFields & { origin: string },
  historyBefore: ConnectionHistory,
): boolean {
  const giftedBefore =
    (historyBefore.giftsToA ?? 0) + (historyBefore.giftsToB ?? 0) > 0 ||
    row.origin.startsWith("gift:");
  if (row.consentAskedAt === null) return !giftedBefore;
  return connectionStatus(row) === "declined";
}

/** Моя сторона строки: согласие пишется в своё поле, чужое не трогается. */
function myConsentField(row: { aUserId: string }, userId: string): "consentA" | "consentB" {
  return row.aUserId === userId ? "consentA" : "consentB";
}

/** Строка вопроса «остаться на связи?» — и у хозяйки, и у дарителя. */
export type PendingConsentRow = {
  id: string;
  /** displayName ?? name собеседника; null — страница подставит подпись. */
  displayName: string | null;
  avatarUrl: string | null;
  /** Название последнего подарка — чтобы вопрос был про конкретный повод. */
  giftTitle: string | null;
  /** Я уже ответил(а) «да» — ждём вторую сторону, кнопок больше нет. */
  answered: boolean;
};

/**
 * Кого спрашивают прямо сейчас. Показывается на «что подарили» (хозяйке,
 * доска Б12) и на странице друзей (дарителю — доска про него молчит, а
 * спросить обязаны обоих).
 *
 * Ничего нового этот список не раскрывает: связь из подарка рождается в
 * `receiveGift`, то есть уже ПОСЛЕ экрана «что подарили», где имя дарителя
 * раскрыто по инварианту №2. Даритель, в свою очередь, знает, кому дарил.
 */
export async function listPendingConsent(userId: string): Promise<PendingConsentRow[]> {
  const id = idSchema.parse(userId);

  const rows = await prisma.connection.findMany({
    where: {
      OR: [{ aUserId: id }, { bUserId: id }],
      consentAskedAt: { not: null },
      // Отказ отсеивается ниже, в JS: `NOT { consentA: false }` в SQL
      // выбрасывает и НЕОТВЕЧЕННЫЕ строки (NULL = false даёт UNKNOWN, а не
      // TRUE) — то есть ровно те, ради которых список и существует.
    },
    include: { a: { select: { displayName: true, name: true, avatarKey: true } }, b: { select: { displayName: true, name: true, avatarKey: true } } },
    orderBy: { consentAskedAt: "desc" },
  });

  return rows
    .filter((row) => connectionStatus(row) === "pending")
    .map((row) => {
      const meIsA = row.aUserId === id;
      const other = meIsA ? row.b : row.a;
      const history = readHistory(row.history);
      return {
        id: row.id,
        displayName: other.displayName ?? other.name ?? null,
        avatarUrl: itemPhotoUrl(other.avatarKey),
        giftTitle: history.lastGiftTitle ?? null,
        answered: (meIsA ? row.consentA : row.consentB) === true,
      } satisfies PendingConsentRow;
    });
}

/**
 * Ответ одной стороны: «да» или «не в этот раз».
 *
 * Связь НЕ создаётся и не ищется по имени — обновляется строка, где человек
 * уже является стороной (инвариант №4). Чужая или несуществующая связь даёт
 * один и тот же ответ `false`: существование чужой строки не подтверждаем.
 * Пишем только в СВОЁ поле; чужой ответ переписать нельзя ни при какой гонке.
 */
export async function respondToConnection(
  userId: string,
  connectionId: string,
  agree: boolean,
): Promise<boolean> {
  const id = idSchema.parse(userId);
  const rowId = idSchema.parse(connectionId);

  const row = await prisma.connection.findFirst({
    where: { id: rowId, OR: [{ aUserId: id }, { bUserId: id }] },
  });
  if (!row || row.consentAskedAt === null) return false; // спрашивать нечего

  const updated = await prisma.connection.update({
    where: { id: row.id },
    data: { [myConsentField(row, id)]: agree },
  });
  await stampMutual(updated);
  return true;
}

/**
 * Отметить момент, когда связь СТАЛА взаимной (тикет 114): «Соня теперь в
 * твоих связях» — пятое событие ленты, и его «когда» иначе не восстановить.
 *
 * Ставится ровно один раз: `mutualAt` уже стоит — второй ответ его не
 * двигает. Ошибка наверх не поднимается: лента украшение, а согласие важнее.
 */
async function stampMutual(row: Connection): Promise<void> {
  if (row.mutualAt !== null || connectionStatus(row) !== "active") return;
  if (row.consentAskedAt === null) return; // связь без вопроса взаимной не «становилась»
  try {
    await prisma.connection.updateMany({
      where: { id: row.id, mutualAt: null },
      data: { mutualAt: new Date() },
    });
  } catch (error) {
    console.error(`[лента] момент взаимности связи ${row.id} не записался`, error);
  }
}

/**
 * «Со всеми семью» с доски Б12 — один ответ на все висящие вопросы.
 *
 * Трогает ровно те строки, где Я ещё не ответил(а), и не воскрешает отказы:
 * если вторая сторона уже сказала «нет», связь остаётся `declined` (моё «да»
 * ничего не меняет — согласие нужно обоюдное). Возвращает, скольким ответили.
 */
export async function respondToAllPending(userId: string, agree: boolean): Promise<number> {
  const id = idSchema.parse(userId);
  const asked = { consentAskedAt: { not: null } } as const;

  // «Вторая сторона не отказала» пишется перечислением ({null, true}), а не
  // отрицанием: `NOT { consentB: false }` в SQL выбросил бы и строки, где та
  // сторона ещё молчит (NULL = false — это UNKNOWN, не TRUE).
  const notRefused = (field: "consentA" | "consentB") => ({
    OR: [{ [field]: null }, { [field]: true }],
  });

  const [asA, asB] = await prisma.$transaction([
    prisma.connection.updateMany({
      where: { ...asked, aUserId: id, consentA: null, ...notRefused("consentB") },
      data: { consentA: agree },
    }),
    prisma.connection.updateMany({
      where: { ...asked, bUserId: id, consentB: null, ...notRefused("consentA") },
      data: { consentB: agree },
    }),
  ]);

  // Ответ «со всеми» мог сделать взаимной не одну связь — отмечаем каждую.
  if (agree && asA.count + asB.count > 0) {
    const touched = await prisma.connection.findMany({
      where: { OR: [{ aUserId: id }, { bUserId: id }], mutualAt: null },
    });
    for (const row of touched) await stampMutual(row);
  }
  return asA.count + asB.count;
}

// ---------- Визит: связь «смотрели» из открытой ссылки ----------

/**
 * Залогиненный гость посмотрел чужую комнату: у ХОЗЯЙКИ появляется связь
 * kind=VIEWED (aUserId=хозяйка, bUserId=гость, origin "visit"), а у
 * существующей связи пары — в ЛЮБОЙ ориентации — инкрементится счётчик
 * визитов в history, не чаще раза в час (спам-заслон).
 *
 * Правила:
 * - своя комната → no-op (связи с самим собой не существует);
 * - kind НИКОГДА не трогается: визит не понижает FOLLOW/MUTUAL до VIEWED
 *   (и не повышает ничего) — сильнее связи только подарок;
 * - origin существующей строки не переписывается (происхождение — история
 *   рождения связи, а не последнего события);
 * - гонка двух первых визитов решается P2002 → тихий no-op (визит тот же).
 */
export async function recordVisit(viewerUserId: string, roomOwnerId: string): Promise<void> {
  const viewer = idSchema.parse(viewerUserId);
  const owner = idSchema.parse(roomOwnerId);
  if (viewer === owner) return; // хозяйка ходит по своей комнате — это не связь

  const row = await findPairRow(prisma, owner, viewer);
  const now = new Date();

  if (!row) {
    const history: ConnectionHistory = { visitsByB: 1, lastVisitByBAt: now.toISOString() };
    try {
      await prisma.connection.create({
        data: {
          aUserId: owner,
          bUserId: viewer,
          kind: "VIEWED",
          origin: "visit",
          history: history as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      // Параллельный первый визит успел раньше — это тот же визит, не событие.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }
    return;
  }

  // Строка есть (возможно, зеркальная: гость сам хозяйка, а наша хозяйка
  // когда-то дарила ему). Направление визита выбирает ключи history.
  const history = readHistory(row.history);
  const viewerIsA = row.aUserId === viewer;
  const countKey = viewerIsA ? "visitsByA" : "visitsByB";
  const lastKey = viewerIsA ? "lastVisitByAAt" : "lastVisitByBAt";

  const lastRaw = history[lastKey];
  const lastAt = lastRaw ? Date.parse(lastRaw) : Number.NaN;
  if (Number.isFinite(lastAt) && now.getTime() - lastAt < VISIT_THROTTLE_MS) {
    return; // спам-заслон: F5 и хождение по зонам — не «N визитов»
  }

  const next: ConnectionHistory = { ...history };
  next[countKey] = (history[countKey] ?? 0) + 1;
  next[lastKey] = now.toISOString();
  await prisma.connection.update({
    where: { id: row.id },
    data: { history: next as Prisma.InputJsonObject },
  });
}

/**
 * Визит по адресу комнаты (роут POST /rooms/{slug}/visit — тонкий): слаг
 * резолвится как ник ИЛИ короткий код (порядок — как в guest-room, тикет 13).
 * Возврат false — такой комнаты нет (роут ответит 404). Сам HTML комнаты
 * по-прежнему одинаков для всех: пинг — отдельный некэшируемый запрос.
 */
export async function recordVisitBySlug(viewerUserId: string, slug: string): Promise<boolean> {
  const parsedSlug = z.string().min(1).max(64).safeParse(slug);
  if (!parsedSlug.success) return false;

  const room =
    (await prisma.room.findUnique({
      where: { nick: parsedSlug.data },
      select: { userId: true },
    })) ??
    (await prisma.room.findUnique({
      where: { shareSlug: parsedSlug.data },
      select: { userId: true },
    }));
  if (!room) return false;

  await recordVisit(viewerUserId, room.userId);
  return true;
}

// ---------- Подарок: рождение/усиление связи из receiveGift ----------

export type GiftConnectionInput = {
  /** Хозяйка, отметившая «Дошло» (получатель подарка). */
  receiverUserId: string;
  /** Даритель — booking.guestUserId (гость дарил залогиненным). */
  giverUserId: string;
  itemId: string;
  /** Название вещи на момент дарения — для строки происхождения. */
  itemTitle: string;
  /**
   * Гость предложил остаться на связи — ответ, данный ЗАРАНЕЕ, на
   * подтверждении брони (тикет 98b, доска 32a; `Booking.offersConnection`).
   *
   * true  — сторона гостя уже сказала «да», ждём хозяйку: связь рождается
   *         «предложением», и только о таких хозяйку и спрашивают;
   * false — вопроса не было вовсе. Связь рождается ОДНОСТОРОННЕЙ («знакомы ·
   *         подарок в истории»): молчаливой дружбы больше нет, но и вопроса
   *         без предложения тоже — хозяйке этот даритель не показывается.
   */
  guestOffered: boolean;
};

/**
 * Связь из подарка — зовётся ИЗ транзакции receiveGift (тикет 10), поэтому
 * принимает tx: все эффекты «Дошло» атомарны, отдельной транзакции здесь нет.
 *
 * Контракт (Comments тикета 10, расширенный этим тикетом):
 * - пары нет (в обеих ориентациях) → создать {a: получатель, b: даритель,
 *   kind: MUTUAL если у дарителя есть комната, иначе FOLLOW,
 *   origin `gift:{itemId}`, history {giftsToA: 1, lastGift*}};
 * - пара есть → kind и origin НЕ перезаписываются (тест 10-го), кроме
 *   ровно одного апгрейда: VIEWED поднимается до FOLLOW/MUTUAL по тому же
 *   правилу — подарок сильнее «смотрели». Понижения не существует;
 * - history обновляется всегда: направленный счётчик получателя +1,
 *   lastGiftAt/lastGiftItemId/lastGiftTitle — строка происхождения на
 *   странице связей получает данные и для старых пар.
 */
export async function upsertGiftConnection(
  tx: Prisma.TransactionClient,
  input: GiftConnectionInput,
): Promise<void> {
  const receiver = idSchema.parse(input.receiverUserId);
  const giver = idSchema.parse(input.giverUserId);
  if (receiver === giver) return; // самому себе не дарят — защита в глубину

  const now = new Date();
  const row = await findPairRow(tx, receiver, giver);

  if (!row) {
    const giverRoom = await tx.room.findUnique({
      where: { userId: giver },
      select: { id: true },
    });
    const history: ConnectionHistory = {
      giftsToA: 1,
      lastGiftAt: now.toISOString(),
      lastGiftItemId: input.itemId,
      lastGiftTitle: input.itemTitle,
    };
    await tx.connection.create({
      data: {
        aUserId: receiver,
        bUserId: giver,
        kind: giverRoom ? "MUTUAL" : "FOLLOW",
        origin: `gift:${input.itemId}`,
        history: history as Prisma.InputJsonObject,
        // Согласие (тикет 98b): гость ответил на броне, хозяйка ответит на
        // «что подарили». Сторона b — даритель, a — хозяйка.
        //
        // Не предлагал — строка сразу «отказная» по форме (consentB: false):
        // она живёт, хранит историю подарка и никогда не станет дружбой, а
        // хозяйке вопроса не задаёт. Это и есть «знакомы · подарок в истории».
        consentAskedAt: now,
        consentB: input.guestOffered ? true : false,
      },
    });
    return;
  }

  const history = readHistory(row.history);
  const receiverIsA = row.aUserId === receiver;
  const countKey = receiverIsA ? "giftsToA" : "giftsToB";
  const next: ConnectionHistory = {
    ...history,
    lastGiftAt: now.toISOString(),
    lastGiftItemId: input.itemId,
    lastGiftTitle: input.itemTitle,
  };
  next[countKey] = (history[countKey] ?? 0) + 1;

  // Единственный апгрейд kind: подарок поверх «смотрели». FOLLOW/MUTUAL
  // подарок не трогает (контракт 10-го: существующая пара не перезаписывается).
  let kind: ConnectionKind = row.kind;
  if (row.kind === "VIEWED") {
    const giverRoom = await tx.room.findUnique({
      where: { userId: giver },
      select: { id: true },
    });
    kind = giverRoom ? "MUTUAL" : "FOLLOW";
  }

  // Вопрос «остаться на связи?» — по правилу shouldAskConsent (тикет 98):
  // состоявшуюся дружбу второй подарок не переспрашивает, висящий вопрос не
  // задаётся дважды, прошлое «нет» новому подарку не мешает спросить снова.
  //
  // С тикета 98b поднять вопрос может ТОЛЬКО предложение гостя: без него
  // спрашивать хозяйку не о чем (доска 32a). Молчаливый подарок существующую
  // пару не трогает вовсе.
  const asking = input.guestOffered && shouldAskConsent(row, history);

  await tx.connection.update({
    where: { id: row.id },
    data: {
      kind,
      history: next as Prisma.InputJsonObject,
      ...(asking ? { consentAskedAt: now, consentA: null, consentB: true } : {}),
    },
  });
}

// ---------- Список связей хозяйки ----------

export type ConnectionKindDto = "MUTUAL" | "FOLLOW" | "VIEWED";

/**
 * Происхождение связи — СТРУКТУРА, а не готовая строка: все строки продукта
 * живут в next-intl (CLAUDE.md), страница собирает подпись из этих данных.
 */
export type ConnectionOriginDto =
  | {
      type: "gift";
      /** Сколько раз собеседник дарил мне. */
      received: number;
      /** Сколько раз дарил(а) я — «ты в ответ N». */
      given: number;
      /** Название последнего подарка (null — вещь удалена, а history старый). */
      lastTitle: string | null;
      /** Последний подарок сейчас в витрине зала славы («она в зале славы»). */
      lastInHall: boolean;
    }
  | { type: "visit"; visits: number }
  /** Происхождение не восстановить (битые старые данные) — честный fallback. */
  | { type: "link" };

/** Строка страницы связей. Allowlist-DTO: email собеседника НЕ существует. */
export type ConnectionRowDto = {
  id: string;
  kind: ConnectionKindDto;
  /** displayName ?? name собеседника; null — страница подставит подпись. */
  displayName: string | null;
  avatarUrl: string | null;
  origin: ConnectionOriginDto;
  /** ISO последнего события (подарок/визит/рождение) — для «N дней назад». */
  lastAt: string;
  createdAt: string;
  /**
   * Комната собеседника — ТОЛЬКО если человек в ней уже был (тикет 95,
   * решение владельца 08.08). Ссылка на комнату и есть ключ доступа: показать
   * кадр чужой комнаты тому, кому её не давали, значит раздать ключ
   * (инвариант №7). Был — значит ссылку давали, и мы ничего нового не
   * открываем. Не был — здесь `null`, и строка остаётся строкой.
   */
  room: ConnectionRoomDto | null;
};

/** Комната друга в ленте: кадр, отсчёт до праздника и «сколько свободно». */
export type ConnectionRoomDto = {
  /** Канонический адрес: ник, если занят, иначе короткий код. */
  slug: string;
  /** id пресета — кадр и акцент страница берёт из конфига. */
  preset: string;
  /** Календарный день `YYYY-MM-DD` или null. Гостю он и так виден в комнате. */
  occasionDate: string | null;
  /**
   * «N можно подарить» — вещи «хочу» без брони среди видимых. Ровно то же
   * число, что гость видит, открыв комнату (services/guest-room): ни имён,
   * ни вещей, и обратного — «сколько уже забрали» — не существует
   * (инвариант №1).
   */
  freeGifts: number;
};

// Из собеседника наружу — только имя и аватар: ни email, ни id (allowlist,
// под тестом). Сторону строки различаем по скалярам aUserId/bUserId.
const personSelect = {
  select: {
    displayName: true,
    name: true,
    avatarKey: true,
    // Комната собеседника (тикет 95) — отдаётся наружу НЕ всегда, а только
    // тому, кто в ней уже был; решает `roomForVisitor` ниже. Здесь только
    // чтение полей, которые гость и так видит, открыв комнату по ссылке.
    room: { select: { id: true, preset: true, shareSlug: true, nick: true, occasionDate: true, zonesOff: true } },
  },
} as const;

/** Последний ISO из имеющихся дат (createdAt — всегда есть). */
function latestIso(createdAt: Date, ...candidates: (string | undefined)[]): string {
  let best = createdAt.getTime();
  for (const candidate of candidates) {
    const time = candidate ? Date.parse(candidate) : Number.NaN;
    if (Number.isFinite(time) && time > best) best = time;
  }
  return new Date(best).toISOString();
}

/**
 * Связи пользователя для страницы /connections — обе ориентации строк
 * (строка одна на пару, перспектива переворачивается на чтении).
 *
 * DTO собеседника — только displayName/avatar (email не отдаётся, тест);
 * origin-структура строится из history, а для строк 10-го без history —
 * из origin `gift:{itemId}` (название подтягивается по вещи). Сортировка —
 * по последнему событию, свежие сверху. Фильтр по kind — опционален.
 *
 * Отдаются только СОСТОЯВШИЕСЯ связи (тикет 98): ждущие ответа живут отдельным
 * списком (`listPendingConsent`), отклонённые не показываются никому и никогда.
 */
export async function listConnections(
  userId: string,
  options: { kind?: ConnectionKindDto } = {},
): Promise<ConnectionRowDto[]> {
  const id = idSchema.parse(userId);

  const rows = await prisma.connection.findMany({
    where: {
      OR: [{ aUserId: id }, { bUserId: id }],
      ...(options.kind ? { kind: options.kind } : {}),
      // Состоявшиеся связи — фильтр стоит В ЗАПРОСЕ, а не после него: строка,
      // ждущая ответа или отклонённая, не должна доезжать до страницы даже
      // как отброшенная (тикет 98). Зеркало connectionStatus === "active".
      AND: [{ OR: [{ consentAskedAt: null }, { consentA: true, consentB: true }] }],
    },
    include: { a: personSelect, b: personSelect },
  });

  // Названия/витрина последних подарков — одним запросом на весь список.
  const giftItemIds = new Set<string>();
  for (const row of rows) {
    const history = readHistory(row.history);
    const fromOrigin = row.origin.startsWith("gift:") ? row.origin.slice(5) : null;
    const itemId = history.lastGiftItemId ?? fromOrigin;
    if (itemId) giftItemIds.add(itemId);
  }
  const giftItems = giftItemIds.size
    ? await prisma.item.findMany({
        where: { id: { in: [...giftItemIds] } },
        select: { id: true, title: true, state: true, inHall: true, hiddenFromHall: true },
      })
    : [];
  const itemById = new Map(giftItems.map((item) => [item.id, item]));

  // Комнаты, куда человек ХОДИЛ, — только у них будет карточка с кадром
  // (тикет 95). Считаем «сколько свободно» одним запросом на весь список.
  const visitedRooms = rows.flatMap((row) => {
    const meIsA = row.aUserId === id;
    const other = meIsA ? row.b : row.a;
    if (!other.room || myVisitsToTheirRoom(readHistory(row.history), meIsA) === 0) return [];
    return [{ roomId: other.room.id, zoneKeys: visibleRoomZoneKeys(other.room) }];
  });
  const freeByRoom = await countFreeGiftsByRoom(visitedRooms);

  const result = rows.map((row) => {
    const meIsA = row.aUserId === id;
    const other = meIsA ? row.b : row.a;
    const history = readHistory(row.history);

    // Перспектива: направленные счётчики history → «мне»/«от меня».
    let received = (meIsA ? history.giftsToA : history.giftsToB) ?? 0;
    let given = (meIsA ? history.giftsToB : history.giftsToA) ?? 0;
    const visits = (meIsA ? history.visitsByB : history.visitsByA) ?? 0;

    // Строки тикета 10 без history: origin gift:{itemId}, подарок был один
    // и получала его сторона a (receiveGift всегда писал a=хозяйка).
    const legacyGiftItemId = row.origin.startsWith("gift:") ? row.origin.slice(5) : null;
    if (received + given === 0 && legacyGiftItemId) {
      received = meIsA ? 1 : 0;
      given = meIsA ? 0 : 1;
    }

    let origin: ConnectionOriginDto;
    if (received + given > 0) {
      const lastItem = itemById.get(history.lastGiftItemId ?? legacyGiftItemId ?? "");
      origin = {
        type: "gift",
        received,
        given,
        lastTitle: history.lastGiftTitle ?? lastItem?.title ?? null,
        // Друг — наблюдатель: строка «последнее в сокровищнице» обязана
        // замолчать, как только вещь спрятана глазком (тикет 89). Условие
        // одно на всех наблюдателей — dto/hall.hallItemShownToObservers.
        lastInHall: lastItem ? hallItemShownToObservers(lastItem) : false,
      };
    } else if (visits > 0 || row.origin === "visit" || row.kind === "VIEWED") {
      origin = { type: "visit", visits: Math.max(visits, 1) };
    } else {
      origin = { type: "link" };
    }

    return {
      id: row.id,
      kind: row.kind,
      displayName: other.displayName ?? other.name ?? null,
      avatarUrl: itemPhotoUrl(other.avatarKey),
      origin,
      lastAt: latestIso(
        row.createdAt,
        history.lastGiftAt,
        history.lastVisitByAAt,
        history.lastVisitByBAt,
      ),
      createdAt: row.createdAt.toISOString(),
      room:
        other.room && myVisitsToTheirRoom(history, meIsA) > 0
          ? {
              slug: other.room.nick ?? other.room.shareSlug,
              preset: other.room.preset,
              occasionDate:
                other.room.occasionDate === null
                  ? null
                  : other.room.occasionDate.toISOString().slice(0, 10),
              freeGifts: freeByRoom.get(other.room.id) ?? 0,
            }
          : null,
    } satisfies ConnectionRowDto;
  });

  return result.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/**
 * Сколько раз Я заходил(а) в ЕГО комнату — зеркало счётчика «смотрел(а) у
 * меня». Счётчики history направленные: `visitsByA` — визиты стороны a в
 * комнату b, `visitsByB` — наоборот. Ошибиться стороной здесь дорого: это и
 * есть проверка права видеть чужую комнату.
 */
function myVisitsToTheirRoom(history: ConnectionHistory, meIsA: boolean): number {
  return (meIsA ? history.visitsByA : history.visitsByB) ?? 0;
}

/** Видимые зоны комнаты: пресет минус выключенные (инвариант №5). */
function visibleRoomZoneKeys(room: { preset: string; zonesOff: string[] }): string[] {
  const preset = roomPresets.find((candidate) => candidate.id === room.preset);
  const off = new Set(room.zonesOff);
  return (preset?.zones ?? []).filter((zone) => !off.has(zone.key)).map((zone) => zone.key);
}
