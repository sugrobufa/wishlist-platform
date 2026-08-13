"use client";

// Клиентские части экрана «что подарили» (тикет 10, турн 21a): строки
// подарков с кнопкой «Дошло», адресной благодарностью «Сказать спасибо»
// (пакет 49, тикет 224) и открытие итога («Открыть, кто что подарил» —
// действие, а не состояние; тикеты 217 и 219, турн 54b).
// Данные приходят с сервера уже gated: имена существуют только при summary
// (services/occasions), клиент ничего не раскрывает сам — и почта гостя
// приезжает сюда только там, где строка благодарности показывается.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconCheck } from "@/components/icons";
import type { OccasionPendingGift, OccasionReceivedGift } from "@/server/services/occasions";
import { closeOccasionAction, receiveGiftAction, type OccasionActionResult } from "./actions";

type OccasionRowsProps = {
  pending: OccasionPendingGift[];
  received: OccasionReceivedGift[];
  accent: string;
  ink: string;
  /**
   * Связь уже состоялась — можно звать на страницу друзей. С тикета 98 это
   * не следует из «Дошло»: связь рождается ждущей согласия обеих сторон, и
   * пока вопрос висит (он тут же, ниже), друга ещё нет.
   */
  connectionReady: boolean;
};

/** Квадратик-фото строки: 52px, серая заливка при отсутствии фото;
 * badge — галочка «Дошло» в углу (акцент комнаты). */
