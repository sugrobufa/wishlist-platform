"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconShare } from "@/components/icons";

/** Сколько живёт подтверждение с адресом (тикет 24: «короткое подтверждение»). */
const CONFIRM_MS = 5000;

/**
 * Копирование адреса — прежняя логика CopyButton (тикет 13) слово в слово,
 * включая запасной путь для небезопасного контекста: `navigator.clipboard`
 * есть только на https и localhost, а стенд живёт и по http.
 */
async function copyToClipboard(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = url;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/**
 * Значок «поделиться» в нижней полосе (тикет 24) вместо карточки с адресом.
 *
 * Нажатие: где есть системное окно — открываем его (`navigator.share`), там
 * человек отправит ссылку туда, куда привык. Где нет — копируем в буфер и
 * показываем короткое подтверждение: сам адрес и объяснение, зачем он.
 * Постоянно на экране адрес не нужен — он живёт в «Настройках», рядом с
 * ником, которым его и меняют.
 */
export function ShareButton({ path, accent }: { path: string; accent: string }) {
  const t = useTranslations("Room");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const share = useCallback(async () => {
    const url = new URL(path, window.location.origin).toString();

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch (error) {
        // Окно закрыли — это не ошибка и не повод копировать взамен.
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Всё прочее (нет разрешения, не тот контекст) — падаем в копирование.
      }
    }

    await copyToClipboard(url);
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, CONFIRM_MS);
  }, [path]);

  return (
    <span className="relative inline-flex">
      {/* Подтверждение висит НАД полосой и нажатие не перехватывает: зона под
          ним остаётся нажимаемой всё время, пока оно видно. */}
      {copied && (
        <span
          role="status"
          className="pointer-events-none absolute right-0 bottom-[calc(100%+10px)] flex w-[min(320px,78vw)] flex-col gap-1 border border-surface-hairline bg-surface-overlay-ground p-4 text-left"
        >
          <span className="overline" style={{ color: accent }}>
            {t("shareOverline")}
          </span>
          <span className="font-mono text-sm text-text-primary">{path}</span>
          <span className="text-xs font-semibold text-text-strong">{t("copied")}</span>
          <span className="text-xs leading-snug text-text-muted">{t("shareHint")}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => void share()}
        aria-label={t("copy")}
        className="pressable justify-center rounded-full border border-surface-hairline-strong text-text-strong"
        style={{ width: "var(--hit-target-min)", height: "var(--hit-target-min)" }}
      >
        {/* Канон 25a «Поделиться» — стрелка из лотка (тикет 52): наши три
            узла с рёбрами были другой метафорой и заменены по списку
            тикета 51. */}
        <IconShare size={24} />
      </button>
    </span>
  );
}
