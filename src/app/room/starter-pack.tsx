"use client";

// «Или начни с готового · +40» на пустой комнате (тикет 100, доска Б23 ·
// турн 12c; `task15.json → emptyStates.emptyRoom.starterPack`).
//
// Второй вход для новичка: вставить ссылку из магазина умеет не каждый и не
// сразу, а пустая комната не рассказывает о себе ничего. Набор кладётся
// ТОЛЬКО по нажатию — это и есть «по согласию» из вердикта дизайна.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { applyStarterPackAction } from "./starter-pack-actions";

type StarterPackProps = {
  /** Сколько вещей принесёт набор — считается по пулам видимых зон. */
  size: number;
  accent: string;
};

export function StarterPack({ size, accent }: StarterPackProps) {
  const t = useTranslations("StarterPack");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  if (size === 0) return null; // у комнаты нет ни одного пула — предлагать нечего

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
