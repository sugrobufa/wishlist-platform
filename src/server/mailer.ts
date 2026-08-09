// Общий почтовый транспорт (тикет 12) — единственное место, откуда проект
// отправляет письма. EMAIL_SERVER задан → nodemailer (динамический импорт,
// как в auth.ts Phase 0); не задан (dev) → письмо печатается в консоль
// рамкой «✉ [письмо] кому / тема / текст». Здесь же живут шаблоны писем
// цикла дарения (spec, решение гриллинга №7): reminderGuestMail — гостю за
// 3 дня до праздника, occasionOwnerMail — хозяйке после, itemGoneMail —
// гостю, когда занятая им вещь уехала в сокровищницу (тикет 124, раунд 28).
// Тон — тихий и тёплый (CLAUDE.md), только ru (Phase 1).
//
// ПИСЬМА ПРО БРОНИ ЕСТЬ ТОЛЬКО У ГОСТЯ. Хозяйке о бронях не пишет ни один
// шаблон — ни о появлении, ни о снятии (инвариант №1).
//
// СЛОВА ЖИВУТ НЕ ЗДЕСЬ (тикет 32): все строки писем — в `mail-messages.ts`,
// серверном словаре вне next-intl (почему именно там — комментарий в самом
// файле). В этом модуле остались сборка, ссылки и отправка.
//
// ИНВАРИАНТ №1 (тихая бронь): письмо хозяйке не упоминает ни вещей, ни
// имён — шаблон физически принимает только имя хозяйки и ссылку на
// «что подарили». Покрыто тестом (tests/mailer.worker.test.ts).

import type { Transporter } from "nodemailer";
import { brandName, fillMail, mailMessages } from "./mail-messages";

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

// ---------- Тестовый шов e2e (тикет 15) ----------

/** Строка NDJSON в E2E_MAIL_FILE: письмо или magic link, ушедшие из mailer. */
type MailFileRecord = {
  kind: "mail" | "magic-link";
  to: string;
  subject?: string;
  url?: string;
  at: string;
};

/**
 * E2E_MAIL_FILE задан (только e2e-прогоны, playwright.config.ts) → каждое
 * «письмо» и magic link ДОПОЛНИТЕЛЬНО дописываются строкой NDJSON в файл:
 * e2e/full-cycle.spec.ts достаёт оттуда ссылку входа и письмо occasion-owner.
 * Флаг пуст (dev/prod) — ветка мертва: консоль и SMTP байт-в-байт прежние.
 * Шов не имеет права ломать отправку — сбой записи глотается с console.error.
 */
