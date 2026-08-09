"use client";

// Клиентские части экрана «что подарили» (тикет 10, турн 21a): строки
// подарков с кнопкой «Дошло» и ручная кнопка «праздник прошёл».
// Данные приходят с сервера уже gated: имена существуют только при summary
// (services/occasions), клиент ничего не раскрывает сам.
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
 * «Праздник прошёл» — ручной запуск закрытия (работает и без даты).
 * Стиль — «полоса света», главная кнопка (турн 22).
 */
export function CloseOccasionButton({ accent }: { accent: string }) {
  const t = useTranslations("Occasion");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function close() {
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

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={close}
        className="pressable border-b-2 px-6 py-3 font-semibold text-text-primary disabled:opacity-60"
        style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
      >
        {busy ? t("closing") : `${t("closeButton")} →`}
      </button>
      {failed && <p className="text-sm text-text-muted">{t("errGeneric")}</p>}
    </div>
  );
}
