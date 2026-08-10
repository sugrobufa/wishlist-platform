// Почтовая ВЁРСТКА трёх писем — контракт дизайна, раунд 41 (тикет 171).
// Источник: `design/package/handoff/round41/reminder.html`, `item-gone.html`
// и новый `after-party.html` (письмо хозяйке после праздника).
//
// ЭТО НЕ НАША РАЗМЕТКА, И ПЕРЕПИСЫВАТЬ ЕЁ РУКАМИ НЕЛЬЗЯ. Таблицы, ширина 600,
// стили инлайн, `mso-line-height-rule` — всё это написано ради почтовых
// клиентов, а не ради красоты: Outlook рисует письма движком Word, Gmail
// вырезает <style> и внешние таблицы стилей. Файлы дизайна скопированы сюда
// байт в байт; менялись только ТЕКСТОВЫЕ УЗЛЫ — на месте примеров («Мила»,
// «Шёлковый шарф», «7 900 ₽») стоят подстановки `{токен}`, а слова живут в
// `mail-messages.ts`, как и у всех прочих писем (тикет 32).
//
// СВЕРКА С ПАКЕТОМ — МАШИННАЯ. `tests/mail-round41.test.ts` разбирает три
// файла дизайна и три шаблона отсюда и сравнивает СТРОКИ ИНЛАЙН-СТИЛЕЙ и
// последовательность тегов. Любая правка разметки руками ломает тест — ровно
// этого мы и хотим.
//
// ОТСТУПЛЕНИЙ ОТ ФАЙЛОВ ДИЗАЙНА БОЛЬШЕ НЕТ — оба, записанные тикетом 160,
// раунд 41 закрыл сам, и обоими способами, которые мы и предлагали письмом:
//
// 1. Картинка знака (`<img src="https://ЗАМЕНИТЬ-НА-ХОСТИНГ/grace-mark.png"
//    alt="G">` плюс «race» текстом рядом) УБРАНА ДИЗАЙНОМ: шапка письма —
//    слово «Grace» обычным HTML-текстом одной ячейкой. Мы пришли к этому
//    независимо и держали текстом ту же ячейку; теперь это не отступление, а
//    сам контракт («Вы пошли тем же путём независимо от нас», letters.json →
//    rules.noImages). Картинок в письмах нет ни одной.
// 2. `https://grace.example/unsubscribe` — ССЫЛКИ ОТПИСКИ БОЛЬШЕ НЕТ И В
//    ПАКЕТЕ. Мы её не ставили (страницы `/unsubscribe` не существует, а
//    мёртвая ссылка хуже отсутствия) и занимали место в подвале дорогой «Мои
//    подарки»; раунд 41 убрал из подвала ссылку целиком и написал то же самое
//    словами: «Почта осталась при брони — только ради этого письма… Рассылки
//    нет». Берём подвал как есть — ссылок в нём теперь ноль у всех трёх писем.
//    Настоящая отписка = поле в БД + маршрут, это по-прежнему отдельный тикет.
//
// ИМЯ ПЛОЩАДКИ подставляется токеном `{brand}` из единственного ключа продукта
// (`Brand.name`, см. mail-messages) — в файлах дизайна на его месте стоит
// «Grace» текстом.
//
// ТОКЕНЫ подставляет `renderMailTemplate` — значения экранируются, шаблон
// нет. Фигурные скобки в этой разметке встречаются ТОЛЬКО в токенах: ни
// одного `<style>`, ни одного `<script>`, ни одной CSS-фигурной скобки.

/**
 * Напоминание гостю за три дня до праздника (`reminder.html`).
 *
 * Токены: `{subject}` `{preheader}` `{brand}` `{overline}` `{when}` `{title}`
 * `{quiet}` `{item}` `{meta}` `{link}` `{cta}` `{tailLead}` `{tailAction}`
 * `{tailTrail}` `{footer}` `{signature}`.
 */
