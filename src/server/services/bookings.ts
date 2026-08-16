// Сервис «Тихая бронь» (тикет 08): гость занимает вещь комнаты без
// регистрации и управляет своими бронями по cancelToken из HTTP-only cookie.
//
// БРОНИРУЕТСЯ ВСЁ, ЧТО В КОМНАТЕ (тикет 124). Состояний у вещи нет; комната и
// есть список желаний. Не бронируется только то, что уже своё, — вещь
// сокровищницы (`inHall`).
//
// ИНВАРИАНТ №1 (CLAUDE.md, никогда не нарушать): хозяйке — НИЧЕГО. Ни одна
// функция этого сервиса не шлёт уведомлений, не пишет ничего видимого хозяйке
// и НЕ ревалидирует кэш комнаты (брони в guest-DTO нет по построению —
// тикет 07). Счётчик «N вещей уже забраны» — тикет 09, отдельный канал.
// Имена/почты гостей наружу не выходят нигде, кроме «моих броней» самого
// гостя, — и даже там их сейчас нет: DTO собирается allowlist'ом без
// guestName/guestEmail (под тестом).
import { randomBytes } from "node:crypto";
import { isExpired } from "@/server/dto/experience";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { birthdayOf, dueOccasion, type BirthdayColumns } from "@/server/birthday";
import { itemPhotoUrl } from "@/server/dto/items";
import { enqueueItemGoneMail } from "@/server/queues";
import { hallOpenToViewer } from "@/server/services/hall-access";

const idSchema = z.string().min(1).max(64);
// Слаг приходит из URL от кого угодно: мусор режем до похода в БД (как в guest-room).
const slugSchema = z.string().min(1).max(64);

/** Токен отмены: randomBytes(24) в hex — ровно 48 символов [0-9a-f]. */
const TOKEN_RE = /^[0-9a-f]{48}$/;

// ---------- Доменные отказы ----------

export type BookingErrorCode =
  | "NOT_FOUND" // вещи нет (или гостю её «не существует»: hidden / зона выключена)
  | "DEMO_ITEM" // демо-призрак «пример» — не бронируется (гриллинг №4)
  | "IN_HALL" // вещь уже своя (в сокровищнице) — дарить нечего
  | "OWN_ITEM" // хозяйка «бронирует» свою вещь — подарок себе не бывает (тикет 11)
  | "ALREADY_BOOKED" // уникальность Booking.itemId (P2002) — уже занято
  | "EXPIRED" // впечатление с вышедшим сроком (тикет 97)
  | "POOL_NOT_SUPPORTED" // складчина — Phase 2 (каркас в БД есть, UI нет)
  | "OCCASION_PASSED" // передумать про связь после праздника поздно (тикет 98b)
  | "TOKEN_NOT_FOUND"; // операция по чужому/несуществующему токену

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

// ---------- Бронирование ----------

/** Пустая строка/null → undefined («поле не заполнено»), как в services/items. */
const optionalEmail = z.preprocess(
  (value) =>
    value == null || (typeof value === "string" && value.trim() === "") ? undefined : value,
  z.email("почта выглядит неправильно").max(254).optional(),
);

/**
 * Вход брони. POOL входит в enum сознательно: отказ по нему — доменный,
 * с честным сообщением (400), а не безликий ZodError.
 */
export const bookItemInputSchema = z.object({
  itemId: idSchema,
  name: z.string({ error: "имя обязательно" }).trim().min(1, "имя обязательно").max(120),
  email: optionalEmail,
  mode: z.enum(["QUIET", "SIGNED", "POOL"]).default("QUIET"),
  /**
   * Гость предложил остаться на связи (тикет 98b, доска 32a). Вопрос стоит
   * на подтверждении брони, поэтому и ответ приходит сюда. У гостя без
   * аккаунта игнорируется: связывать некого.
   */
  offersConnection: z.boolean().default(false),
});

export type BookItemInput = z.input<typeof bookItemInputSchema>;

