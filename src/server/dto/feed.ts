// Лента «Что происходит» (тикет 114, часть 2) — ПОКАЗ. Правила приехали
// заданием 19 (`design_handoff_round23/task19.json`, доска турн 35a), и здесь
// они собраны в одном месте: свежесть → склейка дня → приоритет → кап.
//
// НЕ ПУТАТЬ с `app/connections/feed-order.ts`: тот про ПОРЯДОК КАРТОЧЕК друзей
// по близости праздника (тикет 95). Здесь — хроника событий комнат.
//
// ПОЧЕМУ СБОРКА В DTO, А НЕ В СЕРВИСЕ. Сериализация по CLAUDE.md живёт ровно в
// одном слое, а все три правила задания 19 — это правила ФОРМЫ строки: какие
// события доживают до экрана, какие сливаются в одну строку и что от них в
// строке остаётся. Сервис при таком делении занят только тем, что умеет один
// он: спросить у БД события ДРУЗЕЙ смотрящего. Побочный выигрыш — правила
// проверяются без базы (tests/feed.dto.test.ts).
//
// ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Подарочного слоя: ни броней, ни складчин,
// ни «что подарили» — правило доски 34c, шире инварианта №1 (запись тех же
// пяти видов сторожит tests/room-events.test.ts). Дарителей лента не
// раскрывает: раскрытие имён случается ровно один раз и на своём экране
// (инвариант №2). Связи лента только ЧИТАЕТ (инвариант №4).

/** Пять видов событий — те же, что пишет `services/room-events` (и только они). */
export type FeedKind =
  | "ITEMS_ADDED"
  | "SHELF_OPENED"
  | "TREASURY_OPENED"
  | "ROOM_CHANGED"
  | "BECAME_MUTUAL";

/**
 * Память ленты (task19 → feedMemory). Новости и вехи стареют по-разному:
 * «новые желания» через неделю уже не новость, а веха месячной давности всё
 * ещё рассказывает, как изменилась комната.
 */
export const FEED_WANTS_DAYS = 7;
export const FEED_MILESTONE_DAYS = 30;

/** После фильтра свежести — не больше стольких строк. «Показать ещё» нет. */
export const FEED_MAX_ROWS = 30;

/**
 * Приоритет склейки (task19 → feedMerge.priority): связь → интерьер →
 * сокровищница → полка → желания. Меньше число — выше веха.
 */
