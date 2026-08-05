import { describe, expect, it } from "vitest";
import { alreadyAsked, rememberAsked, ROOM_OFFER_ASKED_KEY, type AskStore } from "./ask-once";

// «Спрашиваем ровно один раз» (тикет 38). Правило проверяется на поддельном
// хранилище: настоящий localStorage тут не нужен, а приватное окно, где он
// бросает, — нужно очень.

function fakeStore(initial: Record<string, string> = {}): AskStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/** Приватное окно: обращение к хранилищу бросает на каждом вызове. */
const throwingStore: AskStore = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  },
};

describe("предложение комнаты — ровно один раз", () => {
  it("первый раз спрашиваем, после отметки — больше никогда", () => {
    const store = fakeStore();
    expect(alreadyAsked(store)).toBe(false);

    rememberAsked(store);
    expect(alreadyAsked(store)).toBe(true);
    expect(store.data.get(ROOM_OFFER_ASKED_KEY)).toBe("1");
  });

  it("повторная отметка ничего не ломает и не «сбрасывает» память", () => {
    const store = fakeStore();
    rememberAsked(store);
    rememberAsked(store);
    expect(alreadyAsked(store)).toBe(true);
  });

  it("отметка из прошлого визита читается как «уже спрашивали»", () => {
    expect(alreadyAsked(fakeStore({ [ROOM_OFFER_ASKED_KEY]: "1" }))).toBe(true);
  });

  it("чужие ключи хранилища на нас не влияют", () => {
    expect(alreadyAsked(fakeStore({ "wl.something-else": "1" }))).toBe(false);
  });

  it("хранилища нет — спрашиваем: лишний вопрос дешевле потерянной хозяйки", () => {
    expect(alreadyAsked(null)).toBe(false);
    rememberAsked(null); // и не падаем
  });

  it("приватное окно (хранилище бросает) — спрашиваем и не роняем лист брони", () => {
    expect(alreadyAsked(throwingStore)).toBe(false);
    expect(() => rememberAsked(throwingStore)).not.toThrow();
  });
});