/**
 * Гость тихо занимает вещь комнаты. Возврат — ТОЛЬКО cancelToken: единственный
 * ключ гостя к своей брони (уйдёт в HTTP-only cookie на роуте).
 *
 * Правила:
 * - демо-призраки (id `demo:...`) не бронируются — их нет в БД, отказ честный;
 * - спрятанная вещь и вещь выключенной зоны для гостя «не существуют»
 *   (инвариант №5) — тот же NOT_FOUND, что у незнакомого id, без утечки факта;
 * - только вещь КОМНАТЫ (`inHall: false`); только без активной брони —
 *   уникальность Booking.itemId держит СХЕМА (гонка двух гостей решается
 *   P2002, не проверкой заранее);
 * - режим QUIET|SIGNED; POOL — Phase 2, отказ с честным сообщением.
 *
 * options.sessionUserId (тикет 11) — userId сессии, если гость залогинен
 * (auth БЕЗ требования: аноним бронирует как раньше). Пишется в
 * booking.guestUserId — из него после «Дошло» рождается связь (тикет 10).
 * Свою вещь хозяйка не «бронирует» — отказ OWN_ITEM: подарок себе не бывает,
 * а бронь без дарителя лишь врала бы счётчику.
 */
export async function bookItem(
  input: unknown,
  options: { sessionUserId?: string | null } = {},
): Promise<{ cancelToken: string }> {
  const data = bookItemInputSchema.parse(input);
  const sessionUserId = options.sessionUserId ? idSchema.parse(options.sessionUserId) : null;

  if (data.mode === "POOL") {
    throw new BookingError(
      "POOL_NOT_SUPPORTED",
      "складчина появится позже — пока можно занять вещь тихо или с подписью",
    );
  }
  // Демо-призраки не бронируются (гриллинг №4). Их id (`demo:{zone}:{n}`)
  // в БД не живут, но отказ должен быть честным, а не «вещь не найдена».
  if (data.itemId.startsWith("demo:")) {
    throw new BookingError("DEMO_ITEM", "это пример для пустой зоны — подарить его нельзя");
  }

  const item = await prisma.item.findUnique({
    where: { id: data.itemId },
    select: {
      id: true,
      inHall: true,
      hidden: true,
      zone: true,
      validUntil: true,
      room: { select: { zonesOff: true, userId: true } },
    },
  });
  // Спрятанные вещи и вещи выключенных зон гостям не отдаются (инвариант №5) —
  // и не бронируются; отказ неотличим от несуществующего id.
  if (!item || item.hidden || item.room.zonesOff.includes(item.zone)) {
    throw new BookingError("NOT_FOUND", "такой вещи нет");
  }
  if (sessionUserId && sessionUserId === item.room.userId) {
    throw new BookingError("OWN_ITEM", "это твоя вещь — подарить её себе нельзя");
  }
  // Вещь сокровищницы уже своя — дарить её нечего (тикет 124). Всё
  // остальное, что лежит в комнате, бронируется без исключений.
  if (item.inHall) {
    throw new BookingError("IN_HALL", "эта вещь уже у хозяйки — подарить её нельзя");
  }
  // Впечатление с вышедшим сроком не бронируется (тикет 97): сертификат,
  // годный до вчера, дарить нечем. Вещь при этом остаётся видной — хозяйка
  // её не убирала, и прятать её за нас никто не просил.
  if (isExpired(item.validUntil, new Date())) {
    throw new BookingError("EXPIRED", "срок этого впечатления уже вышел");
  }

  const cancelToken = randomBytes(24).toString("hex");
  try {
    await prisma.booking.create({
      data: {
        itemId: item.id,
        mode: data.mode,
        guestName: data.name,
        guestEmail: data.email ?? null,
        guestUserId: sessionUserId,
        cancelToken,
        // Предложение связи — только у гостя с аккаунтом: анониму связь
        // заводить не с кем (тикет 98b). У остальных остаётся false.
        offersConnection: sessionUserId ? data.offersConnection : false,
      },
    });
  } catch (error) {
    // Уникальность itemId уже в схеме: параллельная бронь = P2002 → «занято».
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BookingError("ALREADY_BOOKED", "уже занято — кто-то успел раньше");
    }
    throw error;
  }

  return { cancelToken };
}

/** Снять бронь — только по своему cancelToken. Чужой/битый токен → отказ. */
export async function cancelBooking(cancelToken: string): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const { count } = await prisma.booking.deleteMany({ where: { cancelToken: token } });
  if (count === 0) {
    throw new BookingError("TOKEN_NOT_FOUND", "брони с таким токеном нет");
  }
}

/** Отметка «куплено» (переключатель) — только по своему cancelToken. */
export async function markPurchased(cancelToken: string, purchased = true): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const { count } = await prisma.booking.updateMany({
    where: { cancelToken: token },
    data: { purchased },
  });
  if (count === 0) {
    throw new BookingError("TOKEN_NOT_FOUND", "брони с таким токеном нет");
  }
}