const PRIORITY: Record<FeedKind, number> = {
  BECAME_MUTUAL: 0,
  ROOM_CHANGED: 1,
  TREASURY_OPENED: 2,
  SHELF_OPENED: 3,
  ITEMS_ADDED: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько живёт событие этого вида. */
function lifetimeDays(kind: FeedKind): number {
  return kind === "ITEMS_ADDED" ? FEED_WANTS_DAYS : FEED_MILESTONE_DAYS;
}

/**
 * Событие на входе сборки. Про КОМНАТУ друга и ничего сверх: имя (его лента
 * и так называет), адрес комнаты для тапа, id интерьера — на цвет точки.
 */
export type FeedSourceEvent = {
  /** Чьё событие. Ключ склейки — пара «друг + день», а не комната. */
  friendId: string;
  /** displayName ?? name друга; null — разметка подставит подпись. */
  friendName: string | null;
  /**
   * Адрес комнаты друга для тапа или `null`, если открывать её этому зрителю
   * нечем. Решение принимает сервис (`connections.listFriendsForFeed`), здесь
   * значение только переносится: лента ключей от чужих комнат не раздаёт.
   */
  roomSlug: string | null;
  /** id интерьера комнаты СЕЙЧАС — цвет точки строки (макет 35a). */
  roomPreset: string | null;
  kind: FeedKind;
  at: Date;
  /** Ключ зоны — только у SHELF_OPENED. */
  zone?: string | null;
  /** id интерьера, на который сменили, — только у ROOM_CHANGED. */
  preset?: string | null;
};

/**
 * Строка ленты. Текст собирает разметка через next-intl (CLAUDE.md): здесь
 * только ключи и числа — ни готовых фраз, ни подписей зон.
 */
export type FeedRowDto = {
  /** «друг + день»: ключ склейки, он же ключ списка. */
  id: string;
  /** Вид ВЕДУЩЕГО события дня — он и выбирает строку. */
  kind: FeedKind;
  name: string | null;
  roomSlug: string | null;
  roomPreset: string | null;
  /** Ключ зоны (у SHELF_OPENED), иначе null. */
  zone: string | null;
  /** id интерьера (у ROOM_CHANGED), иначе null. */
  preset: string | null;
  /**
   * Сколько «новых желаний» в этом дне. У строки желаний это её собственное
   * число, у строки-вехи — ХВОСТ `Feed.mergedTail` («…· и 3 новых желания»);
   * 0 — хвоста нет. Одно поле на обе роли намеренно: желание в строке ровно
   * одно, и второе поле немедленно начало бы с ним расходиться.
   */
  wants: number;
  /** ISO ведущего события: разметка покажет «вчера» / «12 дн». */
  at: string;
};

/** Календарный день события в UTC — ключ склейки «один друг в один день». */
function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Свежесть: событию меньше отпущенных ему суток. Граница строгая — ровно
 * семидневное желание уже не новость (срок жизни израсходован), 6 дней 23
 * часа — ещё да. Считается в UTC тем же способом, что и остальные сроки
 * продукта (`app/r/[slug]/welcome.daysUntilOccasion`): пояс машины дал бы на
 * сервере и у гостя из другого часового пояса разные ленты.
 */
export function feedEventFresh(kind: FeedKind, at: Date, now: Date): boolean {
  const age = now.getTime() - at.getTime();
  return age < lifetimeDays(kind) * DAY_MS;
}

/**
 * Лента из событий друзей: свежесть → склейка по паре «друг + день» →
 * приоритет → кап 30 строк.
 *
 * ЧТО ЗДЕСЬ ГЛАВНОЕ (task19 → feedMerge). Один друг в один день = ОДНА строка.
 * Строка дня — событие высшего приоритета; желания того же дня подклеиваются
 * хвостом, а ВТОРАЯ ВЕХА СГОРАЕТ: строка из трёх событий — снова спам, а
 * спам и был причиной, по которой лента вообще спрашивала правило склейки.
 */
export function buildFeed(events: readonly FeedSourceEvent[], now: Date): FeedRowDto[] {
  const days = new Map<string, { lead: FeedSourceEvent; wants: number }>();

  for (const event of events) {
    if (!feedEventFresh(event.kind, event.at, now)) continue;

    const key = `${event.friendId}|${dayKey(event.at)}`;
    const day = days.get(key);
    if (day === undefined) {
      days.set(key, { lead: event, wants: event.kind === "ITEMS_ADDED" ? 1 : 0 });
      continue;
    }

    if (event.kind === "ITEMS_ADDED") day.wants += 1;

    // Ведущее — высшее по приоритету; при равном приоритете (две смены
    // интерьера за день) выигрывает позднее: интерьер дня — тот, на котором
    // день закончился.
    const better =
      PRIORITY[event.kind] < PRIORITY[day.lead.kind] ||
      (PRIORITY[event.kind] === PRIORITY[day.lead.kind] && event.at > day.lead.at);
    if (better) day.lead = event;
  }

  const rows = [...days].map(([id, { lead, wants }]) => ({
    id,
    kind: lead.kind,
    name: lead.friendName,
    roomSlug: lead.roomSlug,
    roomPreset: lead.roomPreset,
    zone: lead.kind === "SHELF_OPENED" ? (lead.zone ?? null) : null,
    preset: lead.kind === "ROOM_CHANGED" ? (lead.preset ?? null) : null,
    // Хвост — ТОЛЬКО у вехи. У самой строки желаний это её собственное число.
    wants,
    at: lead.at.toISOString(),
  })) satisfies FeedRowDto[];

  // Свежее сверху; равные моменты разводим ключом, чтобы порядок не зависел
  // от того, в каком порядке БД вернула строки.
  rows.sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? 1 : -1));
  return rows.slice(0, FEED_MAX_ROWS);
}
