"use client";

import { useTranslations } from "next-intl";
import {
  HardenAskCard,
  ShareAddressCard,
  useRoomShare,
  type HardenAsk,
} from "@/app/room/share-button";

/**
 * «Отдать ссылку на комнату» на пустых «Друзьях» (доска В8, турн 20a).
 *
 * ТИКЕТ 227. Здесь стояла ссылка `<Link href="/room">`: кнопка называла
 * действие и уводила его искать — приёмка владельца 14.08.2026 прочла это как
 * «при нажатии ничего не происходит». Теперь она делает то, что называет,
 * ПРЯМО ЗДЕСЬ: то же системное окно, тот же запасной путь в буфер и то же
 * предусловие — просьба укрепить аккаунт перед ПЕРВЫМ шером (тикет 94).
 *
 * Второй логики шера при этом не завелось: поведение целиком приходит хуком
 * `useRoomShare` из кнопки комнаты, здесь только вид. Отличается он ровно
 * местом карточек — в комнате они висят над нижней полосой, а тут стоят В
 * ПОТОКЕ под кнопкой: экран длинный, всплывать некуда и незачем.
 */
export function ShareRoomButton({
  path,
  accent,
  harden,
}: {
  path: string;
  accent: string;
  harden?: HardenAsk;
}) {
  const t = useTranslations("Connections");
  const { asking, copied, press, shareAnyway, providers } = useRoomShare({ path, harden });

  return (
    <div className="mt-4">
      {/* Вид кнопки не менялся вместе с поведением: те же «полоса света» под
          словами и тот же ореол акцента, что были у ссылки. */}
      <button
        type="button"
        onClick={press}
        className="pressable inline-block border-b-2 px-5 py-2.5 text-[13px] font-semibold text-text-primary"
        style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
      >
        {t("emptyShare")} →
      </button>

      {asking && (
        <HardenAskCard
          providers={providers}
          accent={accent}
          onSkip={shareAnyway}
          className="mt-4 w-full"
        />
      )}

      {copied && <ShareAddressCard path={path} accent={accent} className="mt-4 w-full" />}
    </div>
  );
}
