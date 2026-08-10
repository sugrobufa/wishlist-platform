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

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const draw = (desire: number | null | undefined, place: "card" | "row" = "card") =>
  renderToStaticMarkup(createElement(DesireScale, { desire, accent: "#E7C9A9", place }));

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

describe("два места — два вида (36d)", () => {
  it("в карточке — со словом, шкала для читалки скрыта", () => {
    const markup = draw(3, "card");
    expect(markup).toContain(ru.AddItem.desire3);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("вид без слова — читалка слышит слово всё равно", () => {
    // Второй вид завёлся для строки зоны, и в продукте её больше не одевает:
    // раунд 36 оставил строке ОДИН огонёк вместо лестницы (zone-row.json →
    // wishDot, «четыре огонька в строке 52 съедают имя»). Правило вида от
    // этого не изменилось и проверяется как было.
    const markup = draw(3, "row");
    expect(markup).not.toContain(`>${ru.AddItem.desire3}<`);
    expect(markup).toContain(`aria-label="${ru.AddItem.desire3}"`);
  });

  it("числа вида — с макета: 6 px в карточке, 5 px в строке", () => {
    const css = read("../src/components/item/desire-scale.module.css");
    expect(css).toContain("width: 6px");
    expect(css).toContain("width: 5px");
    expect(css).toContain("gap: 5px");
    expect(css).toContain("gap: 4px");
    // Пустой огонёк — .2; слово 12 px тоном .55.
    expect(css).toContain("background: rgba(255, 249, 242, 0.2)");
    expect(css).toContain("font: 400 12px/1 var(--font-ui)");
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
    expect(guest).toContain('place="card"');
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
