"use client";

// «7 подарков ещё свободны» в приветствии гостя (тикет 38, турн 12b).
//
// ЗАЧЕМ КЛИЕНТСКИЙ КОМПОНЕНТ У ОДНОЙ СТРОКИ. Само число считает сервер
// (services/guest-room.countFreeGifts) и оно едет в кэшируемом HTML: страница
// /r/{slug} — полностраничный ISR на 300 секунд, а бронь кэш комнаты не
// ревалидирует по построению (инвариант №1 — тихая бронь). Значит без поправки
// человек занял бы последний подарок, закрыл лист — и прочитал бы наверху, что
// один ещё свободен. Поправка ровно одна и ровно та, которую можно сделать
// честно: вычитаем брони, сделанные ИМ САМИМ за этот заход (booking-context).
//
// Чужие брони сюда не приезжают: канал «занято» отдаёт id занятых вещей, но
// сколько из них «хочу» в видимых зонах — по нему не сосчитать, и гадать мы не
// будем. Число остаётся честным «не меньше, чем свободно».
import { useTranslations } from "next-intl";
import { useGuestBooking } from "./booking-context";

export function FreeGifts({ count, accent }: { count: number; accent: string }) {
  const t = useTranslations("GuestRoom");
  const { bookedNow } = useGuestBooking();
  const free = Math.max(0, count - bookedNow);

  // Свободных нет — молчим: «0 подарков ещё свободны» ничего не сообщает и
  // звучит как упрёк комнате.
  if (free === 0) return null;

  return (
    <p className="overline" style={{ color: accent }}>
      {t("freeGifts", { count: free })}
    </p>
  );
}