/**
 * «Остаться в связях?» — ответ гостя на подтверждении брони (тикет 98b,
 * доска 32a). Меняет только СВОЮ бронь по своему токену; связи в этот момент
 * ещё не существует, она родится на «Дошло» и возьмёт ответ отсюда.
 *
 * Предложение живёт на ПАРЕ гость↔хозяйка, а не на вещи: ответ ставится всем
 * живым броням этого гостя в этой комнате разом — вторая бронь той же хозяйке
 * вопроса уже не задаст, а передумать можно один раз на всех.
 *
 * ПЕРЕДУМАТЬ МОЖНО ТОЛЬКО ДО ПРАЗДНИКА (хвост тикета 98b). Как только итог
 * закрыт, ответ отыгран: хозяйка видит предложение на «что подарили», а
 * «Дошло» переносит его в связь — менять задним числом нечего (условие —
 * `consentAnswerLocked` ниже). Отказ доменный (OCCASION_PASSED) и живёт
 * ЗДЕСЬ, а не в разметке: строка «Моих подарков» только показывает то, что
 * решил сервис.
 */
export async function offerConnection(cancelToken: string, offers: boolean): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const mine = await prisma.booking.findUnique({
    where: { cancelToken: token },
    select: {
      guestUserId: true,
      item: {
        select: {
          roomId: true,
          room: { select: { birthdayDay: true, birthdayMonth: true, birthdayYear: true } },
        },
      },
    },
  });
  if (!mine) {
    throw new BookingError("TOKEN_NOT_FOUND", "брони с таким токеном нет");
  }
  // Гость без аккаунта: связывать некого, ответ молча ничего не меняет.
  if (!mine.guestUserId) return;

  const closed = await prisma.occasionSummary.findFirst({
    where: { roomId: mine.item.roomId },
    select: { id: true },
  });
  if (consentAnswerLocked(mine.item.room, closed !== null, new Date())) {
    throw new BookingError("OCCASION_PASSED", "праздник уже прошёл — ответ менять поздно");
  }

  await prisma.booking.updateMany({
    where: { guestUserId: mine.guestUserId, item: { roomId: mine.item.roomId } },
    data: { offersConnection: Boolean(offers) },
  });
}

/**
 * Ответ про связь уже отыгран? От этого зависит, можно ли ещё передумать
 * (хвост тикета 98b): до праздника — да, после — нет.
 *
 * Отсчёт идёт не от календаря, а от МОМЕНТА, КОГДА ОТВЕТ СТАНОВИТСЯ ВИДЕН.
 * До закрытия праздника его не читает никто: связи из подарка ещё нет
 * (`receiveGift` без `OccasionSummary` отвечает NO_SUMMARY), а «что подарили»
 * без итога не показывает ни имён, ни вопросов. Наступившая дата сама по себе
 * не запирает ничего: между ней и закрытием (его делает воркер или сама
 * хозяйка) человек не увидел ещё ни строчки — а вот гость в эти часы может и
 * подарок занять, и на вопрос ответить.
 *
 * Обратный случай — комната МЕЖДУ праздниками: прошлый итог закрыт, но
 * впереди уже стоит следующий день рождения, и брони копятся к нему (то же
 * правило, что у баннера комнаты — `occasions.occasionBannerVisible`). Такой
 * ответ снова живой: он про следующий праздник, а не про закрытый.
 *
 * С повторяющейся датой (тикет 187) «впереди» она ВСЕГДА, поэтому «между
 * праздниками» задаётся хвостом: пока день рождения считается наступившим
 * (`birthday.dueOccasion`), закрытый итог держит ответ; кончился хвост —
 * ответ снова живой. Комната без дня рождения запирается закрытием итога, как
 * и раньше: другого края у её праздника нет.
 */
function consentAnswerLocked(room: BirthdayColumns, closed: boolean, now: Date): boolean {
  const birthday = birthdayOf(room);
  if (birthday && dueOccasion(birthday, now) === null) return false;
  return closed;
}

// ---------- «Мои брони» гостя ----------

/**
 * Строка «моих броней». Сериализация — только allowlist: ключей guestName /
 * guestEmail в форме НЕ СУЩЕСТВУЕТ (даже своих — гостю они не нужны, а
 * инвариант №1 проще держать, когда их нет нигде). Покрыто тестом.
 */
