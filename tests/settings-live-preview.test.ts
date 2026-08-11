// НАСТРОЙКИ ПОКАЗЫВАЮТ КОМНАТУ: крупный кадр на две ручки (тикет 181).
//
// ОТКУДА. Приёмка владельца 11.08.2026, три пункта из пяти про один экран:
// «при выборе комнаты на мобильном увеличивать изображение, чтобы пользователь
// понимал, какая комната будет», «выбор света роняет непонятно, просто мигает
// экран», «он просто что-то жмёт и вынужден каждый раз выходить в комнату».
//
// ЗАЧЕМ ТЕСТ. У этого экрана есть инвариант, нарушение которого стоит человеку
// его вещей: **превью показывает выбранное, а комнату меняет только
// «Переехать»**. Смена интерьера двигает вещи между полками — где полки
// совпадут, останутся, остальные переедут в «Что угодно», — и сделать это по
// тапу значит переставить чужие вещи без спроса. Нарушение не падает ни в
// типах, ни в линте: достаточно дописать один вызов экшена в обработчик
// плитки, и экран будет выглядеть точно так же.
//
// ИНВАРИАНТ ЗАКРЫТ ТРЕМЯ ЗАМКАМИ, и каждый проверяется здесь:
//   1. кадр берёт ВЫБРАННОЕ, а не то, что в комнате (`previewOf`, чистый
//      модуль — проверяется вызовом, а не прокликиванием);
//   2. тап по плитке зовёт `select` и ничего больше;
//   3. `changePresetAction` во всём экране ровно один — в `apply()` под
//      кнопкой «Переехать».
// Разорви любой из трёх — покраснеет здесь.
//
// ОСТАЛЬНОЕ — ЧИСЛА. Они сверяются с контрактом и с самим CSS, потому что
// ломаются молча: цель нажатия «чуть компактнее», пропорция кадра «чуть
// красивее», липкость, снятая заодно с рефактором вёрстки.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  gradingFilter,
  LIGHT_COLORS,
  TIMES_OF_DAY,
  type LightColor,
  type TimeOfDay,
} from "../src/components/scene/grading";
import { previewOf, type PresetCard } from "../src/app/settings/room-preview";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

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
const page = read("../src/app/settings/page.tsx");
const css = read("../src/app/settings/room-studio.module.css");

/**
 * Две карточки с РАЗНЫМ родным временем суток базы. Разное оно намеренно:
 * грейдинг обязан считаться от фотографии, которую кадр показывает сейчас, а
 * не от той, что стоит в комнате (тикет 107 — четыре базы из десяти сняты
 * ночью, и на них расхождение вдвое).
 */
const HOME: PresetCard = {
  id: "cottage",
  name: "Домик",
  sex: "F",
  accent: "#E7C9A9",
  ink: "#241A0E",
  imageUrl: "/rooms/v4-cottage.jpg",
  tod: "day",
};
const GUEST: PresetCard = {
  id: "gamer",
  name: "Геймерская",
  sex: "M",
  accent: "#8FB7FF",
  ink: "#0B0806",
  imageUrl: "/rooms/v4-gamer.jpg",
  tod: "night",
};
const CARDS = [HOME, GUEST];

function renderStudio(
  currentPreset: string,
  timeOfDay: TimeOfDay = "day",
  lightColor: LightColor = "warm",
): string {
  // Дети приезжают со страницы (два раздела) — самому кадру они безразличны.
  return renderToStaticMarkup(
    createElement(RoomStudio, { cards: CARDS, currentPreset, timeOfDay, lightColor }),
  );
}

/** Кадр в отрыве от состояния — единственный способ увидеть обе подписи. */
function renderFrame(
  card: PresetCard,
  pending: boolean,
  timeOfDay: TimeOfDay = "day",
  lightColor: LightColor = "warm",
): string {
  return renderToStaticMarkup(
    createElement(RoomFrame, { card, pending, timeOfDay, lightColor }),
  );
}

/** Все адреса картинок разметки: `url(...)` без повторов. */
function imageAddresses(markup: string): string[] {
  return [...new Set([...markup.matchAll(/url\(([^)]+)\)/gu)].map((match) => match[1] as string))];
}

// ---------- Замок 1: кадр показывает выбранное ----------

