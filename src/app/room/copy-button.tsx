"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * «Скопировать адрес комнаты»: абсолютный URL собирается из origin браузера,
 * поэтому ссылка верна на любом хосте. Стиль — «полоса света» (турн 22).
 */
export function CopyButton({ path, accent }: { path: string; accent: string }) {
  const t = useTranslations("Room");
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Небезопасный контекст (http не с localhost) — запасной путь.
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="pressable border-b-2 px-6 py-3 font-semibold text-text-primary"
      style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
    >
      {copied ? t("copied") : `${t("copy")} →`}
    </button>
  );
}
