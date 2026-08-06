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
//   гость   → GET /api/v1/rooms/{slug}/goal — цель, прогресс, «N скинулись».
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

/** Цель глазами гостя — та же плюс прогресс. Имён нет ни одного. */
type GuestGoal = OwnerGoal & {
  pledged: string;
  participants: number;
  percent: number;
  mine: boolean;
};

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
        {/* «11 человек уже скинулись» — число без единого имени: кто именно,
            гость узнает вместе со всеми на «что подарили» (инвариант №2). */}
        <span>{t("participants", { count: goal.participants })}</span>
      </p>

      <ul className={s.promises}>
        {[
          t("promiseDirect"),
          t("promiseQuiet", { name: ownerName ?? tGuest("ownerFallback") }),
          t("promiseHidden"),
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
