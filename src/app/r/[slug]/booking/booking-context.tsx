"use client";

// Канал «занято» гостевой комнаты (тикет 08). Один fetch на страницу ПОСЛЕ
// рендера — кэш комнаты и HTML одинаковы для всех (решение тикета 07), брони
// приезжают только сюда, некэшируемо (инвариант №1: тихая бронь).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type GuestBookingState = {
  /** Вещи комнаты с чьей-то бронью — тихое «занято», без имён. */
  taken: ReadonlySet<string>;
  /** Какие из них заняты ЭТИМ гостем (по его же cookie) — «занято тобой». */
  mine: ReadonlySet<string>;
  /** Всего живых броней гостя — строка «Мои брони · N» внизу комнаты. */
  myBookingsCount: number;
  /** Зритель вошёл в аккаунт — вопрос «остаться в связях?» (тикет 98b). */
  signedIn: boolean;
  /**
   * Сколько вещей ЭТОЙ комнаты гость занял прямо сейчас, за этот заход.
   * Приветствие вычитает это число из «сколько подарков ещё свободно»: сам
   * счётчик посчитан при рендере, а страница кэшируется (ISR 300 с) — без
   * поправки человек занял бы последний подарок и тут же прочитал, что один
   * ещё свободен. Чужие брони сюда не попадают и попасть не могут.
   */
  bookedNow: number;
  /** Успешная бронь: пометить вещь занятой без перезагрузки. */
  markBooked: (itemId: string) => void;
  /** Кто-то успел раньше (409): вещь занята, но не тобой. */
  markTaken: (itemId: string) => void;
};

const GuestBookingContext = createContext<GuestBookingState | null>(null);

/** Строковый массив из недоверенного JSON — всё лишнее молча отбрасывается. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function GuestBookingProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set());
  const [myBookingsCount, setMyBookingsCount] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [bookedNow, setBookedNow] = useState(0);

  useEffect(() => {
    // Пинг визита (тикет 11): один fire-and-forget POST после первого рендера.
    // HTML комнаты одинаков для всех (инвариант кэшируемости) — «смотрели»
    // пишется этим отдельным некэшируемым запросом; аноним на сервере → 204
    // no-op, ответ не читаем, ошибки глотаем (комната живёт и без пинга).
    void fetch(`/api/v1/rooms/${encodeURIComponent(slug)}/visit`, { method: "POST" }).catch(
      () => {},
    );
  }, [slug]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/rooms/${encodeURIComponent(slug)}/taken`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        const data =
          typeof payload === "object" && payload !== null
            ? (payload as {
                data?: {
                  itemIds?: unknown;
                  mine?: unknown;
                  myBookingsCount?: unknown;
                  signedIn?: unknown;
                };
              })
                .data
            : undefined;
        if (!data) return;
        setTaken(new Set(stringArray(data.itemIds)));
        setMine(new Set(stringArray(data.mine)));
        setMyBookingsCount(typeof data.myBookingsCount === "number" ? data.myBookingsCount : 0);
        setSignedIn(data.signedIn === true);
      } catch {
        // Тихо: без канала «занято» комната остаётся смотрибельной,
        // а сервер всё равно не даст занять уже занятое (P2002 → 409).
      }
    })();
    return () => controller.abort();
  }, [slug]);

  const markBooked = useCallback((itemId: string) => {
    setTaken((prev) => new Set(prev).add(itemId));
    setMine((prev) => new Set(prev).add(itemId));
    setMyBookingsCount((prev) => prev + 1);
    setBookedNow((prev) => prev + 1);
  }, []);

  const markTaken = useCallback((itemId: string) => {
    setTaken((prev) => new Set(prev).add(itemId));
  }, []);

  const value = useMemo<GuestBookingState>(
    () => ({ taken, mine, myBookingsCount, signedIn, bookedNow, markBooked, markTaken }),
    [taken, mine, myBookingsCount, signedIn, bookedNow, markBooked, markTaken],
  );

  return <GuestBookingContext.Provider value={value}>{children}</GuestBookingContext.Provider>;
}

export function useGuestBooking(): GuestBookingState {
  const context = useContext(GuestBookingContext);
  if (!context) {
    throw new Error("useGuestBooking — только внутри GuestBookingProvider (/r/[slug])");
  }
  return context;
}
