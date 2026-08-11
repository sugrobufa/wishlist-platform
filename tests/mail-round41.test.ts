// Контракт писем дизайна, раунд 41 (тикет 171): наши письма против
// `design/package/handoff/round41/letters.json` и трёх присланных вёрсток.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. `tests/mailer.test.ts` проверяет, что письмо
// собирается и что в нём написано; здесь — что оно СОВПАДАЕТ С КОНТРАКТОМ и
// что вёрстку никто не переписал руками. Правило проекта — заявлениям
// дизайна не верить: всё, что можно сверить счётом, сверяется счётом.
//
// РАУНД 41 ЗАКРЫЛ ОБА НАШИХ ОТСТУПЛЕНИЯ (тикет 160): знак картинкой убран
// самим дизайном (шапка — слово текстом одной ячейкой), ссылка отписки ушла из
// подвала целиком. Поэтому сверка вёрстки здесь СТРОГАЯ: инлайн-стили и теги
// обязаны совпасть один в один, без единого исключения.
//
// РАУНД 42 ЗАКРЫЛ И ГЛАВНУЮ НАХОДКУ РАУНДА 41 — прехедеры обоих гостевых
// писем, которыми контракт нарушал собственное правило рода. Дизайн признал,
// переписал обе строки назывными оборотами и заодно расширил правило на ВСЕ
// поля письма; мы взяли обе строки дословно, и спорить здесь больше не о чем.
// Его дельта перенесена в файлы этого каталога точечно.
//
// И здесь же два сторожа, которых больше нигде нет:
// - ИНВАРИАНТ №1 со стороны почты: письмо хозяйке не имеет права назвать ни
//   вещь, ни дарителя, ни цену, ни ЧИСЛО — ни в теме, ни в теле, ни в
//   preheader'е (его видно в списке входящих, и утекает он так же);
// - ПРЕХЕДЕРЫ: единственное оставшееся расхождение (письмо хозяйке) лежит в
//   именованном списке `PREHEADER_DRIFT` с причиной, а полнота этого списка
//   выводится из данных, а не берётся на слово (см. ниже).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mailMessages } from "../src/server/mail-messages";
import { AFTER_PARTY_HTML, ITEM_GONE_HTML, REMINDER_HTML } from "../src/server/mail-templates";
import {
  itemGoneMail,
  occasionOwnerMail,
  reminderGuestMail,
  type OccasionOwnerParams,
} from "../src/server/mailer";

const ROUND41 = resolve(__dirname, "../design/package/handoff/round41");
const readDesign = (file: string) => readFileSync(join(ROUND41, file), "utf8");

type LettersContract = {
  rules: Record<string, string>;
  templates: Record<
    string,
    { trigger: string; subject: string; preheader: string; blocks: string[]; never?: string }
  >;
  tokens: string[];
};

const contract = JSON.parse(readDesign("letters.json")) as LettersContract;
const designReminder = readDesign("reminder.html");
const designItemGone = readDesign("item-gone.html");
const designAfterParty = readDesign("after-party.html");

const OCCASION_DATE = new Date("2026-03-14T00:00:00.000Z");
const NOW = new Date("2026-03-11T09:00:00.000Z");

const reminder = reminderGuestMail({
  ownerName: "Мила",
  itemTitle: "Серьги-каффы",
  occasionDate: OCCASION_DATE,
  itemZone: "jewelry",
  price: "7900",
  currency: "RUB",
  priceVisibility: "ALL",
  now: NOW,
});

const itemGone = itemGoneMail({
  itemTitle: "Стёганая сумка",
  roomSlug: "mila",
  ownerName: "Мила",
  freeCount: 19,
  occasionDate: OCCASION_DATE,
  now: NOW,
});

const afterParty = occasionOwnerMail({ occasionUrl: "https://rooms.test/room/occasion" });

// ---------- Разбор вёрстки ----------

