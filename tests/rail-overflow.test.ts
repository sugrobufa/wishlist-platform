// ПОЛОСА ПОД КАДРОМ НЕ РЕЖЕТ СОДЕРЖИМОЕ МОЛЧА (тикет 188).
//
// БАГ, приёмка владельца 11.08 со снимками: «нельзя прокрутить вниз (баг) на
// мобильном представлении». В пустой комнате ряд чипов «Одежда · Украшения ·
// Парфюм · Сумки» срезан нижним баром — видно верхнюю половину плиток, второй
// ряд не виден вовсе, прокрутить нечего.
//
// ПРИЧИНА БЫЛА В ДВУХ СТРОКАХ, И ОНА НЕ ПРО БАР. Экран комнаты иммерсивный:
// `.imm` ровно в высоту окна, `overflow: hidden`, прокрутки нет ПО ЗАМЫСЛУ — это
// сцена, а не страница. Нижняя полоса при этом была ФИКСИРОВАННОЙ ВЫСОТЫ, и всё,
// что в неё не помещалось, срезалось выше по дереву.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ, ЕСЛИ ТИКЕТЫ 190 И 191 СОДЕРЖИМОЕ УЖЕ СОКРАТИЛИ. Именно
// затем. Блок стал короче и сегодня влезает с запасом — обрезка от этого не
// починена: следующий длинный текст обрежется так же тихо. Здесь записано, что
// починка настоящая: потолок вместо высоты, своя прокрутка, низ от бара.
//
// ГЕОМЕТРИЮ НА ЖИВОМ ЭКРАНЕ МЕРЯЕТ ТЕЛЕФОННЫЙ e2e (e2e/mobile-layout.spec.ts):
// там прямоугольники, здесь правила. Правило, стёртое из CSS, e2e поймает
// только если совпадут ещё и данные стенда, — поэтому сторожа два.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const globalsCss = read("../src/app/globals.css");
const railCss = read("../src/components/scene/zone-index.module.css");
const tokensCss = read("../src/styles/tokens.css");

/** Тело правила по селектору — с учётом того, что правил может быть несколько. */
function bodies(css: string, selector: string): string[] {
  return [...css.matchAll(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "gu"))].map(
    (match) => match[1] ?? "",
  );
}

/**
 * Телефонные ветки файла склейкой — ВСЕ, а не первая: и в globals.css, и в
 * модуле полосы их по нескольку, и правило легко оказывается не в той.
 */
const PHONE_AT = "@media not all and (min-width: 1024px)";

function phoneBranch(css: string): string {
  const parts: string[] = [];
  for (let at = css.indexOf(PHONE_AT); at !== -1; at = css.indexOf(PHONE_AT, at + 1)) {
    let depth = 0;
    for (let i = css.indexOf("{", at); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          parts.push(css.slice(at, i + 1));
          break;
        }
      }
    }
  }
  expect(parts.length, "телефонной ветки в файле нет").toBeGreaterThan(0);
  return parts.join("\n");
}

