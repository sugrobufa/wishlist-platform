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
// ВЁРСТКА ТРЁХ ПИСЕМ ЦИКЛА ДАРЕНИЯ ЖИВЁТ НЕ ЗДЕСЬ (тикеты 160 и 171):
// напоминание, «вещь уехала» и письмо хозяйке после праздника собираются из
// готовых почтовых шаблонов дизайна (`mail-templates.ts`, раунд 41) — таблицы
// и инлайн-стили писал он, мы подставляем значения. Простой разметкой здесь
// собирается только письмо ВХОДА: его дизайн не рисовал.
//
// ИНВАРИАНТ №1 (тихая бронь): письмо хозяйке не упоминает ни вещей, ни имён —
// шаблон физически принимает ОДНУ ссылку на «что подарили» и больше ничего,
// даже её собственного имени. Покрыто тестами (mailer.worker, mail-round41).

import type { Transporter } from "nodemailer";
import { daysUntilOccasion } from "@/app/r/[slug]/welcome";
import { zoneInfo } from "@/config/design";
import { guestSeesPrice } from "@/server/dto/guest-items";
import type { PriceVisibilityDto } from "@/server/dto/items";
import { brandName, fillMail, mailMessages } from "./mail-messages";
import { AFTER_PARTY_HTML, ITEM_GONE_HTML, REMINDER_HTML } from "./mail-templates";

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
  /**
   * Текст письма (тикет 158) — по нему прогон проверяет, что ссылки внутри
   * ведут на адрес e2e-стенда, а не на чужой dev-сервер. Раньше в записи были
   * только «кому» и «тема», и неверный хост в письме прогон не замечал.
   * Переносы строк JSON экранирует сам — NDJSON остаётся однострочным.
   */
  text?: string;
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
  await appendToMailFile({ kind: "mail", to, subject, text, at: new Date().toISOString() });
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

// ПИСЬМО ВХОДА — простой светлый HTML на инлайн-стилях и системном шрифте:
// веб-шрифты продукта (Archivo/Onest) в письма сознательно не тащим. Три
// письма цикла дарения собираются не здесь, а из готовой почтовой вёрстки
// дизайна (mail-templates.ts, раунд 41).
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
 * Подстановка в ГОТОВУЮ ПОЧТОВУЮ ВЁРСТКУ (mail-templates.ts): экранируется
 * КАЖДОЕ ЗНАЧЕНИЕ, а шаблон — нет. Порядок обратный привычному «экранируем
 * результат целиком», и по-другому нельзя: в шаблоне сама разметка,
 * экранируй его — и человек получит письмо с `&lt;table&gt;`.
 *
 * Значения — уже собранные строки (имя, название вещи, цена, ссылки); ни в
 * одной из них разметки нет и быть не должно.
 */
function renderMailTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : escapeHtml(value);
  });
}

/**
 * Шапка письма — имя площадки текстом одной ячейкой (раунд 41). Берётся из
 * ЕДИНСТВЕННОГО ключа имени площадки (`Brand.name`), поэтому переименование
 * остаётся правкой в одном месте; в файлах дизайна на этом месте стоит слово
 * «Grace» тем же начертанием. Картинок в письмах нет ни одной — почему,
 * записано в шапке mail-templates.ts.
 */
function brandCell(): { brand: string } {
  return { brand: brandName };
}

/** «7 900 ₽» — цена вещи для письма; неизвестная валюта не роняет письмо. */
function formatMailPrice(price: string | null, currency: string | null): string | null {
  if (price === null) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency ?? "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${price} ${currency ?? ""}`.trim();
  }
}

/**
 * Разделитель плашки — точка между НЕРАЗРЫВНЫМИ пробелами, как в вёрстке
 * дизайна (`&nbsp;·&nbsp;`). Здесь это настоящие символы U+00A0: экранирование
 * значений их не трогает, а в письме получается то же самое.
 */
const META_SEPARATOR = "\u00A0·\u00A0";

/** Русская форма счётного слова: 1 вещь · 3 вещи · 19 вещей. */
function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
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
  /** displayName хозяйки; null — имени нет, письмо обходится без него. */
  ownerName: string | null;
  itemTitle: string;
  occasionDate: Date;
  /** Ключ зоны вещи (`Item.zone`) — подпись полки берётся из zones.json. */
  itemZone: string | null;
  /** Цена Decimal строкой и её валюта; null — цены у вещи нет. */
  price: string | null;
  currency: string | null;
  /**
   * Настройка хозяйки на момент ОТПРАВКИ. `ME`/`NONE` — цены в письме нет
   * вовсе (инвариант №8): письмо не имеет права показать гостю то, чего ему
   * не показывает комната.
   */
  priceVisibility: PriceVisibilityDto;
  /** «Сейчас» для счёта дней до праздника; в тестах подменяется. */
  now?: Date;
}