/** Все строки инлайн-стилей по порядку — «скелет» почтовой вёрстки. */
const styles = (html: string) => [...html.matchAll(/style="([^"]*)"/gu)].map((m) => m[1] ?? "");
/** Последовательность ОТКРЫВАЮЩИХ тегов (закрывающие с `/` сюда не попадают). */
const tags = (html: string) =>
  [...html.matchAll(/<([a-z!][a-z0-9]*)/giu)].map((m) => (m[1] ?? "").toLowerCase());
/** Preheader — скрытый span в самом начале письма; в списке входящих он виден. */
const preheaderOf = (html: string) => /<span[^>]*>([^<]*)<\/span>/u.exec(html)?.[1] ?? "";
/** Видимый текст письма: без тегов, без скрытого preheader'а, с живыми пробелами. */
const visibleText = (html: string) =>
  html
    .replace(/<span[^>]*display:none[^>]*>[\s\S]*?<\/span>/gu, " ")
    .replace(/<head>[\s\S]*?<\/head>/u, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&#8381;/gu, "₽")
    .replace(/\s+/gu, " ")
    .trim();

describe("вёрстка писем — та самая, что прислал дизайн", () => {
  const pairs = [
    ["напоминание", REMINDER_HTML, designReminder],
    ["вещь уехала", ITEM_GONE_HTML, designItemGone],
    ["после праздника", AFTER_PARTY_HTML, designAfterParty],
  ] as const;

  for (const [name, ours, design] of pairs) {
    it(`«${name}»: инлайн-стили совпадают строка в строку и по порядку`, () => {
      // Самая важная проверка файла: если вёрстку начнут править руками —
      // «поправим отступ», «добавим свой блок», — она падает сразу. Раунд 41
      // снял оба прежних исключения, поэтому сравнение теперь без вычетов.
      expect(styles(ours)).toEqual(styles(design));
    });

    it(`«${name}»: последовательность тегов совпадает один в один`, () => {
      expect(tags(ours)).toEqual(tags(design));
    });

    it(`«${name}»: почтовые ограничения соблюдены — таблицы, 600, ни скриптов, ни шрифтов`, () => {
      expect(ours).toContain('width="600"');
      expect(ours).not.toContain("<script");
      expect(ours).not.toContain("<style");
      expect(ours).not.toContain("@font-face");
      expect(ours).not.toContain("linear-gradient"); // заливка, а не полоса света
      expect(ours).not.toContain("box-shadow"); // ореол в почте не рендерится
      expect(ours).toContain("Arial,Helvetica,sans-serif"); // системный стек
      expect(ours).toContain("background:#14100D"); // фон писем, не #0B0806
      expect(ours).not.toContain("<img"); // картинок в письмах нет ни одной
    });
  }

  it("ни одной картинки и ни одной ссылки отписки — оба отступления закрыл сам пакет", () => {
    // Раунд 39 присылал знак картинкой на несуществующий хостинг и ссылку
    // `/unsubscribe`, которой у нас нет; мы отступали от вёрстки в двух местах
    // и записывали это. Раунд 41 убрал и то и другое у себя.
    for (const design of [designReminder, designItemGone, designAfterParty]) {
      expect(design).not.toContain("<img");
      expect(design).not.toContain("unsubscribe");
      expect(design).toContain(">Grace</td>"); // шапка — слово текстом одной ячейкой
    }
    // В подвале ссылок больше нет ни у кого: у нас столько же `<a>`, сколько
    // у дизайна, и это проверено сравнением тегов выше.
    expect(tags(AFTER_PARTY_HTML).filter((tag) => tag === "a")).toHaveLength(1);
  });

  it("в готовом письме нет ни плейсхолдеров дизайна, ни несделанных подстановок", () => {
    for (const mail of [reminder, itemGone, afterParty]) {
      expect(mail.html).not.toContain("grace.example"); // домен-заглушка
      expect(mail.html).not.toContain("ЗАМЕНИТЬ-НА-ХОСТИНГ");
      expect(mail.html).not.toMatch(/\{[a-z]+\}/iu); // ни одного сырого токена
      // Все ссылки письма — свои, от APP_BASE_URL процесса (тикет 158).
      for (const [, href] of mail.html.matchAll(/href="([^"]*)"/gu)) {
        expect(href).toMatch(/^https?:\/\//u);
        expect(href).not.toContain("grace.example");
      }
    }
  });
});

describe("темы и блоки — против letters.json", () => {
  /**
   * НАЗВАННЫЕ РАСХОЖДЕНИЯ С КОНТРАКТОМ. Пусто по умолчанию: слово дизайна
   * сильнее нашего вкуса. Каждая запись обязана иметь причину, и проверка
   * ниже стережёт, что расхождение настоящее, а не выданная вперёд
   * индульгенция (тот же приём, что `PACKAGE_DRIFT` в messages-tone).
   */
  const SUBJECT_DRIFT: Record<string, string> = {
    // «Через три дня праздник у {name}» — родительный падеж, а в displayName
    // лежит «Мила». Склонять чужие имена нельзя (памятка тона: «если фраза
    // требует рода — перепиши фразу»), поэтому имя прикреплено оборотом,
    // которым продукт пользуется всюду: «комната {name}». Плюс «через три
    // дня» — не всегда правда: тик ежечасный, бронь могли занять позже.
    reminder: "{when} праздник — комната {name}",
    // «Праздник прошёл» — правда, но в списке входящих она не зовёт никуда.
    // У нас та же строка, что ждёт хозяйку баннером в комнате
    // (`Room.occasionBanner`): письмо и экран говорят одними словами. Дизайн
    // сам просил прислать свои слова, если они точнее (letters.json → asks).
    afterParty: "Праздник прошёл — посмотри, что подарили",
  };

  it("тема письма «вещь уехала» — дословно контракт", () => {
    expect(itemGone.subject).toBe(contract.templates.itemGone?.subject);
    expect(itemGone.html).toContain(`<title>${contract.templates.itemGone?.subject}</title>`);
  });

  it("тема напоминания расходится с контрактом ровно там, где записано", () => {
    const drift = SUBJECT_DRIFT.reminder;
    expect(drift).toBeDefined();
    // Расхождение настоящее: подставь имя в шаблон контракта — получится не то.
    expect(reminder.subject).not.toBe(
      contract.templates.reminder?.subject.replace("{name}", "Мила"),
    );
    expect(reminder.subject).toBe(
      drift?.replace("{when}", "Через три дня").replace("{name}", "Мила"),
    );
  });

  it("тема письма хозяйке расходится с контрактом ровно там, где записано", () => {
    expect(afterParty.subject).not.toBe(contract.templates.afterParty?.subject);
    expect(afterParty.subject).toBe(SUBJECT_DRIFT.afterParty);
    // И она по-прежнему начинается словами контракта — спорит только хвост.
    expect(afterParty.subject.startsWith(String(contract.templates.afterParty?.subject))).toBe(true);
  });

  it("три письма несут блоки, перечисленные контрактом", () => {
    // По одному зонду на блок — надстрочная, заголовок, тишина брони, плашка
    // вещи, кнопка, тихий выход.
    expect(contract.templates.reminder?.blocks).toHaveLength(6);
    expect(reminder.html).toContain(">Напоминание<");
    expect(reminder.html).toContain("Через три дня<br>");
    expect(reminder.html).toContain("не знает никто");
    expect(reminder.html).toContain("Серьги-каффы");
    expect(reminder.html).toContain(">Открыть мои подарки</a>");
    expect(reminder.html).toContain(">освободить вещь</a>");

    // Надстрочная, заголовок, что случилось, кнопка, сколько свободно и когда.
    expect(contract.templates.itemGone?.blocks).toHaveLength(5);
    expect(itemGone.html).toContain(">Бронь снята<");
    expect(itemGone.html).toContain("Вещь уехала —<br>выбери другую");
    expect(itemGone.html).toContain("больше не в комнате");
    expect(itemGone.html).toContain(">Посмотреть комнату</a>");
    expect(itemGone.html).toContain("свободно ещё 19 вещей");
    expect(itemGone.html).toContain("Праздник — 14 марта");

    // Надстрочная, заголовок, одна строка «есть что посмотреть», кнопка,
    // строка про «дошло».
    expect(contract.templates.afterParty?.blocks).toHaveLength(5);
    expect(afterParty.html).toContain(">После праздника<");
    expect(afterParty.html).toContain(">Праздник прошёл<");
    expect(afterParty.html).toContain("В комнате есть что посмотреть");
    expect(afterParty.html).toContain("Открыть «что подарили»</a>");
    expect(afterParty.html).toContain("вещь уезжает в сокровищницу");
  });

  it("все токены контракта в письмах действительно подставляются", () => {
    // {name} {item} {price} {zone} {date} {link} — шесть штук, и каждый обязан
    // где-то отработать, иначе контракт принят на словах.
    expect(contract.tokens).toHaveLength(6);
    // Цена и разделители плашки набраны НЕРАЗРЫВНЫМИ пробелами (так их ставит
    // и вёрстка дизайна, и Intl) — сравнивать с ними глазами невозможно.
    const both = `${reminder.html}\n${itemGone.html}`.replace(/[\u00A0\u202F]/gu, " ");
    expect(both).toContain("Мила"); // {name}
    expect(both).toContain("Серьги-каффы"); // {item}
    expect(both).toContain("7 900 ₽"); // {price}
    expect(both).toContain("полка «Украшения»"); // {zone}
    expect(both).toContain("14 марта"); // {date}
    expect(both).toMatch(/href="https?:\/\/[^"]+\/my-bookings"/u); // {link}
  });

  it("запреты контракта соблюдены", () => {
    // reminder.never — «не показывать, сколько ещё гостей заняли вещи, и не
    // звать докупить». itemGone.never — «не объяснять ПОЧЕМУ хозяйка убрала».
    expect(contract.templates.reminder?.never).toContain("сколько ещё гостей");
    const words = `${reminder.subject} ${reminder.text} ${reminder.html}`.toLowerCase();
    for (const forbidden of ["уже дарят", "заняли", "ещё гост", "докупи"]) {
      expect(words).not.toContain(forbidden);
    }
    const gone = `${itemGone.subject} ${itemGone.text} ${itemGone.html}`.toLowerCase();
    for (const forbidden of ["потому что она", "уже у хозяйки", "передумала"]) {
      expect(gone).not.toContain(forbidden);
    }
  });
});

/**
 * ГЛАВНАЯ НАХОДКА РАУНДА 41 И ЗАКРЫТЫЙ СЧЁТ РАУНДА 42.
 *
 * Раунд 41: дизайн написал правило рода (`rules.gender`: имя хозяйки может
 * быть мужским, имени гостя мы не знаем вовсе — значит «Ты обещал», «{name}
 * убрала», «ты ничего не должен» запрещены), ПЕРЕПИСАЛ ПО НЕМУ ТЕЛА ОБЕИХ
 * ВЁРСТОК, а прехедеры не тронул: в `letters.json` и в самих HTML остались
 * дословно те три фразы, которые правило перечисляет запрещёнными.
 *
 * Раунд 42: признал целиком и назвал причину, которая дороже самих строк —
 * **прехедер не считали текстом**, потому что в вёрстке он спрятан в
 * невидимом `<span>`, а в макете его нет. Человек читает его в списке
 * входящих второй строкой после темы. Обе строки переписаны назывными
 * оборотами, обе взяты нами ДОСЛОВНО, правило расширено на ВСЕ поля письма.
 *
 * ОСТАЛОСЬ ОДНО РАСХОЖДЕНИЕ, И ОНО НАШЕ — прехедер письма хозяйке. Оно лежит
 * в ИМЕНОВАННОМ СПИСКЕ с причиной, а не держится комментарием: комментарий
 * никто не сверяет, а список — сверяется, и полнота его выводится из данных.
 */
describe("прехедеры — контракт взят дословно, кроме одного названного расхождения", () => {
  /** Фразы, которые правило рода САМО перечисляет запрещёнными. */
  const forbiddenByRule = [...(contract.rules.gender ?? "").matchAll(/«([^»]+)»/gu)].map(
    (found) => found[1] ?? "",
  );

  /** Наш прехедер против контрактного — по именам шаблонов контракта. */
  const OUR_PREHEADER: Record<string, string> = {
    reminder: mailMessages.ReminderMail.preheader,
    itemGone: mailMessages.ItemGoneMail.preheader,
    afterParty: mailMessages.OccasionMail.preheader,
  };

  /**
   * НАЗВАННЫЕ РАСХОЖДЕНИЯ ПО ПРЕХЕДЕРАМ — та же форма, что `SUBJECT_DRIFT`
   * выше, и заведён список ровно потому, что вторая по заметности строка
   * письма заслуживает того же замка, что и первая.
   */
  const PREHEADER_DRIFT: Record<string, string> = {
    // Контрактный «Комната ждёт: посмотри, что подарили» дословно повторил бы
    // НАШУ ТЕМУ («Праздник прошёл — посмотри, что подарили»): две самые
    // заметные строки списка входящих сказали бы одно и то же. Слова взяты
    // его, заменена только вторая половина — на то, чего в теме нет. О правиле
    // рода здесь не спорят: родовых форм в контрактной строке нет.
    afterParty: "Комната ждёт: итог праздника уже собран",
  };

  it("правило рода расширено на ВСЕ поля письма и по-прежнему называет три формы", () => {
    // Список выведен из текста самого правила, а не переписан руками: если
    // дизайн его перепишет — тест велит перечитать, а не проехать мимо.
    expect(contract.rules.gender).toContain("ПРАВИЛО РАСШИРЕНО");
    expect(contract.rules.gender).toContain("ВСЕ поля письма");
    expect(forbiddenByRule).toEqual(["Ты обещал", "{name} убрала", "ты ничего не должен"]);
    // Отдельным правилом прехедер объявлен текстом — это и был весь спор.
    expect(contract.rules.preheaderIsText).toContain("а не служебное поле");
  });

  it("прехедеры контракта больше не нарушают его же правило", () => {
    const everywhere = [
      contract.templates.reminder?.preheader ?? "",
      contract.templates.itemGone?.preheader ?? "",
      // И в самих вёрстках тоже: правка сделана в обоих файлах, а не в одном.
      preheaderOf(designReminder),
      preheaderOf(designItemGone),
      preheaderOf(designAfterParty),
    ].join("\n");

    for (const phrase of forbiddenByRule) {
      // «{name} убрала» в вёрстке стоит примером «Мила убрала» — сравниваем по
      // глаголу, он и несёт род.
      expect(everywhere).not.toContain(phrase.replace("{name} ", ""));
    }
  });

  it("оба гостевых прехедера взяты у контракта ДОСЛОВНО", () => {
    expect(mailMessages.ReminderMail.preheader).toBe(contract.templates.reminder?.preheader);
    expect(mailMessages.ItemGoneMail.preheader).toBe(contract.templates.itemGone?.preheader);
    // И в собранном письме стоит она же — с подставленным названием вещи.
    expect(preheaderOf(reminder.html)).toBe("Подарок за тобой: «Серьги-каффы»");
    expect(preheaderOf(itemGone.html)).toBe(
      "Бронь снята: «Стёганая сумка» больше не в комнате — делать ничего не нужно",
    );
  });

  it("прехедер письма хозяйке расходится с контрактом ровно там, где записано", () => {
    const drift = PREHEADER_DRIFT.afterParty;
    expect(drift).toBeDefined();
    expect(mailMessages.OccasionMail.preheader).toBe(drift);
    expect(preheaderOf(afterParty.html)).toBe(drift);
    // Расхождение НАСТОЯЩЕЕ, а не выданная вперёд индульгенция.
    expect(contract.templates.afterParty?.preheader).not.toBe(drift);
    // И причина жива: контрактный прехедер — это хвост нашей же темы.
    const contractLine = String(contract.templates.afterParty?.preheader);
    expect(contractLine).toContain("посмотри, что подарили");
    expect(afterParty.subject).toContain("посмотри, что подарили");
    expect(drift?.startsWith("Комната ждёт: ")).toBe(true); // первая половина — его
  });

  it("других расхождений по прехедерам нет — список полон, а не выборочен", () => {
    // Замок с той же стороны, что и «записанное расхождение — настоящее»:
    // список выводится из данных, а не берётся на слово.
    const drifted = Object.entries(contract.templates)
      .filter(([name, template]) => OUR_PREHEADER[name] !== template.preheader)
      .map(([name]) => name)
      .sort();
    expect(drifted).toEqual(Object.keys(PREHEADER_DRIFT).sort());
  });

  it("наши прехедеры назывные — ни одной родовой формы", () => {
    const ours = [
      mailMessages.ReminderMail.preheader,
      mailMessages.ItemGoneMail.preheader,
      mailMessages.ItemGoneMail.preheaderNoItem,
      mailMessages.OccasionMail.preheader,
      preheaderOf(reminder.html),
      preheaderOf(itemGone.html),
    ].join("\n");

    for (const phrase of forbiddenByRule) {
      expect(ours).not.toContain(phrase.replace("{name} ", ""));
    }
    expect(mailMessages.ReminderMail.preheader).toBe("Подарок за тобой: «{item}»");
    expect(mailMessages.ItemGoneMail.preheader).toBe(
      "Бронь снята: «{item}» больше не в комнате — делать ничего не нужно",
    );
  });

  it("падежная ловушка развязана и в прехедере, и в теле «вещь уехала»", () => {
    // «Больше нет» требует родительного («шёлкового шарфа»), а {item} приезжает
    // в именительном. Наши обе строки стояли в этой ловушке; лечение назывное.
    for (const line of [
      mailMessages.ItemGoneMail.preheader,
      mailMessages.ItemGoneMail.body,
    ]) {
      expect(line).toContain("{item}");
      expect(line).toContain("больше не в комнате");
      expect(line).not.toContain("больше нет");
    }
    // Строки БЕЗ токена ловушкой не задеты и остаются согласованными.
    for (const line of [
      mailMessages.ItemGoneMail.preheaderNoItem,
      mailMessages.ItemGoneMail.bodyNoItem,
    ]) {
      expect(line).not.toContain("{item}");
      expect(line).toContain("больше нет в комнате");
    }
  });
});

/**
 * СТРОКА ПРО «ДОШЛО» — та, из-за которой раунд 41 записал ЕДИНСТВЕННОЕ
 * отступление от присланной вёрстки. Контракт склеивал две РАЗНЫЕ
 * необратимости в одну фразу («Отметишь „дошло" — вещь уедет в сокровищницу, и
 * ТОГДА ЖЕ станет видно, от кого она»), и это была неправда дважды: имена
 * живых броней видны, как только экран «что подарили» открылся первый раз
 * (`OccasionSummary.revealedAt`, services/occasions.ts), а «Дошло»
 * (`receiveGift`) увозит вещь в сокровищницу и закрепляет имя у неё.
 *
 * РАУНД 42 ПРИНЯЛ ДОВОД ЦЕЛИКОМ — «необратимое действие, поданное как
 * отложенное, лишает человека выбора, о котором он не знал», — и переписал
 * строку сам. Теперь она КОНТРАКТНАЯ и взята дословно: отступлений от вёрсток
 * не осталось ни одного.
 */
describe("две необратимости письма хозяйке не склеены", () => {
  it("строка вёрстки взята дословно и разводит раскрытие имён с «Дошло»", () => {
    const ours = mailMessages.OccasionMail.tail;
    // Дословно из присланной вёрстки, а не пересказ.
    expect(visibleText(designAfterParty)).toContain(ours);
    // Склейки нет ни у нас, ни у него.
    expect(`${ours}\n${visibleText(designAfterParty)}`).not.toContain("тогда же");
    // РАСКРЫТИЕ привязано к открытию страницы и названо однократным.
    expect(ours).toContain("когда её откроешь");
    expect(ours).toContain("один раз и насовсем");
    // «ДОШЛО» названо отдельно и про вещь, а не про имена.
    expect(ours).toContain("вещь уезжает в сокровищницу");
    expect(afterParty.html).toContain(ours);
    expect(afterParty.text).toContain(ours);
  });
});

describe("ИНВАРИАНТ №1 — письмо хозяйке молчит о брони", () => {
  /** Совпадают ли два множества ключей ровно, а не «одно внутри другого». */
  type ExactKeys<A extends string, B extends string> = [A] extends [B]
    ? [B] extends [A]
      ? true
      : false
    : false;

  /** Какие подстановки `{…}` вообще встречаются в секции словаря писем. */
  const slotsOf = (section: Record<string, string>) => {
    const slots = new Set<string>();
    for (const line of Object.values(section)) {
      for (const found of line.matchAll(/\{(\w+)\}/gu)) slots.add(found[1] ?? "");
    }
    return [...slots].sort();
  };

  it("шаблон письма хозяйке физически принимает ОДНУ ссылку и больше ничего", () => {
    // Проверка ТИПОМ: добавить в параметры письма `itemTitle` или `giverName`
    // молча нельзя — не соберётся ни `npm run typecheck`, ни этот тест.
    // С раунда 41 отсюда ушло и имя самой хозяйки: в табличном макете слота
    // под обращение нет, а лишний параметр — это лишняя дорога для утечки.
    const onlyOne: ExactKeys<keyof OccasionOwnerParams, "occasionUrl"> = true;
    expect(onlyOne).toBe(true);
  });

  it("в словаре письма хозяйке нет ни одной подстановки", () => {
    // Ни {item}, ни {giver}, ни {price}, ни {count}, ни даже {name}: назвать
    // их письму нечем.
    expect(slotsOf(mailMessages.OccasionMail)).toEqual([]);
  });

  it("собранное письмо хозяйке не содержит ни вещи, ни дарителя, ни цены", () => {
    const everything = `${afterParty.subject}\n${afterParty.text}\n${afterParty.html}`;
    for (const secret of [
      "Секретный Даритель",
      "Тайная вещь",
      "Серьги-каффы",
      "7 900",
      "₽",
      "занят",
      "бронь",
    ]) {
      expect(everything.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(everything).toContain("https://rooms.test/room/occasion");
  });

  it("НИ ОДНОЙ ЦИФРЫ — правило самого контракта", () => {
    // «Если из письма можно узнать хоть одно число о подарках — оно неверно
    // свёрстано» (templates.afterParty.strictest). Проверяем буквально: цифр
    // нет ни в видимом тексте, ни в теме, ни в прехедере — ни у дизайна, ни у
    // нас. Единственные цифры письма живут в инлайн-стилях и в адресе ссылки.
    for (const html of [designAfterParty, afterParty.html]) {
      expect(visibleText(html)).not.toMatch(/\d/u);
      expect(preheaderOf(html)).not.toMatch(/\d/u);
    }
    expect(afterParty.subject).not.toMatch(/\d/u);
    expect(mailMessages.OccasionMail.preheader).not.toMatch(/\d/u);
    // И ровно одна ссылка — на «что подарили».
    const links = [...afterParty.html.matchAll(/href="([^"]*)"/gu)].map((m) => m[1]);
    expect(links).toEqual(["https://rooms.test/room/occasion"]);
  });

  it("гостевые письма не считают чужие брони: слотов под счётчик нет", () => {
    // Обратная сторона того же инварианта. У напоминания подстановки ровно
    // пять, и ни одной про других гостей; у «вещь уехала» есть {free} — это
    // СВОБОДНЫЕ вещи (их гость и так видит на странице комнаты) и {count} для
    // её числительного.
    expect(slotsOf(mailMessages.ReminderMail)).toEqual(["date", "item", "name", "when", "zone"]);
    expect(slotsOf(mailMessages.ItemGoneMail)).toEqual(["count", "date", "free", "item", "name"]);
  });
});