describe("полоса перестала быть фиксированной по высоте", () => {
  it("`--imm-rail-bottom` — ПОТОЛОК, а не высота", () => {
    const [base] = bodies(globalsCss, ".imm-rail-bottom");
    expect(base, "правило `.imm-rail-bottom` не найдено").toBeDefined();
    expect(base).toMatch(/max-height:\s*var\(--imm-rail-bottom\)/u);
    // Именно ПОТОЛОК: высотой то же число быть больше не имеет права —
    // короткое содержимое стоит как стояло, длинное растёт до потолка.
    expect(base).not.toMatch(/(?<!max-)height:\s*var\(--imm-rail-bottom\)/u);
  });

  it("слот под оглавлением получил свою прокрутку — на телефоне", () => {
    const phone = phoneBranch(railCss);
    const [slot] = bodies(phone, ".below");
    expect(slot, "телефонного правила `.below` нет — прокрутки у слота не будет").toBeDefined();
    expect(slot).toMatch(/overflow-y:\s*auto/u);
    // Прокрутка полосы не тянет за собой сцену (условие тикета).
    expect(slot).toMatch(/overscroll-behavior-y:\s*contain/u);
    // Без `min-height: 0` потомок с прокруткой распирает flex-колонку вместо
    // того, чтобы прокручиваться, — прежняя обрезка вернулась бы целиком.
    expect(slot).toMatch(/min-height:\s*0/u);
    // Полоса прозрачна для пальца целиком (globals.css → .imm-rail); по
    // прозрачному не потянешь.
    expect(slot).toMatch(/pointer-events:\s*auto/u);
  });

  it("слоту разрешено сжиматься и запрещено расти: указатель зон стоит на месте", () => {
    // Условие тикета для комнаты С ВЕЩАМИ: «полоса не выросла и указатель зон
    // стоит там же, где стоял». Рост слота отобрал бы место у оглавления.
    const [slot] = bodies(phoneBranch(railCss), ".below");
    expect(slot).toMatch(/flex:\s*0\s+1\s+auto/u);
    expect(slot, "слоту разрешили расти — оглавление уедет").not.toMatch(/flex:\s*1[\s;]/u);
  });

  it("низ полосы считается ОТ БАРА, и своих слагаемых у него нет", () => {
    const phone = phoneBranch(globalsCss);
    const [rail] = bodies(phone, ".imm-rail-bottom");
    expect(rail, "телефонного правила полосы нет").toBeDefined();
    // Место бара внизу = полоса знаков + нижний инсет, и сумма уже объявлена на
    // `body` (тикет 182). Новых чисел тикет 188 не заводит.
    expect(rail).toMatch(/bottom:\s*var\(--imm-bar-h,\s*var\(--imm-tab-bar\)\)/u);
    expect(rail, "низ отмерян от края экрана, а не от бара").not.toMatch(/bottom:\s*0/u);
  });

  it("верх полосы — кромка кадра: потолок = окно минус кадр минус бар", () => {
    // Пункт 4 тикета: сцена обязана остаться видимой — комната и есть продукт.
    // На телефоне потолок и есть сам ящик полосы, вырасти выше ей нечем.
    const [rail] = bodies(phoneBranch(globalsCss), ".imm-rail-bottom");
    expect(rail).toMatch(/top:\s*var\(--imm-scene-h\)/u);
    expect(rail).toMatch(/max-height:\s*none/u);
  });
});

describe("чего починка НЕ сделала", () => {
  it("сцена и кадр не тронуты: экран не стал прокручиваемой страницей", () => {
    // Граница тикета, названная поимённо: ни высоты, ни `overflow: hidden`
    // у `.imm`.
    const [imm] = bodies(globalsCss, ".imm");
    expect(imm).toMatch(/height:\s*100dvh/u);
    expect(imm).toMatch(/overflow:\s*hidden/u);
  });

  it("число 86 по-прежнему живёт ровно в одном файле", () => {
    // Граница тикета: не дублировать. В остальных файлах 86 встречается только
    // в разборах — там это текст, а не значение.
    expect(tokensCss).toMatch(/--imm-tab-bar:\s*86px/u);
    for (const [name, css] of [
      ["globals.css", globalsCss],
      ["zone-index.module.css", railCss],
    ] as const) {
      const values = css
        .split(/\r?\n/u)
        .filter((line) => !/^\s*(?:\/\*|\*|\/\/)/u.test(line))
        .filter((line) => /\b86px\b/u.test(line));
      expect(values, `${name}: число бара продублировано`).toEqual([]);
    }
  });

  it("починка не сделана уменьшением шрифта или отступов", () => {
    // Прямой запрет тикета: «обрезка вернётся на первом же длинном тексте».
    // Числа блока первого шага — из макета 41a и не меняются.
    const [title] = bodies(globalsCss, ".imm-empty-title");
    const [body] = bodies(globalsCss, ".imm-empty-body");
    expect(title).toMatch(/font-size:\s*22px/u);
    expect(body).toMatch(/font-size:\s*12\.5px/u);
    expect(bodies(globalsCss, ".imm-empty-start")[0]).toMatch(/gap:\s*10px/u);
  });
});
