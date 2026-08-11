import type { Metadata, Viewport } from "next";
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

/**
 * `viewport-fit=cover` — решение владельца 11.08.2026, тикет 200.
 *
 * БЕЗ ЭТОЙ СТРОКИ WebKit ВОЗВРАЩАЕТ `env(safe-area-inset-*) = 0`, и оба наших
 * инсета — мёртвые переменные. Следствий было ровно два, и оба тихие:
 *
 * 1. `--imm-safe-bottom` в сумме высоты таб-бара не делал ничего, поэтому
 *    тикет 182 закрывал щель под баром только в эмуляции. На айфоне заливка
 *    оставалась 86 px, и владелец видел под баром комнату;
 * 2. `--imm-safe-top` мёртв с тикета 57: проект считал, что обрабатывает
 *    чёлку, и не обработал её ни разу.
 *
 * ЧТО МЕНЯЕТСЯ ВИДИМО: комната идёт до самого верха экрана — ровно то, чего
 * хочет код («она фотография, ей вырез не мешает»), — а текст шапки и её вуаль
 * съезжают вниз на высоту выреза. Это замысел тикета 57, доехавший до
 * устройства через двенадцать дней.
 *
 * ПРОВЕРЯТЬ ЭТО В ХРОМЕ БЕССМЫСЛЕННО: там инсеты равны нулю и до, и после.
 * Годятся два доказательства — тест на УСТРОЙСТВО (читает CSS и требует инсет
 * в формуле) и замер с подставленным вручную числом.
 */
export const viewport: Viewport = {
  viewportFit: "cover",
};

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
