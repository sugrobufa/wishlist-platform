import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Nodemailer from "next-auth/providers/nodemailer";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { sendMagicLink } from "./mailer";
import { CONFIRM_PATH, magicLinkUrl } from "./auth-links";

// Вход без пароля — правило продукта (PRD §7.4): почта + ссылка.
// Отправка — общий транспорт src/server/mailer (тикет 12): в dev без
// EMAIL_SERVER ссылка печатается в консоль сервера той же рамкой
// «✉  [magic link] …», что и в Phase 0 (байт-в-байт — под перехват e2e).
//
// В письмо уходит НЕ callback Auth.js, а наша страница подтверждения
// (тикет 19, magicLinkUrl): callback тратит одноразовый токен первым же
// GET — его сжигали предзагрузка адресной строки Chrome и почтовые
// сканеры. Страница на GET не делает ничего; токен расходуется по кнопке.
const providers: Provider[] = [
  Nodemailer({
    server: process.env.EMAIL_SERVER || { host: "localhost", port: 587 },
    from: process.env.EMAIL_FROM || "room@wishlist.local",
    async sendVerificationRequest({ identifier, url }) {
      await sendMagicLink(identifier, magicLinkUrl(url));
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
    // Сырой экран Auth.js «Verification error» человеку не показываем:
    // все отказы входа уводим на нашу страницу подтверждения — там тихий
    // текст и кнопка «Прислать новую ссылку» (тикет 19).
    error: CONFIRM_PATH,
  },
});