export type MyBookingDto = {
  itemId: string;
  title: string;
  photoUrl: string | null;
  /** Комната вещи: слаг для ссылки /r/{slug} и имя хозяйки для подписи. */
  roomSlug: string;
  ownerName: string | null;
  mode: "QUIET" | "SIGNED" | "POOL";
  purchased: boolean;
  /** ISO-строка — когда занял. */
  createdAt: string;
  /**
   * Строка «Показаться после праздника · да/нет» (хвост тикета 98b, доска
   * 32a). null — спрашивать не о чем: гость бронировал без аккаунта, и
   * связывать его не с кем (`offersConnection` у такой брони всегда false).
   */
  connection: MyBookingConnectionDto | null;
};

/** Ответ гостя про связь — как он выглядит в «Моих подарках». */
export type MyBookingConnectionDto = {
  /** Текущий ответ: показаться хозяйке после праздника или подарить тихо. */
  offers: boolean;
  /** Можно ли ещё передумать. false — праздник прошёл, вопрос отыгран. */
  editable: boolean;
};

/** Токены из cookie: только похожие на наши (48 hex), без дублей. */
function validTokens(tokens: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (typeof token === "string" && TOKEN_RE.test(token)) unique.add(token);
  }
  return [...unique];
}

/**
 * Брони гостя по токенам из его cookie — для страницы «мои брони».
 * Отдаются ТОЛЬКО брони перечисленных токенов: чужого сюда не попадает
 * по построению (where cancelToken in …), и почт других гостей в выдаче
 * нет ни при каком входе.
 */
export async function listBookingsByTokens(tokens: readonly string[]): Promise<MyBookingDto[]> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return [];

  const bookings = await prisma.booking.findMany({
    where: { cancelToken: { in: valid } },
    orderBy: { createdAt: "desc" },
    select: {
      mode: true,
      purchased: true,
      createdAt: true,
      // Ответ про связь (хвост тикета 98b): гостю показывается его же ответ,
      // о хозяйке эти поля не говорят ничего — инвариант №1 не задет.
      guestUserId: true,
      offersConnection: true,
      item: {
        select: {
          id: true,
          title: true,
          photoKey: true,
          room: {
            select: {
              id: true,
              shareSlug: true,
              birthdayDay: true,
              birthdayMonth: true,
              birthdayYear: true,
              user: { select: { displayName: true, name: true } },
            },
          },
        },
      },
    },
  });

  // «Праздник уже закрыт?» — одним запросом на весь список: OccasionSummary
  // связан с комнатой только полем roomId (relation'а у модели нет).
  const roomIds = [...new Set(bookings.map((booking) => booking.item.room.id))];
  const closedRooms = new Set(
    roomIds.length === 0
      ? []
      : (
          await prisma.occasionSummary.findMany({
            where: { roomId: { in: roomIds } },
            select: { roomId: true },
          })
        ).map((summary) => summary.roomId),
  );
  const now = new Date();

  return bookings.map((booking) => ({
    itemId: booking.item.id,
    title: booking.item.title,
    photoUrl: itemPhotoUrl(booking.item.photoKey),
    roomSlug: booking.item.room.shareSlug,
    ownerName: booking.item.room.user.displayName ?? booking.item.room.user.name ?? null,
    mode: booking.mode,
    purchased: booking.purchased,
    createdAt: booking.createdAt.toISOString(),
    connection: booking.guestUserId
      ? {
          offers: booking.offersConnection,
          editable: !consentAnswerLocked(
            booking.item.room,
            closedRooms.has(booking.item.room.id),
            now,
          ),
        }
      : null,
  }));
}

/** Сколько живых броней у гостя (для строки «Мои брони · N»). */
export async function countBookingsByTokens(tokens: readonly string[]): Promise<number> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return 0;
  return prisma.booking.count({ where: { cancelToken: { in: valid } } });
}

/**
 * Токен гостя для конкретной вещи — сервер сам находит подходящий токен из
 * cookie (роуты отмены/«куплено» не принимают токен от клиента явно).
 */
export async function findTokenForItem(
  itemId: string,
  tokens: readonly string[],
): Promise<string | null> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return null;
  const booking = await prisma.booking.findFirst({
    where: { itemId: idSchema.parse(itemId), cancelToken: { in: valid } },
    select: { cancelToken: true },
  });
  return booking?.cancelToken ?? null;
}

// ---------- Канал «занято»: гостям — да, хозяйке — нет (тикеты 08 и 41) ----------

