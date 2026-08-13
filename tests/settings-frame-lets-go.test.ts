// КАДР ОТПУСКАЕТ ВМЕСТЕ С РУЧКАМИ СВЕТА (тикет 237).
//
// ОТКУДА. Приёмка 14.08.2026, замечание 6, и уточнение владельца после разбора
// тикета 228: «когда мы спускаемся ниже по настройкам (гораздо ниже), мы уже
// поработали с комнатой и светом, нам не нужна комната сверху и там не на что
// смотреть».
//
// ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ. Тикет 228 запер липкость в её разделе — и это верно, но
// замечание не закрыло: между кадром и ручками лежит лента интерьеров в 580 px,
// поэтому кадр висит 873 px прокрутки, и последние 265 из них едет ОДИН. Теперь
// берег другой: кадр липнет, пока видны РУЧКИ. Стеречь надо две вещи, и обе
// ломаются молча:
//
//   1. КРОМКА ВИДИМОГО ПРОХОДИТ ПО НИЗУ КАДРА, а не по верху экрана. Док
//      непрозрачный и висит на `top: 0` — ручка пропадает, уехав ЕМУ ЗА СПИНУ,
//      на 243.7 раньше (замер 228 на 375×812). Поставь наблюдателю нулевое
//      поле — он отпустит кадр на 1205.7 прокрутки, за 21 px до того, как кадр
//      уедет сам: код есть, тесты зелёные, а глазами починки нет;
//   2. ЛИПКОСТЬ ПО УМОЛЧАНИЮ ЦЕЛА. Разметка сервера, браузер без наблюдателя и
//      страница без раздела света обязаны вести себя как до тикета — иначе
//      человек крутит свет вслепую, а это тикет 181 наоборот.
//
// ЗАМЕР 375×812 (тикет 228, повтор структуры настроек) — числа ниже все оттуда:
//   док (кадр с подписью) 243.7 — треть телефона;
//   блок «Интерьер + Свет» 109.6…1226.6, кадр приколот 873 px прокрутки;
//   верхняя ручка уходит за спину кадра на 838, нижняя на 962;
//   низ блока ручек 1205.7 = 962 + 243.7, и до низа раздела от него 20.9 —
//   ровно `p-5` секции с рамкой. Отмеряй тот замер от верха экрана, там
//   осталось бы 264.6, чему в разметке взяться неоткуда: это и доказывает, что
//   кромка — низ кадра.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  knobsInSight,
  sightMargin,
  watchKnobs,
  type KnobsSighting,
} from "../src/app/settings/knobs-in-sight";

vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, values?: Record<string, string | number>) => {
        const raw = dict[ns]?.[key] ?? key;
        return values
          ? raw.replace(/\{(\w+)\}/gu, (_, token: string) => String(values[token] ?? `{${token}}`))
          : raw;
      },
    useLocale: () => "ru",
  };
});

const { RoomFrame, RoomStudio } = await import("../src/app/settings/room-studio");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sections = read("../src/app/settings/settings-sections.tsx");
const studioSource = read("../src/app/settings/room-studio.tsx");
const css = read("../src/app/settings/room-studio.module.css");

const CARD = {
  id: "cottage",
  name: "Домик",
  sex: "F" as const,
  accent: "#E7C9A9",
  ink: "#241A0E",
  imageUrl: "/rooms/v4-cottage.jpg",
  tod: "day" as const,
};

// ---------- Замер 375×812 из тикета 228 ----------

/** Высота липкого дока: кадр 208.9 + подпись под ним. Она же — кромка. */
const FRAME = 243.7;
const PHONE = 812;
/** Блок ручек в координатах документа: обе строки со своими подписями. */
const KNOBS_TOP = 1009.7;
const KNOBS_BOTTOM = 1205.7;

/**
 * Что наблюдатель расскажет про блок ручек на такой прокрутке. Зона видимости
 * у него начинается под кадром — это и задаёт `rootMargin`, а здесь повторено
 * руками, чтобы проверка не зависела от того, кто считает пересечение.
 */
