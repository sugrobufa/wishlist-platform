// Общий почтовый транспорт (тикет 12) — единственное место, откуда проект
// отправляет письма. EMAIL_SERVER задан → nodemailer (динамический импорт,
// как в auth.ts Phase 0); не задан (dev) → письмо печатается в консоль
// рамкой «✉ [письмо] кому / тема / текст». Здесь же живут шаблоны двух
// писем цикла дарения (spec, решение гриллинга №7): reminderGuestMail —
// гостю за 3 дня до праздника, occasionOwnerMail — хозяйке после. Тон —
// тихий и тёплый (CLAUDE.md), только ru (Phase 1); писем про САМИ брони
// не существует — только эти два.
//
// ИНВАРИАНТ №1 (тихая бронь): письмо хозяйке не упоминает ни вещей, ни
// имён — шаблон физически принимает только имя хозяйки и ссылку на
// «что подарили». Покрыто тестом (tests/mailer.worker.test.ts).

import type { Transporter } from "nodemailer";

// ---------- Транспорт ----------

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Транспорт переживает HMR через globalThis (паттерн src/server/db.ts);
// создаётся лениво — в dev без EMAIL_SERVER nodemailer вообще не грузится.
const globalForMailer = globalThis as unknown as {
  __wishlistMailTransport?: Promise<Transporter>;
};

function smtpTransport(): Promise<Transporter> {
  globalForMailer.__wishlistMailTransport ??= import("nodemailer").then(({ createTransport }) =>
    createTransport(process.env.EMAIL_SERVER),
  );
  return globalForMailer.__wishlistMailTransport;
}

/**
 * Отправить письмо. Без EMAIL_SERVER — консоль воркера/сервера (dev),
 * с EMAIL_SERVER — nodemailer. Бросает при ошибке SMTP: повторы — забота
 * вызывающего (у mail-джоб это attempts BullMQ).
 */
export async function sendMail({ to, subject, text, html }: MailInput): Promise<void> {
  if (!process.env.EMAIL_SERVER) {
    const body = text
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    console.log(`\n✉  [письмо] ${to}\n   Тема: ${subject}\n${body}\n`);
    return;
  }
  const transport = await smtpTransport();
  await transport.sendMail({
    to,
    from: process.env.EMAIL_FROM || "room@wishlist.local",
    subject,
    text,
    html,
  });
}

/**
 * Magic link входа (Auth.js, src/server/auth.ts). Dev-рамка сохранена
 * байт-в-байт с Phase 0: e2e тикета 15 перехватывает ссылку из консоли
 * именно по «✉  [magic link] …» — не менять без него.
 */
export async function sendMagicLink(to: string, url: string): Promise<void> {
  if (!process.env.EMAIL_SERVER) {
    console.log(`\n✉  [magic link] ${to}\n   ${url}\n`);
    return;
  }
  await sendMail({
    to,
    subject: "Вход в вашу комнату",
    text: `Ссылка для входа: ${url}`,
    html: `<p>Ссылка для входа: <a href="${escapeHtml(url)}">войти</a></p>`,
  });
}

// ---------- Помощники шаблонов ----------

/** Абсолютная ссылка приложения для писем (паттерн app/r/[slug]/page.tsx). */
export function appUrl(path: string): string {
  return new URL(path, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();
}

/** «14 марта» — дата праздника по-русски. UTC-сутки, как всюду в цикле
 * праздника (тикет 10): occasionDate из настроек — полночь UTC. */
export function formatOccasionDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

/** Пользовательский ввод (имена, названия вещей) в HTML — только экранированным. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Письма — простой светлый HTML на инлайн-стилях и системном шрифте:
// веб-шрифты продукта (Archivo/Onest) в письма сознательно не тащим.
const HTML_WRAP = [
  `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;`,
  `font-size:15px;line-height:1.6;color:#333333;background:#ffffff;`,
  `max-width:520px;margin:0 auto;padding:24px 20px;">`,
].join("");

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

// ---------- Шаблон: напоминание гостю за 3 дня ----------

export interface ReminderGuestParams {
  guestName: string;
  /** displayName хозяйки; null — имени нет, письмо обходится без него. */
  ownerName: string | null;
  itemTitle: string;
  occasionDate: Date;
  roomSlug: string;
}