function RowPhoto({ photoUrl, badgeAccent }: { photoUrl: string | null; badgeAccent?: string }) {
  return (
    <div className="relative h-13 w-13 flex-none bg-surface-fill" aria-hidden>
      {photoUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${photoUrl})` }}
        />
      )}
      {badgeAccent && (
        <span
          className="absolute bottom-0 right-0 flex h-4.5 w-4.5 items-center justify-center"
          style={{ background: badgeAccent }}
        >
          {/* Галочка «Дошло» из набора; на 11 px контур утолщён до 3.2 —
              оптическая компенсация (см. components/icons.tsx). */}
          <IconCheck size={11} strokeWidth={3.2} style={{ color: "#0B0806" }} />
        </span>
      )}
    </div>
  );
}

/**
 * Список строк: сначала уже отмеченные («уже в зале славы», приглушены),
 * затем ожидающие с кнопкой «Дошло». Успех — router.refresh(): страница
 * force-dynamic, строка сама переезжает в отмеченные.
 */
export function OccasionRows({
  pending,
  received,
  accent,
  ink,
  connectionReady,
}: OccasionRowsProps) {
  const t = useTranslations("Occasion");
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function markReceived(itemId: string) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result: OccasionActionResult = await receiveGiftAction(itemId);
      setBusyId(null);
      if (result?.error) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {failed && <p className="mb-3 text-sm text-text-muted">{t("errGeneric")}</p>}
      <ul className="flex flex-col gap-px bg-surface-hairline">
        {received.map((gift) => (
          <li
            key={gift.itemId}
            className="flex items-center gap-3 bg-surface-app-ground py-3 opacity-60"
          >
            <RowPhoto photoUrl={gift.photoUrl} badgeAccent={accent} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-text-primary">{gift.title}</p>
              <p className="mt-1.5 text-[10.5px] font-medium text-text-muted">
                {gift.giverName
                  ? t("receivedRow", { name: gift.giverName })
                  : t("receivedRowNoName")}
              </p>
            </div>
            <Link
              href="/room/hall"
              className="pressable flex-none text-[10.5px] font-semibold"
              style={{ color: accent }}
            >
              {t("see")}
            </Link>
          </li>
        ))}

        {pending.map((gift) => (
          <li key={gift.itemId} className="flex items-center gap-3 bg-surface-app-ground py-3">
            <RowPhoto photoUrl={gift.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-text-primary">{gift.title}</p>
              <p className="mt-1.5 text-[10.5px] font-medium" style={{ color: accent }}>
                {t("givenBy", { name: gift.guestName })}
              </p>
              {/* «СКАЗАТЬ СПАСИБО» — БЛАГОДАРНОСТЬ АДРЕСНАЯ, В СТРОКЕ ПОДАРКА
                  (пакет 49, `thanksGuest`). Громкой «спасибо всем» у открытого
                  итога нет и не будет: почта гостя необязательна, и на любом
                  составе, где хоть у одного её нет, кнопка «всем» врала бы.
                  Здесь же строки просто нет — не серой, не выключенной,
                  никакой: не сообщаем человеку о том, чего у нас нет.

                  ЧТО СТРОКА ДЕЛАЕТ — ОТВЕТ ПРИШЁЛ (пакет 50, тикет 236): наш
                  `mailto:` верен, тема из ключа `thanksSubject` = «Спасибо за
                  подарок», а ТЕЛО ПУСТОЕ — «благодарить за человека
                  заготовкой нельзя, слова его». Поэтому в ссылке ровно один
                  параметр: заготовки письма мы не пишем.
                  Флаг и адрес приходят порознь (сервис): сегодня они ходят
                  парой — одна бронь, одна почта, — а у складчины строка
                  положена, если почта есть хотя бы у одного. */}
              {gift.canThank && gift.thanksEmail !== null && (
                <a
                  href={`mailto:${gift.thanksEmail}?subject=${encodeURIComponent(t("thanksSubject"))}`}
                  className="pressable inline-flex min-h-11 items-center text-[12px] font-medium"
                  style={{ color: accent }}
                >
                  {t("thanksGuest")}
                </a>
              )}
            </div>
            <button
              type="button"
              disabled={busyId === gift.itemId}
              onClick={() => markReceived(gift.itemId)}
              className="pressable flex-none px-3.5 py-2.5 text-[11px] font-bold disabled:opacity-60"
              style={{ background: accent, color: ink }}
            >
              {t("done")}
            </button>
          </li>
        ))}
      </ul>

      {/* После «Дошло» цикл замыкается связью (тикет 11): тихая ссылка на
          страницу связей — router.refresh() выше переносит строку в received,
          и подсказка появляется сама. Пока согласие не получено обеими
          сторонами (тикет 98), звать некуда: друга ещё нет. */}
      {received.length > 0 && connectionReady && (
        <Link
          href="/connections"
          className="pressable mt-4 inline-block text-xs font-semibold"
          style={{ color: accent }}
        >
          {t("connectionAppeared")} →
        </Link>
      )}
    </div>
  );
}

/**
 * ОТКРЫТЬ ИТОГ — действие, а не состояние (тикет 217, слова пакета 48).
 *
 * Кнопка называлась «Праздник прошёл»: это то, что человек СООБЩАЕТ экрану, а
 * не то, что произойдёт по нажатию. А произойдёт необратимое — имена дарителей
 * раскрываются ровно один раз (инвариант №2), — и действие обязано это
 * называть. Дизайн правку принял («тикет 217 принят без правок») и поправил
 * глагол: не «показать», а «ОТКРЫТЬ» — «показать» обратимо, так говорят про
 * фильтр, а состояние зовётся «итог открыт» и прогресс — «Открываем…».
 * Стрелки нет: перехода не происходит, раскрытие случается на этом же экране.
 *
 * ТРИ ТОНА ПО СОСТОЯНИЮ ЭКРАНА (`screen-state`), а не один на все случаи:
 * - `loud` — «полоса света» на пороге (турн 22): `openButton` со знаком
 *   раскрытия и подписью необратимости под ней. Подчёркивание 2 px — пол
 *   пакета (инвариант 47), не ужимать;
 * - `quiet` — тихая дорога `manualLink` там, где праздник впереди: акцентом
 *   комнаты, но без полосы. Дорогу мы не убираем — она работает и без даты
 *   (решение гриллинга №6), — но гореть год до следующего праздника она не
 *   должна;
 * - `quieter` — та же дорога у комнаты без даты, и она ТИШЕ: громкое там уже
 *   занято датой, двух громких на экране не бывает.
 *
 * ДИАЛОГА ПОДТВЕРЖДЕНИЯ НЕТ И НЕ БУДЕТ (`warning.notADialog`): «человек пришёл
 * именно за этим, стена была бы лишней». Предупреждение стоит блоком ДО
 * нажатия — «Что случится по нажатию» на пороге, — а не вопросом поверх него.
 */
export function CloseOccasionButton({
  accent,
  tone,
}: {
  accent: string;
  tone: "loud" | "quiet" | "quieter";
}) {
  const t = useTranslations("Occasion");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function open() {
    setBusy(true);
    setFailed(false);
    startTransition(async () => {
      const result = await closeOccasionAction();
      setBusy(false);
      if (result?.error) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  const loud = tone === "loud";

  return (
    <div className="flex flex-col items-start gap-2.5">
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className={
          loud
            ? "pressable inline-flex items-center gap-2.5 border-b-2 px-6 py-3 text-base font-bold text-text-primary disabled:opacity-60"
            : tone === "quiet"
              ? "pressable text-[13px] font-medium disabled:opacity-60"
              : "pressable text-[12.5px] font-medium text-text-muted disabled:opacity-60"
        }
        style={
          loud
            ? { borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }
            : tone === "quiet"
              ? { color: accent }
              : undefined
        }
      >
        {loud && <RevealSign />}
        {busy ? t("closing") : t(loud ? "openButton" : "manualLink")}
      </button>
      {/* Подпись необратимости — под самой полосой, а не в конце экрана:
          раньше про «один раз» говорила строка `hint`, то есть уже ПОСЛЕ
          раскрытия. */}
      {loud && <p className="text-xs leading-relaxed text-text-muted">{t("openOnceHint")}</p>}
      {failed && <p className="text-sm text-text-muted">{t("errGeneric")}</p>}
    </div>
  );
}

/** Знак раскрытия 18, stroke 1.7 — тот же, что у плашки открытого итога. */
function RevealSign() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
      aria-hidden
    >
      <path d="M13 2.8l2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2z" />
    </svg>
  );
}
