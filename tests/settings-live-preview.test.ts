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

/** Кадр в отрыве от состояния: девять сочетаний ручек достижимы вызовом. */
function renderFrame(
  card: PresetCard,
  timeOfDay: TimeOfDay = "day",
  lightColor: LightColor = "warm",
): string {
  return renderToStaticMarkup(createElement(RoomFrame, { card, timeOfDay, lightColor }));
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
  it("стартует с того, что стоит в комнате", () => {
    const markup = renderStudio(HOME.id);
    expect(imageAddresses(markup)).toEqual([HOME.imageUrl]);
  });

  // СТРОКА СОСТОЯНИЯ — ВТОРОЙ АБСОЛЮТНЫЙ СИГНАЛ (тикет 185, пакет 43). До неё
  // выбранное положение света было названо только заливкой плитки: сигнал
  // хороший, но один. Теперь выбранное сказано словами, и сравнивать плитку
  // с соседями не нужно.
  it("под кадром сказано словами, что именно выбрано — комната, время и свет", () => {
    const markup = renderFrame(GUEST, "dusk", "white");
    expect(markup).toContain(GUEST.name);
    expect(markup).toContain(ru.Settings.state_dusk);
    expect(markup).toContain(ru.Settings.state_white);
    // Не только видно, но и слышно: кадр читалке не говорит ничего.
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(`--preview-accent:${GUEST.accent}`);
  });

  it("строка состояния меняется вместе с ручками, а не показывает одно и то же", () => {
    // ЦВЕТА ЗДЕСЬ ДВА, А НЕ ТРИ (тикет 256): «свечной» упразднён — владелец не
    // отличил его от тёплого на комнате. Проверка та же: обе ручки обязаны
    // менять строку, и ни одно положение не должно называть чужое слово.
    const dusk = renderFrame(HOME, "dusk", "white");
    const morning = renderFrame(HOME, "morning", "warm");
    expect(dusk).toContain(ru.Settings.state_dusk);
    expect(dusk).toContain(ru.Settings.state_white);
    expect(dusk).not.toContain(ru.Settings.state_warm);
    expect(morning).toContain(ru.Settings.state_morning);
    expect(morning).toContain(ru.Settings.state_warm);
    expect(morning).not.toContain(ru.Settings.state_white);
  });

  // НАСТОЯЩИЙ КРОССФЕЙД, А НЕ ПОДМЕНА ГРАДИЕНТА (пакет 43). Пока слои
  // рисовались по текущему сочетанию ручек, смена света размонтировала одни
  // узлы и монтировала другие — то есть шла ВСТЫК. Проверять это глазами
  // нечем (панель браузера кадры не композитит), поэтому проверяем СОСТАВ:
  // набор слоёв обязан быть один и тот же при любом положении ручек, меняться
  // может только непрозрачность.
  it("слои лежат стопкой при любом положении ручек — меняется только непрозрачность", () => {
    const layers = (markup: string) => [...markup.matchAll(/mix-blend-mode:/gu)].length;
    const lit = (markup: string) => [...markup.matchAll(/opacity:1/gu)].length;

    const dusk = renderFrame(HOME, "dusk", "white");
    const morning = renderFrame(HOME, "morning", "warm");

    expect(layers(dusk)).toBeGreaterThan(0);
    expect(layers(morning)).toBe(layers(dusk));
    // Горит при этом не всё подряд — иначе «стопка» была бы просто кашей.
    expect(lit(dusk)).toBeLessThan(layers(dusk));
    expect(lit(dusk)).toBeGreaterThan(0);
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

  // КАДР ВО ВСЮ ШИРИНУ ТЕЛЕФОНА (тикет 185, пакет 43): «кадр целиком — он и
  // есть комната». Было 335.2×186.8 на 375 (столбец с полями 20), стало
  // 375×208.9 — та же пропорция, просто без полей.
  it("на телефоне кадр идёт во всю ширину, а на широком экране полей уже нет", () => {
    expect(css).toMatch(/\.dock\s*\{[^}]*margin-inline:\s*-20px/u);
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.dock\s*\{\s*margin-inline:\s*0/u);
    // Текст под кадром при этом остаётся по столбцу страницы.
    expect(css).toMatch(/\.state\s*\{[^}]*padding-inline:\s*20px/u);
  });

  // ЧИСЛО ДВИЖЕНИЯ ОДНО НА ВСЕ ТРИ СЛОЯ (motion.json: 460, easing out). Пока
  // фильтр ехал 400, а слои не ехали вовсе, движений было два — и второе было
  // мгновенным. Это и есть остаток «мигания».
  it("фильтр, слои и крест баз идут одним числом — 460 из motion.json", () => {
    expect(css).toMatch(/\.photo\s*\{[^}]*transition:\s*filter 460ms/u);
    expect(css).toMatch(/\.grade\s*\{[^}]*transition:\s*opacity 460ms/u);
    expect(css).toMatch(/\.baseLeaving\s*\{\s*animation:\s*baseOut 460ms/u);
  });

  it("prefers-reduced-motion укорачивает движение, а не убивает его", () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(reduced).toMatch(/\.photo,\s*\n?\s*\.grade\s*\{[^}]*transition-duration:\s*120ms/u);
    expect(reduced).toMatch(/\.baseLeaving\s*\{[^}]*animation-duration:\s*120ms/u);
  });
});

// ---------- Примерка ----------

describe("примерка — состояние с именем и второй дверью", () => {
  it("цена переезда сказана ВНУТРИ примерки, а не подписью после неё", () => {
    // Честное имя состояния и есть цена: смена интерьера двигает вещи между
    // полками, и сказать об этом надо там, где решают, а не там, где уже всё.
    expect(sections).toMatch(/studio\.tryOn[\s\S]{0,900}presetHint/u);
  });

  it("выход из примерки чистый: возвращает показанное к тому, что в комнате", () => {
    // Ни одного серверного действия «отменить» здесь нет и не нужно —
    // примерка кончается равенством, а равенство ставится на клиенте.
    expect(sections).toMatch(/onClick=\{\(\) => select\(currentPreset\)\}/u);
    // И оно правда гасит расхождение — это уже уровень чистой функции.
    expect(previewOf(CARDS, HOME.id, HOME.id).pending).toBe(false);
  });

  it("«Переехать» остаётся главной кнопкой, отмена — тихой", () => {
    expect(sections).toMatch(/<LightButton[\s\S]{0,200}presetApply/u);
    expect(css).toMatch(/\.tryOnCancel\s*\{[^}]*background:\s*none/u);
  });
});

// ---------- Числа положений света ----------

describe("положения света", () => {
  it("три положения времени суток и два цвета — столько же, сколько в контракте", () => {
    expect(TIMES_OF_DAY).toHaveLength(3); // «ночь» упразднена, тикет 133
    expect(LIGHT_COLORS).toHaveLength(2); // «свечной» упразднён, тикет 256
  });

  // РЯДЫ РАЗНОЙ ДЛИНЫ — И ЧИСЛА КОЛОНОК В CSS НЕТ НИ ОДНОГО (тикет 256).
  // Пока в правиле стояло `repeat(3, …)`, ряд света остался бы с пустой
  // клеткой на месте снятого положения: класс `.knobRow` один на оба ряда.
  // Теперь колонки считает сам grid по числу детей — снимут положение или
  // вернут, здесь править нечего, и соврать этому файлу больше нечем.
  it("колонок в ряду столько, сколько положений, — число не написано руками", () => {
    expect(css).toMatch(/\.knobRow\s*\{[^}]*grid-auto-flow:\s*column/u);
    expect(css).toMatch(/\.knobRow\s*\{[^}]*grid-auto-columns:\s*minmax\(0, 1fr\)/u);
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(\d/u);
    // Оба ряда набраны перебором словаря, а не списком руками — иначе снятое
    // положение однажды вернулось бы отдельной строкой.
    expect(sections).toContain("{TIMES_OF_DAY.map((option) => (");
    expect(sections).toContain("{LIGHT_COLORS.map((option) => (");
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
  const KEYS = [
    "roomState",
    "state_morning",
    "state_day",
    "state_dusk",
    "state_warm",
    "state_white",
    "tryOn",
    "tryOnLine",
    "tryOnCancel",
  ] as const;

  for (const key of KEYS) {
    it(`${key} — есть и в русском словаре, и в английском каркасе`, () => {
      expect(typeof ru.Settings[key]).toBe("string");
      expect(typeof en.Settings[key]).toBe("string");
    });
  }

  // СНЯТОЕ ПОЛОЖЕНИЕ УНОСИТ СВОИ СТРОКИ (тикет 256, тот же приём и тот же
  // довод, что у «ночи» в тикете 133): сирота без употребления рано или поздно
  // возвращается в интерфейс как «готовая строка», а `Settings.state_candle`
  // при этом ещё и сериализуется в разметку КАЖДОЙ страницы (правило тикета
  // 29). Проверка двусторонняя: снятого нет, живое на месте — иначе ряд
  // положений показал бы человеку имя ключа.
  it("строк «Свечной» и «свечной свет» в словаре не осталось", () => {
    for (const dict of [ru.Settings, en.Settings] as Record<string, string>[]) {
      expect(dict).not.toHaveProperty("light_candle");
      expect(dict).not.toHaveProperty("state_candle");
    }
  });

  it("у каждого живого положения света подпись и слово состояния на месте", () => {
    for (const color of LIGHT_COLORS) {
      expect(ru.Settings[`light_${color}`], color).toBeTruthy();
      expect(en.Settings[`light_${color}`], color).toBeTruthy();
      expect(ru.Settings[`state_${color}`], color).toBeTruthy();
      expect(en.Settings[`state_${color}`], color).toBeTruthy();
    }
  });

  it("строка состояния собирается из трёх мест, а не из одного", () => {
    // Иначе она называла бы комнату и молчала про свет — то есть повторяла бы
    // ленту вместо того, чтобы отвечать за вторую ручку.
    for (const token of ["{room}", "{tod}", "{light}"]) {
      expect(ru.Settings.roomState).toContain(token);
      expect(en.Settings.roomState).toContain(token);
    }
  });

  it("примерка называет интерьер по имени", () => {
    expect(ru.Settings.tryOnLine).toContain("{name}");
    expect(en.Settings.tryOnLine).toContain("{name}");
  });

  // СЛОВО «КАДР» В ИНТЕРФЕЙСЕ НЕ СУЩЕСТВУЕТ — правило памятки тона самого
  // дизайна (`handoff/tone.md`: «Слова из технического контракта… наши, не
  // пользовательские»). Пакет 43 прислал `tryOnLine` со словами «пока только
  // на этом кадре» — то есть нарушил собственное правило, и общий сторож тона
  // это поймал. Держим проверку и здесь, рядом со строкой: она про эту строку.
  it("строки примерки не говорят техническими словами", () => {
    for (const value of [ru.Settings.tryOn, ru.Settings.tryOnLine, ru.Settings.tryOnCancel]) {
      expect(value).not.toMatch(/кадр[а-я]*/iu);
    }
  });
});