async function appendToMailFile(record: MailFileRecord): Promise<void> {
  const file = process.env.E2E_MAIL_FILE;
  if (!file) return;
  try {
    const [{ appendFile, mkdir }, { dirname }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error(`E2E_MAIL_FILE: не удалось дописать письмо в ${file}:`, error);
  }
}

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
  await appendToMailFile({ kind: "mail", to, subject, at: new Date().toISOString() });
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
  await appendToMailFile({ kind: "magic-link", to, url, at: new Date().toISOString() });
  if (!process.env.EMAIL_SERVER) {
    console.log(`\n✉  [magic link] ${to}\n   ${url}\n`);
    return;
  }
  await sendMail({ to, ...signInMail(url) });
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

/**
 * Подстановка значений в строку словаря для HTML. Экранируется результат
 * целиком: строки словаря — обычная проза без разметки, а пользовательский
 * ввод (имя, название вещи) внутри них после этого безопасен наверняка.
 */
function fillHtml(template: string, values: Record<string, string>): string {
  return escapeHtml(fillMail(template, values));
}

/**
 * Подпись письма — имя площадки (тикет 58). Имя приходит из ЕДИНСТВЕННОГО
 * ключа продукта (`Brand.name`, см. mail-messages), поэтому здесь только
 * подстановка. Строка одна и та же у всех трёх писем: человек узнаёт, от кого
 * письмо, до того как перейдёт по ссылке.
 */
function signature(): string {
  return fillMail(mailMessages.Common.signature, { brand: brandName });
}

/** Та же подпись серым, последним абзацем письма. */
function signatureHtml(): string {
  return `<p style="margin:20px 0 0;color:#888888;font-size:13px;">${escapeHtml(signature())}</p>`;
}

// ---------- Шаблон: письмо входа ----------

/**
 * Magic link словами: одна ссылка и честный срок её жизни. Сам адрес не
 * трогаем — он приходит готовым из Auth.js (src/server/auth.ts).
 */
export function signInMail(url: string): MailContent {
  const t = mailMessages.SignInMail;

  const text = [t.body, ``, url, ``, t.hint, ``, signature()].join("\n");

  const html = [
    HTML_WRAP,
    `<p style="margin:0 0 16px;">${escapeHtml(t.body)}</p>`,
    `<p style="margin:0 0 16px;">`,
    `<a href="${escapeHtml(url)}" style="color:#333333;">${escapeHtml(t.link)}</a></p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">${escapeHtml(t.hint)}</p>`,
    signatureHtml(),
    `</div>`,
  ].join("");

  return { subject: fillMail(t.subject, { brand: brandName }), text, html };
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
 * «Мила отмечает праздник 14 марта, подарок за тобой» + ссылки на «Мои
 * подарки» и комнату. Имя хозяйки — displayName как есть, поэтому фразы
 * построены под именительный падеж (склонять чужие имена нельзя).
 * Письмо содержит только СВОЮ бронь гостя — ничего о других.
 */
export function reminderGuestMail(params: ReminderGuestParams): MailContent {
  const t = mailMessages.ReminderMail;
  const date = formatOccasionDate(params.occasionDate);
  const myBookingsUrl = appUrl("/my-bookings");
  const roomUrl = appUrl(`/r/${params.roomSlug}`);

  const values = {
    name: params.guestName,
    owner: params.ownerName ?? "",
    item: params.itemTitle,
    date,
  };
  // Без displayName хозяйки фраза строится без неё — «null» в письме не место.
  const occasion = params.ownerName ? t.occasion : t.occasionNoName;

  const text = [
    fillMail(t.greeting, values),
    ``,
    fillMail(occasion, values),
    fillMail(t.taken, values),
    ``,
    `${t.bookings} — ${t.bookingsHint}: ${myBookingsUrl}`,
    `${t.room}: ${roomUrl}`,
    ``,
    t.quiet,
    ``,
    signature(),
  ].join("\n");

  const html = [
    HTML_WRAP,
    `<p style="margin:0 0 16px;">${fillHtml(t.greeting, values)}</p>`,
    `<p style="margin:0 0 16px;">${fillHtml(occasion, values)}<br/>`,
    `${fillHtml(t.taken, values)}</p>`,
    `<p style="margin:0 0 16px;">`,
    `<a href="${escapeHtml(myBookingsUrl)}" style="color:#333333;">${escapeHtml(t.bookings)}</a>`,
    ` — ${escapeHtml(t.bookingsHint)}<br/>`,
    `<a href="${escapeHtml(roomUrl)}" style="color:#333333;">${escapeHtml(t.room)}</a></p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">${escapeHtml(t.quiet)}</p>`,
    signatureHtml(),
    `</div>`,
  ].join("");

  return { subject: fillMail(t.subject, values), text, html };
}

export async function sendReminderGuest(to: string, params: ReminderGuestParams): Promise<void> {
  await sendMail({ to, ...reminderGuestMail(params) });
}

// ---------- Шаблон: гостю, когда вещь уехала в сокровищницу ----------

export interface ItemGoneParams {
  /** Имя гостя из его же брони; пустое — письмо здоровается без имени. */
  guestName: string;
  itemTitle: string;
  roomSlug: string;
}

/**
 * «Подарок больше не нужен» (тикет 124, раунд 28): хозяйка перенесла вещь в
 * сокровищницу, бронь снялась молча, и гость обязан узнать об этом ДО
 * праздника — иначе он придёт с подарком, который у хозяйки уже есть.
 *
 * ПИСЬМО ИДЁТ ТОЛЬКО ГОСТЮ и ничего не говорит о других бронях. Хозяйке о нём
 * не сообщается ничем, и ни один её экран от него не зависит (инвариант №1):
 * сервер отвечает на переезд одинаково независимо от того, была бронь или нет.
 */
export function itemGoneMail(params: ItemGoneParams): MailContent {
  const t = mailMessages.ItemGoneMail;
  const myBookingsUrl = appUrl("/my-bookings");
  const roomUrl = appUrl(`/r/${params.roomSlug}`);
  const values = { name: params.guestName, item: params.itemTitle };
  // Имени нет — здороваемся без него и называем вещь общей фразой.
  const greeting = params.guestName ? fillMail(t.greeting, values) : null;
  const body = params.itemTitle ? fillMail(t.body, values) : t.bodyNoName;

  const text = [
    ...(greeting ? [greeting, ``] : []),
    body,
    ``,
    `${t.room}: ${roomUrl}`,
    `${t.bookings} — ${t.bookingsHint}: ${myBookingsUrl}`,
    ``,
    t.quiet,
    ``,
    signature(),
  ].join("\n");

  const html = [
    HTML_WRAP,
    ...(greeting ? [`<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>`] : []),
    `<p style="margin:0 0 16px;">${escapeHtml(body)}</p>`,
    `<p style="margin:0 0 16px;">`,
    `<a href="${escapeHtml(roomUrl)}" style="color:#333333;">${escapeHtml(t.room)}</a><br/>`,
    `<a href="${escapeHtml(myBookingsUrl)}" style="color:#333333;">${escapeHtml(t.bookings)}</a>`,
    ` — ${escapeHtml(t.bookingsHint)}</p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">${escapeHtml(t.quiet)}</p>`,
    signatureHtml(),
    `</div>`,
  ].join("");

  return { subject: fillMail(t.subject, values), text, html };
}

export async function sendItemGone(to: string, params: ItemGoneParams): Promise<void> {
  await sendMail({ to, ...itemGoneMail(params) });
}

// ---------- Шаблон: хозяйке после праздника ----------

export interface OccasionOwnerParams {
  /** displayName хозяйки; null — письмо начинается без имени. */
  ownerName: string | null;
  /** Абсолютная ссылка на «что подарили» (appUrl("/room/occasion")). */
  occasionUrl: string;
}

/**
 * «Праздник прошёл — посмотри, что подарили»: тема дословно совпадает с
 * баннером в комнате (`Room.occasionBanner`). Никаких имён и вещей: имена
 * дарителей раскрываются ровно один раз — на самом экране (инвариант №2).
 */
export function occasionOwnerMail(params: OccasionOwnerParams): MailContent {
  const t = mailMessages.OccasionMail;
  const values = { name: params.ownerName ?? "" };
  // Имени нет — здороваемся без него, а не с пустотой на его месте.
  const greeting = params.ownerName ? fillMail(t.greeting, values) : t.greetingNoName;

  const text = [
    greeting,
    ``,
    t.body,
    `${t.link}: ${params.occasionUrl}`,
    ``,
    t.reveal,
    ``,
    signature(),
  ].join("\n");

  const html = [
    HTML_WRAP,
    `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px;">${escapeHtml(t.body)}<br/>`,
    `<a href="${escapeHtml(params.occasionUrl)}" style="color:#333333;">${escapeHtml(t.link)}</a></p>`,
    `<p style="margin:0;color:#888888;font-size:13px;">${escapeHtml(t.reveal)}</p>`,
    signatureHtml(),
    `</div>`,
  ].join("");

  return { subject: t.subject, text, html };
}

export async function sendOccasionOwner(to: string, params: OccasionOwnerParams): Promise<void> {
  await sendMail({ to, ...occasionOwnerMail(params) });
}
