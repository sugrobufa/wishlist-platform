// Степень желания: показать (тикет 125, турн 36d).
//
// ЗАЧЕМ ТЕСТ. Поле `desire` прожило в продукте месяцы в состоянии «есть везде,
// кроме экрана»: колонка в базе, шкала в добавлении, шкала в правке, значение
// в обоих DTO — и ни одного компонента, который его рисует. Владелец спросил
// «почему я этого нигде не видел», и ответ был «показ никто не собрал». Такая
// поломка не падает ни в typecheck, ни в рантайме: она молчит. Поэтому здесь
// проверяется именно ПОКАЗ — в трёх местах, где он обязан быть, и в одном, где
// его быть не должно.
//
// Рендером, а не чтением исходника: правила шкалы («не скажу» не рисуется
// нулём, светится только четвёртый огонёк) — про разметку, и увидеть их можно
// только в ней.
//
// ВИД У ШКАЛЫ ОДИН (тикет 161). Файл описывал «два места — два вида»: 6 px со
// словом в карточке и 5 px без слова в строке зоны. Второго не стало, и не
// потому, что мы прибрались: строку у него забрал сам дизайн (`zone-row.json →
// form.wishDot` — «четыре огонька в строке 52 съедают имя; лестница целиком
// живёт в сетке и в карточке»), а тикет 152 это воплотил. После него у варианта
// не осталось ни одного потребителя в продукте — дёргал его только этот тест.
// Поэтому раздел «два места» заменён на «вид один», и он же держит решение от
// молчаливого отката: проверяет, что вариант не вернулся и что причина его
// снятия жива — точку в строке рисует сама строка.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

// Словарь настоящий: слова шкалы («пусть будет · хочется · очень хочется ·
// мечтаю») — часть проверки, подставлять вместо них заглушки бессмысленно.
vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return { useTranslations: (ns: string) => (key: string) => dict[ns]?.[key] ?? key };
});

const { DesireScale, DESIRE_DREAM, DESIRE_STEPS } = await import(
  "../src/components/item/desire-scale"
);
const { DesirePicker } = await import("../src/components/item/desire-picker");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const draw = (desire: number | null | undefined) =>
  renderToStaticMarkup(createElement(DesireScale, { desire, accent: "#E7C9A9" }));

/** Сколько огоньков нарисовано и сколько из них горит. */
const flames = (markup: string) => (markup.match(/_flame_/gu) ?? []).length;
const lit = (markup: string) => (markup.match(/_flameOn_/gu) ?? []).length;