function sighting(scroll: number): KnobsSighting {
  const top = KNOBS_TOP - scroll;
  const bottom = KNOBS_BOTTOM - scroll;
  return { isIntersecting: bottom > FRAME && top < PHONE, boundingClientRect: { bottom } };
}

describe("пока ручки видны — кадр липнет (тикет 237)", () => {
  it("ручки на экране — кадр держится: это и есть смысл липкости", () => {
    // 394 — то место замера, где комната и обе ручки видны разом.
    expect(knobsInSight(sighting(394), FRAME)).toBe(true);
    expect(knobsInSight(sighting(838), FRAME)).toBe(true); // верхняя ушла, нижняя видна
    expect(knobsInSight(sighting(961), FRAME)).toBe(true); // нижняя ещё на волосок видна
  });

  it("ушла последняя ручка — липкость снимается", () => {
    expect(knobsInSight(sighting(963), FRAME)).toBe(false);
    // И дальше вниз — тем более: «О себе» и «Адрес комнаты» кадр не нужен.
    expect(knobsInSight(sighting(1400), FRAME)).toBe(false);
  });

  it("ручки ЕЩЁ ВПЕРЕДИ — кадр липнет, хотя пересечения нет", () => {
    // Человек листает ленту интерьеров: до света он не дошёл, наблюдатель
    // молчит про пересечение — а кадр обязан стоять, ради ленты он и заведён
    // (тикет 181). Спутай эти два «не видно» — и кадр пропадёт на самой ленте.
    const onRibbon = sighting(0);
    expect(onRibbon.isIntersecting).toBe(false);
    expect(knobsInSight(onRibbon, FRAME)).toBe(true);
  });

  it("КРОМКА — НИЗ КАДРА, А НЕ ВЕРХ ЭКРАНА: без этого починки не видно", () => {
    // Та же прокрутка, та же разметка — разница только в кромке. С нулевой
    // кадр отпустил бы на 1205.7, за 21 px до того, как уедет сам.
    expect(knobsInSight(sighting(963), FRAME)).toBe(false);
    expect(knobsInSight(sighting(963), 0)).toBe(true);
    expect(knobsInSight(sighting(1204), 0)).toBe(true);
    // Отпустить обязано на 962, а не на 1205.7 — это 265 px разницы, треть
    // телефона всё это время занята комнатой.
    expect(knobsInSight(sighting(1206), 0)).toBe(false);
  });

  it("поле наблюдателя опускает верхнюю кромку ровно на высоту кадра", () => {
    expect(sightMargin(FRAME)).toBe("-244px 0px 0px 0px");
    expect(sightMargin(289.7)).toBe("-290px 0px 0px 0px"); // широкий экран
    // Ни отрицательной высоты, ни «-0px»: кадра нет — поля нет.
    expect(sightMargin(0)).toBe("-0px 0px 0px 0px");
    expect(sightMargin(-5)).toBe("-0px 0px 0px 0px");
  });
});

// ---------- Наблюдатель ----------

/** Наблюдатель-пустышка: node-прогону настоящего взять негде. */
class StubWatcher {
  static made: StubWatcher[] = [];
  readonly seen: Element[] = [];
  disconnected = 0;

  constructor(
    readonly fire: (entries: KnobsSighting[]) => void,
    readonly options?: { rootMargin?: string },
  ) {
    StubWatcher.made.push(this);
  }

  observe(node: Element) {
    this.seen.push(node);
  }

  disconnect() {
    this.disconnected += 1;
  }
}

const KNOBS = { id: "блок ручек" } as unknown as Element;
const NOT_KNOBS = { id: "страница" } as unknown as Element;