/**
 * id забронированных вещей комнаты — и НИЧЕГО больше: ни имён, ни режимов,
 * ни дат (тихое «занято» другим гостям, US 26). Канал живёт ВНЕ кэша комнаты
 * (некэшируемый роут) — кэшированный HTML одинаков для всех.
 */
export async function takenItemIds(roomId: string): Promise<string[]> {
  const rows = await prisma.booking.findMany({
    where: { item: { roomId: idSchema.parse(roomId) } },
    select: { itemId: true },
  });
  return rows.map((row) => row.itemId);
}

/**
 * Ответ канала «занято» целиком — ровно то, что уезжает в гостевую комнату
 * (роут только заворачивает это в `{ data }`). Форма ОДНА на обоих зрителей,
 * и это тот же приём, что в сводке зоны (dto/zone-summary.ts): разница между
 * хозяйкой и гостем живёт не в наборе ключей, а в числах внутри, и решается
 * в ОДНОМ месте — иначе «а этот ключ хозяйке можно?» пришлось бы отвечать
 * заново на каждом новом поле.
 */
export type TakenChannelDto = {
  /** Занятые вещи комнаты — ТОЛЬКО id, без имён. */
  itemIds: string[];
  /** Какие из них заняты ЭТИМ гостем (по токенам его же cookie). */
  mine: string[];
  /** Всего живых броней гостя — строка «Мои подарки · N» внизу комнаты. */
  myBookingsCount: number;
  /**
   * Зритель вошёл в свой аккаунт (тикет 98b). Нужен вопросу «остаться в
   * связях?»: анониму связывать некого, и спрашивать его не о чем.
   *
   * Живёт ЗДЕСЬ, а не в разметке страницы, потому что гостевая страница
   * одинакова для всех и сессии не читает вовсе (ISR). Про брони этот флаг
   * не говорит ничего — инвариант №1 не задет.
   */
  signedIn: boolean;
  /**
   * ЗРИТЕЛЬ — ХОЗЯИН ЭТОЙ КОМНАТЫ (тикет 250, приёмка 14.08.2026: «при попытке
   * подарить не срабатывает кнопка, пишет, что ты в своей комнате»).
   *
   * Запрет правильный и остаётся: иначе счётчик «N вещей уже забраны» хозяйка
   * накрутит себе сама, и инвариант №1 теряет смысл. Неверно было МЕСТО: он
   * срабатывал на сервере ПОСЛЕ того, как человек заполнил имя, почту и выбрал
   * «тихо / подписаться», — и читался ошибкой, а не «так задумано».
   *
   * Флаг живёт здесь по той же причине, что и `signedIn`: гостевая страница
   * одинакова для всех и сессии не читает (ISR), а этот канал некэшируем и
   * может. Про брони он не говорит НИЧЕГО — ответ хозяйке и так пустой, и
   * инвариант №1 не задет.
   */
  isOwner: boolean;
  /**
   * Открыта ли ЭТОМУ зрителю сокровищница комнаты (тикет 116, ADR-0011).
   *
   * Живёт здесь по той же причине, что и `signedIn`, и ровно в том же канале:
   * при положении «только взаимным друзьям» ответ зависит от того, КТО
   * смотрит, а страница /r/{slug} кэшируется целиком и сессии не читает.
   * Второго запроса ради одной ссылки заводить незачем — вход «Сокровищница»
   * приезжает тем же кругом, что «занято» и «Мои подарки».
   *
   * Про брони не говорит ничего: инвариант №1 не задет. Хозяйке своей же
   * ссылки флаг приходит `true` — витрина её собственная (см. takenForOwner).
   */
  hallOpen: boolean;
  /**
   * У ВОШЕДШЕГО ЗРИТЕЛЯ ЕСТЬ СВОЯ КОМНАТА (тикет 253, приёмка 16.08.2026:
   * «если я просматриваю страницу в качестве гостя и допустим имею свою
   * страницу, то как мне это увидеть на странице гостя и быстро перейти к
   * себе?»).
   *
   * Третье место гостевого бара звало «Собрать свою» и вело на первый экран
   * воронки ВСЕГДА — человеку с готовой комнатой продукт предлагал собрать её
   * заново, а дороги к себе не давал вовсе. По этому флагу место переключается
   * на дорогу домой.
   *
   * Живёт здесь по той же причине, что `signedIn` и `isOwner`: страница
   * /r/{slug} кэшируется целиком и сессии не читает, а канал некэшируем и
   * зрителя знает. Про брони флаг не говорит ничего — инвариант №1 не задет.
   *
   * ОТВЕТ — РОВНО БУЛЕВО, и это не экономия. Ни имени, ни слага, ни числа
   * вещей: дорога домой ведёт на `/room`, а свой адрес зритель знает сам.
   * Инвариант №4 (друзья не добавляются) тоже цел — это собственная комната
   * зрителя, а не поиск людей.
   */
  hasOwnRoom: boolean;
};

