import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Каталог сборки. По умолчанию `.next`; e2e подставляет свой (`.next/e2e`)
  // через `NEXT_DIST_DIR` из `webServer.env` в playwright.config.ts — тикет 155.
  // Зачем: Next 16 держит блокировку файлом `<distDir>/dev/lock` и запрещает
  // ВТОРОЙ `next dev` в том же КАТАЛОГЕ сборки. Блокировка не по порту, поэтому
  // отдельный порт :3100 e2e не спасал: пока рядом работает обычный
  // `npm run dev` на :3000, прогон падал с «Another next dev server is already
  // running». Разные каталоги — два сервера живут рядом и не мешают друг другу.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  // Прод едет в Docker (см. Dockerfile): standalone кладёт в .next/standalone
  // самодостаточный server.js со своим срезом node_modules — в образ не нужно
  // тащить весь npm-дерево. На dev и тесты не влияет: режим читается только
  // при `next build`.
  output: "standalone",

  // Изображения комнат неприкосновенны и раздаются как статика без пережатия
  // (хотспоты привязаны к пикселям кадра — см. CLAUDE.md).
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default withNextIntl(nextConfig);