describe("наблюдатель заведён на блоке ручек (тикет 237)", () => {
  beforeEach(() => {
    StubWatcher.made = [];
    Object.assign(globalThis, { IntersectionObserver: StubWatcher });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
  });

  it("следит именно за блоком ручек, и ровно за ним одним", () => {
    watchKnobs(KNOBS, () => FRAME, vi.fn());
    expect(StubWatcher.made).toHaveLength(1);
    expect(StubWatcher.made[0]?.seen).toEqual([KNOBS]);
    expect(StubWatcher.made[0]?.seen).not.toContain(NOT_KNOBS);
  });

  it("берёт кромку ЗАМЕРОМ кадра, а не числом из головы", () => {
    watchKnobs(KNOBS, () => 289.7, vi.fn());
    expect(StubWatcher.made[0]?.options?.rootMargin).toBe("-290px 0px 0px 0px");
  });

  it("рассказывает про видимость: ушли ручки — сняли липкость", () => {
    const tell = vi.fn();
    watchKnobs(KNOBS, () => FRAME, tell);
    const watcher = StubWatcher.made[0];

    watcher?.fire([sighting(394)]);
    expect(tell).toHaveBeenLastCalledWith(true);

    watcher?.fire([sighting(963)]);
    expect(tell).toHaveBeenLastCalledWith(false);

    // Назад вверх — липкость возвращается: ручки снова видны.
    watcher?.fire([sighting(500)]);
    expect(tell).toHaveBeenLastCalledWith(true);
  });

  it("из пачки берётся последнее — оно и есть «сейчас»", () => {
    const tell = vi.fn();
    watchKnobs(KNOBS, () => FRAME, tell);
    StubWatcher.made[0]?.fire([sighting(0), sighting(963)]);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenLastCalledWith(false);
  });

  it("возврат снимает наблюдение — на уходе раздела не остаётся висяка", () => {
    const unwatch = watchKnobs(KNOBS, () => FRAME, vi.fn());
    expect(StubWatcher.made[0]?.disconnected).toBe(0);
    unwatch();
    expect(StubWatcher.made[0]?.disconnected).toBe(1);
  });

  it("сменилось окно — кромка меряется заново: кадр там другой высоты", () => {
    // `rootMargin` задаётся один раз и правке не поддаётся, а высота кадра
    // живая: 208.9 на телефоне против 289.7 на широком экране (плюс подпись).
    // Поворот и переход через `lg` обязаны пересобрать наблюдателя, иначе
    // кадр отпустит не там, где перестал закрывать ручки.
    const onResize: Array<() => void> = [];
    const view = {
      addEventListener: (type: string, fn: () => void) => {
        if (type === "resize") onResize.push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        const at = onResize.indexOf(fn);
        if (at >= 0) onResize.splice(at, 1);
      },
    };
    Object.assign(globalThis, { window: view });
    try {
      let frame = FRAME;
      const unwatch = watchKnobs(KNOBS, () => frame, vi.fn());
      expect(StubWatcher.made[0]?.options?.rootMargin).toBe("-244px 0px 0px 0px");

      frame = 324.4; // 1280×800: кадр 289.7 с подписью — замер тикета 228
      for (const fire of [...onResize]) fire();

      expect(StubWatcher.made[0]?.disconnected).toBe(1);
      expect(StubWatcher.made[1]?.options?.rootMargin).toBe("-324px 0px 0px 0px");
      expect(StubWatcher.made[1]?.seen).toEqual([KNOBS]);

      // Слушатель уходит вместе с наблюдением — иначе он пересобирал бы
      // наблюдателя на снятом разделе.
      unwatch();
      expect(onResize).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });
});

describe("браузер без наблюдателя (тикет 237)", () => {
  it("молчит — и док остаётся липким по-старому, хуже не станет", () => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    const tell = vi.fn();
    const unwatch = watchKnobs(KNOBS, () => FRAME, tell);
    // Ни падения, ни рассказов: липкость остаётся той, что в CSS.
    expect(tell).not.toHaveBeenCalled();
    expect(() => unwatch()).not.toThrow();
  });
});

