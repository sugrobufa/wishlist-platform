"use client";

// «Или начни с готового · +40» на пустой комнате (тикет 100, доска Б23 ·
// турн 12c; `task15.json → emptyStates.emptyRoom.starterPack`).
//
// Второй вход для новичка: вставить ссылку из магазина умеет не каждый и не
// сразу, а пустая комната не рассказывает о себе ничего. Набор кладётся
// ТОЛЬКО по нажатию — это и есть «по согласию» из вердикта дизайна.
//
// ЗДЕСЬ ЖЕ ТЕПЕРЬ ЗАДАЁТСЯ «ЧТО ЧАЩЕ ВСЕГО ХОЧЕТСЯ» (письмо 33, турн 40b).
// Вопрос был четвёртым шагом онбординга (тикет 113, доска 34b) и стоял целым
// экраном между человеком и его комнатой, а красил ровно две вещи: порядок
// наполнения этой подборкой и порядок зон в форме добавления. Дизайн назвал
// причину переноса сам: «после v2 стартовый набор ужался вдвое — цена целого
// экрана выше пользы». Чипы стоят НАД набором: ответ виден сразу в том, что
// человек получит нажатием. Пропуск = просто листать дальше — отдельной
// кнопки нет, и анкеты нет.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  alreadyAsked,
  browserAskStore,
  rememberAsked,
  STARTER_WANTS_ASKED_KEY,
} from "@/app/r/[slug]/booking/ask-once";
import {
  applyStarterPackAction,
  saveWantsAction,
  starterPackWantsAction,
} from "./starter-pack-actions";

type StarterPackProps = {
  /** Сколько вещей принесёт набор — считается по пулам видимых зон. */
  size: number;
  accent: string;
};

type Chip = { key: string; label: string };

/** Выбрать можно 3–4; четвёртый гасит остальные чипы (доска 34b). Столько же
 *  берёт и сервис — `WANTS_MAX` в services/rooms. */
const WANTS_MAX = 4;

export function StarterPack({ size, accent }: StarterPackProps) {
  const t = useTranslations("StarterPack");
  const tWants = useTranslations("Onboarding");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  /** Чипы вопроса; пусто — вопрос уже задавали или задавать нечего. */
  const [chips, setChips] = useState<Chip[]>([]);
  const [wants, setWants] = useState<string[]>([]);
  /** Чернила выбранного чипа — из данных комнаты, приезжают вместе с чипами. */
  const [ink, setInk] = useState("#0B0806");

  // ПЕРВОЕ ОТКРЫТИЕ. Отметка ставится в момент ПОКАЗА, а не ответа: молчание и
  // ответ для нас одно и то же — второй раз мы не спрашиваем ни в том, ни в
  // другом случае (то же правило и тот же механизм, что у предложения собрать
  // комнату, `ask-once.ts`). Цена ошибки — лишний вопрос, а не утечка, поэтому
  // хранилище браузера, а не сервер.
  useEffect(() => {
    if (size === 0) return;
    const store = browserAskStore();
    if (alreadyAsked(store, STARTER_WANTS_ASKED_KEY)) return;

    let alive = true;
    void starterPackWantsAction().then((question) => {
      if (!alive || !question || question.chips.length === 0) return;
      setChips(question.chips);
      setWants(question.wants);
      setInk(question.ink);
      rememberAsked(store, STARTER_WANTS_ASKED_KEY);
    });
    return () => {
      alive = false;
    };
  }, [size]);

  if (size === 0) return null; // у комнаты нет ни одного пула — предлагать нечего

  const full = wants.length >= WANTS_MAX;

  function toggle(key: string) {
    const next = wants.includes(key)
      ? wants.filter((candidate) => candidate !== key)
      : wants.length >= WANTS_MAX
        ? wants
        : [...wants, key];
    if (next === wants) return;
    setWants(next);
    // Ответ уезжает сразу: он пригодится и без набора — порядком зон в форме
    // добавления, — а нажатия «готово» у вопроса нет по замыслу.
    startTransition(async () => {
      await saveWantsAction(next);
    });
  }

  function take() {
    setBusy(true);
    setFailed(false);
    startTransition(async () => {
      const result = await applyStarterPackAction();
      setBusy(false);
      if ("error" in result) {
        setFailed(true);
        return;
      }
      // Комната перестала быть пустой: свет включается сам, блок исчезает.
      router.refresh();
    });
  }

  return (
    <div className="imm-starter">
      {chips.length > 0 && (
        <div className="mb-1 w-full">
          <p className="text-[13px] font-semibold text-text-primary">{tWants("wantsTitle")}</p>
          <p className="imm-starter-caption mt-1">{tWants("wantsSubtitle")}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {chips.map((zone) => {
              const picked = wants.includes(zone.key);
              return (
                <button
                  key={zone.key}
                  type="button"
                  aria-pressed={picked}
                  // Четвёртый выбор гасит остальные чипы: предел виден, а не
                  // встречается отказом на нажатие.
                  disabled={!picked && full}
                  onClick={() => toggle(zone.key)}
                  className={`pressable min-h-11 px-3.5 text-[13px] font-semibold disabled:opacity-40 ${
                    picked ? "" : "border border-surface-hairline text-text-muted"
                  }`}
                  style={picked ? { background: accent, color: ink } : undefined}
                >
                  {zone.label}
                </button>
              );
            })}
          </div>
          {full && <p className="imm-starter-caption mt-2">{tWants("wantsMax")}</p>}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={take}
        className="pressable imm-starter-btn"
        style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
      >
        {busy ? t("busy") : t("label", { count: size })}
      </button>
      <p className="imm-starter-caption">{failed ? t("errGeneric") : t("caption")}</p>
    </div>
  );
}
