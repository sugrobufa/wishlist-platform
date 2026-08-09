"use client";

// Вход «Сокровищница» при положении «только взаимным друзьям» (тикет 116,
// ADR-0011). С тикета 119 это ЗНАК-ШКАТУЛКА в правом верхнем углу сцены, а не
// пилюля со словом под оглавлением зон: место и вид сменились, развилка трёх
// положений — нет.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КЛИЕНТСКИЙ КОМПОНЕНТ. Ответ «пускать ли этого зрителя»
// зависит от того, КТО смотрит, а страница /r/{slug} кэшируется целиком и
// сессии не читает (её шапка) — на сервере такой ссылки не нарисовать, не
// сломав ISR. Поэтому знак появляется после рендера, из УЖЕ существующего
// некэшируемого канала «занято» (booking-context, поле `hallOpen`): второго
// запроса и нового роута ради одной ссылки не заводится.
//
// Тот же приём, что у соседних «Мои подарки · N»: HTML страницы одинаков для
// всех, личное приезжает каналом.
//
// До ответа канала знака НЕТ. Ссылка, ведущая в 404, запрещена ADR, а
// «мигнуть и пропасть» хуже, чем «появиться»: закрытая витрина у чужого
// человека — это как раз тот случай, где ошибиться в открытую сторону нельзя.
import { useTranslations } from "next-intl";
import { IconTreasury } from "@/components/icons";
import { CornerMark, CORNER_ICON_SIZE } from "@/components/scene/scene-corner";
import { useGuestBooking } from "./booking-context";

export function HallLink({ href }: { href: string }) {
  const t = useTranslations("Hall");
  const { hallOpen } = useGuestBooking();
  if (!hallOpen) return null;

  return (
    <CornerMark href={href} label={t("toHall")}>
      <IconTreasury size={CORNER_ICON_SIZE} />
    </CornerMark>
  );
}
