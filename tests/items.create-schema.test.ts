// Юнит на Zod-схему формы добавления (тикет 04) — без БД.
//
// ПЕРЕПИСАНО ТИКЕТОМ 124: схема больше не различает СОСТОЯНИЯ, она различает
// МЕСТА. Ядро контракта items.json v2: у вещи КОМНАТЫ цена/валюта
// обязательны («у всего в комнате есть цена»), у вещи СОКРОВИЩНИЦЫ ключей
// price/currency не существует вовсе — лишнее отбрасывается ДО записи.
// Дискриминатор — `inHall`, и по умолчанию он false: форма из зоны его не
// шлёт, а «сразу в сокровищницу» (тикет 89) шлёт явно.
import { describe, expect, it } from "vitest";
import {
  createItemInputSchema,
  ITEM_PHOTO_MAX_BYTES,
  newItemPhotoKey,
} from "../src/server/services/items";

/** Вещь КОМНАТЫ: ключ места не шлём вовсе — так делает форма из зоны. */
const roomInput = (overrides: Record<string, unknown> = {}) => ({
  zone: "jewelry",
  title: "Серьги-кольца",
  price: "14900",
  currency: "RUB",
  ...overrides,
});

/** Вещь СОКРОВИЩНИЦЫ: «сразу в сокровищницу» шлёт `inHall: true` явно. */
const hallInput = (overrides: Record<string, unknown> = {}) => ({
  inHall: true,
  zone: "jewelry",
  title: "Теннисный браслет",
  ...overrides,
});

describe("createItemInputSchema — вещь комнаты", () => {
  it("хэппи-пас: цена нормализуется («14900,50» → «14900.50»), дефолт видимости ALL", () => {
    const parsed = createItemInputSchema.parse(
      roomInput({ price: "14900,50", size: "M", color: "золотой", desire: 4 }),
    );
    if (parsed.inHall) throw new Error("unreachable");
    expect(parsed.inHall).toBe(false); // место по умолчанию — комната
    expect(parsed.price).toBe("14900.50");
    expect(parsed.priceVisibility).toBe("ALL");
    expect(parsed.desire).toBe(4);
  });

  it("без цены — ошибка валидации (у всего в комнате есть цена)", () => {
    expect(() => createItemInputSchema.parse(roomInput({ price: undefined }))).toThrow();
    expect(() => createItemInputSchema.parse(roomInput({ price: "" }))).toThrow();
  });

  it("без валюты — ошибка; не ISO-код — ошибка; нижний регистр приводится", () => {
    expect(() => createItemInputSchema.parse(roomInput({ currency: undefined }))).toThrow();
    expect(() => createItemInputSchema.parse(roomInput({ currency: "рубли" }))).toThrow();
    const parsed = createItemInputSchema.parse(roomInput({ currency: "usd" }));
    if (parsed.inHall) throw new Error("unreachable");
    expect(parsed.currency).toBe("USD");
  });

  it("цена: ноль, минус, буквы и >2 знаков после точки — отказ", () => {
    for (const bad of ["0", "0.00", "-5", "abc", "10.999", "1e3", "10."]) {
      expect(() => createItemInputSchema.parse(roomInput({ price: bad })), bad).toThrow();
    }
  });

  it("desire только 1–4; пустые строки опциональных полей становятся undefined", () => {
    expect(() => createItemInputSchema.parse(roomInput({ desire: 0 }))).toThrow();
    expect(() => createItemInputSchema.parse(roomInput({ desire: 5 }))).toThrow();
    const parsed = createItemInputSchema.parse(roomInput({ size: "  ", color: "", note: "" }));
    if (parsed.inHall) throw new Error("unreachable");
    expect(parsed.size).toBeUndefined();
    expect(parsed.color).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });
});

