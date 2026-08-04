import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Nodemailer from "next-auth/providers/nodemailer";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

// Вход без пароля — правило продукта (PRD §7.4): почта + ссылка.
// В dev без EMAIL_SERVER ссылка печатается в консоль сервера.
const providers: Provider[] = [
  Nodemailer({
    server: process.env.EMAIL_SERVER || { host: "localhost", port: 587 },
    from: process.env.EMAIL_FROM || "room@wishlist.local",
    async sendVerificationRequest({ identifier, url, provider }) {
      if (!process.env.EMAIL_SERVER) {
        console.log(`\n✉  [magic link] ${identifier}\n   ${url}\n`);
        return;
      }
      const { createTransport } = await import("nodemailer");
      const transport = createTransport(provider.server as Parameters<typeof createTransport>[0]);
      await transport.sendMail({
        to: identifier,
        from: provider.from,
        subject: "Вход в вашу комнату",
        text: `Ссылка для входа: ${url}`,
        html: `<p>Ссылка для входа: <a href="${url}">войти</a></p>`,
      });
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
