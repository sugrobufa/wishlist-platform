import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_DIST_DIR, E2E_MAIL_FILE, E2E_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // Dev-сервер компилирует маршруты лениво — первым заходам нужен запас.
  expect: { timeout: 15_000 },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Полный цикл (full-cycle) гоняется один раз в chromium: у него
    // фиксированные e2e-почты и общая dev-БД — параллельный второй прогон
    // дрался бы за одни и те же строки. Мобильная эмуляция перф-замера
    // живёт внутри самого спека (devices["iPhone 14"] на chromium).
    //
    // browserName задан явно: у iPhone-пресета defaultBrowserType — webkit,
    // а локально и в CI ставится ТОЛЬКО chromium (тикет 15) — мобильный
    // проект эмулирует вьюпорт/тач на нём же.
    {
      name: "mobile",
      use: { ...devices["iPhone 14"], browserName: "chromium" },
      testIgnore: /full-cycle/,
    },
  ],
  webServer: {
    // СВОЙ dev-сервер на своём порту И В СВОЁМ КАТАЛОГЕ СБОРКИ (тикеты 15, 155):
    // возможный чужой на :3000 не переиспользуем и не трогаем. Порт и каталог
    // параметризованы через e2e/env.ts (E2E_PORT, E2E_DIST_DIR), сам скрипт
    // package.json не меняется — next dev читает PORT, next.config.ts читает
    // NEXT_DIST_DIR.
    //
    // Одного порта МАЛО: Next 16 блокирует КАТАЛОГ сборки (`<distDir>/dev/lock`),
    // а не порт, и второй `next dev` в том же каталоге не стартует вовсе —
    // «Another next dev server is already running». Пока каталог был общий,
    // локальный прогон был невозможен рядом с живым `npm run dev`; в CI это не
    // видно, там второго сервера нет.
    command: "npm run dev",
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(E2E_PORT),
      NEXT_DIST_DIR: E2E_DIST_DIR,
      // Абсолютные ссылки (письма, OG) собираются от адреса e2e-сервера.
      APP_BASE_URL: E2E_BASE_URL,
      // Тестовые швы тикета 15: перехват писем + фикстурный магазин парсера.
      E2E_MAIL_FILE,
      E2E_FIXTURE_SHOP: "1",
    },
  },
});
