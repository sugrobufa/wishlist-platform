// ХОЗЯЙКА ВИДИТ СВОЁ ЛИЦО В СВОЕЙ КОМНАТЕ (тикет 226, приёмка владельца
// 14.08.2026, замечание 1):
//
// > «Фото пользователю его также надо показывать и хозяйке как и для гостя, это
// > важно для идентификации в какой комнате я нахожусь. Кроме того, при нажатии
// > лучше бы попадать в раздел Настройка в место где фотография».
//
// ЧТО БЫЛО. `Room.avatarKey` показывался ТОЛЬКО гостю: в своей шапке стояли имя
// и тихие строки, и на вопрос «чьё это место» свой экран отвечал одними словами.
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ:
// - фотография есть в шапке комнаты хозяйки и ведёт на ЯКОРЬ настроек
//   (`/settings#about`), а не на длинную страницу целиком;
// - якорь существует на той стороне: имя из ссылки сверяется с `id` карточки
//   «О себе». Ссылка в никуда молча прокручивает страницу к началу — поймать
//   это можно только глазами, поэтому держим тестом;
// - ВИД И ЧИСЛА ГОСТЕВЫЕ ДО СИМВОЛА. Гостевая комната (`src/app/r/[slug]`) —
//   источник: кружок, кромка, подложка и промежуток до имени сверяются с ней
//   разметка в разметку. Два экрана показывают одного человека, и разъехаться
//   им нечем;
// - ФОТОГРАФИИ НЕТ — НЕТ И НИЧЕГО: ни серого круга, ни буквы имени (правило
//   пустых состояний продукта). Заглушка — это следующий тикет приёмки;
// - числа шапки не тронуты: надстрочная и заголовок остались собой, а `mt-1`
//   переехал с самого заголовка на обёртку строки — ровно так, как у гостя,
//   иначе отступ сложился бы дважды и имя уехало вниз;
// - гостевая комната осталась источником, а не копией правки: её фотография
//   по-прежнему НЕ нажимается — у гостя настроек нет.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ownerPage = read("../src/app/room/page.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const settingsSections = read("../src/app/settings/settings-sections.tsx");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;

/** Левая колонка шапки — от блока заголовков до тихих строк. */
function titlesArea(source: string): string {
  const start = source.indexOf('<div className="imm-area-titles">');
  const end = source.indexOf('<div className="imm-area-quiet">', start);
  return start === -1 || end === -1 ? "" : source.slice(start, end);
}

const ownerTitles = titlesArea(ownerPage);
const guestTitles = titlesArea(guestPage);

/** Кружок фотографии — самозакрывающийся `<div aria-hidden … />`. */
const faceOf = (area: string) => /<div\s+aria-hidden[\s\S]*?\/>/u.exec(area)?.[0] ?? "";

/** Пробелы вёрстки и имя переменной с адресом различий не несут. */
const shape = (block: string) =>
  block.replace(/\s+/gu, " ").replace(/url\(\$\{[^}]+\}\)/u, "url(${AVATAR})");

describe("фотография хозяйки в её собственной шапке", () => {
  it("блок заголовков найден на обеих страницах", () => {
    expect(ownerTitles, "шапка комнаты хозяйки не разобрана").not.toBe("");
    expect(guestTitles, "шапка гостевой комнаты не разобрана").not.toBe("");
  });

  it("фотография есть — и показывается только когда она есть", () => {
    expect(ownerTitles).toContain("{profile?.avatarUrl && (");
    expect(faceOf(ownerTitles)).toContain("url(${profile.avatarUrl})");
  });

  it("кружок — гостевой до символа: два экрана не разошлись", () => {
    const ownerFace = faceOf(ownerTitles);
    expect(ownerFace, "кружок в шапке хозяйки не найден").not.toBe("");
    expect(shape(ownerFace)).toBe(shape(faceOf(guestTitles)));
  });

  it("строка «фото + имя» собрана той же обёрткой, что у гостя", () => {
    // Промежуток до имени и отступ сверху — те же числа, из одной строки.
    expect(ownerTitles).toContain('<div className="mt-1 flex items-center gap-3">');
    expect(guestTitles).toContain('<div className="mt-1 flex items-center gap-3">');
  });

  it("плашка нажатия не растит строку имени: рост тоже гостевой", () => {
    // `.imm-rail a` даёт всему нажимаемому в полосах min-height 44 (контракт
    // цели нажатия). Без поправки строка имени на телефоне стала бы 44 против
    // гостевых 36, и имя с тихими строками уехало бы вниз — то самое «имя
    // съехало». На широком экране кружок сам 44, вычитать нечего.
    expect(ownerTitles).toMatch(/<Link[\s\S]*?className="[^"]*-my-1[^"]*lg:my-0[^"]*"/u);
  });
});

