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

  it("цель нажатия у огонька — 44, точка 14, шаг 10 (round49, числа раунда 29)", () => {
    const css = read("../src/components/item/desire-picker.module.css");
    expect(css).toContain("width: var(--hit-target-min, 44px)");
    expect(css).toContain("height: var(--hit-target-min, 44px)");
    expect(css).toContain("width: 14px");
    // Шаг между целями — 10 (было 2). Число не наше: см. раздел «одно число»
    // ниже, где оно сверяется с контрактом 49 и с его же шириной ряда.
    expect(css).toMatch(/\.steps \{[\s\S]*?gap: 10px;/u);
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

  it("СПОР О ЧИСЛАХ ЗАКРЫТ ПАКЕТОМ 49 — и закрыт в нашу сторону", () => {
    // ПЕРЕВЁРНУТО (тикет 225). Сутки здесь держалось наше расхождение с
    // пакетом 48: он описывал огоньки как 5 px с шагом 4, и это были числа
    // СТРОКИ ЗОНЫ, перенесённые в карточку — та же ошибка, что round41 признал
    // своей однажды. Письмо 53 сказало это второй раз, и round49 снял ОБА
    // своих числа: и 5/4, и 6/5. Проверка не удалена, а перевёрнута — теперь
    // она требует, чтобы контракт говорил то же, что делает код.
    const v2 = JSON.parse(read("../design/package/handoff/round49/desire-scale-v2.json")) as {
      replaces: string;
      oneNumber: { dot: number; target: number; gapBetweenTargets: number; rowWidth: number };
      withdrawn: Record<string, string>;
      targets: { count: number; each: string };
    };
    // Файл 48 ЗАМЕНЁН ЦЕЛИКОМ — числа из него больше не читаются нигде.
    expect(v2.replaces).toBe("round48/desire-scale.json целиком");
    expect(Object.keys(v2.withdrawn).sort()).toEqual(["5/4", "6/5"]);
    expect(v2.withdrawn["5/4"]).toContain("числа СТРОКИ ЗОНЫ");
    // ОДНО ЧИСЛО НА КАРТОЧКУ: точка 14 в цели 44, шаг 10.
    expect([v2.oneNumber.dot, v2.oneNumber.target, v2.oneNumber.gapBetweenTargets]).toEqual([
      14, 44, 10,
    ]);
    // ПРОВЕРКА СЧЁТОМ, которой не хватило самому контракту 48: ряд из четырёх
    // целей с этим шагом обязан сойтись с его же шириной строки.
    expect(v2.targets.count * v2.oneNumber.target + 3 * v2.oneNumber.gapBetweenTargets).toBe(
      v2.oneNumber.rowWidth,
    );
    const css = read("../src/components/item/desire-picker.module.css");
    expect(css).toContain(`width: ${v2.oneNumber.dot}px`);
    expect(css).toMatch(new RegExp(String.raw`\.steps \{[\s\S]*?gap: ${v2.oneNumber.gapBetweenTargets}px;`, "u"));
    expect(css).toContain("width: var(--hit-target-min, 44px)");
    // Снятых чисел в модуле ввода нет ни одного — ни 5/4, ни 6/5.
    for (const gone of ["width: 5px", "gap: 4px", "width: 6px", "gap: 5px"]) {
      expect(css, gone).not.toContain(gone);
    }
    // ТОЧКА 5 ОСТАЁТСЯ РОВНО В ОДНОМ МЕСТЕ — в строке зоны, и контракт 49
    // называет это сам. Заберёт её кто-нибудь в карточку в третий раз —
    // покраснеет здесь.
    const zoneRow = read("../src/components/zone-row/zone-row.module.css");
    expect(zoneRow).toMatch(/\.dot \{[\s\S]*?width: 5px;/u);
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

// ШКАЛА ВСТАЁТ СВОЕЙ СТРОКОЙ (тикет 225, пакет 49 → round49/desire-scale-v2.json).
//
// ЗАЧЕМ РАЗДЕЛ. Раскладка «цена · огоньки · слово» держалась на точке 5, и
// вместе с ней уходит: «цель 44 в мета-строку не встаёт». Ломается это молча —
// строка цены в карточке живёт своим `flex-wrap`, и шкала в ней не падает, а
// просто переносится второй строкой ВНУТРИ чужого блока. Поэтому проверяется
// не вид, а ШОВ: где стоит компонент относительно строки цены.
//
// И второе — СВЕЧЕНИЕ. Контракт 49 просит его у ПОСЛЕДНЕЙ ВЫБРАННОЙ ступени, а
// правило 36d, по которому код жил, давало ореол только «мечтаю». Правила
// спорят на трёх ступенях из четырёх; взята редакция round49 как свежая, и
// «мечтаю» при этом НЕ ПОГАШЕНА — на 4 из 4 верхняя горящая точка и есть она.
// Здесь это записано проверками, чтобы откат в любую сторону был виден.
describe("шкала своей строкой — числа и место (тикет 225, пакет 49)", () => {
  const ACCENT = "#E7C9A9";
  const css = read("../src/components/item/desire-picker.module.css");
  const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
  const contract = JSON.parse(read("../design/package/handoff/round49/desire-scale-v2.json")) as {
    layout: {
      ownRow: string;
      why: string;
      word: string;
      wordTone: string;
      emptyDots: string;
      chosenGlow: string;
    };
    targets: { tapOnCurrent: string; noDialog: string };
  };

  const pick = (desire: number | null, emptyLabel?: string) =>
    renderToStaticMarkup(
      createElement(DesirePicker, { desire, accent: ACCENT, onPick: () => {}, emptyLabel }),
    );

  /** Четыре точки ввода в порядке ступеней. */
  const dots = (markup: string) =>
    [...markup.matchAll(/<span[^>]*class="_flame_[^"]*"[^>]*><\/span>/gu)].map((m) => m[0]);

  it("ШКАЛА НЕ В СТРОКЕ ЦЕНЫ — своим блоком под ней", () => {
    expect(contract.layout.ownRow).toContain("не в мета-строке при цене");
    expect(contract.layout.why).toContain("цель 44 в мета-строку не встаёт");
    // Строка цены осталась строкой ЦЕНЫ: внутри неё шкалы нет.
    const priceRow =
      /\{!item\.inHall && roomPrice !== null && \(\s*<div className=\{s\.priceRow\}>[\s\S]*?<\/div>\s*\)\}/u.exec(
        card,
      )?.[0] ?? "";
    expect(priceRow, "строка цены не найдена — раскладка уехала").toContain("s.price");
    expect(priceRow, "огоньки вернулись в строку цены").not.toContain("DesirePicker");
    // И стоит шкала ПОД ценой — после подписи «цену видят все», которая
    // приклеена к цене отрицательным отступом и принадлежит ей, а не шкале.
    expect(card.indexOf("<DesirePicker")).toBeGreaterThan(card.indexOf("<p className={s.priceSeen}>"));
    // Своей строкой — то есть прямым ребёнком поверхности, а не жильцом чужого
    // блока: обёртки над ним нет ни одной.
    expect(card).toMatch(/\{!item\.inHall && \(\s*<DesirePicker/u);
  });

  it("ПУСТЫЕ ТОЧКИ КОНТУРНЫЕ — то же место и тот же размер", () => {
    expect(contract.layout.emptyDots).toContain("border 1.5 rgba(255,249,242,.28)");
    expect(css).toMatch(/\.flame \{[\s\S]*?border: 1\.5px solid rgba\(255, 249, 242, 0\.28\);/u);
    // «Тот же размер» — обещание, которое держит `box-sizing`: без него граница
    // растит точку до 17 и сдвигает всю лестницу.
    expect(css).toMatch(/\.flame \{[\s\S]*?box-sizing: border-box;/u);
    expect(css).toMatch(/\.flame \{[\s\S]*?width: 14px;/u);
    // Заливки .2 у пустой точки больше нет — она была прежним видом.
    expect(css).not.toContain("background: rgba(255, 249, 242, 0.2)");
    // У горящей точки контура нет: поверх заливки он читался бы кольцом.
    expect(css).toMatch(/\.flameOn \{[\s\S]*?border-color: transparent;/u);
  });

  it("СВЕЧЕНИЕ — у последней выбранной ступени, и цвет его акцент комнаты", () => {
    expect(contract.layout.chosenGlow).toContain("box-shadow 0 0 14px 2px rgba(231,201,169,.5)");
    // Цвет контракта записан числом, а у нас он ДАННЫЕ: сверяем, что rgba из
    // файла — это ровно акцент комнаты с .5, и что в разметку уезжает он же.
    const [, r, g, b, alpha] = /rgba\((\d+),(\d+),(\d+),(\.\d+)\)/u.exec(
      contract.layout.chosenGlow,
    ) as RegExpExecArray;
    const hex = `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    expect(hex.toUpperCase()).toBe(ACCENT);
    expect(Math.round(Number(alpha) * 255).toString(16)).toBe("80");
    const glow = `box-shadow:0 0 14px 2px ${ACCENT}80`;

    for (const step of DESIRE_STEPS) {
      const lit = dots(pick(step));
      expect(lit, String(step)).toHaveLength(4);
      // Светится ровно одна точка — та, по которой нажали.
      expect(lit.filter((dot) => dot.includes("box-shadow")), String(step)).toHaveLength(1);
      expect(lit[step - 1], `ступень ${step}`).toContain(glow);
    }
    // Пустое положение не светится ничем: дефолта у шкалы нет.
    expect(pick(null)).not.toContain("box-shadow");
  });

  it("«МЕЧТАЮ» НЕ ПОГАШЕНА — на 4 из 4 светится она же (правило 36d живо)", () => {
    // Контракт 49 не отменял 36d («мечта в этом продукте всегда подсвечена») —
    // он расширил свечение на все ступени. Проверка держит обе половины: на
    // «мечтаю» горит четвёртая точка, и она по-прежнему последняя горящая.
    const dream = dots(pick(DESIRE_DREAM));
    expect(dream[DESIRE_DREAM - 1]).toContain("box-shadow:0 0 14px 2px");
    expect(dream.filter((dot) => dot.includes("box-shadow"))).toHaveLength(1);
    // ПОКАЗ ГОСТЯ ЖИВЁТ ПО 36d ПО-ПРЕЖНЕМУ: контракт 49 его не упоминает вовсе,
    // и трогать его было нечем (открытый хвост тикета 225). Разъедутся эти два
    // места дальше — разговор об этом начнётся здесь.
    expect(draw(DESIRE_DREAM)).toContain("box-shadow:0 0 8px #E7C9A9e6");
    expect(draw(3)).not.toContain("box-shadow");
  });

  it("СЛОВО СПРАВА, и тон у него разный: выбрано 500 12.5, пусто 400 12", () => {
    expect(contract.layout.word).toContain("справа");
    expect(contract.layout.wordTone).toContain("выбрано — 500 12.5 при .6");
    expect(css).toMatch(/\.word \{[\s\S]*?margin-inline-start: auto;/u);
    expect(css).toMatch(/\.word \{[\s\S]*?text-align: end;/u);
    expect(css).toMatch(/\.word \{[\s\S]*?font: 400 12px\/1 var\(--font-ui\);/u);
    expect(css).toMatch(/\.word \{[\s\S]*?color: rgba\(255, 249, 242, 0\.6\);/u);
    expect(css).toMatch(/\.wordChosen \{[\s\S]*?font: 500 12\.5px\/1 var\(--font-ui\);/u);
    // Тон выбирает ЗНАЧЕНИЕ поля, а не место вызова: второй класс приходит
    // ровно со ступенью и пропадает на пустом.
    expect(pick(2, ru.ItemCard.desireEmpty)).toMatch(/<p class="_word_[^"]*\s_wordChosen_/u);
    expect(pick(null, ru.ItemCard.desireEmpty)).not.toContain("_wordChosen_");
  });

  it("УЖЕ 400 — слово переносится под ряд, по левому краю первой ЦЕЛИ", () => {
    expect(contract.layout.word).toContain("при ширине экрана < 400 переносится под ряд");
    const narrow = /@media \(max-width: 399\.98px\) \{[\s\S]*?\n\}/u.exec(css)?.[0] ?? "";
    expect(narrow, "правила переноса нет вовсе").toContain(".word");
    expect(narrow).toContain("width: 100%");
    // По левому краю ЦЕЛИ, а не первой точки: отступа 15 (полполя цели) здесь
    // больше нет — он равнял слово по кружку, а не по краю строки.
    expect(narrow).toContain("margin-inline-start: 0");
    expect(narrow).toContain("text-align: start");
    expect(css).not.toContain("padding-inline-start: 15px");
  });

  it("ТАП ПО ТЕКУЩЕЙ СНИМАЕТ СТЕПЕНЬ, и диалога нет (не сломано переездом)", () => {
    expect(contract.targets.tapOnCurrent).toContain("шкала возвращается в «не сказано»");
    expect(contract.targets.noDialog).toContain("обратимо тем же тапом");
    const picker = read("../src/components/item/desire-picker.tsx");
    expect(picker).toContain("onClick={() => onPick(value === step ? null : step)}");
    // Подтверждения на этом пути нет ни одного: спрашивают о необратимом.
    expect(picker).not.toMatch(/confirm|Confirm/u);
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
