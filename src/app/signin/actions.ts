"use server";

// Отправка ссылки входа (тикет 56). Одно действие на обе формы: первая
// отправка с /signin и «Отправить снова» с экрана «письмо ушло».
//
// Механика не менялась (Auth.js magic link, тикет 19) — здесь только адрес
// экрана после отправки. Почта уезжает в query, чтобы экран «письмо ушло»
// мог показать адрес и повторить отправку; это тот же приём, что у самой
// ссылки входа (/signin/confirm?token=…&email=…).

import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { MAGIC_PROVIDER_ID } from "@/server/auth-links";

export async function requestMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  await signIn(MAGIC_PROVIDER_ID, { email, redirect: false });
  redirect(`/signin?sent=1&email=${encodeURIComponent(email)}`);
}
