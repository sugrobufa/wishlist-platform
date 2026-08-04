import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Nodemailer from "next-auth/providers/nodemailer";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { sendMagicLink } from "./mailer";

// Вход без пароля — правило продукта (PRD §7.4): почта + ссылка.
// Отправка — общий транспорт src/server/mailer (тикет 12): в dev без
// EMAIL_SERVER ссылка печатается в консоль сервера той же рамкой
// «✉  [magic link] …», что и в Phase 0 (байт-в-байт — под перехват e2e).
const providers: Provider[] = [
  Nodemailer({
    server: process.env.EMAIL_SERVER || { host: "localhost", port: 587 },
    from: process.env.EMAIL_FROM || "room@wishlist.local",
    async sendVerificationRequest({ identifier, url }) {
      await sendMagicLink(identifier, url);
    },
  }),
];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers,
  pages: {
    signIn: "/signin",
  },
});
