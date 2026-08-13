// ГРАНИЦА ЛИПКОСТИ КАДРА НАСТРОЕК (тикет 228).
//
// ОТКУДА. Приёмка владельца 14.08.2026, замечание 6: «В настройках когда
// смещаюсь вниз в мобильной версии зачем-то комната летает со мной прибитая
// сверху».
//
// ЧТО ДЕРЖИТ ЛИПКОСТЬ В БЕРЕГАХ. Ничего, кроме РОДИТЕЛЯ: `position: sticky`
// не умеет выйти за свой содержащий блок. Значит вся граница — это ответ на
// один вопрос: внутри чего лежит док. Он обязан лежать внутри обёртки
// «Интерьер + Свет» (`RoomStudio` → `.studio`), которая держит и сам док, и
// ОБЕ ручки света. Тогда кадр стоит, пока человек в этих двух разделах, и
// уезжает вместе с ними; вынеси док на уровень страницы — и он поедет над
// именем, адресом комнаты, полками и данными, которым он не нужен.
//
// ЗАЧЕМ ТЕСТ, А НЕ ГЛАЗА. Ломается это молча и одной строкой: достаточно
// перенести `<RoomFrame>` выше обёртки или завернуть в `<RoomStudio>` лишние
// разделы — экран при первом взгляде выглядит так же, а липкость получает
// новые берега. Ни типы, ни линт про это ничего не знают.
//
// ЗАМЕР (повтор структуры настроек: те же классы модуля и те же числа
// Tailwind; поднять настоящий экран нечем — сервер в прогоне не поднимаем):
//   375×812 — кадр 0…208.9, липкий блок 0…243.7 (30% телефона), блок
//             «Интерьер + Свет» 109.6…1226.6, кадр приколот 873 px прокрутки
//             и отпускается ровно там, где низ блока доходит до низа кадра;
//   390×664 — липкий блок 0…252.2 (38%), приколот 896;
//   1280×800 — кадр 520×289.7, липкий блок 0…324.4 (41%), приколот 987.
// Ни на одной ширине док не наезжает на «О себе»: разделы ниже начинаются
// после низа блока. Проверка ниже сторожит именно это — берега, а не числа
// (числа сторожит `settings-live-preview.test.ts`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

const { RoomStudio } = await import("../src/app/settings/room-studio");
const styles = (await import("../src/app/settings/room-studio.module.css")).default as Record<
  string,
  string
>;

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../src/app/settings/page.tsx");
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

/** Метка на месте разделов: страница отдаёт их обёртке детьми. */
const KNOBS_MARK = "ручки-света-стоят-здесь";

function studioMarkup(): string {
  return renderToStaticMarkup(
    createElement(
      RoomStudio,
      { cards: [CARD], currentPreset: CARD.id, timeOfDay: "day", lightColor: "warm" },
      createElement("section", null, KNOBS_MARK),
    ),
  );
}

/**
 * Конец элемента `<div>`, начатого в `openIndex`: считаем вложенность до
 * парного закрывающего тега. Самозакрывающихся `div` React не печатает, так
 * что счёта хватает — а вложенность и есть то, что проверяет этот файл.
 */
function divCloseIndex(markup: string, openIndex: number): number {
  const tags = /<(\/?)div\b/gu;
  tags.lastIndex = openIndex;
  let depth = 0;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return match.index;
  }
  return -1;
}

describe("липкий кадр не выходит за свой раздел (тикет 228)", () => {
  it("док лежит ВНУТРИ обёртки «Интерьер + Свет», а не рядом с ней", () => {
    const markup = studioMarkup();
    const studioOpen = markup.indexOf(`class="${styles.studio}"`);
    const dockAt = markup.indexOf(`class="${styles.dock}"`);

    expect(studioOpen).toBeGreaterThanOrEqual(0);
    expect(dockAt).toBeGreaterThanOrEqual(0);
    // Обёртка — корень разметки: перед ней не стоит ничего, что могло бы
    // унести кадр на уровень выше.
    expect(markup.startsWith("<div")).toBe(true);
    expect(studioOpen).toBeLessThan(markup.indexOf(">"));

    const studioEnd = divCloseIndex(markup, 0);
    expect(studioEnd).toBeGreaterThan(0);
    expect(dockAt).toBeGreaterThan(studioOpen);
    expect(dockAt).toBeLessThan(studioEnd);
  });

  it("обе ручки света лежат в той же обёртке — иначе липнуть незачем", () => {
    // Смысл липкости: пока на экране раздел света, кадр и ручки видны разом.
    // Уедут ручки из обёртки — кадр останется приколотым над чужими
    // разделами, а это ровно то, на что владелец и жаловался.
    const markup = studioMarkup();
    const studioEnd = divCloseIndex(markup, 0);
    const knobsAt = markup.indexOf(KNOBS_MARK);
    const dockAt = markup.indexOf(`class="${styles.dock}"`);

    expect(knobsAt).toBeGreaterThan(dockAt);
    expect(knobsAt).toBeLessThan(studioEnd);
  });

  it("в обёртке ровно два раздела: «Интерьер» и «Свет» — и ни одного чужого", () => {
    // Липкость кончается там, где кончается обёртка. Завернуть в неё «О себе»
    // или «Полки» значит продлить кадр на них — тикет 228 ровно про это.
    const inside = page.match(/<RoomStudio[\s\S]*?<\/RoomStudio>/u)?.[0] ?? "";
    expect(inside).not.toBe("");
    const sections = [...inside.matchAll(/<([A-Z][A-Za-z]*)Section\b/gu)].map((m) => m[1]);
    expect(sections).toEqual(["Preset", "Light"]);
  });

  it("остальные семь разделов страницы стоят СНАРУЖИ обёртки", () => {
    const inside = page.match(/<RoomStudio[\s\S]*?<\/RoomStudio>/u)?.[0] ?? "";
    const outside = page.replace(inside, "");
    for (const name of [
      "ProfileSection",
      "NickSection",
      "ZonesSection",
      "BirthdaySection",
      "HallSection",
      "AccessSection",
      "DataSection",
    ]) {
      expect(outside).toContain(`<${name}`);
    }
  });

  it("липкость в модуле ровно одна и стоит на доке, а не на обёртке", () => {
    // Обёртке липкость не нужна и вредна: приколотый блок из двух разделов
    // занял бы экран целиком. И вторая липкость в файле означала бы вторые
    // берега — то есть второе поведение, которого никто не мерил.
    const sticky = [...css.matchAll(/position:\s*sticky/gu)];
    expect(sticky).toHaveLength(1);
    expect(css).toMatch(/\.dock\s*\{[^}]*position:\s*sticky/u);
    expect(css).not.toMatch(/\.studio\s*\{[^}]*position:/u);
    // Своей прокрутки у обёртки нет: липкость держит документ. Появись здесь
    // `overflow`, кадр перестал бы липнуть вовсе — берега стали бы окном.
    expect(css).not.toMatch(/\.studio\s*\{[^}]*overflow/u);
  });
});
