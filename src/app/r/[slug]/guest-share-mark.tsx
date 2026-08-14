"use client";

// «Позвать дарителя» — второй круглый знак в углу гостевого кадра (тикет 251,
// пакет 55 → guest-gaps.shareFurther, турн 61d).
//
// ЗАЧЕМ. Подарок часто выбирают вдвоём и втроём, а передать комнату дальше мог
// только хозяин: гость, которому прислали ссылку, звал остальных мимо продукта.
// Слово дизайна: «из этого в продукте и берутся связи — связь возникает из
// подарка или из открытой ссылки. Запрещать передачу значит требовать, чтобы
// всех гостей позвала хозяйка сама».
//
// БРОНЬ НЕ ПРОТЕКАЕТ ПО ПОСТРОЕНИЮ, и это главное здесь. Гость отдаёт ТУ ЖЕ
// публичную ссылку комнаты, что и хозяйка: ни имени, ни брони в ней нет. Новый
// гость увидит «уже дарят» без имени, как любой другой. Ссылки «на мою бронь» в
// продукте нет и заводить её не нужно (инвариант №1).
//
// ПОЧЕМУ КНОПКА, А НЕ `CornerMark`. Тот — `<Link>`, здесь действие: копирование
// в буфер. Вид общий, класс тот же, поэтому в углу они стоят парой и не спорят.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconShare } from "@/components/icons";

/** Сколько живёт подтверждение — то же число, что у шера хозяйки (тикет 24). */
const CONFIRM_MS = 5000;

/**
 * Копирование адреса — та же логика, что в `room/share-button.tsx`, включая
 * запасной путь: `navigator.clipboard` есть только на https и localhost, а
 * стенд живёт и по http.
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
    document.body.removeChild(area);
  }
}

/**
 * `path` — путь комнаты («/r/{slug}»), а не готовый адрес: origin на сервере и
 * на клиенте может отличаться (стенд за прокси), и собирать его надо там, где
 * человек нажимает.
 */
export function GuestShareMark({ path }: { path: string }) {
  const t = useTranslations("GuestRoom");
  // Подтверждение берём готовым словом хозяйкиного шера, а не заводим своё:
  // «Скопировано» одинаково верно с обеих сторон, и новый ключ ради того же
  // слова стоил бы ровно столько же, сколько даёт (довод письма 47 про
  // `Light.*`).
  const tRoom = useTranslations("Room");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = useCallback(() => {
    void copyToClipboard(`${window.location.origin}${path}`).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
    });
  }, [path]);

  const label = t("shareRoom");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pressable imm-corner-mark"
    >
      <IconShare size={22} />
      {/* Подтверждение — только читалке: на экране у знака слов нет вовсе, и
          заводить их значило бы спорить с правилом угла (тикет 118). */}
      <span className="sr-only" role="status">
        {copied ? tRoom("copied") : ""}
      </span>
    </button>
  );
}
