import type { Metadata } from "next";
import { Archivo, Onest, Instrument_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-archivo",
});

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});

const DESCRIPTION = "Комната, которая говорит за тебя: что любишь и что хочешь.";

/**
 * Имя площадки — «Grace» (решение владельца 06.08.2026, тикеты 56/58). Оно
 * живёт ОДНИМ ключом словаря `Brand.name`: здесь, во вкладке и в OG, — и там
 * же его наберёт SVG-логотип, когда приедет от дизайна.
 *
 * `template` достаётся ДОЧЕРНИМ сегментам (правило Next: на самом layout он
 * не действует, поэтому рядом обязателен `default`). Внутренние страницы
 * отдают в `title` только своё имя — «Вход», «Что подарили», название зоны, —
 * а хвост « — Grace» добавляется здесь, в одном месте.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getTranslations("Brand");
  const name = brand("name");

  return {
    title: { default: name, template: `%s — ${name}` },
    description: DESCRIPTION,
    // По минимуму (тикет 58): имя площадки в карточке ссылки. Картинки OG
    // ждут логотип — заведём вместе с ним.
    openGraph: { siteName: name, title: name, description: DESCRIPTION, type: "website" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${archivo.variable} ${onest.variable} ${instrumentSans.variable} antialiased`}
      >
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
