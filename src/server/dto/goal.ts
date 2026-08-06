// Копилка на мечту (ADR-0008, тикет 44) — единственное место, где цель и
// участие превращаются в JSON. Форм ДВЕ, и это главное содержание файла.
//
// ПОЧЕМУ ДВЕ ФОРМЫ, А НЕ ОДНА С ФЛАГОМ. Копилка ведёт себя как складчина, и
// инвариант №1 (тихая бронь) распространяется на неё целиком:
//
//   хозяйке — цель и больше НИЧЕГО. Ни собранной суммы, ни числа участников,
//             ни имён, ни обещанных сумм. Прогресс своей копилки она не видит:
//             у себя в комнате она видит один общий счётчик «N вещей уже
//             забрали», где копилка считается ОДНОЙ вещью при любом числе
//             участников (services/goal.ownerTakenTotal);
//   гостю   — цель, прогресс сбора и «N человек уже скинулись» — без имён.
//
// Форма хозяйки физически не содержит ключей прогресса: не «мы их не
// заполняем», а «их в типе нет». Так вопрос «а это поле хозяйке можно?» не
// приходится решать заново на каждом новом поле — ответ уже в форме.
//
// ИНВАРИАНТ №2. Кто скинулся — только на экране «что подарили», вместе с
// остальными дарителями (services/occasions.getOccasionView). Ни в одной из
// двух форм этого файла имён нет: доска рисует «Вложились трое · Кто», и
// «Кто» до раскрытия не существует.
//
// ДЕНЬГИ. Суммы уезжают строками Decimal, валюта — отдельным полем ISO 4217
// (CLAUDE.md). Числом сумма не становится нигде: доля собранного считается
// на Decimal ниже, а Intl-форматирование живёт в компоненте.
import { Prisma, type GoalPledge, type RoomGoal } from "@prisma/client";

/** Цель глазами ХОЗЯЙКИ: на что копит, сколько, в какой валюте. И всё. */
export type OwnerGoalDto = {
  title: string;
  /** Decimal строкой — «45000.00». */
  amount: string;
  /** ISO 4217. */
  currency: string;
};

/** Цель глазами ГОСТЯ: то же плюс прогресс сбора — без единого имени. */
export type GuestGoalDto = {
  title: string;
  amount: string;
  currency: string;
  /** Сумма НАЗВАННЫХ обещаний, строкой Decimal. */
  pledged: string;
  /** Сколько человек сказали «я участвую» — считаются все, и без суммы тоже. */
  participants: number;
  /** Доля собранного, 0…100, целыми процентами (полоса и «Собрано 36%»). */
  percent: number;
  /** Участвует ли ЭТОТ гость (по токену из его же cookie) — «ты участвуешь». */
  mine: boolean;
};

/**
 * Цель хозяйке. Аргумент — строка БД целиком (со всеми участиями, если их
 * загрузили): allowlist из трёх полей отсекает остальное, даже когда relation
 * случайно оказался в объекте. Ровно тот же приём, что у `itemForOwner`,
 * и проверяется он так же — сериализацией целого объекта в тесте.
 */
export function goalForOwner(goal: RoomGoal | null | undefined): OwnerGoalDto | null {
  if (!goal) return null;
  return {
    title: goal.title,
    amount: goal.amount.toString(),
    currency: goal.currency,
  };
}

/**
 * Цель гостю: та же цель плюс прогресс. Имён и отдельных сумм здесь нет —
 * ни своих, ни чужих: гость видит ОБЩЕЕ число и ОБЩУЮ сумму, а «я участвую»
 * ему подтверждает флаг `mine`, а не строка с его именем.
 *
 * Обещание без суммы («просто участвую») в сумму не входит, но участником
 * считается: иначе «трое скинулись» при пустой полосе выглядело бы ошибкой,
 * а не честной картиной.
 */
export function goalForGuest(
  goal: RoomGoal,
  pledges: readonly Pick<GoalPledge, "amount" | "cancelToken">[],
  options: { myTokens?: readonly string[] } = {},
): GuestGoalDto {
  const mineTokens = new Set(options.myTokens ?? []);
  const pledged = pledges.reduce(
    (sum, pledge) => (pledge.amount ? sum.add(pledge.amount) : sum),
    new Prisma.Decimal(0),
  );

  return {
    title: goal.title,
    amount: goal.amount.toString(),
    currency: goal.currency,
    pledged: pledged.toString(),
    participants: pledges.length,
    percent: percentOf(pledged, goal.amount),
    mine: pledges.some((pledge) => mineTokens.has(pledge.cancelToken)),
  };
}

/**
 * Доля собранного целыми процентами. Считается на Decimal (никакого float:
 * CLAUDE.md), зажимается в 0…100 — перебор по цели рисовать полосой длиннее
 * самой полосы нечем, а «Собрано 140%» ничего не добавляет к «Собрано 100%».
 * Цель ноль или меньше в БД не заводится (схема ввода), но делить на неё
 * всё равно нельзя — честный 0.
 */
function percentOf(pledged: Prisma.Decimal, target: Prisma.Decimal): number {
  if (target.lessThanOrEqualTo(0)) return 0;
  const raw = pledged.div(target).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toNumber();
  return Math.min(100, Math.max(0, raw));
}
