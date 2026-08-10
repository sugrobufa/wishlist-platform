// Контракт писем дизайна, раунд 39 (тикет 160): наши письма против
// `design/package/handoff/round39/letters.json` и двух присланных вёрсток.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. `tests/mailer.test.ts` проверяет, что письмо
// собирается и что в нём написано; здесь — что оно СОВПАДАЕТ С КОНТРАКТОМ и
// что вёрстку никто не переписал руками. Правило проекта — заявлениям
// дизайна не верить: всё, что можно сверить счётом, сверяется счётом.
//
// И здесь же сторож ИНВАРИАНТА №1 со стороны почты: письмо хозяйке не имеет
// права назвать ни вещь, ни дарителя, ни цену — ни в теме, ни в теле, ни в
// preheader'е (его видно в списке входящих, и утекает он так же).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mailMessages } from "../src/server/mail-messages";
import { ITEM_GONE_HTML, REMINDER_HTML } from "../src/server/mail-templates";
import {
  itemGoneMail,
  occasionOwnerMail,
  reminderGuestMail,
  type OccasionOwnerParams,
} from "../src/server/mailer";

const ROUND39 = resolve(__dirname, "../design/package/handoff/round39");
const readDesign = (file: string) => readFileSync(join(ROUND39, file), "utf8");

type LettersContract = {
  templates: Record<
    string,
    { trigger: string; subject: string; preheader: string; blocks: string[]; never: string }
  >;
  tokens: string[];
};

const contract = JSON.parse(readDesign("letters.json")) as LettersContract;
const designReminder = readDesign("reminder.html");
const designItemGone = readDesign("item-gone.html");

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

// ---------- Разбор вёрстки ----------

/** Все строки инлайн-стилей по порядку — «скелет» почтовой вёрстки. */
const styles = (html: string) => [...html.matchAll(/style="([^"]*)"/gu)].map((m) => m[1] ?? "");
/** Последовательность ОТКРЫВАЮЩИХ тегов (закрывающие с `/` сюда не попадают). */
const tags = (html: string) =>
  [...html.matchAll(/<([a-z!][a-z0-9]*)/giu)].map((m) => (m[1] ?? "").toLowerCase());

// Знак «G»: у дизайна картинка-плейсхолдер с alt, у нас — текст теми же
// стилями (почему — в шапке mail-templates.ts). Это ЕДИНСТВЕННОЕ расхождение
// вёрстки, и оно названо здесь поимённо.
const MARK_IMG_STYLE =
  "display:block;border:0;outline:none;text-decoration:none;color:#E7C9A9;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;";
const MARK_TD_DESIGN = "padding:0;";
const MARK_TD_OURS =
  "padding:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:22px;mso-line-height-rule:exactly;font-weight:700;color:#E7C9A9;";

const without = (list: readonly string[], ...drop: string[]) => {
  const rest = [...list];
  for (const value of drop) {
    const at = rest.indexOf(value);
    if (at >= 0) rest.splice(at, 1);
  }
  return rest;
};

describe("вёрстка писем — та самая, что прислал дизайн", () => {
  const pairs = [
    ["напоминание", REMINDER_HTML, designReminder],
    ["вещь уехала", ITEM_GONE_HTML, designItemGone],
  ] as const;

  for (const [name, ours, design] of pairs) {
    it(`«${name}»: инлайн-стили совпадают строка в строку и по порядку`, () => {
      // Самая важная проверка файла: если вёрстку начнут править руками —
      // «поправим отступ», «добавим свой блок», — она падает сразу.
      expect(styles(design)).toContain(MARK_IMG_STYLE); // знак у дизайна картинкой
      expect(styles(ours)).not.toContain(MARK_IMG_STYLE); // у нас текстом

      expect(without(styles(ours), MARK_TD_OURS)).toEqual(
        without(styles(design), MARK_IMG_STYLE, MARK_TD_DESIGN),
      );
    });

    it(`«${name}»: последовательность тегов совпадает, кроме убранной картинки`, () => {
      expect(tags(ours)).toEqual(tags(design).filter((tag) => tag !== "img"));
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
    });
  }

  it("в готовом письме нет ни плейсхолдеров дизайна, ни несделанных подстановок", () => {
    for (const mail of [reminder, itemGone]) {
      expect(mail.html).not.toContain("grace.example"); // домен-заглушка
      expect(mail.html).not.toContain("ЗАМЕНИТЬ-НА-ХОСТИНГ");
      expect(mail.html).not.toContain("<img"); // хостинга под знак у нас нет
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
    expect(reminder.subject).toBe(drift?.replace("{when}", "Через три дня").replace("{name}", "Мила"));
  });

  it("оба письма несут блоки, перечисленные контрактом", () => {
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
    expect(itemGone.html).toContain("больше нет в комнате");
    expect(itemGone.html).toContain(">Посмотреть комнату</a>");
    expect(itemGone.html).toContain("свободно ещё 19 вещей");
    expect(itemGone.html).toContain("Праздник — 14 марта");
  });

  it("все токены контракта в письмах действительно подставляются", () => {
    // {name} {item} {price} {zone} {date} {link} — шесть штук, и каждый обязан
    // где-то отработать, иначе контракт принят на словах.
    expect(contract.tokens).toHaveLength(6);
    const both = `${reminder.html}\n${itemGone.html}`.replace(/ /gu, " ");
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

  it("шаблон письма хозяйке физически не принимает ни вещь, ни имя, ни цену", () => {
    // Проверка ТИПОМ: добавить в параметры письма `itemTitle` или `giverName`
    // молча нельзя — не соберётся ни `npm run typecheck`, ни этот тест.
    const onlyTwo: ExactKeys<keyof OccasionOwnerParams, "ownerName" | "occasionUrl"> = true;
    expect(onlyTwo).toBe(true);
  });

  it("в словаре письма хозяйке единственная подстановка — её собственное имя", () => {
    // Ни {item}, ни {giver}, ни {price}, ни {count}: назвать их письму нечем.
    expect(slotsOf(mailMessages.OccasionMail)).toEqual(["name"]);
  });

  it("собранное письмо хозяйке не содержит ни вещи, ни дарителя, ни цены", () => {
    const owner = occasionOwnerMail({
      ownerName: "Мила",
      occasionUrl: "https://rooms.test/room/occasion",
    });
    // preheader'а у этого письма нет вовсе — в списке входящих клиент покажет
    // первую строку тела, а она про праздник и ссылку.
    const everything = `${owner.subject}\n${owner.text}\n${owner.html}`;
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

  it("гостевые письма не считают чужие брони: слотов под счётчик нет", () => {
    // Обратная сторона того же инварианта. У напоминания подстановки ровно
    // пять, и ни одной про других гостей; у «вещь уехала» есть {free} — это
    // СВОБОДНЫЕ вещи (их гость и так видит на странице комнаты) и {count} для
    // её числительного.
    expect(slotsOf(mailMessages.ReminderMail)).toEqual(["date", "item", "name", "when", "zone"]);
    expect(slotsOf(mailMessages.ItemGoneMail)).toEqual(["count", "date", "free", "item", "name"]);
  });
});