/**
 * Ответ ХОЗЯЙКЕ, открывшей СВОЮ ЖЕ ссылку (тикет 41): комната выглядит так,
 * будто не занято ничего. Инвариант №1 говорит «ни в API, ни в кэше», а это
 * ровно API — и ссылку хозяйка получает кнопкой «поделиться», которую мы сами
 * ей и показываем.
 *
 * Пустой ответ, а не «частичный», сознательно: это одно правило, которое
 * наследует любое будущее поле этой формы. `myBookingsCount` тоже 0 — её
 * брони в ЧУЖИХ комнатах существуют, но число, показанное в её собственной
 * комнате, читается как «сколько тут занято», а не «сколько я подарила»;
 * дорога к «моим подаркам» у неё остаётся из тех комнат, где она гость.
 *
 * Это НЕ криптографическая защита: хозяйка может выйти из аккаунта и открыть
 * ту же ссылку гостем. Обещание инварианта — «продукт ей не показывает», а не
 * «она не может подсмотреть» (ADR-0007).
 */
function takenForOwner(): TakenChannelDto {
  // Хозяйка на своей ссылке вошла — но занятого для неё не существует.
  // `hallOpen` при этом true, и правило «пустой ответ» здесь не нарушено:
  // оно про БРОНИ, а витрина — её собственная, и запирать хозяйку от своих же
  // вещей не за чем (тикет 116).
  return {
    itemIds: [],
    mine: [],
    myBookingsCount: 0,
    signedIn: true,
    isOwner: true,
    hallOpen: true,
    // Хозяин ЭТОЙ комнаты — по определению человек со своей комнатой, спрашивать
    // базу не о чем (тикет 253). Правило «пустой ответ» здесь не нарушено: оно
    // про БРОНИ, а ему третье место бара тем более обязано вести домой, а не в
    // регистрацию, — «это твоя комната» ему уже сказано (тикет 250).
    hasOwnRoom: true,
  };
}

/**
 * Ответ ГОСТЮ: все занятые вещи комнаты плюс `mine` — какие из них заняты
 * ЭТИМ гостем (по токенам его же cookie; о чужих бронях это не говорит
 * ничего). Ради этой координации мы у гостя имя и спрашиваем.
 *
 * ФЛАГИ ЗРИТЕЛЯ ЕДУТ ОДНИМ ИМЕНОВАННЫМ ОБЪЕКТОМ (тикет 253). Позиционными они
 * были, пока их было два; с третьим («есть своя комната») подряд идут три
 * булевых места, и перестановка соседей не ловится ни типом, ни тестом формы —
 * ответ просто начинает врать про другого зрителя.
 */
async function takenForGuest(
  roomId: string,
  tokens: readonly string[],
  viewer: { signedIn: boolean; hallOpen: boolean; hasOwnRoom: boolean },
): Promise<TakenChannelDto> {
  const itemIds = await takenItemIds(roomId);
  const valid = validTokens(tokens);
  const mine =
    valid.length === 0 || itemIds.length === 0
      ? []
      : (
          await prisma.booking.findMany({
            where: { cancelToken: { in: valid }, item: { roomId } },
            select: { itemId: true },
          })
        ).map((row) => row.itemId);

  return {
    itemIds,
    mine,
    myBookingsCount: await countBookingsByTokens(tokens),
    signedIn: viewer.signedIn,
    // Сюда попадает только НЕ хозяин: ветка хозяйки отсекается выше и уходит
    // в `takenForOwner`. Значение проставляется явно, а не умолчанием типа —
    // иначе следующая ветка ответа заведётся без него молча.
    isOwner: false,
    hallOpen: viewer.hallOpen,
    hasOwnRoom: viewer.hasOwnRoom,
  };
}

/**
 * Есть ли своя комната у ВОШЕДШЕГО зрителя (тикет 253) — один булев ответ и
 * ничего больше. Аноним базу не тревожит: комнаты у него быть не может.
 *
 * Наружу уходит только `true/false`. Ни слага, ни имени чужой комнаты в
 * гостевом канале не появляется ни на секунду: дорога домой ведёт на `/room`,
 * и свой адрес зритель знает сам.
 */
