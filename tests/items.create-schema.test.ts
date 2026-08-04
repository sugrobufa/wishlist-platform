// Юнит на Zod-схему формы добавления (тикет 04) — без БД.
// Ядро контракта items.json: у WANT цена/валюта обязательны, у LOVE ключей
// price/currency не существует — лишнее отбрасывается ДО записи.
import { describe, expect, it } from "vitest";
import {
  createItemInputSchema,
  ITEM_PHOTO_MAX_BYTES,
  newItemPhotoKey,
} from "../src/server/services/items";

const wantInput = (overrides: Record<string, unknown> = {}) => ({
  state: "WANT",
  zone: "jewelry",
  title: "Серьги-кольца",
  price: "14900",
  currency: "RUB",
  ...overrides,
});

const loveInput = (overrides: Record<string, unknown> = {}) => ({
  state: "LOVE",
  zone: "jewelry",
  title: "Теннисный браслет",
  ...overrides,
});

describe("createItemInputSchema — WANT", () => {
  it("хэппи-пас: цена нормализуется («14900,50» → «14900.50»), дефолт видимости ALL", () => {
    const parsed = createItemInputSchema.parse(
      wantInput({ price: "14900,50", size: "M", color: "золотой", desire: 4 }),
    );
    if (parsed.state !== "WANT") throw new Error("unreachable");
    expect(parsed.price).toBe("14900.50");
    expect(parsed.priceVisibility).toBe("ALL");
    expect(parsed.desire).toBe(4);
  });

  it("без цены — ошибка валидации (цена «хочу» обязательна по продукту)", () => {
    expect(() => createItemInputSchema.parse(wantInput({ price: undefined }))).toThrow();
    expect(() => createItemInputSchema.parse(wantInput({ price: "" }))).toThrow();
  });

  it("без валюты — ошибка; не ISO-код — ошибка; нижний регистр приводится", () => {
    expect(() => createItemInputSchema.parse(wantInput({ currency: undefined }))).toThrow();
    expect(() => createItemInputSchema.parse(wantInput({ currency: "рубли" }))).toThrow();
    const parsed = createItemInputSchema.parse(wantInput({ currency: "usd" }));
    if (parsed.state !== "WANT") throw new Error("unreachable");
    expect(parsed.currency).toBe("USD");
  });

  it("цена: ноль, минус, буквы и >2 знаков после точки — отказ", () => {
    for (const bad of ["0", "0.00", "-5", "abc", "10.999", "1e3", "10."]) {
      expect(() => createItemInputSchema.parse(wantInput({ price: bad })), bad).toThrow();
    }
  });

  it("desire только 1–4; пустые строки опциональных полей становятся undefined", () => {
    expect(() => createItemInputSchema.parse(wantInput({ desire: 0 }))).toThrow();
    expect(() => createItemInputSchema.parse(wantInput({ desire: 5 }))).toThrow();
    const parsed = createItemInputSchema.parse(wantInput({ size: "  ", color: "", note: "" }));
    if (parsed.state !== "WANT") throw new Error("unreachable");
    expect(parsed.size).toBeUndefined();
    expect(parsed.color).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });
});

describe("createItemInputSchema — LOVE", () => {
  it("цена/валюта/видимость/размер/desire в инпуте LOVE отбрасываются ДО записи", () => {
    const parsed = createItemInputSchema.parse(
      loveInput({
        price: "9900",
        currency: "RUB",
        priceVisibility: "NONE",
        size: "S",
        desire: 3,
      }),
    );
    expect(parsed.state).toBe("LOVE");
    expect("price" in parsed).toBe(false);
    expect("currency" in parsed).toBe(false);
    expect("priceVisibility" in parsed).toBe(false);
    expect("size" in parsed).toBe(false);
    expect("desire" in parsed).toBe(false);
  });

  it("даритель+год: год не раньше 1900 и не из будущего", () => {
    const year = new Date().getFullYear();
    const parsed = createItemInputSchema.parse(
      loveInput({ giverName: "мама", receivedYear: year }),
    );
    if (parsed.state !== "LOVE") throw new Error("unreachable");
    expect(parsed.receivedYear).toBe(year);
    expect(() => createItemInputSchema.parse(loveInput({ receivedYear: 1899 }))).toThrow();
    expect(() => createItemInputSchema.parse(loveInput({ receivedYear: year + 1 }))).toThrow();
    expect(() => createItemInputSchema.parse(loveInput({ receivedYear: 2024.5 }))).toThrow();
  });
});

describe("createItemInputSchema — общие поля", () => {
  it("заголовок обязателен и не бывает пробельным", () => {
    expect(() => createItemInputSchema.parse(wantInput({ title: "" }))).toThrow();
    expect(() => createItemInputSchema.parse(wantInput({ title: "   " }))).toThrow();
  });

  it("state вне словаря — отказ (третьего состояния нет)", () => {
    expect(() => createItemInputSchema.parse(wantInput({ state: "MAYBE" }))).toThrow();
  });

  it("url: только http(s); javascript: и просто текст — отказ", () => {
    const parsed = createItemInputSchema.parse(wantInput({ url: "https://shop.ru/x" }));
    expect(parsed.url).toBe("https://shop.ru/x");
    expect(() =>
      createItemInputSchema.parse(wantInput({ url: "javascript:alert(1)" })),
    ).toThrow();
    expect(() => createItemInputSchema.parse(wantInput({ url: "не ссылка" }))).toThrow();
  });

  it("photoKey: только наш вид items/{roomId}/{random}.{ext}; URL и refs/ — отказ", () => {
    const parsed = createItemInputSchema.parse(
      wantInput({ photoKey: "items/room1/0123456789abcdef.jpg" }),
    );
    expect(parsed.photoKey).toBe("items/room1/0123456789abcdef.jpg");
    for (const bad of [
      "https://evil.example/x.jpg",
      "refs/p-vinyl.jpg",
      "/etc/passwd",
      "items/../secret.jpg",
      "avatars/room1/a.jpg",
    ]) {
      expect(() => createItemInputSchema.parse(wantInput({ photoKey: bad })), bad).toThrow();
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
    const parsed = createItemInputSchema.parse(wantInput({ photoKey: key }));
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
