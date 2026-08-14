import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const MARK = readFileSync(
  resolve(process.cwd(), "src/app/r/[slug]/guest-share-mark.tsx"),
  "utf8",
);
const PAGE = readFileSync(resolve(process.cwd(), "src/app/r/[slug]/page.tsx"), "utf8");

/**
 * 251 — ГОСТЬ ПЕРЕДАЁТ КОМНАТУ ДАЛЬШЕ.
 *
 * Приёмка 14.08.2026: «почему я в режиме гостя не могу отправить далее ссылку
 * на эту комнату другому дарителю?» Пакет 55 (турн 61d) ответил «да, и тем же
 * приёмом»: из передачи ссылки в продукте и берутся связи — «связь возникает из
 * подарка или из открытой ссылки».
 */
describe("251 — «Позвать дарителя»", () => {
  it("знак стоит в углу гостевого кадра и всегда — витрина может быть закрыта", () => {
    expect(PAGE).toContain("<GuestShareMark path={`/r/${room.shareSlug}`} />");
    // Внутри SceneCorner, а не отдельным слоем: угол — территория знаков.
    expect(PAGE).toMatch(/<GuestShareMark[\s\S]{0,120}<\/SceneCorner>/u);
  });

  it("ОТДАЁТСЯ ПУБЛИЧНАЯ ССЫЛКА КОМНАТЫ — ни брони, ни имени", () => {
    // Инвариант №1. Ссылка — тот же shareSlug, что у хозяйки; «ссылки на мою
    // бронь» в продукте нет и заводить её не нужно.
    expect(PAGE).toContain("path={`/r/${room.shareSlug}`}");
    expect(MARK).not.toMatch(/booking|bookingId|myBooking/iu);
  });

  it("адрес собирается на КЛИЕНТЕ — origin за прокси другой", () => {
    expect(MARK).toContain("window.location.origin");
  });

  it("слово из пакета, подтверждение — готовым словом хозяйки", () => {
    expect(ru.GuestRoom.shareRoom).toBe("Позвать дарителя");
    expect(en.GuestRoom.shareRoom).toBeTruthy();
    expect(MARK).toContain('tRoom("copied")');
  });

  it("на экране слов нет — они читалке и мыши, как у прочих знаков угла", () => {
    expect(MARK).toContain("aria-label={label}");
    expect(MARK).toContain('title={label}');
    expect(MARK).toContain('className="pressable imm-corner-mark"');
  });
});