describe("previewOf — «что в комнате» и «что человек смотрит» это два разных значения", () => {
  it("показывает ВЫБРАННОЕ, а не то, что стоит в комнате", () => {
    const { shown, pending } = previewOf(CARDS, HOME.id, GUEST.id);
    expect(shown).toBe(GUEST);
    expect(pending).toBe(true);
  });

  it("выбранное совпало с комнатой — расхождения нет", () => {
    const { shown, pending } = previewOf(CARDS, HOME.id, HOME.id);
    expect(shown).toBe(HOME);
    expect(pending).toBe(false);
  });

  it("ищет по ПОЛНОМУ списку, а не по отфильтрованной ленте", () => {
    // Переключатель заготовки полок прячет часть карточек. Своя комната
    // запросто оказывается среди спрятанных — искать в ленте значило бы терять
    // её из кадра от нажатия соседнего тумблера.
    const feminine = CARDS.filter((card) => card.sex === "F");
    expect(previewOf(feminine, GUEST.id, GUEST.id).shown).toBeNull();
    expect(previewOf(CARDS, GUEST.id, GUEST.id).shown).toBe(GUEST);
  });

  it("незнакомый выбор откатывается к комнате, а не гасит кадр", () => {
    const { shown, pending } = previewOf(CARDS, HOME.id, "нет-такого");
    expect(shown).toBe(HOME);
    expect(pending).toBe(false);
  });

  it("незнакома и сама комната — показывать нечего, но и «не применён» не врёт", () => {
    const { shown, pending } = previewOf(CARDS, "нет-такого", "нет-такого");
    expect(shown).toBeNull();
    expect(pending).toBe(false);
  });
});

describe("кадр в разметке", () => {
  it("стартует с того, что стоит в комнате, и подписан спокойно", () => {
    const markup = renderStudio(HOME.id);
    expect(imageAddresses(markup)).toEqual([HOME.imageUrl]);
    expect(markup).toContain(ru.Settings.studioApplied);
    expect(markup).not.toContain("ещё не в комнате");
  });

  it("расхождение подписано словами и названо по имени — соврать здесь дорого", () => {
    // Кадр показывает гостевой интерьер, комната — свой. Человек, решивший,
    // что переезд уже случился, не поймёт потом, куда делись вещи с полок.
    const markup = renderFrame(GUEST, true);
    expect(markup).toContain(GUEST.name);
    expect(markup).toContain("ещё не в комнате");
    expect(markup).toContain(ru.Settings.presetApply); // зовёт к соседней кнопке
    expect(markup).not.toContain(ru.Settings.studioApplied);
    // Акцент показанной комнаты — и у подписи, и у точки перед ней.
    expect(markup).toContain(`--preview-accent:${GUEST.accent}`);
  });

  it("грейдинг считается от родного времени суток ПОКАЗАННОЙ базы, а не комнаты", () => {
    // Комната гостевая (база ночная) — фильтр обязан быть ночным рецептом.
    const markup = renderStudio(GUEST.id, "morning", "white");
    const fromShown = gradingFilter("morning", "white", GUEST.tod);
    const fromWrongBase = gradingFilter("morning", "white", HOME.tod);
    expect(fromShown).not.toBe(fromWrongBase); // иначе проверка ничего не значит
    expect(markup).toContain(fromShown);
    expect(markup).not.toContain(fromWrongBase);
  });

  it("ни одного нового адреса картинки: кадр берёт файл ленты", () => {
    // Условие тикета — «ни одного нового запроса за картинкой сверх тех, что
    // уже идут». Кадр рисуется тем же `imageUrl`, что и плитка.
    const addresses = imageAddresses(renderStudio(GUEST.id));
    expect(addresses).toHaveLength(1);
    expect(CARDS.map((card) => card.imageUrl)).toContain(addresses[0]);
  });

  it("незнакомый пресет комнаты — кадра нет, экран не падает", () => {
    const markup = renderStudio("нет-такого");
    expect(imageAddresses(markup)).toEqual([]);
  });
});

// ---------- Замок 2 и 3: комнату меняет только «Переехать» ----------

