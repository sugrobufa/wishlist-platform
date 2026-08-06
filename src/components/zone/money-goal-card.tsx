"use client";

// Карточка копилки на мечту — зона «Просто деньги» (тикет 44, ADR-0008).
//
// ЧТО РИСУЕМ С ДОСКИ (турн 8d): плашку «Основное желание», цель словами,
// собранное над «из 180 000 ₽», полосу прогресса, строку «Собрано 36% ·
// 11 человек уже скинулись» и галочки-обещания.
// ЧЕГО НЕ РИСУЕМ: «быстрых сумм» и кнопки «Отправить 3 000 ₽» — это платёж.
// Сервис деньги не принимает, не хранит и не переводит (PRD §12а): участие —
// договорённость, деньги идут напрямую хозяйке.
//
// ДВА ЗРИТЕЛЯ — ДВА РАЗНЫХ ЭКРАНА, и разводит их не эта карточка, а сервер:
//   хозяйка → GET /api/v1/room/goal   — цель и ничего больше;
//   гость   → GET /api/v1/rooms/{slug}/goal — цель, прогресс, «N скинулись»,
//             а если он сам скинулся — ещё и имена соседей по складчине
//             (тикет 54; кому их можно, решает сервер по cookie участия).
// Прогресс своей копилки хозяйка не видит (инвариант №1), и это свойство не
// формы, а ответа: в её ответе таких ключей нет вовсе (dto/goal.ts). Даже
// открыв собственную гостевую ссылку, она получит ветку `owner`.
//
// КАК КАРТОЧКА ПОНИМАЕТ, ГДЕ ОНА СТОИТ. По параметру маршрута: комната гостя —
// /r/[slug], у неё есть `slug`; комната хозяйки (/room, /room/zone/[zone]) —
// нет. Это роутер, а не догадка по разметке, и подмешать себе чужой slug
// нельзя: он приходит из адреса, а ответ всё равно собирает сервер по сессии.
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatHallMoney } from "@/app/room/hall/money";
import { IconCheck } from "@/components/icons";
import s from "./money-goal.module.css";

/** Цель глазами хозяйки — ровно то, что отдаёт /api/v1/room/goal. */
type OwnerGoal = { title: string; amount: string; currency: string };

/** Значения строки «кто в складчине» — их считает сервер (dto/goal.ts). */
type GuestGoalWho = {
  form: "one" | "two" | "many" | "you";
  a: string;
  b: string | null;
  rest: number;
};

/**
 * Цель глазами гостя — та же плюс прогресс и, если гость сам участвует, имена
 * соседей по складчине (тикет 54). Не участвует — `who` приходит `null`, и
 * рисовать нечего: решение принимает сервер, а не эта разметка.
 */
type GuestGoal = OwnerGoal & {
  pledged: string;
  participants: number;
  percent: number;
  mine: boolean;
  who: GuestGoalWho | null;
};

/**
 * Четыре формы строки 25d лежат в словаре складчины (`Booking.poolWho*`) — там
 * же, где ими пользуется складчина вещи. Карточка не выбирает форму, а только
 * переводит выбор сервера в ключ.
 */
const WHO_KEY = {
  one: "poolWho1",
  two: "poolWho2",
  many: "poolWhoMany",
  you: "poolWhoYou",
} as const;

type Loaded =
  { viewer: "owner"; goal: OwnerGoal | null } | { viewer: "guest"; goal: GuestGoal | null };

export type MoneyGoalCardProps = {
  /** Акцент комнаты из rooms.json — полоса, плашка, свечение. */
  accent: string;
  /** ink комнаты — текст на акценте. */
  ink: string;
  /** Имя хозяйки для строки «{имя} не увидит, кто сколько дал» (гостю). */
  ownerName?: string;
};

