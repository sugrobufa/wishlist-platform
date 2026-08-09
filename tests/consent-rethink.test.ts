// «Передумать» в «Моих подарках» — строка, подтверждение, действие (тикет 128).
//
// ЗАЧЕМ ТЕСТ. Тикет 98b собрал это место на своих словах и двух голых кнопках
// «да / нет»: нажал — и ответ уехал на сервер. Дизайн прислал десять
// канонических строк (`Consent.rethink*`) и другую механику: у каждой стороны
// СВОЁ подтверждение, которое объясняет последствие, и только согласие меняет
// ответ. Ломается такое не переписыванием экрана, а одной «упрощающей»
// правкой — вернуть мгновенное нажатие или подставить чужой вопрос не той
// стороне. Поэтому здесь проверяются три вещи: слова (дословно из словаря),
// выбор стороны (чистой функцией) и то, что переключателю НЕЧЕМ ответить —
// `onAnswer` до него не доходит.
//
// Замок к тесту не относится: он серверный и проверен в connections.test.ts
// («запирает не календарь, а закрытие итога»). Здесь только подача.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RethinkConfirm,
  RethinkRow,
  RethinkSwitch,
  rethinkQuestion,
  type RethinkWords,
} from "../src/app/my-bookings/rethink-row";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rowSource = read("../src/app/my-bookings/rethink-row.tsx");
const listSource = read("../src/app/my-bookings/bookings-list.tsx");
const packageDictionary = JSON.parse(read("../design/package/handoff/messages-ru.json")) as Record<
  string,
  Record<string, string>
>;

/** Слова взяты приметными, чтобы в разметке их нельзя было спутать. */
const WORDS: RethinkWords = {
  row: "СТРОКА",
  onTitle: "ЗАГОЛОВОК-ПОКАЗАТЬСЯ",
  onBody: "ОБЪЯСНЕНИЕ-ПОКАЗАТЬСЯ",
  onYes: "ДА-ПОКАЖИ",
  offTitle: "ЗАГОЛОВОК-ТИХО",
  offBody: "ОБЪЯСНЕНИЕ-ТИХО",
  offYes: "ДА-ТИХО",
  keep: "ОСТАВИТЬ",
  locked: "ЗАПЕРТО",
};

/**
 * Кнопки из дерева элементов, по порядку. Компоненты `RethinkSwitch` и
 * `RethinkConfirm` хуков не держат — их можно позвать функцией и нажать на
 * то, что они вернули. Настоящего DOM в прогоне нет (vitest здесь `node`),
 * а проверять надо именно нажатие.
 */
function buttons(node: ReactNode): Array<{ onClick?: () => void; disabled?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; onClick?: () => void; disabled?: boolean };
  const inner = buttons(props.children);
  return node.type === "button"
    ? [{ onClick: props.onClick, disabled: props.disabled }, ...inner]
    : inner;
}

describe("слова — из словаря дизайна, а не наши", () => {
  const KEYS = [
    "rethinkRow",
    "rethinkOnTitle",
    "rethinkOnBody",
    "rethinkOnYes",
    "rethinkOffTitle",
    "rethinkOffBody",
    "rethinkOffYes",
    "rethinkKeep",
    "rethinkLocked",
  ] as const;

  it("девять строк перенесены дословно из handoff/messages-ru.json", () => {
    const mine = Object.fromEntries(KEYS.map((key) => [key, ru.Consent[key]]));
    const theirs = Object.fromEntries(KEYS.map((key) => [key, packageDictionary.Consent?.[key]]));
    expect(mine).toEqual(theirs);
  });

  it("английский каркас полон — next-intl падает на пропущенном ключе", () => {
    for (const key of KEYS) expect(en.Consent[key], key).toBeTruthy();
  });

  it("объяснения называют закрытие итога, а не календарную дату", () => {
    // Замок наш, и дизайн принял его дословно (`Consent._rethinkLock`). Слово
    // «дата» здесь означало бы обещание, которого продукт не выполняет.
    expect(ru.Consent.rethinkOffBody).toContain("итог праздника не закрыт");
    expect(ru.Consent.rethinkLocked).toContain("итог закрыт");
  });

  it("пяти прежних ключей нет ни в словарях, ни в коде", () => {
    // Их писали мы, пока дизайн молчал (тикет 98b). Мёртвая строка в словаре
    // стоит килобайта в разметке КАЖДОЙ страницы — оставлять «на всякий» нельзя.
    for (const key of [
      "connectionLabel",
      "connectionYes",
      "connectionNo",
      "connectionHint",
      "connectionLocked",
    ]) {
      expect(ru.MyBookings, key).not.toHaveProperty(key);
      expect(en.MyBookings, key).not.toHaveProperty(key);
      expect(listSource).not.toContain(key);
    }
  });
});