describe("превью НЕ меняет комнату до «Переехать» — инвариант тикета", () => {
  it("тап по плитке ленты зовёт только выбор кадра", () => {
    expect(sections).toMatch(/onClick=\{\(\) => select\(preset\.id\)\}/u);
  });

  it("комнату пишет ровно один вызов, и он под кнопкой «Переехать»", () => {
    const calls = [...sections.matchAll(/changePresetAction\(/gu)];
    expect(calls).toHaveLength(1);
    // Вызов стоит внутри apply() — обработчика кнопки, а не плитки.
    expect(sections).toMatch(/function apply\(\)[\s\S]{0,400}changePresetAction\(/u);
    expect(sections).toMatch(/onClick=\{apply\}/u);
  });

  it("сам кадр серверных действий не знает вовсе", () => {
    // Файл кадра — состояние и разметка. Появись здесь экшен, инвариант
    // пришлось бы стеречь в двух местах вместо одного.
    expect(studioSource).not.toMatch(/Action\(/u);
    expect(studioSource).not.toContain("./actions");
  });

  it("«Переехать» предлагается по КАДРУ, а не по отфильтрованной ленте", () => {
    // Иначе кнопка пропадает от переключения заготовки полок, кадр продолжает
    // показывать выбранное, а применить его становится нечем.
    expect(sections).toMatch(/const selectedCard = shown;/u);
    expect(sections).toMatch(/const dirty = pending;/u);
  });
});

// ---------- Числа кадра ----------

describe("числа крупного кадра", () => {
  it("пропорция — система кадра 630×351 (ADR-0006), а не своя", () => {
    expect(css).toMatch(/aspect-ratio:\s*630\s*\/\s*351/u);
    // Растяжка, а не обрезка: так же показывает кадр сама сцена.
    expect(css).toMatch(/background-size:\s*100% 100%/u);
  });

  it("кадр липкий и остаётся на виду, пока крутят обе ручки", () => {
    expect(css).toMatch(/\.dock\s*\{[^}]*position:\s*sticky/u);
    expect(css).toMatch(/\.dock\s*\{[^}]*top:\s*0/u);
    // Фон обязателен: под липким кадром проезжает содержимое страницы.
    expect(css).toMatch(/\.dock\s*\{[^}]*background:\s*var\(--color-surface-app-ground\)/u);
    // Липкость живёт внутри блока «Интерьер + Свет» — оба раздела внутри него.
    expect(page).toMatch(/<RoomStudio[\s\S]*?<PresetSection[\s\S]*?<LightSection[\s\S]*?<\/RoomStudio>/u);
  });

  it("на широком экране рост кадра ограничен — липкий блок не съедает окно", () => {
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\.frame\s*\{\s*max-width:\s*520px/u);
  });
});

// ---------- Числа положений света ----------

describe("положения света", () => {
  it("три положения времени суток и три цвета — столько же, сколько в контракте", () => {
    expect(TIMES_OF_DAY).toHaveLength(3); // «ночь» упразднена, тикет 133
    expect(LIGHT_COLORS).toHaveLength(3);
    expect(css).toMatch(/\.knobRow\s*\{[^}]*grid-template-columns:\s*repeat\(3,/u);
  });

  it("цель нажатия — не меньше 44 (контракт rooms.json → hitTargetMin)", () => {
    expect(css).toMatch(/\.knob\s*\{[^}]*min-height:\s*var\(--hit-target-min,\s*44px\)/u);
  });

  it("выбранное видно без сравнения с соседями: заливка и галочка", () => {
    // Половина жалобы «непонятно» была именно в этом: единственным отличием
    // выбранного был ЦВЕТ СЛОВА, и понять его можно было, только прочитав все
    // три подписи подряд.
    expect(css).toMatch(/\.knobOn\s*\{[^}]*background:\s*var\(--knob-accent/u);
    expect(sections).toMatch(/\{on && <IconCheck/u);
    expect(sections).toMatch(/aria-pressed=\{on\}/u);
  });

  it("превью с плиток снято: своих картинок у положений больше нет", () => {
    // Осталось ровно два адреса на весь файл секций — аватар и плитка ленты.
    const urls = [...sections.matchAll(/url\(\$\{([^}]+)\}\)/gu)].map((match) => match[1]);
    expect(urls).toEqual(["avatarUrl", "preset.imageUrl"]);
    // И ровно один источник адресов комнат на всю страницу.
    expect([...page.matchAll(/roomImageUrl\(/gu)]).toHaveLength(1);
  });

  it("оптимистичность цела: кадр меняется в момент нажатия, а не после сервера", () => {
    // Сначала состояние кадра, потом экшен — порядок и есть оптимистичность.
    expect(sections).toMatch(/setTimeOfDay\(option\);\s*run\(/u);
    expect(sections).toMatch(/setLightColor\(option\);\s*run\(/u);
  });
});

// ---------- Строки ----------

describe("строки кадра", () => {
  for (const key of ["studioApplied", "studioPending"] as const) {
    it(`${key} — есть и в русском словаре, и в английском каркасе`, () => {
      expect(typeof ru.Settings[key]).toBe("string");
      expect(typeof en.Settings[key]).toBe("string");
    });
  }

  it("подпись расхождения называет интерьер и зовёт к той кнопке, что рядом", () => {
    expect(ru.Settings.studioPending).toContain(ru.Settings.presetApply);
    expect(en.Settings.studioPending).toContain(en.Settings.presetApply);
  });
});
