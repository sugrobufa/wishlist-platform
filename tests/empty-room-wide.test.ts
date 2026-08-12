// ПУСТАЯ КОМНАТА НА ШИРОКОМ ЭКРАНЕ (тикет 209, пакет 47 → турн 53c).
//
// ЗАЧЕМ ТЕСТ. Десктопной пустой комнаты никто не рисовал полтора десятка
// раундов: она получила телефонный блок в телефонной полосе и растягивала его
// на всю ширину окна (замер до правки на 1920: блок 44…1876, то есть 1832 px
// шириной). Тикет 202 записал это как открытый вопрос и спросил дизайн письмом;
// пакет 47 ответил числами, и числа эти живут ровно в одном месте — в
// `@media (min-width: 1024px)` файла globals.css. Ломается такое молча: правка
// «поправим отступы блока» уносит угол, и заметить это может только тот, кто
// откроет пустую комнату на широком экране, — а её открывают один раз в жизни,
// сразу после онбординга.
//
// ЧИСЛА БЕРУТСЯ ИЗ САМОГО КОНТРАКТА, а не переписаны сюда руками: приедет
// пакет с другими — тест назовёт разницу, вместо того чтобы молча остаться
// зелёным на устаревших.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/app/globals.css");
const ownerPage = read("../src/app/room/page.tsx");

type WideContract = {
  measuredFrom: string;
  decision: string;
  numbers: {
    veil: number;
    blockWidth: number;
    padLeft: number;
    padBottom: number;
    title: string;
    body: string;
    button: string;
  };
  rejected: ReadonlyArray<{ what: string; why: string }>;
};

const contract = JSON.parse(
  read("../design/package/handoff/round47/empty-room-wide.json"),
) as WideContract;

/**
 * Тело правила `selector` внутри блока `@media (min-width: 1024px)`, который
 * заведён тикетом 209. Ищем по метке тикета, а не по первому попавшемуся
 * запросу ширины: их в файле несколько, и все чужие.
 */
const wideBranch = (): string => {
  const marker = css.indexOf("тикет 209");
  expect(marker, "в globals.css нет ветки тикета 209").toBeGreaterThan(0);
  const open = css.indexOf("@media (min-width: 1024px) {", marker);
  expect(open, "после метки 209 нет @media (min-width: 1024px)").toBeGreaterThan(marker);
  // Считаем скобки от `{` запроса — так конец ветки находится честно, а не
  // «до следующей пустой строки».
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", open); i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, "ветка 209 не закрыта").toBeGreaterThan(open);
  return css.slice(open, end);
};

const wideRule = (selector: string): string => {
  const branch = wideBranch();
  const at = branch.indexOf(`${selector} {`);
  expect(at, `в ветке 209 нет правила ${selector}`).toBeGreaterThan(-1);
  return branch.slice(at, branch.indexOf("}", at));
};