describe("подтверждение — своё на каждую сторону", () => {
  it("«показаться» и «спрятаться» спрашивают разными словами", () => {
    expect(rethinkQuestion(true, WORDS)).toEqual({
      title: WORDS.onTitle,
      body: WORDS.onBody,
      yes: WORDS.onYes,
    });
    expect(rethinkQuestion(false, WORDS)).toEqual({
      title: WORDS.offTitle,
      body: WORDS.offBody,
      yes: WORDS.offYes,
    });
  });

  it("объяснение есть у обеих сторон — вопрос без последствия здесь не задают", () => {
    for (const target of [true, false]) {
      const question = rethinkQuestion(target, WORDS);
      expect(question.body, `сторона ${target}`).toBeTruthy();
      expect(question.body).not.toBe(question.title);
    }
  });

  it("на экране — вопрос, объяснение и ровно два ответа", () => {
    const markup = renderToStaticMarkup(
      createElement(RethinkConfirm, {
        question: rethinkQuestion(true, WORDS),
        keep: WORDS.keep,
        onYes: () => {},
        onKeep: () => {},
      }),
    );
    expect(markup).toContain(WORDS.onTitle);
    expect(markup).toContain(WORDS.onBody);
    expect(markup).toContain(WORDS.onYes);
    expect(markup).toContain(WORDS.keep);
    expect(markup.match(/<button[\s>]/gu) ?? []).toHaveLength(2);
    // Чужая сторона в подтверждение не подмешивается.
    expect(markup).not.toContain(WORDS.offYes);
  });
});

describe("ответ меняется только после согласия", () => {
  it("переключателю нечем ответить: он называет сторону, а не отвечает", () => {
    const pressed: boolean[] = [];
    const element = RethinkSwitch({ label: WORDS.row, on: false, onPress: (t) => pressed.push(t) });
    const [button] = buttons(element);
    button?.onClick?.();
    // Сторона — противоположная нынешнему ответу, и это всё, что случилось.
    expect(pressed).toEqual([true]);

    const pressedBack: boolean[] = [];
    buttons(
      RethinkSwitch({ label: WORDS.row, on: true, onPress: (t) => pressedBack.push(t) }),
    )[0]?.onClick?.();
    expect(pressedBack).toEqual([false]);
  });

  it("«да» зовёт ответ, «Оставить как есть» — не зовёт ничего", () => {
    const calls: string[] = [];
    const [yes, keep] = buttons(
      RethinkConfirm({
        question: rethinkQuestion(true, WORDS),
        keep: WORDS.keep,
        onYes: () => calls.push("yes"),
        onKeep: () => calls.push("keep"),
      }),
    );

    keep?.onClick?.();
    expect(calls, "«Оставить как есть» не трогает ответ").toEqual(["keep"]);

    yes?.onClick?.();
    expect(calls).toEqual(["keep", "yes"]);
  });

  it("строка сшита так же: согласие ведёт к onAnswer, отказ — только закрывает", () => {
    // Разметку читаем глазами теста: собрать «да» и «нет» обратно в одну
    // кнопку можно только здесь, и заметно это должно быть сразу.
    expect(rowSource).toMatch(
      /onYes=\{\(\) => \{\s*setAsking\(null\);\s*onAnswer\(asking\);\s*\}\}/u,
    );
    expect(rowSource).toMatch(/onKeep=\{\(\) => setAsking\(null\)\}/u);
    // У переключателя `onAnswer` нет вовсе — ни в пропах, ни в теле.
    const swtch = rowSource.slice(
      rowSource.indexOf("export function RethinkSwitch"),
      rowSource.indexOf("export function RethinkConfirm"),
    );
    expect(swtch).not.toContain("onAnswer");
  });

  it("нетронутая строка подтверждения не показывает", () => {
    const markup = renderToStaticMarkup(
      createElement(RethinkRow, {
        offers: false,
        editable: true,
        words: WORDS,
        onAnswer: () => {},
      }),
    );
    expect(markup).toContain(WORDS.row);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    for (const word of [WORDS.onTitle, WORDS.onBody, WORDS.onYes, WORDS.offTitle, WORDS.keep]) {
      expect(markup, "подтверждение до нажатия не показывается").not.toContain(word);
    }
  });

  it("нынешний ответ виден на переключателе", () => {
    const markup = renderToStaticMarkup(
      createElement(RethinkRow, { offers: true, editable: true, words: WORDS, onAnswer: () => {} }),
    );
    expect(markup).toContain('aria-checked="true"');
  });
});

