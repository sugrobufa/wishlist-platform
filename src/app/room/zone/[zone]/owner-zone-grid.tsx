"use client";

// Сетка зоны глазами ХОЗЯЙКИ (тикеты 13 и 10): та же ZoneGrid тикета 03, но
// со слотом действия — тихое меню вещи. У «хочу»: «Уже моё» (ручной переход
// в «люблю» — необратим, двухшаговое подтверждение), «Спрятать», «Удалить».
// У «люблю»: «В зал славы / Убрать из зала», «Спрятать», «Удалить».
// Слот заполняется только у своих вещей: у демо-призраков меню нет — они не
// в БД. «Бирки» здесь нет и не будет — она ровно одна, «подарить» у гостя
// (турн 22). Обратного пути LOVE → WANT в меню нет и не появится (инвариант №2).
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import type { ZoneGridItem } from "@/components/zone/types";
import {
  deleteItemAction,
  selfFulfillAction,
  setItemHiddenAction,
  toggleHallAction,
} from "./actions";

/** Owner-DTO несёт inHall у «люблю»; общий контракт сетки его не знает. */
type OwnerGridItem = ZoneGridItem & { inHall?: boolean };

type OwnerZoneGridProps = {
  items: OwnerGridItem[];
  accent: string;
  ink: string;
  /** Ключ зоны — из него собирается адрес карточки вещи (тикет 39). */
  zoneKey: string;
  /** Пул зоны — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
};

/** Двухшаговые подтверждения: удаление и необратимое «уже моё». */
type Confirming = { id: string; kind: "delete" | "own" };

export function OwnerZoneGrid({ items, accent, ink, zoneKey, pool }: OwnerZoneGridProps) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function run(itemId: string, action: () => Promise<{ error: string } | undefined>) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      setConfirming(null);
      if (result?.error) {
        setFailed(true);
        return;
      }
      // Страница force-dynamic: refresh дотягивает свежие данные с сервера.
      router.refresh();
    });
  }

  const renderItemAction = (item: ZoneGridItem): ReactNode => {
    if (item.isDemo) return null;
    const busy = busyId === item.id;
    // Каст честный: сюда приходят те же объекты, что в items (OwnerGridItem).
    const inHall = (item as OwnerGridItem).inHall === true;

    if (confirming?.id === item.id) {
      const isDelete = confirming.kind === "delete";
      return (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">
            {isDelete ? t("itemDeleteConfirm") : t("itemAlreadyMineConfirm")}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(item.id, () =>
                isDelete ? deleteItemAction(item.id) : selfFulfillAction(item.id),
              )
            }
            className="pressable font-semibold text-text-strong disabled:opacity-60"
          >
            {isDelete ? t("itemDeleteYes") : t("itemAlreadyMineYes")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(null)}
            className="pressable font-semibold text-text-muted disabled:opacity-60"
          >
            {t("itemDeleteNo")}
          </button>
        </div>
      );
    }

    return (
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
        {item.hidden && (
          <span className="overline text-text-faint">{t("itemHiddenBadge")}</span>
        )}
        {/* Карточка вещи (тикет 39): правка полей, перенос на другую полку,
            история «люблю». Отсюда же и только у своих вещей. */}
        <Link
          href={`/room/zone/${zoneKey}/i/${item.id}`}
          className="pressable font-semibold text-text-muted hover:text-text-strong"
        >
          {t("itemEdit")}
        </Link>
        {/* «Хочу»: ручной переход «уже моё» (тикет 10) — с подтверждением,
            потому что обратно в «хочу» пути не существует. */}
        {item.state === "WANT" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming({ id: item.id, kind: "own" })}
            className="pressable font-semibold disabled:opacity-60"
            style={{ color: accent }}
          >
            {t("itemAlreadyMine")}
          </button>
        )}
        {/* «Люблю»: витрина зала славы туда и обратно (тикет 10). */}
        {item.state === "LOVE" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(item.id, () => toggleHallAction(item.id, !inHall))}
            className="pressable font-semibold disabled:opacity-60"
            style={{ color: accent }}
          >
            {inHall ? t("itemHallRemove") : t("itemHallAdd")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(item.id, () => setItemHiddenAction(item.id, !item.hidden))}
          className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
        >
          {item.hidden ? t("itemShow") : t("itemHide")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming({ id: item.id, kind: "delete" })}
          className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
        >
          {t("itemDelete")}
        </button>
      </div>
    );
  };

  return (
    <>
      {failed && <p className="mb-3 text-sm text-text-muted">{t("errGeneric")}</p>}
      <ZoneGrid
        items={items}
        accent={accent}
        ink={ink}
        enterDelay="none"
        renderItemAction={renderItemAction}
        pool={pool}
      />
    </>
  );
}