/**
 * «Мила отмечает праздник 14 марта, вы заняли подарок» + ссылки на «мои
 * брони» и комнату. Имя хозяйки — displayName как есть, поэтому фразы
 * построены под именительный падеж (склонять чужие имена нельзя).
 * Письмо содержит только СВОЮ бронь гостя — ничего о других.
 */
export function reminderGuestMail(params: ReminderGuestParams): MailContent {
  const date = formatOccasionDate(params.occasionDate);
  const myBookingsUrl = appUrl("/my-bookings");
  const roomUrl = appUrl(`/r/${params.roomSlug}`);

  const subject = `Праздник уже близко — ${date}`;
  const occasionLine = params.ownerName
    ? `${params.ownerName} отмечает праздник ${date} — уже совсем скоро.`
    : `Праздник уже близко: ${date}.`;

  const text = [
    `Здравствуйте, ${params.guestName}!`,
    ``,
    occasionLine,
    `Вы заняли подарок: «${params.itemTitle}».`,
    ``,
    `Посмотреть или снять бронь: ${myBookingsUrl}`,
    `Заглянуть в комнату: ${roomUrl}`,
    ``,
    `Бронь по-прежнему тихая — о ней знаете только вы.`,
  ].join("\n");

  const html = [
    HTML_WRAP,
    `<p style="margin:0 0 16px;">Здравствуйте, ${escapeHtml(params.guestName)}!</p>`,
    `<p style="margin:0 0 16px;">${escapeHtml(occasionLine)}<br/>`,
    `Вы заняли подарок: «${escapeHtml(params.itemTitle)}».</p>`,
    `<p style="margin:0 0 16px;">`,
    `<a href="${escapeHtml(myBookingsUrl)}" style="color:#333333;">Посмотреть или снять бронь</a><br/>`,
    `<a href="${escapeHtml(roomUrl)}" style="color:#333333;">Заглянуть в комнату</a></p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">`,
    `Бронь по-прежнему тихая — о ней знаете только вы.</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}

export async function sendReminderGuest(to: string, params: ReminderGuestParams): Promise<void> {
  await sendMail({ to, ...reminderGuestMail(params) });
}

// ---------- Шаблон: хозяйке после праздника ----------

export interface OccasionOwnerParams {
  /** displayName хозяйки; null — письмо начинается без имени. */
  ownerName: string | null;
  /** Абсолютная ссылка на «что подарили» (appUrl("/room/occasion")). */
  occasionUrl: string;
}

/**
 * «Праздник прошёл — открой „что подарили"». Никаких имён и вещей: имена
 * дарителей раскрываются ровно один раз — на самом экране (инвариант №2).
 */
export function occasionOwnerMail(params: OccasionOwnerParams): MailContent {
  const greeting = params.ownerName ? `${params.ownerName}, привет!` : `Привет!`;

  const subject = `Праздник прошёл — открой «что подарили»`;

  const text = [
    greeting,
    ``,
    `Праздник прошёл, и комната собрала итог.`,
    `Открой «что подарили»: ${params.occasionUrl}`,
    ``,
    `Имена дарителей раскроются, когда откроешь страницу, — ровно один раз.`,
  ].join("\n");

  const html = [
    HTML_WRAP,
    `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px;">Праздник прошёл, и комната собрала итог.<br/>`,
    `<a href="${escapeHtml(params.occasionUrl)}" style="color:#333333;">Открой «что подарили»</a></p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">`,
    `Имена дарителей раскроются, когда откроешь страницу, — ровно один раз.</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}

export async function sendOccasionOwner(to: string, params: OccasionOwnerParams): Promise<void> {
  await sendMail({ to, ...occasionOwnerMail(params) });
}