describe("нажатие ведёт к самой фотографии, а не «в настройки»", () => {
  it("ссылка стоит на фотографии и несёт якорь", () => {
    expect(ownerTitles).toMatch(/<Link\s+href="\/settings#[a-z-]+"/u);
    // Просто /settings — это «попал на страницу», а владелец просил «в место,
    // где фотография»: голого адреса в этой строке быть не должно.
    expect(ownerTitles).not.toMatch(/href="\/settings"/u);
  });

  it("якорь существует: имя из ссылки — это id карточки «О себе»", () => {
    const anchor = /href="\/settings#([a-z-]+)"/u.exec(ownerTitles)?.[1];
    expect(anchor, "якорь в ссылке не найден").toBeTruthy();
    const section = new RegExp(
      `<Section id="${anchor}" overline=\\{t\\("profileOverline"\\)\\}>`,
      "u",
    );
    expect(settingsSections).toMatch(section);
    // …и каркас секции правда кладёт id на сам элемент, а не роняет проп.
    expect(settingsSections).toMatch(/<section\s+id=\{id\}/u);
  });

  it("знак называет себя читалке словом, которое у нас уже есть", () => {
    expect(ownerTitles).toContain('aria-label={t("settingsLink")}');
    expect(ru.Room?.settingsLink).toBeTruthy();
  });

  it("нажимаемое проседает: класс pressable, как у всего остального", () => {
    expect(ownerTitles).toMatch(/className="pressable[^"]*"/u);
  });
});

describe("фотографии нет — в шапке не прибавилось ничего", () => {
  it("ни второй ветки, ни заглушки вместо снимка", () => {
    // Тройной выбор здесь означал бы серый круг или букву на месте пустоты.
    expect(ownerTitles).not.toMatch(/avatarUrl\s+\?/u);
    expect(ownerTitles).not.toMatch(/charAt|toUpperCase|slice\(0/u);
  });

  it("пустота не рисуется даже кромкой: круг живёт внутри условия", () => {
    const guarded = ownerTitles.slice(ownerTitles.indexOf("{profile?.avatarUrl && ("));
    expect(faceOf(guarded)).toContain("rounded-full");
    // Второго кружка в шапке нет — ни до условия, ни после него.
    expect([...ownerTitles.matchAll(/rounded-full/gu)]).toHaveLength(1);
  });
});

describe("границы тикета", () => {
  it("числа шапки на месте: надстрочная и заголовок не тронуты", () => {
    expect(ownerTitles).toContain('{t("overline")}');
    expect(ownerTitles).toContain(
      '<h1 className="display imm-title text-2xl lg:text-4xl">{roomTitle}</h1>',
    );
    // `mt-1` переехал на обёртку строки — на самом заголовке его быть не должно,
    // иначе отступ сложится дважды и имя уедет вниз.
    expect(ownerTitles).not.toMatch(/<h1[^>]*\bmt-1\b/u);
  });

  it("гостевая комната осталась источником: её фотография не нажимается", () => {
    expect(guestTitles).not.toContain("<Link");
    expect(guestTitles).not.toContain("href=");
  });
});