describe("шкала рисуется на 1–4", () => {
  for (const step of DESIRE_STEPS) {
    it(`${step} из четырёх — четыре огонька, горят ${step}`, () => {
      const markup = draw(step);
      expect(flames(markup)).toBe(4);
      expect(lit(markup)).toBe(step);
      // Заполнение — акцент комнаты; пустые берут .2 из css-модуля, инлайна
      // у них нет вовсе.
      expect(markup.match(/background:#E7C9A9/gu) ?? []).toHaveLength(step);
    });
  }

  it("на «мечтаю» светится последний огонёк — и только он", () => {
    const dream = draw(DESIRE_DREAM);
    const spans = dream.match(/<span class="_flame_[^"]*"[^>]*><\/span>/gu) ?? [];
    expect(spans).toHaveLength(4);
    // Ореол стоит на ЧЕТВЁРТОМ огоньке, а не на первом попавшемся.
    expect(spans[3]).toContain("box-shadow:0 0 8px #E7C9A9e6");
    expect(spans.slice(0, 3).filter((span) => span.includes("box-shadow"))).toEqual([]);
  });

  it("на трёх из четырёх ореола нет: подсвечена только мечта", () => {
    expect(draw(3)).not.toContain("box-shadow");
  });
});

describe("«не скажу» — шкалы нет вовсе", () => {
  it("null и undefined не рисуют ничего: пустое не рисуется нулём", () => {
    expect(draw(null)).toBe("");
    expect(draw(undefined)).toBe("");
  });

  it("и слово «не скажу» вместо шкалы тоже не рисуется", () => {
    expect(draw(null)).not.toContain(ru.AddItem.desireUnset);
    // Ключ жив: он подписывает пустое положение в форме добавления и правки.
    expect(ru.AddItem.desireUnset).toBe("не скажу");
    expect(en.AddItem).toHaveProperty("desireUnset");
  });

  it("значение вне 1–4 шкалу не собирает", () => {
    // Мусор из базы или чужой ввод не имеет права нарисовать «полшкалы».
    for (const bad of [0, 5, -1, 2.5, Number.NaN]) {
      expect(draw(bad), String(bad)).toBe("");
    }
  });
});

describe("вид один — карточка (36d + zone-row.json)", () => {
  it("слово рядом всегда, огоньки от читалки скрыты", () => {
    const markup = draw(3);
    expect(markup).toContain(ru.AddItem.desire3);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("числа вида — с макета: 6 px с шагом 5", () => {
    const css = read("../src/components/item/desire-scale.module.css");
    expect(css).toContain("width: 6px");
    expect(css).toContain("gap: 5px");
    // Пустой огонёк — .2; слово 12 px тоном .55.
    expect(css).toContain("background: rgba(255, 249, 242, 0.2)");
    expect(css).toContain("font: 400 12px/1 var(--font-ui)");
  });

  it("ВАРИАНТ СТРОКИ СНЯТ ЦЕЛИКОМ — ни пропа, ни правил, ни 5 px", () => {
    // Снят целиком, а не «перестал вызываться»: иначе он вернулся бы первым же
    // «а тут бы поменьше», и мёртвое правило снова стало бы живым кодом.
    // Комментарии из исходника убираются: в них снятый вариант описан, и
    // описан правильно — это объяснение, а не код.
    const component = read("../src/components/item/desire-scale.tsx")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    const css = read("../src/components/item/desire-scale.module.css").replace(
      /\/\*[\s\S]*?\*\//gu,
      "",
    );
    expect(component, "у шкалы снова два вида").not.toMatch(/place/u);
    expect(css).not.toMatch(/^\.row/mu);
    expect(css).not.toContain("width: 5px");
    expect(css).not.toContain("gap: 4px");
    // Безсловной ветки не осталось: слово стоит всегда, и роль с подписью
    // вместо него больше не нужна — ни в коде, ни в разметке.
    expect(component).not.toContain('role="img"');
    expect(draw(3)).not.toContain("aria-label");
  });

  it("причина снятия ЖИВА: точку в строке рисует сама строка", () => {
    // Если строка когда-нибудь снова попросит лестницу, эта проверка упадёт
    // первой — и вариант надо будет возвращать осознанно, а не по привычке.
    const zoneRow = read("../src/components/zone-row/zone-row.tsx");
    const contract = JSON.parse(read("../design/package/handoff/zone-row.json")) as {
      form: { wishDot: { size: number; why: string } };
    };
    expect(contract.form.wishDot.size).toBe(5);
    expect(contract.form.wishDot.why).toContain("лестница целиком живёт в сетке и в карточке");
    expect(zoneRow).toContain("desire === DESIRE_DREAM");
    expect(zoneRow, "в строку вернулась вся лестница").not.toContain("DesireScale");
  });

  it("потребитель у шкалы ровно один — гостевая карточка", () => {
    // Второй появится — станет видно здесь, и вместе с ним придёт вопрос,
    // хватает ли ему одного вида.
    const guest = read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx");
    expect(guest).toContain("<DesireScale desire={desire} accent={accent} />");
    const owner = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
    expect(owner, "в карточке хозяйки показ вместо ввода").not.toContain("DesireScale");
  });
});

describe("где показ обязан быть", () => {
  // ЧТО ИЗМЕНИЛОСЬ В КАРТОЧКЕ ХОЗЯЙКИ (раунд 29, task31.json →
  // addFormScale.editInPlace). Там стояла та же шкала, но ТОЛЬКО ДЛЯ ЧТЕНИЯ, а
  // менять степень ходили в отдельное поле формы ниже — два места на одно
  // значение. Дизайн просит править НА МЕСТЕ, тапом по огонькам, без
  // «Изменить»: «проставить задним числом тридцати вещам должно быть дёшево».
  // Поэтому в шапке теперь ввод (`DesirePicker`), а поля в форме нет вовсе.
  // Показ (`DesireScale`) остался там, где вещь читают, а не правят: у гостя
  // и в строке зоны.
  it("в карточке вещи у хозяйки — ВВОДОМ, у названия, только у вещи комнаты", () => {
    const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
    expect(card).toContain("<DesirePicker");
    // Тикет 124: место вместо состояния — шкала у вещи КОМНАТЫ.
    expect(card).toContain("!item.inHall && (");
    // Тап сохраняет сразу — второй кнопки для этого нет.
    expect(card).toContain("onPick={onPickDesire}");
    expect(card).toMatch(/updateItemAction\(item\.id, buildInput\(next\)\)/u);
    // Второго места ввода на экране не осталось.
    expect(card).not.toContain("DESIRE_STEPS");
  });

  it("в форме добавления — вторым вопросом, сразу после названия", () => {
    const form = read("../src/app/room/add/add-item-flow.tsx");
    expect(form).toContain("<DesirePicker");
    // Порядок: название → степень → зона. Прежде степень стояла последним
    // полем, и это была прямая причина 56 пустых из 57.
    const title = form.indexOf('{t("titleLabel")}');
    const desire = form.indexOf("<DesirePicker");
    const zone = form.indexOf('{t("zoneLabel")}');
    expect(title).toBeGreaterThan(-1);
    expect(desire).toBeGreaterThan(title);
    expect(zone).toBeGreaterThan(desire);
  });

  it("ДЕФОЛТА НЕТ: система степень не проставляет — ни в форме, ни во вводе", () => {
    // «Мечтаю у всего подряд» без дефолта не случается: обесценить шкалу может
    // только система, проставившая что-то сама (task31.json → devaluation).
    const form = read("../src/app/room/add/add-item-flow.tsx");
    expect(form).toContain("useState<number | null>(null)");
    const picker = read("../src/components/item/desire-picker.tsx");
    expect(picker).not.toMatch(/useState\(/u);
    // «Не скажу» — законное пустое и стоит на экране всегда, а не появляется
    // после выбора: это и есть обещание «поле необязательное».
    expect(picker).toContain('t("desireUnset")');
    expect(picker).toContain("onPick(null)");
  });

  it("цель нажатия у огонька — 44, точка 14 (числа раунда 29)", () => {
    const css = read("../src/components/item/desire-picker.module.css");
    expect(css).toContain("width: var(--hit-target-min, 44px)");
    expect(css).toContain("height: var(--hit-target-min, 44px)");
    expect(css).toContain("width: 14px");
  });

  it("в карточке вещи у ГОСТЯ — тем же видом: он по шкале выбирает подарок", () => {
    const guest = read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx");
    expect(guest).toContain("<DesireScale");
    // Вида у шкалы один, и выбирать его нечем: пропа `place` больше нет
    // (тикет 161) — раздел «вид один» выше держит это со стороны компонента.
    // Значение берётся из гостевого DTO, а не досочиняется на клиенте.
    expect(guest).toContain("const desire = item.inHall ? null : item.desire;");
  });

  it("в строке зоны — ОДНОЙ точкой и только у «мечтаю» (тикет 152)", () => {
    // ПЕРЕПИСАНО. Прежде здесь стояла вся лестница (`place="row"`), и это был
    // верный вид до раунда 36. Его контракт строки 52 (zone-row.json →
    // form.wishDot) оставил строке верхнюю ступень: «четыре огонька в строке
    // 52 съедают имя; лестница целиком живёт в сетке и в карточке». Значение
    // по-прежнему приезжает из DTO, а не досочиняется экраном.
    const rows = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
    const zoneRow = read("../src/components/zone-row/zone-row.tsx");
    expect(rows).toContain("desire={item.desire}");
    expect(zoneRow).toContain("desire === DESIRE_DREAM");
    expect(zoneRow, "в строку вернулась вся лестница").not.toContain("DesireScale");
    // Номер верхней ступени берётся у шкалы — второго «4» в продукте нет.
    expect(zoneRow).toContain('import { DESIRE_DREAM } from "@/components/item/desire-scale";');
  });

  it("значение доезжает до строки контрактом сетки, а не кастом", () => {
    const types = read("../src/components/zone/types.ts");
    expect(types).toContain("desire?: number | null;");
  });
});

// ПУСТАЯ ШКАЛА НАЗЫВАЕТ СЕБЯ САМА (тикет 215) — И СВОИМИ СЛОВАМИ (тикет 221).
//
// ЗАЧЕМ ЭТОТ РАЗДЕЛ. Один и тот же `DesirePicker` стоит в двух местах, и
// подпись была только в одном: в форме добавления над шкалой стоит своей
// строкой `AddItem.desireLabel`, а в карточке вещи нет ни подписи, ни
// подсказки. У вещи СО степенью её называет слово ступени («очень хочется»), а
// у вещи БЕЗ степени — а это самый частый случай — на экране оставались четыре
// серых кружка и «не скажу». Владелец на приёмке 13.08: «непонятно, что за
// точки он выставляет».
//
// Разница между местами тонкая и ломается молча: подпись, переданная и в
// форму, напишет одно слово дважды подряд, а забытая в карточке вернёт четыре
// безымянных кружка. Ни то, ни другое не видно ни типам, ни линту — только
// глазу. Поэтому проверяются оба места и оба положения шкалы.
//
// СЛОВО КАРТОЧКИ СТАЛО ИХ (пакет 48 → round48/desire-scale.json, тикет 221).
// Сутки в карточке стояла наша `AddItem.desireLabel` — «Насколько хочется», —
// и дизайн снял её одним доводом: в форме шкала ВОПРОС, в карточке ОТВЕТ, а
// «не скажу» законное значение, а не пустота; вопрос на его месте читается
// приглашением заполнить там, где человек уже ответил. Поэтому проверяется не
// «строка есть», а КАКАЯ строка: своё слово карточки (`ItemCard.desireEmpty`)
// и отсутствие вопроса формы на его месте.
describe("огоньки называют себя в карточке (тикеты 215, 221)", () => {
  const pick = (desire: number | null, emptyLabel?: string) =>
    renderToStaticMarkup(
      createElement(DesirePicker, { desire, accent: "#E7C9A9", onPick: () => {}, emptyLabel }),
    );

  /** Строка под огоньками — та самая, где стоит слово ступени. */
  const words = (markup: string) =>
    [...markup.matchAll(/<p class="_word_[^"]*">([^<]*)<\/p>/gu)].map(
      (match) => match[1] as string,
    );

  it("В КАРТОЧКЕ пустое положение — ОТВЕТ «не сказано», а не вопрос формы", () => {
    // Слово карточки СВОЁ, и раздел словаря у него свой: в форме шкала вопрос,
    // здесь ответ, и одним ключом два голоса не покрыть (пакет 48).
    expect(words(pick(null, ru.ItemCard.desireEmpty))).toEqual([ru.ItemCard.desireEmpty]);
    expect(ru.ItemCard.desireEmpty).toBe("не сказано, насколько хочется");
    expect(en.ItemCard).toHaveProperty("desireEmpty");
    // И это НЕ подпись формы: ровно её дизайн с этого места и снял.
    expect(ru.ItemCard.desireEmpty).not.toBe(ru.AddItem.desireLabel);
    expect(ru.AddItem.desireLabel).toBe("Насколько хочется");
  });

  it("слово карточки — из контракта пакета 48, а не наше", () => {
    // Оба конца: контракт зовёт ключ по имени и приводит саму строку. Уедет
    // словарь или уедет контракт — покраснеет здесь, а не на приёмке.
    const scale = JSON.parse(read("../design/package/handoff/round48/desire-scale.json")) as {
      states: ReadonlyArray<{ case: string; word: string; text?: string }>;
      row: { word: { alwaysPresent: boolean } };
      whyNotYours: { yours: string; keptFromYours: string };
    };
    const empty = scale.states.find((state) => state.case === "ступень не выбрана");
    expect(empty?.word).toBe("ItemCard.desireEmpty");
    expect(empty?.text).toBe(ru.ItemCard.desireEmpty);
    // Причина замены — та самая: на месте ответа стоял наш вопрос.
    expect(scale.whyNotYours.yours).toContain("Насколько хочется");
    // А строку «есть всегда» дизайн забрал у нас дословно — она и остаётся.
    expect(scale.row.word.alwaysPresent).toBe(true);
    expect(scale.whyNotYours.keptFromYours).toContain("есть всегда");
  });

  it("ЧИСЕЛ ШКАЛЫ ИЗ ПАКЕТА 48 МЫ НЕ ВЗЯЛИ — и это названо вслух", () => {
    // РАСХОЖДЕНИЕ, А НЕ НЕДОСМОТР (тикет 221, письмо 53). `round48` описывает
    // огоньки строки как 5 px с шагом 4 — ровно ту пару, которую round41 снял
    // сам: «числа 5/4 из нашего файла были числами СТРОКИ ЗОНЫ, вы поймали
    // верно», и там же «в карточке огоньки 6 px с шагом 5». Плюс арифметика:
    // четыре точки по 5 с шагом 4 — 32 px на всю лестницу, а цель нажатия
    // контракта — вся полоса; тапнуть в такой полосе третью ступень нельзя, а
    // правка тапом — их же правило (round29 → editInPlace).
    const scale = JSON.parse(read("../design/package/handoff/round48/desire-scale.json")) as {
      row: { lights: { size: number; gap: number } };
      hitTarget: { height: number; width: string };
    };
    expect([scale.row.lights.size, scale.row.lights.gap]).toEqual([5, 4]);
    const round41 = JSON.parse(read("../design/package/handoff/round41/item-card-owner.json")) as {
      body: { wish: string };
    };
    expect(round41.body.wish).toContain("огоньки 6 px с шагом 5");
    expect(round41.body.wish).toContain("числа 5/4 из нашего файла были числами СТРОКИ ЗОНЫ");
    // Шкала ввода осталась как есть: точка 14 в цели 44 (числа раунда 29).
    const css = read("../src/components/item/desire-picker.module.css");
    expect(css).toContain("width: 14px");
    expect(css).not.toContain("width: 5px");
    expect(css).not.toContain("gap: 4px");
    // Цель 44 у контракта та же — спор ровно про точку, а не про цель.
    expect(scale.hitTarget.height).toBe(44);
    expect(css).toContain("width: var(--hit-target-min, 44px)");
  });

  it("В ФОРМЕ пустое положение молчит: подпись у неё уже стоит своей строкой", () => {
    expect(words(pick(null))).toEqual([]);
    // ГЛАЗАМ — ни слова. Читалке шкала называет себя в обоих местах, и это не
    // то же самое: `aria-label` группы стоял здесь с раунда 29 и остаётся, а
    // повторить его строкой в форме значило бы написать одно слово дважды
    // подряд — над шкалой и под ней.
    expect(pick(null)).toContain(`aria-label="${ru.AddItem.desireLabel}"`);
    expect(pick(null).replace(/aria-label="[^"]*"/gu, "")).not.toContain(ru.AddItem.desireLabel);
    // И «не скажу» подписью не повторяется ни там, ни там: оно уже написано
    // кнопкой рядом, и второй раз это то же самое слово.
    expect(words(pick(null, ru.ItemCard.desireEmpty))).not.toContain(ru.AddItem.desireUnset);
  });

  it("ВЫБРАННАЯ СТУПЕНЬ в обоих местах даёт слово ступени, а не подпись", () => {
    for (const step of DESIRE_STEPS) {
      const word = ru.AddItem[`desire${step}`];
      expect(words(pick(step)), `форма, ${step}`).toEqual([word]);
      expect(words(pick(step, ru.ItemCard.desireEmpty)), `карточка, ${step}`).toEqual([word]);
    }
  });

  it("в карточке строка под огоньками есть ВСЕГДА — раскладка не прыгает", () => {
    // Побочная польза слова, ради которой его и держат на месте слова ступени:
    // выбор ступени больше не двигает всё, что ниже, на высоту строки. Дизайн
    // забрал это правило у нас дословно (`row.word.alwaysPresent`).
    for (const desire of [null, ...DESIRE_STEPS]) {
      expect(words(pick(desire, ru.ItemCard.desireEmpty)), String(desire)).toHaveLength(1);
    }
  });

  it("слово приходит СНАРУЖИ, и карточка передаёт его, а форма — нет", () => {
    const picker = read("../src/components/item/desire-picker.tsx");
    expect(picker).toContain("emptyLabel?: string;");
    const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
    expect(card).toContain('emptyLabel={tCard("desireEmpty")}');
    // `tCard` — ns ItemCard, СВОЙ раздел карточки: подпись формы здесь больше
    // не звучит, и передать её нечем — ключа с таким смыслом у карточки нет.
    expect(card).toContain('const tCard = useTranslations("ItemCard");');
    expect(card).not.toContain('emptyLabel={tField("desireLabel")}');
    // В форме свойства нет вовсе: подпись у неё стоит своей строкой сверху.
    const form = read("../src/app/room/add/add-item-flow.tsx");
    expect(form).toContain('<span className={s.fieldLabel}>{t("desireLabel")}</span>');
    expect(form.slice(form.indexOf("<DesirePicker"))).not.toContain("emptyLabel");
  });

  it("гостевую половину это не трогает: там слово ступени стоит рядом всегда", () => {
    // У гостя показ (`DesireScale`), и вопроса «что за точки» не возникает:
    // пустая шкала у него не рисуется вовсе.
    const scale = read("../src/components/item/desire-scale.tsx");
    expect(scale).not.toContain("emptyLabel");
    expect(draw(null)).toBe("");
  });
});

describe("где показа быть не должно", () => {
  const treasury = [
    "../src/app/room/hall/hall-showcase.tsx",
    "../src/app/room/hall/page.tsx",
    "../src/app/r/[slug]/hall/page.tsx",
  ];

  for (const file of treasury) {
    it(`${file.split("/").slice(-2).join("/")} — желание исполнено, шкале там нечего мерить`, () => {
      expect(read(file)).not.toContain("DesireScale");
    });
  }
});