async function viewerHasOwnRoom(viewerUserId: string | null): Promise<boolean> {
  if (viewerUserId === null) return false;
  const own = await prisma.room.findUnique({
    where: { userId: viewerUserId },
    select: { id: true },
  });
  return own !== null;
}

/**
 * «Занято» для гостевой страницы по слагу. Единственная дверь канала: здесь
 * комната резолвится и здесь же выбирается ветка зрителя.
 *
 * `options.viewerUserId` — userId сессии, если зритель вошёл (auth БЕЗ
 * требования: аноним получает гостевой ответ, как раньше). Совпал с хозяйкой
 * комнаты — ответ `takenForOwner()`. Тот же приём, что у визита
 * (connections.recordVisit: «своя комната → no-op»).
 *
 * Про самого зрителя канал отвечает тремя булевыми: вошёл ли (`signedIn`),
 * хозяин ли ЭТОЙ комнаты (`isOwner`) и есть ли у него СВОЯ (`hasOwnRoom`,
 * тикет 253). Больше о нём отсюда не уходит ничего.
 *
 * Неизвестный слаг → null (роут ответит 404).
 */
export async function takenForRoomSlug(
  slug: string,
  tokens: readonly string[],
  options: { viewerUserId?: string | null } = {},
): Promise<TakenChannelDto | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  // Адрес резолвится как ник ИЛИ короткий код — тем же порядком, что
  // guest-room.getGuestRoom и connections.recordVisitBySlug: страница /r/{slug}
  // уводит на канонический /r/{nick}, и по этому адресу канал обязан отвечать
  // так же, как по коду (иначе у комнаты с ником он молча мёртв — и ветка
  // хозяйки в нём никогда бы не сработала). Ник, совпадающий с чужим кодом,
  // не выдаётся (services/rooms.setRoomNick), поэтому порядок безопасен.
  const roomSelect = { id: true, userId: true, hallVisibility: true } as const;
  const room =
    (await prisma.room.findUnique({
      where: { nick: parsedSlug.data },
      select: roomSelect,
    })) ??
    (await prisma.room.findUnique({
      where: { shareSlug: parsedSlug.data },
      select: roomSelect,
    }));
  if (!room) return null;

  const viewerUserId = options.viewerUserId ? idSchema.parse(options.viewerUserId) : null;
  if (viewerUserId !== null && viewerUserId === room.userId) return takenForOwner();

  return takenForGuest(room.id, tokens, {
    signedIn: viewerUserId !== null,
    // «Открыта ли витрина этому зрителю» (тикет 116) считается ТЕМ ЖЕ сервисом,
    // что и остальное в этом ответе: гостевая страница узнаёт ответ отсюда и не
    // заводит ради ссылки второго запроса. Правило одно на дверь и на ссылку —
    // ссылки, ведущей в 404, быть не должно (ADR-0011).
    hallOpen: await hallOpenToViewer(room, viewerUserId),
    // Тем же кругом едет и развилка третьего места бара (тикет 253): второго
    // запроса ради одной ссылки не заводится, как и у витрины.
    hasOwnRoom: await viewerHasOwnRoom(viewerUserId),
  });
}

// ---------- Канал хозяйки: счётчик «N вещей уже забраны» (тикет 09) ----------

/**
 * ЕДИНСТВЕННОЕ, что хозяйка узнаёт о бронях до праздника (инвариант №1), —
 * одно ГОЛОЕ число: сколько вещей её комнаты сейчас занято. Ни id вещей,
 * ни имён, ни режимов, ни дат — тип возврата number не даёт унести больше.
 *
 * Комната ищется по userId СЕССИИ (не по slug: слаг публичный, чужой счётчик
 * по нему спрашивать нельзя). Гостевой канал (`takenItemIds`,
 * /rooms/{slug}/taken) сюда сознательно не переиспользуется — он отдаёт id
 * занятых вещей, а хозяйке нельзя знать, КАКИЕ вещи заняты.
 * Нет комнаты — честный 0: нет комнаты, нет и занятых вещей.
 */
export async function ownerTakenCount(userId: string): Promise<number> {
  return prisma.booking.count({
    where: { item: { room: { userId: idSchema.parse(userId) } } },
  });
}