describe("итог закрыт — строка статична", () => {
  const markup = renderToStaticMarkup(
    createElement(RethinkRow, { offers: true, editable: false, words: WORDS, onAnswer: () => {} }),
  );

  it("показывает rethinkLocked и ничего не предлагает нажать", () => {
    expect(markup).toContain(WORDS.locked);
    // Единственная кнопка — переключатель, и он выключен: свой ответ человек
    // видит, а изменить его нечем.
    expect(markup.match(/<button[\s>]/gu) ?? []).toHaveLength(1);
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-checked="true"');
  });

  it("подтверждения после замка не бывает", () => {
    for (const word of [WORDS.onTitle, WORDS.offTitle, WORDS.onYes, WORDS.offYes, WORDS.keep]) {
      expect(markup).not.toContain(word);
    }
  });

  it("замок решает сервер: строка ничего не считает сама", () => {
    // `editable` приезжает пропом. Появится здесь `new Date()` или
    // `occasionDate` — и замок разъедется с серверным (тикет 98b: считаем по
    // ЗАКРЫТИЮ ИТОГА, а не по календарю).
    expect(rowSource).not.toMatch(/new Date|occasionDate|Date\.now/u);
  });
});

describe("инварианты", () => {
  it("№1: ни одна строка не говорит, что вещь занята", () => {
    // Строка живёт у ГОСТЯ и говорит только про его имя. Слово про занятую
    // вещь здесь означало бы, что подача согласия начала рассказывать про
    // подарочный слой — а он тих.
    const taken = /заня[тл]|забра[лн]|бронь|брони|свободн/iu;
    for (const [key, value] of Object.entries(ru.Consent)) {
      if (!key.startsWith("rethink")) continue;
      expect(taken.test(value), `${key} = ${value}`).toBe(false);
    }
  });

  it("№1: строка не знает ни вещи, ни других гостей — ей нечего раскрыть", () => {
    // Пропы `RethinkRow` — свой ответ, замок и слова. Ни вещи, ни имён.
    const props = rowSource.slice(
      rowSource.indexOf("type RethinkRowProps"),
      rowSource.indexOf("export function RethinkRow"),
    );
    for (const forbidden of ["title", "item", "giver", "photo", "count"]) {
      expect(props.toLowerCase(), `в пропах строки не место полю ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("№2: в объяснении — имя ХОЗЯЙКИ, а не дарителя", () => {
    // Гость и так знает, в чьей комнате занял подарок. Чужого имени здесь не
    // бывает: подставляется `ownerName` брони, и только он.
    expect(listSource).toContain('name: booking.ownerName ?? tGuest("ownerFallback")');
    expect(listSource).not.toMatch(/rethinkOnBody[^)]*giver/u);
  });

  it("№2: слова обещают раскрытие только после разбора подарков", () => {
    expect(ru.Consent.rethinkOnBody).toContain("когда разберёт подарки");
  });

  it("строки «передумать» живут только на гостевом экране", () => {
    // Хозяйкиных экранов они не касаются: там свой вопрос (`Consent.host*`).
    expect(listSource).toContain("rethinkRow");
    expect(read("../src/app/room/occasion/page.tsx")).not.toContain("rethink");
  });
});
