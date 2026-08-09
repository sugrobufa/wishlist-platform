"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconShare } from "@/components/icons";
import { linkSecondAuthAction, markHardenAskedAction } from "./harden-actions";

/** Имя провайдера человеку: «Google», а не «google». Список из env, не из URL. */
function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

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
export function ShareButton({
  path,
  accent,
  harden,
}: {
  path: string;
  accent: string;
  /**
   * Просьба укрепить аккаунт перед ПЕРВЫМ шером (тикет 94, доска Б8).
   * `null` — не просим: либо уже спрашивали, либо второй способ уже привязан,
   * либо в сборке его нет вовсе. Решение принимает сервер
   * (services/harden.shouldAskToHarden), кнопка его только показывает.
   */
  harden?: { providers: string[] } | null;
}) {
  const t = useTranslations("Room");
  const [copied, setCopied] = useState(false);
  /** Просьба открыта: шер ждёт ответа, но уйти без ответа можно всегда. */
  const [asking, setAsking] = useState(false);
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

  const ask = harden != null && harden.providers.length > 0;

  /** Ответ получен — записываем его и отдаём ссылку, как и просили. */
  const shareAnyway = useCallback(async () => {
    setAsking(false);
    void markHardenAskedAction();
    await share();
  }, [share]);

  return (
    <span className="relative inline-flex">
      {/* Просьба укрепить аккаунт — ровно перед первым шером и ровно один раз
          (доска Б8: «тот же экран на входе был бы бюрократией — терять ещё
          нечего»). Отказ разрешён и запоминается: второй раз не спросим. */}
      {asking && (
        <span className="absolute right-0 bottom-[calc(100%+10px)] flex w-[min(340px,84vw)] flex-col gap-2 border border-surface-hairline bg-surface-overlay-ground p-4 text-left">
          <span className="overline" style={{ color: accent }}>
            {t("hardenOverline")}
          </span>
          <span className="text-xs leading-snug text-text-muted">{t("hardenBody")}</span>
          <span className="mt-1 flex flex-col gap-2">
            {harden?.providers.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => void linkSecondAuthAction(provider)}
                className="pressable border border-surface-hairline-strong px-3 py-2 text-xs font-semibold text-text-strong"
              >
                {t("hardenLink", { provider: providerLabel(provider) })}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void shareAnyway()}
              className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
            >
              {t("hardenSkip")}
            </button>
          </span>
        </span>
      )}

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
          {/* Доска В5 (турн 13a): «Кто видит комнату: только по ссылке · не в
              поиске». Строка стоит в момент шера, потому что страх появляется
              именно здесь. Обещание не выдумано: комната закрыта от индексации
              (инвариант №7, `robots: index: false` на всех её маршрутах). */}
          <span className="text-[11px] leading-snug text-text-faint">{t("shareWhoSees")}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => (ask && !asking ? setAsking(true) : void share())}
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