/**
 * «Через три дня праздник у Милы» — контракт round41, вёрстка
 * `REMINDER_HTML`. Письмо содержит только СВОЮ бронь гостя: ни одного слова
 * о других гостях и о том, сколько вещей уже заняли (запрет контракта и
 * инвариант №1 с другой стороны).
 *
 * Имя хозяйки — displayName как есть, поэтому фразы построены под
 * именительный падеж (склонять чужие имена нельзя), а прошедшего времени в
 * них нет: рода мы не знаем ни у хозяйки, ни у гостя.
 */
export function reminderGuestMail(params: ReminderGuestParams): MailContent {
  const t = mailMessages.ReminderMail;
  const now = params.now ?? new Date();
  const date = formatOccasionDate(params.occasionDate);
  const link = appUrl("/my-bookings");

  // «Через три дня» — правда не всегда: тик ежечасный, а бронь могли занять,
  // когда до праздника оставалось меньше. Счёт дней — общий с продуктом
  // (welcome.daysUntilOccasion, те же UTC-сутки, что у formatOccasionDate).
  const days = daysUntilOccasion(params.occasionDate.toISOString().slice(0, 10), now);
  const when =
    days === 0
      ? t.whenToday
      : days === 1
        ? t.whenTomorrow
        : days === 2
          ? t.when2
          : days === 3
            ? t.when3
            : t.whenSoon;

  const named = params.ownerName !== null && params.ownerName !== "";
  const values = { name: params.ownerName ?? "", item: params.itemTitle, date, when };

  // Плашка вещи: «7 900 ₽ · полка «Одежда» · комната Милы». Каждая часть
  // пропадает молча, если её нет: цены у вещи, подписи у зоны, имени у
  // хозяйки. Скрытая цена (ME/NONE) — тот же случай, что «цены нет».
  const price = guestSeesPrice(params.priceVisibility)
    ? formatMailPrice(params.price, params.currency)
    : null;
  const zoneLabel = params.itemZone === null ? null : (zoneInfo(params.itemZone)?.label ?? null);
  const meta = [
    price,
    zoneLabel === null ? null : fillMail(t.zone, { zone: zoneLabel }),
    named ? fillMail(t.room, values) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(META_SEPARATOR);

  const subject = fillMail(named ? t.subject : t.subjectNoName, values);
  const title = fillMail(named ? t.title : t.titleNoName, values);
  const quiet = fillMail(named ? t.quiet : t.quietNoName, values);
  const tailTrail = fillMail(named ? t.tailTrail : t.tailTrailNoName, values);

  const text = [
    subject,
    ``,
    quiet,
    ``,
    params.itemTitle,
    ...(meta === "" ? [] : [meta]),
    ``,
    `${t.bookings} — ${t.bookingsHint}: ${link}`,
    ``,
    `${t.tailLead} ${t.tailAction}${tailTrail}`,
    ``,
    signature(),
  ].join("\n");

  const html = renderMailTemplate(REMINDER_HTML, {
    subject,
    preheader: fillMail(t.preheader, values),
    ...brandCell(),
    overline: t.overline,
    when,
    title,
    quiet,
    item: params.itemTitle,
    meta,
    link,
    cta: t.cta,
    tailLead: t.tailLead,
    tailAction: t.tailAction,
    tailTrail,
    footer: t.footer,
    signature: signature(),
  });

  return { subject, text, html };
}

export async function sendReminderGuest(to: string, params: ReminderGuestParams): Promise<void> {
  await sendMail({ to, ...reminderGuestMail(params) });
}

// ---------- Шаблон: гостю, когда вещь уехала в сокровищницу ----------

export interface ItemGoneParams {
  itemTitle: string;
  roomSlug: string;
  /** displayName хозяйки; null — фраза строится без имени. */
  ownerName: string | null;
  /**
   * Сколько вещей комнаты свободно на момент ОТПРАВКИ; null — не считали
   * (комната пропала). Считает `countFreeGiftsByRoom` — то же правило, что
   * показывает сама комната, чтобы письмо и страница не спорили числами.
   */
  freeCount: number | null;
  /** Дата праздника комнаты; null — даты нет или праздник уже прошёл. */
  occasionDate: Date | null;
  /** «Сейчас» — прошедший праздник в письме не называем. */
  now?: Date;
}

/**
 * «Вещь уехала — выбери другую» (тикет 124, раунд 28; слова и вёрстка —
 * контракт round41, `ITEM_GONE_HTML`): вещь ушла из комнаты, бронь снялась
 * молча, и гость обязан узнать об этом ДО праздника — иначе он придёт с
 * подарком, которого в комнате уже нет.
 *
 * ПОЧЕМУ вещь уехала, письмо не говорит: правило контракта («мы этого не
 * знаем, а догадка обидна»).
 *
 * ПИСЬМО ИДЁТ ТОЛЬКО ГОСТЮ и ничего не говорит о других бронях. Хозяйке о нём
 * не сообщается ничем, и ни один её экран от него не зависит (инвариант №1):
 * сервер отвечает на переезд одинаково независимо от того, была бронь или нет.
 */
export function itemGoneMail(params: ItemGoneParams): MailContent {
  const t = mailMessages.ItemGoneMail;
  const bookingsUrl = appUrl("/my-bookings");
  const roomUrl = appUrl(`/r/${params.roomSlug}`);
  const named = params.ownerName !== null && params.ownerName !== "";
  const values = { name: params.ownerName ?? "", item: params.itemTitle };

  const body = params.itemTitle ? fillMail(t.body, values) : t.bodyNoItem;
  const preheader = params.itemTitle ? fillMail(t.preheader, values) : t.preheaderNoItem;

  // «Сколько свободно и когда праздник». Обе половины необязательны: пустая
  // комната про свободные вещи молчит, комната без даты — про праздник.
  const free =
    params.freeCount === null || params.freeCount <= 0
      ? null
      : fillMail(named ? t.free : t.freeNoName, {
          ...values,
          free: fillMail(
            pluralRu(params.freeCount, t.thingsOne, t.thingsFew, t.thingsMany),
            { count: String(params.freeCount) },
          ),
        });
  const occasionAhead =
    params.occasionDate !== null &&
    daysUntilOccasion(
      params.occasionDate.toISOString().slice(0, 10),
      params.now ?? new Date(),
    ) !== null;
  const occasion =
    params.occasionDate === null || !occasionAhead
      ? null
      : fillMail(t.occasion, { date: formatOccasionDate(params.occasionDate) });
  const tail = [free, occasion].filter((part): part is string => part !== null).join(". ");

  const text = [
    body,
    ``,
    `${t.cta}: ${roomUrl}`,
    `${t.bookings} — ${t.bookingsHint}: ${bookingsUrl}`,
    ...(tail === "" ? [] : [``, tail]),
    ``,
    signature(),
  ].join("\n");

  const html = renderMailTemplate(ITEM_GONE_HTML, {
    subject: t.subject,
    preheader,
    ...brandCell(),
    overline: t.overline,
    title: t.title,
    titleTail: t.titleTail,
    body,
    link: roomUrl,
    cta: t.cta,
    tail,
    footer: t.footer,
    signature: signature(),
  });

  return { subject: t.subject, text, html };
}

export async function sendItemGone(to: string, params: ItemGoneParams): Promise<void> {
  await sendMail({ to, ...itemGoneMail(params) });
}

// ---------- Шаблон: хозяйке после праздника ----------

export interface OccasionOwnerParams {
  /** Абсолютная ссылка на «что подарили» (appUrl("/room/occasion")). */
  occasionUrl: string;
}

/**
 * «Праздник прошёл — посмотри, что подарили» (контракт round41, вёрстка
 * `AFTER_PARTY_HTML`, тикет 171): тема дословно совпадает с баннером в
 * комнате (`Room.occasionBanner`), а внутри — одно приглашение открыть экран.
 *
 * ЭТО САМОЕ МОЛЧАЛИВОЕ ПИСЬМО ПРОДУКТА, и молчит оно НЕ ПО ДОГОВОРЁННОСТИ, А
 * ПО УСТРОЙСТВУ: параметр у него ровно один — ссылка. Ни вещи, ни имени
 * дарителя, ни цены, ни счётчика сюда физически неоткуда взять (инвариант
 * №1). С раунда 41 у письма нет и имени самой хозяйки: в табличном макете
 * слота под обращение нет, а заводить его ради «Привет» значило бы открыть
 * шаблону дорогу к строкам, которых он знать не должен.
 *
 * ПОСЛЕДНЯЯ СТРОКА ПИСЬМА РАЗВОДИТ ДВЕ НЕОБРАТИМОСТИ, которые контракт
 * склеил: имена раскрывает ПЕРВОЕ ОТКРЫТИЕ экрана (`revealedAt`), а «Дошло»
 * увозит вещь в сокровищницу и закрепляет имя у неё (`receiveGift`).
 * Подробности — в комментарии к `OccasionMail.tail`.
 */
export function occasionOwnerMail(params: OccasionOwnerParams): MailContent {
  const t = mailMessages.OccasionMail;

  const text = [
    t.title,
    ``,
    t.body,
    `${t.cta}: ${params.occasionUrl}`,
    ``,
    t.tail,
    ``,
    signature(),
  ].join("\n");

  const html = renderMailTemplate(AFTER_PARTY_HTML, {
    subject: t.subject,
    preheader: t.preheader,
    ...brandCell(),
    overline: t.overline,
    title: t.title,
    body: t.body,
    link: params.occasionUrl,
    cta: t.cta,
    tail: t.tail,
    footer: t.footer,
    signature: signature(),
  });

  return { subject: t.subject, text, html };
}

export async function sendOccasionOwner(to: string, params: OccasionOwnerParams): Promise<void> {
  await sendMail({ to, ...occasionOwnerMail(params) });
}
