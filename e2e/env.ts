// Общие параметры e2e-стенда (тикет 15). Единственный источник правды для
// playwright.config.ts и спеков: e2e поднимает СВОЙ dev-сервер на своём
// порту (дефолт 3100 — чужой dev-сервер на :3000 не трогаем) и перехватывает
// письма/magic link'и в NDJSON-файл (шов E2E_MAIL_FILE в src/server/mailer).
import path from "node:path";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

/**
 * Файл перехвата писем: пишут dev-сервер e2e (magic link, вход) и обработчик
 * очереди mail (occasion-owner). Лежит в test-results/ — каталог в .gitignore.
 */
export const E2E_MAIL_FILE = path.resolve(__dirname, "..", "test-results", "e2e-mail.ndjson");
