import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const BOOKINGS = read("src/server/services/bookings.ts");
const CONTEXT = read("src/app/r/[slug]/booking/booking-context.tsx");
const DIALOG = read("src/app/r/[slug]/booking/booking-dialog.tsx");

/**
 * 250 — «СЕБЕ ПОДАРИТЬ НЕЛЬЗЯ» ГОВОРИТСЯ ДО ФОРМЫ.
 *
 * Приёмка 14.08.2026: «при попытке подарить не срабатывает кнопка, пишет, что
 * ты в своей комнате». Запрет правильный — на нём держится инвариант №1: иначе
 * счётчик «N вещей уже забраны» хозяйка накрутит себе сама. Неверным было
 * МЕСТО: отказ прилетал с сервера после того, как человек заполнил имя, почту и
 * выбрал «тихо / подписаться».
 */
describe("250 — хозяин узнаёт о запрете до формы", () => {
  it("канал «занято» отдаёт признак хозяина — обе ветки проставляют его явно", () => {
    expect(BOOKINGS).toContain("isOwner: boolean;");
    expect(BOOKINGS).toContain("isOwner: true,");
    // Гостевая ветка проставляет false явно, а не полагается на умолчание:
    // иначе следующая ветка ответа заведётся без флага молча.
    expect(BOOKINGS).toContain("isOwner: false,");
  });

  it("ПРИЗНАК НЕ ПРОТЕКАЕТ В БРОНИ: ответ хозяйке остался пустым", () => {
    // Инвариант №1. Флаг говорит «это твоя комната» и ничего больше: ни одной
    // брони, ни одного имени. Ветка хозяйки как отдавала пустые списки, так и
    // отдаёт — если это изменится, тест упадёт здесь.
    expect(BOOKINGS).toMatch(/itemIds: \[\],\s*\n\s*mine: \[\],\s*\n\s*myBookingsCount: 0,/u);
  });

  it("флаг доезжает до экрана тем же каналом, что «занято»", () => {
    expect(CONTEXT).toContain("isOwner: boolean;");
    expect(CONTEXT).toContain("setIsOwner(data.isOwner === true);");
    // В зависимостях useMemo — иначе экран не перерисуется, когда флаг приедет.
    expect(CONTEXT).toMatch(/\[taken, mine, myBookingsCount, signedIn, isOwner,/u);
  });

  it("диалог показывает объяснение ВМЕСТО формы, а не после неё", () => {
    expect(DIALOG).toContain("const { markBooked, markTaken, signedIn, isOwner } = useGuestBooking();");
    // Ветка хозяина стоит ПЕРВОЙ — раньше «done» и раньше формы.
    expect(DIALOG).toMatch(/\{isOwner \? \([\s\S]*?\) : phase === "done" \? \(/u);
    expect(DIALOG).toContain('t("errOwn")');
  });

  it("серверная проверка НЕ снята — экран это вежливость, а не защита", () => {
    // Флаг приезжает после рендера; до него бирка работает как обычно, и отказ
    // обязан ловить сервер. Снять его значило бы открыть накрутку счётчика.
    expect(BOOKINGS).toContain("takenForOwner");
    const errors = read("src/app/r/[slug]/booking/booking-errors.ts");
    expect(errors).toContain('own: "errOwn"');
  });
});