// ---------- Проводка ----------

describe("проводка: за чем следит кадр и что он снимает", () => {
  it("ссылка стоит на БЛОКЕ РУЧЕК, и в блоке обе строки света", () => {
    expect(sections).toContain("<div ref={knobsRef} className={studio.knobs}>");
    const from = sections.indexOf("ref={knobsRef}");
    const to = sections.indexOf("{error &&", from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    // Обе строки — внутри блока, и других строк света в файле нет: иначе кадр
    // отпускал бы, пока одна из ручек ещё на экране.
    expect([...sections.slice(from, to).matchAll(/studio\.knobRow/gu)]).toHaveLength(2);
    expect([...sections.matchAll(/studio\.knobRow/gu)]).toHaveLength(2);
  });

  it("наблюдателя заводит хозяин кадра — ему же и мерить его высоту", () => {
    expect(studioSource).toMatch(/watchKnobs\(\s*node,/u);
    expect(studioSource).toMatch(/dock\.current\?\.getBoundingClientRect\(\)\.height/u);
    // Ссылка на док уходит в сам кадр, а состояние — обратно в его класс.
    expect(studioSource).toMatch(/<RoomFrame[\s\S]{0,200}dockRef=\{dockRef\}/u);
    expect(studioSource).toMatch(/<RoomFrame[\s\S]{0,200}loose=\{loose\}/u);
    expect(studioSource).toMatch(/loose: !inSight/u);
  });

  it("липкость снимается вторым классом, а не второй липкостью", () => {
    // Спор двух правил одной специфичности решает порядок в файле: уедет
    // `.dockLoose` выше `.dock` — липкость перестанет сниматься, и молча.
    const dockAt = css.indexOf(".dock {");
    const looseAt = css.indexOf(".dockLoose {");
    expect(dockAt).toBeGreaterThanOrEqual(0);
    expect(looseAt).toBeGreaterThan(dockAt);
    expect(css).toMatch(/\.dockLoose\s*\{[^}]*position:\s*static/u);
    // Липкость в модуле по-прежнему одна и на доке (сторож тикета 228).
    expect([...css.matchAll(/position:\s*sticky/gu)]).toHaveLength(1);
    expect(css).toMatch(/\.dock\s*\{[^}]*position:\s*sticky/u);
  });

  it("блок ручек не сдвинул ручки: внутри тот же ритм, что был снаружи", () => {
    // Обёртка забрала четверых детей из столбца секции (`gap-3` = 12px) и
    // обязана расставить их так же — иначе подписи прилипнут к своим рядам.
    expect(css).toMatch(/\.knobs\s*\{[^}]*flex-direction:\s*column/u);
    expect(css).toMatch(/\.knobs\s*\{[^}]*gap:\s*12px/u);
  });
});

// ---------- Липкость по умолчанию ----------

describe("по умолчанию кадр липнет — как до тикета", () => {
  const frameClass = (loose: boolean): string => {
    const markup = renderToStaticMarkup(
      createElement(RoomFrame, { card: CARD, timeOfDay: "day", lightColor: "warm", loose }),
    );
    return markup.match(/^<div class="([^"]*)"/u)?.[1] ?? "";
  };

  it("отпущенный кадр отличается от липкого ровно одним классом", () => {
    const stuck = frameClass(false);
    const gone = frameClass(true);
    expect(stuck).not.toBe("");
    expect(gone.startsWith(`${stuck} `)).toBe(true);
    expect(gone.split(" ")).toHaveLength(stuck.split(" ").length + 1);
  });

  it("разметка сервера — липкая: без скрипта поведение прежнее", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RoomStudio,
        { cards: [CARD], currentPreset: CARD.id, timeOfDay: "day", lightColor: "warm" },
        createElement("section", null, "разделы"),
      ),
    );
    expect(markup).toContain(`class="${frameClass(false)}"`);
    expect(markup).not.toContain(`class="${frameClass(true)}"`);
  });
});