/**
 * Автоснятие брони вещи: deleteMany — идемпотентно (нет брони → false, без
 * ошибки). Возврат — снялась ли бронь фактически.
 *
 * Это МЕХАНИЗМ для мутаций хозяйки: UI скрытия/удаления вещи (тикет 13)
 * обязан звать эту функцию, чтобы спрятанная вещь не осталась «занятой» и
 * счётчик не врал.
 *
 * СКЛАДЧИНА ВОЗВРАЩАЕТСЯ ЗДЕСЬ ЖЕ И ДРУГОГО МЕХАНИЗМА НЕТ. Взносы
 * (`PoolContribution`) висят на брони и уходят вместе с ней каскадом схемы —
 * ровно тот же «автовозврат», что у несобравшейся складчины (PRD §12а:
 * «не собрали к дате — автовозврат»). Денег сервис не держит и не переводит,
 * поэтому вернуть = перестать считать договорённость живой.
 *
 * `options.notifyGuest` (тикет 124, раунд 28) — сказать ГОСТЮ, что вещь
 * уехала, и предложить выбрать другую. Зовёт это только переезд в
 * сокровищницу: там вещь у хозяйки уже есть, и молчание отправило бы человека
 * на праздник с ненужным подарком. Скрытие и удаление остаются молчаливыми,
 * как были.
 *
 * ХОЗЯЙКЕ ОТСЮДА НЕ УХОДИТ НИЧЕГО И НИКОГДА (инвариант №1): письмо адресовано
 * гостю, ставится ПОСЛЕ удаления и не влияет ни на возврат, ни на ошибки —
 * `enqueueItemGoneMail` не бросает по построению. Вызывающая сторона не имеет
 * права показывать хозяйке результат этой функции: он говорит, была ли бронь.
 */
export async function releaseBookingForItem(
  itemId: string,
  options: { notifyGuest?: boolean } = {},
): Promise<boolean> {
  const id = idSchema.parse(itemId);
  // Читаем ДО удаления: после него писать некому и не о чем. Почта гостя
  // наружу из этой функции не выходит — она уезжает прямо в очередь.
  const doomed = options.notifyGuest
    ? await prisma.booking.findUnique({
        where: { itemId: id },
        select: {
          id: true,
          guestName: true,
          guestEmail: true,
          item: { select: { title: true, room: { select: { shareSlug: true, nick: true } } } },
        },
      })
    : null;

  const { count } = await prisma.booking.deleteMany({ where: { itemId: id } });

  // Гость без почты остаётся без письма — писать некуда. Это не потеря
  // тишины, а её отсутствие: он и бронировал анонимно.
  if (doomed && count > 0 && doomed.guestEmail) {
    await enqueueItemGoneMail({
      bookingId: doomed.id,
      email: doomed.guestEmail,
      guestName: doomed.guestName,
      itemTitle: doomed.item.title,
      roomSlug: doomed.item.room.nick ?? doomed.item.room.shareSlug,
    });
  }
  return count > 0;
}

// ---------- Cookie гостя `guest_bookings` ----------
// Контракт (тикеты 09/15): HTTP-only cookie, значение — JSON-массив
// cancelToken'ов (48 hex каждый), path=/, maxAge год, sameSite=lax,
// secure в production. Хвост длиннее 50 токенов режется с СТАРОГО конца.

export const GUEST_BOOKINGS_COOKIE = "guest_bookings";
export const GUEST_BOOKINGS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // год, в секундах
/** 50 токенов ≈ 2.6 КБ JSON — с запасом до браузерного лимита cookie 4 КБ. */
export const MAX_GUEST_BOOKING_TOKENS = 50;

/** Значение cookie → массив токенов. Мусор любого вида → пустой список. */
export function parseGuestBookingTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return validTokens(parsed.filter((entry): entry is string => typeof entry === "string")).slice(
      -MAX_GUEST_BOOKING_TOKENS,
    );
  } catch {
    return [];
  }
}

/** Новый токен — в конец; дубль не плодится; старейшие выпадают за лимитом. */
export function addGuestBookingToken(tokens: readonly string[], token: string): string[] {
  return [...tokens.filter((entry) => entry !== token), token].slice(-MAX_GUEST_BOOKING_TOKENS);
}

export function removeGuestBookingToken(tokens: readonly string[], token: string): string[] {
  return tokens.filter((entry) => entry !== token);
}

/** Опции cookie — одинаковые во всех роутах, чтобы cookie не «расслаивалась». */
export function guestBookingsCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_BOOKINGS_COOKIE_MAX_AGE,
  } as const;
}
