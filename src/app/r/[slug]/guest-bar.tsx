import type { CSSProperties } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { IconPlus, IconRoom, IconTreasury } from "@/components/icons";
import s from "@/components/tab-bar/tab-bar.module.css";

/**
 * НИЖНИЙ БАР ГОСТЯ (тикет 247, турн 56b + пакет 55 → guest-gaps.guestCta).
 *
 * ЗАЧЕМ ОН ЗАВЁЛСЯ. Призыв «Собрать свою» стоял строкой ПОД списком зон, и
 * владелец не смог до него добраться: «у гостя совсем не видно призыв создать
 * свою комнату, просто не дойти до этой кнопки». Дизайн подтвердил, что это не
 * случайность: «строка в потоке недостижима не случайно — она ниже списка зон,
 * а список растёт с числом полок». Решение турна 56b: третий элемент бара.
 *
 * А это единственная дорога из гостя в хозяина. Гость пришёл по ссылке, ничего
 * не создаёт и уйдёт — призыв обязан быть достижим, а не лежать за краем.
 *
 * ПОЧЕМУ СВОЙ КОМПОНЕНТ, А НЕ `TabBar`. У хозяйки пять мест и активная вкладка
 * из `TabKey`; у гостя мест три, «Добавить» нет вовсе (в чужую комнату вещь не
 * положишь), а третье место — дорога ИЗ комнаты, а не по ней. Общими остались
 * стили: полоса, высота и отступы у бара один раз посчитаны контрактом, и
 * заводить им вторые числа значило бы развести две полосы на одном экране.
 *
 * СЛОВА ПЕРВЫХ ДВУХ МЕСТ ВРЕМЕННЫЕ, И ЭТО НАЗВАНО ВСЛУХ. Турн 56b требует
 * притяжательных — «Комната Кати», «Её сокровищница»: «притяжательное в первом
 * элементе бара обязательно, оно и есть напоминание». Ключей под них в пакете
 * нет ни одного, а сочинять их самим нельзя вдвойне: «Её» — род человека,
 * которого мы не знаем. Пока стоят нейтральные слова хозяйкиного бара, и
 * притяжательные запрошены письмом; приедут — сменятся только строки.
 */
export async function GuestBar({
  roomHref,
  hallHref,
  accent,
  ink,
}: {
  roomHref: string;
  /** `null` — витрина закрыта (ADR-0011): места у неё в баре нет. */
  hallHref: string | null;
  accent: string;
  ink: string;
}) {
  const t = await getTranslations("TabBar");
  const tGuest = await getTranslations("GuestRoom");
  const tHall = await getTranslations("Hall");

  return (
    <nav
      aria-label={t("tabsAria")}
      className={`${s.numbers} ${s.bar}`}
      style={{ "--tb-accent": accent, "--tb-ink": ink } as CSSProperties}
    >
      <Link href={roomHref} className={`pressable ${s.slot} ${s.slotActive}`}>
        <IconRoom size={22} />
        {t("room")}
      </Link>

      {hallHref !== null && (
        <Link href={hallHref} className={`pressable ${s.slot}`}>
          <IconTreasury size={22} />
          {tHall("toHall")}
        </Link>
      )}

      {/* ТРЕТЬЕ МЕСТО — ДОРОГА ДОМОЙ. Знак плюс, и он выбран не за красоту:
          «дом занят „Комнатой", человек читается как „профиль", плюс говорит
          „появится новое"» (турн 61d). `ctaHint` сюда НЕ едет — в баре место
          названию, а уговаривать будет первый экран регистрации, куда ведёт
          нажатие. */}
      <Link href="/" className={`pressable ${s.slot}`}>
        <IconPlus size={22} strokeWidth={2.1} />
        {tGuest("cta")}
      </Link>
    </nav>
  );
}
