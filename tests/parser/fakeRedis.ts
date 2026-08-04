// Фейковый Redis под узкий интерфейс RedisLike парсера.
// Lua-скрипт token-bucket здесь не исполняется: eval отдаёт значения из
// очереди evalResults (поведение обёртки тестируется отдельно, а честная
// математика ведра — на in-memory ветке ParserCache).

import type { RedisLike } from "../../src/server/parser/cache";

export class FakeRedis implements RedisLike {
  readonly store = new Map<string, { value: string; ttl: number }>();
  readonly evalCalls: Array<{ numKeys: number; args: Array<string | number> }> = [];
  evalResults: unknown[] = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, _ex: "EX", ttlSeconds: number): Promise<unknown> {
    this.store.set(key, { value, ttl: ttlSeconds });
    return "OK";
  }

  async eval(
    _script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.evalCalls.push({ numKeys, args });
    return this.evalResults.length > 0 ? this.evalResults.shift() : 1;
  }
}
