import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    server: {
      // next-auth импортирует "next/server" без расширения, а у пакета next
      // нет поля exports — нативный ESM-загрузчик Node такой путь не находит.
      // Прогоняем пакет через резолвер Vite (тикет 19: юниты зовут настоящий
      // обработчик Auth.js, чтобы проверять одноразовость токена не на моках).
      deps: { inline: ["next-auth"] },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@design": fileURLToPath(new URL("./design/package/handoff", import.meta.url)),
    },
  },
});
