import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { TabSlots } from "./tab-slots";
import type { TabKey } from "./tabs";
import s from "./tab-bar.module.css";

/**
 * Постоянный таб-бар (турн 25a, состояние 3): высота 86 (tokens.json →
 * phoneImmersive.tabBar), иконка 22, активная вкладка — только цветом акцента
 * комнаты. Стоит на экранах-списках (Друзья, Настройки, Сокровищница,
 * «Комната списком») и — с приёмки 07.08 (тикет 65) — в самой комнате на
 * телефоне. Мест четыре: «Сокровищница» ушла из бара знаком в угол комнаты
 * (тикет 119), и вкладки у неё больше нет — экран витрины подсвечивает
 * «Комнату», из которой в него и заходят.
 *
 * Прежде в комнате жила шторка: планка 112×4, которую надо было вытянуть
 * пальцем. Владелец на приёмке попросил «всегда видимый нижний бар — базовая
 * подготовка для будущего приложения», и заодно это сняло наложение шторки на
 * кнопку добавления, значок «поделиться» и указатель зон. Состояния 1 и 2
 * турна 25a вместе с `room-tab-drawer.tsx` удалены.
 *
 * Страница под баром обязана оставить себе нижний отступ
 * `pb-[calc(var(--imm-tab-bar)+30px)]` — бар fixed и контента не двигает.
 * Комната считает то же самое своей нижней полосой (globals.css).
 *
 * @param phoneOnly бар исчезает на десктопе. Нужен комнате: там на широком
 *        экране навигация живёт строкой в шапке, и второй ряд тех же ссылок
 *        внизу был бы дублем. Экраны-списки шапки не имеют — им бар нужен на
 *        обеих раскладках, и они этот флаг не ставят.
 */
export async function TabBar({
  active,
  accent,
  ink,
  phoneOnly = false,
}: {
  active: TabKey;
  accent: string;
  ink: string;
  phoneOnly?: boolean;
}) {
  const t = await getTranslations("TabBar");
  return (
    <nav
      aria-label={t("tabsAria")}
      className={phoneOnly ? `${s.numbers} ${s.bar} ${s.barPhoneOnly}` : `${s.numbers} ${s.bar}`}
      style={{ "--tb-accent": accent, "--tb-ink": ink } as CSSProperties}
    >
      <TabSlots
        active={active}
        labels={{
          room: t("room"),
          connections: t("connections"),
          add: t("add"),
          // Места «Сокровищница» в баре больше нет (тикет 119): вход в витрину
          // стоит знаком в углу комнаты. Строка TabBar.hall в словаре
          // оставлена — её убирать отдельным проходом по messages/*, а не
          // мимоходом.
          // «Профиль» из 25a не прошёл памятку тона — временно словом
          // страницы /settings, подробности в tabs.ts (TODO там же).
          settings: t("settings"),
        }}
      />
    </nav>
  );
}
