import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Изображения комнат неприкосновенны и раздаются как статика без пережатия
  // (хотспоты привязаны к пикселям кадра — см. CLAUDE.md).
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default withNextIntl(nextConfig);
