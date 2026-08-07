// Разбор отказа брони (тикет 76). Главный случай — тот, на котором владелец
// встал на приёмке 07.08: он вошёл на стенд под собой, открыл СВОЮ комнату по
// гостевой ссылке и получил «Не получилось — попробуй ещё раз». Сервер при
// этом отвечал 403 `OWN_ITEM` с внятным текстом, а диалог его выбрасывал:
// в лестнице по статусу 403 попадал в «всё остальное».
import { describe, expect, it } from "vitest";
import {
  bookingErrorKey,
  marksItemTaken,
  BOOKING_ERROR_MESSAGE,
  type BookingErrorKey,
} from "../src/app/r/[slug]/booking/booking-errors";

describe("код сервера решает, что показать", () => {
  it("OWN_ITEM больше не безымянный отказ — это случай приёмки 07.08", () => {
    expect(bookingErrorKey("OWN_ITEM", 403)).toBe("own");
    expect(BOOKING_ERROR_MESSAGE.own).toBe("errOwn");
  });

  it("два разных 409 различаются по коду, а не по статусу", () => {
    // ALREADY_BOOKED — «кто-то успел раньше»; NOT_WANT — вещь вообще не «хочу».
    // По статусу они неразличимы, и вещь помечалась занятой в обоих случаях.
    expect(bookingErrorKey("ALREADY_BOOKED", 409)).toBe("taken");
    expect(bookingErrorKey("NOT_WANT", 409)).toBe("gone");
  });

  it("остальные коды роута разобраны поимённо", () => {
    expect(bookingErrorKey("RATE_LIMITED", 429)).toBe("rate");
    expect(bookingErrorKey("VALIDATION", 400)).toBe("validation");
    expect(bookingErrorKey("NOT_FOUND", 404)).toBe("gone");
    expect(bookingErrorKey("DEMO_ITEM", 400)).toBe("gone");
    expect(bookingErrorKey("POOL_NOT_SUPPORTED", 400)).toBe("gone");
    expect(bookingErrorKey("TOKEN_NOT_FOUND", 404)).toBe("gone");
  });
});

describe("статус — запасной путь, а не основной", () => {
  it("тело не доехало (прокси, обрыв) — разбираем по статусу", () => {
    expect(bookingErrorKey(null, 409)).toBe("taken");
    expect(bookingErrorKey(null, 429)).toBe("rate");
    expect(bookingErrorKey(null, 400)).toBe("validation");
    expect(bookingErrorKey(null, 502)).toBe("generic");
  });

  it("незнакомый код честно падает в generic, а не притворяется знакомым", () => {
    expect(bookingErrorKey("КАКОЙ-ТО-НОВЫЙ", 418)).toBe("generic");
    // …но если статус знакомый, он всё равно скажет больше, чем «generic».
    expect(bookingErrorKey("КАКОЙ-ТО-НОВЫЙ", 429)).toBe("rate");
  });
});

describe("занятой вещь помечает ровно один случай", () => {
  it("только «успели раньше» — иначе чужой отказ гасил бы вещь в комнате", () => {
    const keys: BookingErrorKey[] = ["taken", "rate", "validation", "own", "gone", "generic"];
    for (const key of keys) {
      expect(marksItemTaken(key), key).toBe(key === "taken");
    }
  });
});

describe("у каждого ключа есть строка", () => {
  it("словарь покрывает все шесть — иначе экран показал бы ключ", () => {
    const keys: BookingErrorKey[] = ["taken", "rate", "validation", "own", "gone", "generic"];
    for (const key of keys) {
      expect(BOOKING_ERROR_MESSAGE[key], key).toMatch(/^err[A-Z]/u);
    }
  });
});
