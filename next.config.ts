import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
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