describe("createItemInputSchema — вещь сокровищницы", () => {
  it("цена/валюта/видимость/размер/desire отбрасываются ДО записи", () => {
    const parsed = createItemInputSchema.parse(
      hallInput({
        price: "9900",
        currency: "RUB",
        priceVisibility: "NONE",
        size: "S",
        desire: 3,
      }),
    );
    expect(parsed.inHall).toBe(true);
    expect("price" in parsed).toBe(false);
    expect("currency" in parsed).toBe(false);
    expect("priceVisibility" in parsed).toBe(false);
    expect("size" in parsed).toBe(false);
    expect("desire" in parsed).toBe(false);
  });

  // ПЕРЕПИСАНО (тикет 124): раньше `inHall` был ключом формы LOVE со
  // значением по умолчанию false, а у WANT его не было вовсе. Теперь это
  // ДИСКРИМИНАТОР, и правило другое: ключа нет — вещь идёт в комнату.
  it("место по умолчанию — комната; «сразу в сокровищницу» шлётся явно (тикет 89)", () => {
    const fromZone = createItemInputSchema.parse(roomInput());
    expect(fromZone.inHall).toBe(false);

    const treasure = createItemInputSchema.parse(hallInput());
    expect(treasure.inHall).toBe(true);

    // Явное `inHall: false` — то же самое, что его отсутствие.
    const explicit = createItemInputSchema.parse(roomInput({ inHall: false }));
    expect(explicit.inHall).toBe(false);

    // Мусор вместо места — отказ: третьего места не бывает.
    expect(() => createItemInputSchema.parse(roomInput({ inHall: "yes" }))).toThrow();
  });

  it("вещь сокровищницы заводится БЕЗ цены — она там не показывается", () => {
    // Обратная сторона правила «у всего в комнате есть цена»: на витрине её
    // требовать не за чем, и ключа для неё в форме нет.
    const parsed = createItemInputSchema.parse(hallInput());
    expect(parsed.inHall).toBe(true);
    expect("price" in parsed).toBe(false);
    expect("currency" in parsed).toBe(false);
  });

  it("даритель+год: год не раньше 1900 и не из будущего", () => {
    const year = new Date().getFullYear();
    const parsed = createItemInputSchema.parse(
      hallInput({ giverName: "мама", receivedYear: year }),
    );
    if (!parsed.inHall) throw new Error("unreachable");
    expect(parsed.receivedYear).toBe(year);
    expect(() => createItemInputSchema.parse(hallInput({ receivedYear: 1899 }))).toThrow();
    expect(() => createItemInputSchema.parse(hallInput({ receivedYear: year + 1 }))).toThrow();
    expect(() => createItemInputSchema.parse(hallInput({ receivedYear: 2024.5 }))).toThrow();
  });
});

describe("createItemInputSchema — общие поля", () => {
  it("заголовок обязателен и не бывает пробельным", () => {
    expect(() => createItemInputSchema.parse(roomInput({ title: "" }))).toThrow();
    expect(() => createItemInputSchema.parse(roomInput({ title: "   " }))).toThrow();
  });

  // ПЕРЕПИСАНО (тикет 124): проверяли «третьего состояния нет». Состояний
  // нет вовсе, и присланный руками `state` обязан просто исчезнуть — схема
  // его не знает и лишние ключи отбрасывает молча.
  it("присланный руками state в разбор не проходит и до записи не доезжает", () => {
    const parsed = createItemInputSchema.parse(roomInput({ state: "WANT" }));
    expect(parsed).not.toHaveProperty("state");
  });

  it("url: только http(s); javascript: и просто текст — отказ", () => {
    const parsed = createItemInputSchema.parse(roomInput({ url: "https://shop.ru/x" }));
    expect(parsed.url).toBe("https://shop.ru/x");
    expect(() =>
      createItemInputSchema.parse(roomInput({ url: "javascript:alert(1)" })),
    ).toThrow();
    expect(() => createItemInputSchema.parse(roomInput({ url: "не ссылка" }))).toThrow();
  });

  it("photoKey: только наш вид items/{roomId}/{random}.{ext}; URL и refs/ — отказ", () => {
    const parsed = createItemInputSchema.parse(
      roomInput({ photoKey: "items/room1/0123456789abcdef.jpg" }),
    );
    expect(parsed.photoKey).toBe("items/room1/0123456789abcdef.jpg");
    for (const bad of [
      "https://evil.example/x.jpg",
      "refs/p-vinyl.jpg",
      "/etc/passwd",
      "items/../secret.jpg",
      "avatars/room1/a.jpg",
    ]) {
      expect(() => createItemInputSchema.parse(roomInput({ photoKey: bad })), bad).toThrow();
    }
  });
});

describe("фото вещи: ключ и лимит", () => {
  it("лимит — ровно 10 МБ", () => {
    expect(ITEM_PHOTO_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("ключ items/{roomId}/{16 hex}.{ext} по типу; сам проходит photoKey-схему", () => {
    const key = newItemPhotoKey("room42", "image/jpeg");
    expect(key).toMatch(/^items\/room42\/[0-9a-f]{16}\.jpg$/);
    const parsed = createItemInputSchema.parse(roomInput({ photoKey: key }));
    expect(parsed.photoKey).toBe(key);
    expect(newItemPhotoKey("room42", "image/png")).toMatch(/\.png$/);
    expect(newItemPhotoKey("room42", "IMAGE/WEBP")).toMatch(/\.webp$/);
    expect(newItemPhotoKey("room42", "image/heic")).toMatch(/\.heic$/);
  });

  it("два ключа подряд не совпадают (имя файла пользователя не участвует)", () => {
    expect(newItemPhotoKey("r", "image/png")).not.toBe(newItemPhotoKey("r", "image/png"));
  });

  it("SVG и не-картинки — null (SVG с нашего origin был бы XSS)", () => {
    expect(newItemPhotoKey("room42", "image/svg+xml")).toBeNull();
    expect(newItemPhotoKey("room42", "application/pdf")).toBeNull();
    expect(newItemPhotoKey("room42", "text/html")).toBeNull();
    expect(newItemPhotoKey("room42", "")).toBeNull();
  });
});