describe("широкий экран: блок первого шага в левом нижнем углу кадра", () => {
  it("решение контракта — угол, и три отказа названы поимённо", () => {
    // Смысловая часть, без которой числа ниже — просто числа. Если пакет
    // однажды передумает, тест обязан упасть здесь, а не на пикселях.
    expect(contract.decision).toContain("ЛЕВЫЙ НИЖНИЙ УГОЛ");
    expect(contract.measuredFrom).toContain("от краёв ОКНА");
    expect(contract.rejected.map((row) => row.what)).toEqual([
      "центрировать блок",
      "растянуть колонку 672 на всю ширину",
      "показать 13 мест сеткой",
    ]);
  });

  it("блок выходит из потока полосы в угол ОКНА — числами контракта", () => {
    const body = wideRule(".imm-empty-start");
    expect(body).toMatch(/position:\s*absolute;/u);
    expect(body).toMatch(new RegExp(`left:\\s*${contract.numbers.padLeft}px;`, "u"));
    expect(body).toMatch(new RegExp(`bottom:\\s*${contract.numbers.padBottom}px;`, "u"));
    expect(body).toMatch(new RegExp(`width:\\s*${contract.numbers.blockWidth}px;`, "u"));
    // Замер на живом стенде (1024×768, 1280×800, 1440×900, 1920×1080): блок
    // 30…426 по горизонтали и ровно 30 от низа окна на всех четырёх. Система
    // отсчёта — `.imm-rail-bottom`, она стоит left/right/bottom по нулям.
    expect(css).toMatch(/\.imm-rail-bottom \{[\s\S]*?bottom: 0;/u);
  });

  it("НОВОГО СЛОЯ НЕ ЗАВЕЛОСЬ: ни fixed, ни высот, отмеренных от таб-бара", () => {
    // Ровно та поломка, которую чинил тикет 131: блоки пустой комнаты стояли
    // `position: fixed` с высотами «на глаз» от бара и ложились на строки зон.
    // На десктопе бара нет вовсе — считать от него было бы враньём дважды.
    const body = wideRule(".imm-empty-start");
    expect(body).not.toMatch(/position:\s*fixed/u);
    expect(body).not.toMatch(/--imm-tab-bar/u);
    expect(body).not.toMatch(/--imm-scene-h/u);
  });

  it("в угол уезжает БЛОК, а не общая обёртка слота", () => {
    // `.imm-empty-slot` — обёртка обеих веток слота `below`: в комнате с 1–4
    // вещами в ней стоит плашка «ссылку лучше отдавать от пяти вещей». Правило
    // на обёртке унесло бы в угол и её, а она подсказка полосы, а не первый
    // экран.
    expect(wideBranch()).not.toContain(".imm-empty-slot");
    expect(css).toContain(".imm-share-plaque");
  });

  it("кегли контракта: заголовок 30/1.22, подпись 13.5, полоса света 16 и 290", () => {
    expect(contract.numbers.title).toContain("30/1.22");
    expect(contract.numbers.body).toContain("13.5");
    expect(contract.numbers.button).toContain("290");

    const title = wideRule(".imm-empty-title");
    expect(title).toMatch(/font-size:\s*30px;/u);
    expect(title).toMatch(/line-height:\s*1\.22;/u);
    // Доска ставит заголовок в ДВЕ строки жёстким `<br>`, а у нас он приезжает
    // одной строкой словаря — вёрстке внутри значения там не место. Разрыв
    // просит браузер: замер на стенде даёт ровно доскины «Комната твоя.» /
    // «Пока в ней темно» на 1024, 1280 и 1920.
    expect(title).toMatch(/text-wrap:\s*balance;/u);

    expect(wideRule(".imm-empty-body")).toMatch(/font-size:\s*13\.5px;/u);

    const cta = wideRule(".imm-rail .imm-empty-cta");
    expect(cta).toMatch(/width:\s*290px;/u);
    expect(cta).toMatch(/font-size:\s*16px;/u);
  });

  it("расхождения, о котором спрашивал контракт, у нас нет: `max-w-*` в комнате ноль", () => {
    // Условие пакета дословно: «если у вас там колонка max-w-2xl — это
    // расхождение по сути». Колонки нет: ширину держали `max-width: 420px`
    // подписи и полосы света, числа макета 41a. Проверка живёт здесь, чтобы
    // класс не появился завтра «заодно».
    expect(ownerPage).not.toMatch(/\bmax-w-[a-z0-9]/u);
  });
});

describe("телефон не тронут ни одним числом", () => {
  it("базовые правила блока — те же, что были до 209", () => {
    // Граница тикета и условие контракта разом: «на телефоне кадр и блок стоят
    // друг под другом, потому что иначе не помещаются». Все четыре числа —
    // макет 41a и замер тикета 199.
    expect(css).toMatch(/\.imm-empty-start \{[\s\S]*?gap: 10px;/u);
    expect(css).toMatch(/\.imm-empty-title \{[\s\S]*?font-size: 22px;/u);
    expect(css).toMatch(/\.imm-empty-body \{[\s\S]*?font-size: 12\.5px;/u);
    expect(css).toMatch(/\.imm-rail \.imm-empty-cta \{[\s\S]*?padding: 0 2px 12px;/u);
  });

  it("в потоке полосы блок остаётся: `position` есть только в десктопной ветке", () => {
    // Базовое правило обязано быть без позиционирования — на телефоне блок
    // живёт в стопке слота `below`, и место ему отдаёт список зон.
    const base = /\.imm-empty-start \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(base, "правила .imm-empty-start нет").not.toBe("");
    expect(base).not.toMatch(/position:/u);
    // Ровно одна ветка, и она десктопная: считаем вхождения селектора.
    expect(css.match(/\.imm-empty-start \{/gu) ?? []).toHaveLength(2);
  });

  it("метка пустой строки действий осталась телефонной — 209 её не переносил", () => {
    // На десктопе строка схлопнута и без метки, а резерв под палец там честный:
    // в комнате с вещами в строке стоят кнопки. Уехав из телефонной ветки,
    // правило отняло бы у полосы её 44.
    //
    // САМО ЧИСЛО ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ НАРОЧНО: оно принадлежит тикетам 199/208
    // (зазор под пилюлю-обещание) и стережётся их тестом. Тикет 209 отвечает
    // только за то, в какой ветке живёт правило.
    const phoneBranch = css.slice(
      css.indexOf("@media not all and (min-width: 1024px)"),
      css.indexOf("\n.imm-row {"),
    );
    expect(phoneBranch).toContain(".imm-rail-bottom .imm-row-bare");
    expect(wideBranch()).not.toContain(".imm-row-bare");
  });
});