/** Ответ API: `{ data }` или `{ error }` — разбираем без доверия к форме. */
async function readData(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const data = (payload as { data?: unknown }).data;
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function MoneyGoalCard({ accent, ink, ownerName }: MoneyGoalCardProps) {
  const t = useTranslations("Goal");
  // Имя хозяйки в строке обещаний: сцена его не знает, и вместо выдуманного
  // имени подставляем ту же подпись, что шапка гостевой комнаты.
  const tGuest = useTranslations("GuestRoom");
  // Строки «кто в складчине» живут в словаре складчины, а не копилки: копилка
  // и складчина говорят о людях одними и теми же словами (турн 25d).
  const tPool = useTranslations("Booking");
  const locale = useLocale();
  const params = useParams<{ slug?: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : null;

  const [state, setState] = useState<Loaded | null>(null);
  const [form, setForm] = useState<"none" | "edit" | "join">("none");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const endpoint = slug ? `/api/v1/rooms/${encodeURIComponent(slug)}/goal` : "/api/v1/room/goal";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) {
        // Комнаты нет или сессия истекла — карточке нечего показывать, но и
        // ронять панель зоны она не должна: тихо остаёмся без цели.
        setState(slug ? { viewer: "guest", goal: null } : { viewer: "owner", goal: null });
        return;
      }
      const data = await readData(response);
      if (!data) return;
      // Ветку зрителя называет СЕРВЕР (поле `viewer` гостевого канала): хозяйка,
      // открывшая свою же ссылку /r/{slug}, получает ветку `owner` и прогресса
      // не видит. Роут хозяйки ветки не присылает — там она по построению.
      const goal = (data.goal ?? null) as OwnerGoal | GuestGoal | null;
      setState(
        slug && data.viewer !== "owner"
          ? { viewer: "guest", goal: goal as GuestGoal | null }
          : { viewer: "owner", goal: goal as OwnerGoal | null },
      );
    },
    [endpoint, slug],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await load(controller.signal);
      } catch {
        // Тихо: без копилки зона остаётся смотрибельной, а сервер всё равно
        // не даст участвовать в том, чего нет.
      }
    })();
    return () => controller.abort();
  }, [load]);

  async function send(method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setFailed(null);
    try {
      const response = await fetch(endpoint, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        setFailed(response.status === 409 ? t("errAlready") : t("errGeneric"));
        return false;
      }
      await load();
      setForm("none");
      return true;
    } catch {
      setFailed(t("errGeneric"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const style = {
    "--mg-accent": accent,
    "--mg-ink": ink,
    "--mg-percent": `${state?.viewer === "guest" && state.goal ? state.goal.percent : 0}%`,
  } as CSSProperties;

  // Первый кадр до ответа сервера: ничего не обещаем и ничего не мигаем.
  if (!state) return null;

  const money = (amount: string, currency: string) => formatHallMoney(amount, currency, locale);

  // ---------- Хозяйка ----------
  if (state.viewer === "owner") {
    const goal = state.goal;
    return (
      <section className={s.root} style={style} aria-label={t("badge")}>
        <span className={s.badge}>
          <span className={s.badgeSign} aria-hidden>
            ₽
          </span>
          {t("badge")}
        </span>

        {goal ? (
          <>
            <p className={s.title}>{goal.title}</p>
            <div className={s.amounts}>
              <span className={s.big}>{money(goal.amount, goal.currency)}</span>
            </div>
            {/* Почему здесь нет полосы: прогресс своей копилки хозяйка не
                видит — как и того, кто занял её вещь (инвариант №1). Строка
                объясняет это словами, а не оставляет пустое место. */}
            <p className={s.hint}>{t("ownerQuiet")}</p>
          </>
        ) : (
          <>
            <p className={s.title}>{t("ownerEmptyTitle")}</p>
            <p className={s.empty}>{t("ownerEmptyHint")}</p>
          </>
        )}

        {form === "edit" ? (
          <GoalForm
            busy={busy}
            initial={goal}
            onCancel={() => setForm("none")}
            onSubmit={(values) => send("PUT", values)}
          />
        ) : (
          <div className={s.actions}>
            <button
              type="button"
              className={`pressable ${s.primary}`}
              onClick={() => setForm("edit")}
            >
              {goal ? t("ownerChange") : t("ownerSet")}
            </button>
            {goal && (
              <button
                type="button"
                className={`pressable ${s.quiet}`}
                disabled={busy}
                onClick={() => void send("DELETE")}
              >
                {t("ownerClear")}
              </button>
            )}
          </div>
        )}
        {failed && <p className={s.status}>{failed}</p>}
      </section>
    );
  }

  // ---------- Гость ----------
  const goal = state.goal;
  if (!goal) {
    return (
      <section className={s.root} style={style} aria-label={t("badge")}>
        <p className={s.empty}>{t("guestEmpty")}</p>
      </section>
    );
  }

  return (
    <section className={s.root} style={style} aria-label={t("badge")}>
      <span className={s.badge}>
        <span className={s.badgeSign} aria-hidden>
          ₽
        </span>
        {t("badge")}
      </span>

      <p className={s.title}>{goal.title}</p>

      <div className={s.amounts}>
        <span className={s.big}>{money(goal.pledged, goal.currency)}</span>
        <span className={s.of}>{t("of", { amount: money(goal.amount, goal.currency) })}</span>
      </div>
      <div
        className={s.track}
        role="progressbar"
        aria-valuenow={goal.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("collected", { percent: goal.percent })}
      >
        <div className={s.fill} />
      </div>
      <p className={s.legend}>
        <span>{t("collected", { percent: goal.percent })}</span>
        {/* «11 человек уже скинулись» — счёт для всех: имена ниже и только
            участнику. Хозяйке не достаётся ни того, ни другого. */}
        <span>{t("participants", { count: goal.participants })}</span>
      </p>

      {/* «в складчине Аня и Катя» / «ты, Аня и ещё 2» — тикет 54. Строка
          приходит уже разобранной: сервер выбрал форму и назвал имена, здесь
          остаётся подставить их в словарную строку. Гостю со стороны сервер
          присылает who: null, и строки нет вовсе. */}
      {goal.who && (
        <p className={s.legend}>
          <span>
            {tPool(WHO_KEY[goal.who.form], {
              a: goal.who.a,
              b: goal.who.b ?? "",
              rest: goal.who.rest,
            })}
          </span>
        </p>
      )}

      {/* Третье обещание было «Гости не видят друг друга» и перестало быть
          правдой, когда владелец открыл имена между участниками (ADR-0008,
          второе уточнение). Молча снять его нельзя: гость называет имя ДО
          того, как узнает, кто его увидит, — а это ровно то согласие, которое
          обещания на этой карточке и собирают. Поэтому строка не удалена, а
          переписана честно (`promiseNames`): она называет границу видимости —
          участники да, остальные гости и хозяйка нет. Строка наша, не с доски
          (как и прежняя — она в реестре сирот messages-tone), у дизайна
          запрошена своя формулировка письмом ANSWERS-cream-measures. */}
      <ul className={s.promises}>
        {[
          t("promiseDirect"),
          t("promiseQuiet", { name: ownerName ?? tGuest("ownerFallback") }),
          t("promiseNames"),
        ].map((line) => (
          <li key={line} className={s.promise}>
            <span className={s.tick} aria-hidden>
              {/* Галочка «Дошло» из набора; на 11 px контур утолщён до 3.2 —
                  оптическая компенсация (см. components/icons.tsx). */}
              <IconCheck size={11} strokeWidth={3.2} />
            </span>
            {line}
          </li>
        ))}
      </ul>

      {form === "join" ? (
        <PledgeForm
          busy={busy}
          onCancel={() => setForm("none")}
          onSubmit={(v) => send("POST", v)}
        />
      ) : (
        <div className={s.actions}>
          {goal.mine ? (
            <>
              <span className={s.status}>{t("joined")}</span>
              <button
                type="button"
                className={`pressable ${s.quiet}`}
                disabled={busy}
                onClick={() => void send("DELETE")}
              >
                {t("leave")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`pressable ${s.primary}`}
              onClick={() => setForm("join")}
            >
              {t("join")}
            </button>
          )}
        </div>
      )}
      {failed && <p className={s.status}>{failed}</p>}
    </section>
  );
}

/** Форма хозяйки: на что копит и сколько. Валюту берёт сервер (одна на комнату). */
function GoalForm({
  busy,
  initial,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  initial: OwnerGoal | null;
  onCancel: () => void;
  onSubmit: (values: { title: string; amount: string }) => void;
}) {
  const t = useTranslations("Goal");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ title: title.trim(), amount: amount.trim() });
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.field}>
        <span className={s.label}>{t("titleLabel")}</span>
        <input
          className={s.input}
          value={title}
          maxLength={120}
          placeholder={t("titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className={s.field}>
        <span className={s.label}>{t("amountLabel")}</span>
        <input
          className={s.input}
          value={amount}
          inputMode="decimal"
          maxLength={20}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <div className={s.actions}>
        <button
          type="submit"
          className={`pressable ${s.primary}`}
          disabled={busy || title.trim() === "" || amount.trim() === ""}
        >
          {busy ? t("saving") : t("save")}
        </button>
        <button type="button" className={`pressable ${s.quiet}`} onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

/** Форма гостя: имя, необязательная обещанная сумма, необязательная почта. */
function PledgeForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; amount?: string; email?: string }) => void;
}) {
  const t = useTranslations("Goal");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      ...(amount.trim() === "" ? {} : { amount: amount.trim() }),
      ...(email.trim() === "" ? {} : { email: email.trim() }),
    });
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.field}>
        <span className={s.label}>{t("nameLabel")}</span>
        <input
          className={s.input}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className={s.field}>
        <span className={s.label}>{t("pledgeAmountLabel")}</span>
        <input
          className={s.input}
          value={amount}
          inputMode="decimal"
          maxLength={20}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className={s.field}>
        <span className={s.label}>{t("emailLabel")}</span>
        <input
          className={s.input}
          type="email"
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <p className={s.hint}>{t("pledgeHint")}</p>
      <div className={s.actions}>
        <button
          type="submit"
          className={`pressable ${s.primary}`}
          disabled={busy || name.trim() === ""}
        >
          {busy ? t("joining") : t("joinConfirm")}
        </button>
        <button type="button" className={`pressable ${s.quiet}`} onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
