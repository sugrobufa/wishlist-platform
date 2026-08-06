import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { TabSlots } from "./tab-slots";
import type { TabKey } from "./tabs";
import s from "./tab-bar.module.css";

/**
 * Таб-бар «в списках — постоянный» (турн 25a, состояние 3): высота 86
 * (tokens.json → phoneImmersive.tabBar), иконка 22, активная вкладка — только
 * цветом акцента комнаты. Стоит на экранах-вкладках (Друзья, Сокровищница,
 * Настройки); в комнате вместо него живёт шторка (room-tab-drawer.tsx).
 *
 * Страница под баром обязана оставить себе нижний отступ
 * `pb-[calc(var(--imm-tab-bar)+30px)]` — бар fixed и контента не двигает.
 */
export async function TabBar({
  active,
  accent,
  ink,
}: {
  active: TabKey;
  accent: string;
  ink: string;
}) {
  const t = await getTranslations("TabBar");
  return (
    <nav
      aria-label={t("tabsAria")}
      className={`${s.numbers} ${s.bar}`}
      style={{ "--tb-accent": accent, "--tb-ink": ink } as CSSProperties}
    >
      <TabSlots
        active={active}
        iconSize={22}
        addIconSize={19}
        labels={{
          room: t("room"),
          connections: t("connections"),
          add: t("add"),
          hall: t("hall"),
          // «Профиль» из 25a не прошёл памятку тона — временно словом
          // страницы /settings, подробности в tabs.ts (TODO там же).
          settings: t("settings"),
        }}
      />
    </nav>
  );
}
