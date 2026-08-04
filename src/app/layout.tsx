import type { Metadata } from "next";
import { Archivo, Onest, Instrument_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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

export const metadata: Metadata = {
  title: "Wishlist Platform",
  description: "Комната, которая говорит за тебя: что любишь и что хочешь.",
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