export const REMINDER_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:#14100D;">
<span style="display:none;font-size:1px;color:#14100D;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{preheader}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#14100D;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;"><tr><td style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:24px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;letter-spacing:-.01em;">{brand}</td></tr>
<tr><td style="background:#1B1613;border:1px solid #2A231D;padding:32px 32px 28px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:.16em;text-transform:uppercase;color:#B4A99C;padding:0 0 14px 0;">{overline}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;padding:0 0 14px 0;">{when}<br>{title}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#CFC5B8;padding:0 0 24px 0;">{quiet}</td></tr>
    <tr><td style="padding:0 0 24px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#211A16;border-left:2px solid #E7C9A9;">
        <tr><td style="padding:16px 18px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:22px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;">{item}</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;mso-line-height-rule:exactly;color:#B4A99C;padding-top:6px;">{meta}</div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 0 18px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#E7C9A9" style="background:#E7C9A9;padding:15px 26px;">
          <a href="{link}" style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;mso-line-height-rule:exactly;font-weight:700;color:#241A0E;text-decoration:none;">{cta}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:#B4A99C;">{tailLead} <a href="{link}" style="color:#E7C9A9;text-decoration:underline;">{tailAction}</a>{tailTrail}</td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 4px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;mso-line-height-rule:exactly;color:#8E8579;">
{footer}<br><br>
{signature}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

/**
 * Гостю: вещь уехала из комнаты, бронь снята (`item-gone.html`).
 *
 * Токены: `{subject}` `{preheader}` `{brand}` `{overline}` `{title}`
 * `{titleTail}` `{body}` `{link}` `{cta}` `{tail}` `{footer}` `{signature}`.
 */
export const ITEM_GONE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:#14100D;">
<span style="display:none;font-size:1px;color:#14100D;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{preheader}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#14100D;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;"><tr><td style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:24px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;letter-spacing:-.01em;">{brand}</td></tr>
<tr><td style="background:#1B1613;border:1px solid #2A231D;padding:32px 32px 28px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:.16em;text-transform:uppercase;color:#B4A99C;padding:0 0 14px 0;">{overline}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;padding:0 0 14px 0;">{title}<br>{titleTail}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#CFC5B8;padding:0 0 24px 0;">{body}</td></tr>
    <tr><td style="padding:0 0 18px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#E7C9A9" style="background:#E7C9A9;padding:15px 26px;">
          <a href="{link}" style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;mso-line-height-rule:exactly;font-weight:700;color:#241A0E;text-decoration:none;">{cta}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:#B4A99C;">{tail}</td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 4px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;mso-line-height-rule:exactly;color:#8E8579;">
{footer}<br><br>
{signature}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

/**
 * ХОЗЯЙКЕ после праздника (`after-party.html`, раунд 41 — новый шаблон).
 * До него это письмо собиралось нашей простой разметкой (тикет 12): дизайн
 * его не рисовал, и в контракте шаблона не было.
 *
 * ЭТО САМОЕ МОЛЧАЛИВОЕ ПИСЬМО ПРОДУКТА. Слов о подарках в нём нет вовсе: ни
 * вещи, ни имени дарителя, ни цены, ни счётчика — только приглашение открыть
 * «что подарили» (инвариант №1, и правило самого контракта: «если из письма
 * можно узнать хоть одно число о подарках — оно неверно свёрстано»). Поэтому
 * подстановок у него ровно две — ссылка и имя площадки, — и ни одна из них не
 * умеет принести сюда чужую тайну. Проверено тестом с двух сторон: типом
 * параметров и составом словаря.
 *
 * Токены: `{subject}` `{preheader}` `{brand}` `{overline}` `{title}` `{body}`
 * `{link}` `{cta}` `{tail}` `{footer}` `{signature}`.
 */
export const AFTER_PARTY_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:#14100D;">
<span style="display:none;font-size:1px;color:#14100D;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{preheader}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#14100D;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;"><tr><td style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:24px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;letter-spacing:-.01em;">{brand}</td></tr>
<tr><td style="background:#1B1613;border:1px solid #2A231D;padding:32px 32px 28px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:.16em;text-transform:uppercase;color:#B4A99C;padding:0 0 14px 0;">{overline}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;mso-line-height-rule:exactly;font-weight:700;color:#F2EDE4;padding:0 0 14px 0;">{title}</td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#CFC5B8;padding:0 0 24px 0;">{body}</td></tr>
    <tr><td style="padding:0 0 18px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#E7C9A9" style="background:#E7C9A9;padding:15px 26px;">
          <a href="{link}" style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;mso-line-height-rule:exactly;font-weight:700;color:#241A0E;text-decoration:none;">{cta}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;mso-line-height-rule:exactly;color:#B4A99C;">{tail}</td></tr>
  </table>
</td></tr>
<tr><td style="padding:24px 4px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;mso-line-height-rule:exactly;color:#8E8579;">
{footer}<br><br>
{signature}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
