"use client";

// Сетка зоны глазами ХОЗЯЙКИ (тикет 13): та же ZoneGrid тикета 03, но со
// слотом действия — тихое меню вещи «Спрятать/Показать» и «Удалить»
// (двухшаговое подтверждение, как отмена в «моих бронях»). Слот заполняется
// только у своих вещей: у демо-призраков меню нет — они не в БД.
// «Бирки» здесь нет и не будет — она ровно одна, «подарить» у гостя (турн 22).
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ZoneGrid } from "@/components/zone/ZoneGrid";
import type { ZoneGridItem } from "@/components/zone/types";
import { deleteItemAction, setItemHiddenAction } from "./actions";

type OwnerZoneGridProps = {
  items: ZoneGridItem[];
  accent: string;
  ink: string;
};

export function OwnerZoneGrid({ items, accent, ink }: OwnerZoneGridProps) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function run(itemId: string, action: () => Promise<{ error: string } | undefined>) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      setConfirmingId(null);
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

    if (confirmingId === item.id) {
      return (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">{t("itemDeleteConfirm")}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(item.id, () => deleteItemAction(item.id))}
            className="pressable font-semibold text-text-strong disabled:opacity-60"
          >
            {t("itemDeleteYes")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingId(null)}
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
        <button
          type="button"
          disabled={busy}
          onClick={() => run(item.id, () => setItemHiddenAction(item.id, !item.hidden))}
          className="pressable font-semibold disabled:opacity-60"
          style={{ color: accent }}
        >
          {item.hidden ? t("itemShow") : t("itemHide")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmingId(item.id)}
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
      />
    </>
  );
}
