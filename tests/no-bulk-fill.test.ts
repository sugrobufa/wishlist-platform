// СТОРОЖ ОТСУТСТВИЯ: КОМНАТУ НАПОЛНЯЕТ ТОЛЬКО ХОЗЯЙКА (тикет 191).
//
// Решение владельца, приёмка 11.08.2026: «нужно выпилить функционал
// автоматического наполнения комнаты. Для любой женщины это оскорбление, ведь
// она сама должна наполнить пространство». Довод его же: комната — своё
// пространство, и наполнить его чужой рукой значит отнять единственное, ради
// чего человек сюда пришёл.
//
// ЗАЧЕМ ТЕСТ, КОТОРЫЙ НИЧЕГО НЕ ЗОВЁТ. **Функция, выпиленная без сторожа,
// возвращается.** Удаление живёт в истории git, а требование — нигде: следующий
// раунд дизайна пришлёт «начни с готового» снова (он его автор — доска Б23 ·
// турн 12c, вердикт «по согласию»), и вернуть кнопку будет дешевле, чем вспомнить
// разговор. Здесь записано само требование, и красным оно станет на любом из
// путей возврата — на строке словаря, на стиле, на сервисе, на экшене.
//
// ГРАНИЦА ПРАВИЛА — «ПАЧКОЙ ПО ОДНОМУ НАЖАТИЮ ЧЕЛОВЕКА», А НЕ «МНОГО ВЕЩЕЙ».
// Живыми остаются двое, и оба не предложение человеку:
//   • ПОСЕВ СТЕНДА (`npm run db:seed`, `/dev-login`, тикет 175) — наш инструмент
//     разработки: он наполняет комнату СТЕНДА, чтобы владельцу было что
//     принимать. В интерфейсе продукта дороги к нему нет;
//   • ДЕМО-ПРИЗРАКИ (`look.ghost`, `demoBadge`) — они показывают, как выглядит
//     полка с вещами, и вещами не становятся (поле DTO, а не строка БД).
//
// БАЗА НЕ ТРОГАЕТСЯ (граница тикета): вещи, положенные набором у живых комнат,
// остаются вещами их хозяек — они уже свои. Удалений по признаку происхождения
// не было и не будет, поэтому проверять здесь нечего: их отсутствие и есть
// отсутствие такого кода.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Все исходники продукта: по ним ищутся следы возврата. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css)$/u.test(entry) ? [full] : [];
  });
}

const files = sourceFiles(SRC);
const sources = files.map((file) => [file.slice(SRC.length + 1), readFileSync(file, "utf8")] as const);

/** Найти имя во всех исходниках, кроме комментариев (они рассказывают историю). */
function mentions(pattern: RegExp): string[] {
  return sources
    .filter(([, body]) =>
      body
        .split(/\r?\n/u)
        .some((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line) && pattern.test(line)),
    )
    .map(([name]) => name);
}

const ownerPage = read("../src/app/room/page.tsx");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;
const en = JSON.parse(read("../messages/en.json")) as Record<string, Record<string, string>>;

describe("автонаполнения комнаты не существует ни одним путём", () => {
  it("ни одного имени набора в исходниках продукта", () => {
    // Проверка тикета дословно: «grep по src/ на starterPack|StarterPack|
    // applyStarterPack — пусто». Комментарии не в счёт: они и должны говорить,
    // куда делся набор и почему.
    expect(mentions(/starterPack|StarterPack|applyStarterPack/u)).toEqual([]);
  });

  it("файлов набора нет: ни компонента, ни экшенов, ни сервиса", () => {
    for (const gone of [
      "app/room/starter-pack.tsx",
      "app/room/starter-pack-actions.ts",
      "server/services/starter-pack.ts",
    ]) {
      expect(
        files.map((file) => file.slice(SRC.length + 1).split("\\").join("/")),
        `${gone} вернулся`,
      ).not.toContain(gone);
    }
  });

  it("в словарях не осталось ни одной строки набора и ни одного вопроса анкеты", () => {
    // Строка живёт дольше кода: раздел словаря — самая дешёвая дорога назад.
    expect(ru.StarterPack).toBeUndefined();
    expect(en.StarterPack).toBeUndefined();
    for (const key of ["wantsTitle", "wantsSubtitle", "wantsMax", "wantsStep", "wantsSkip"]) {
      expect(ru.Onboarding?.[key], `ru Onboarding.${key}`).toBeUndefined();
      expect(en.Onboarding?.[key], `en Onboarding.${key}`).toBeUndefined();
    }
    // …и ни одной строки, обещающей наполнить комнату пачкой, под другим именем.
    const all = Object.entries(ru).flatMap(([section, entries]) =>
      typeof entries === "object" && entries !== null
        ? Object.entries(entries).map(([key, value]) => `${section}.${key} = ${String(value)}`)
        : [],
    );
    expect(all.filter((line) => /начни с готового|начать с готового/iu.test(line))).toEqual([]);
  });

  it("стилей блока набора не осталось", () => {
    // Стиль без разметки — приглашение нарисовать под него разметку заново.
    expect(mentions(/\.imm-starter/u)).toEqual([]);
  });

  it("отметки «вопрос уже задавали» нет: спрашивать больше нечего", () => {
    expect(mentions(/STARTER_WANTS_ASKED_KEY/u)).toEqual([]);
    // Предложение собрать СВОЮ комнату — другое и живо (тикет 38).
    expect(read("../src/app/r/[slug]/booking/ask-once.ts")).toContain("ROOM_OFFER_ASKED_KEY");
  });
});

describe("пустая комната: одно действие, и оно рождает ОДНУ вещь", () => {
  it("единственная дорога из блока первого шага ведёт в форму добавления", () => {
    // Блок пустой комнаты (слот `below`) целиком: в нём не должно остаться ни
    // второй кнопки, ни второго адреса. Форма добавления заводит РОВНО ОДНУ
    // вещь за сохранение — это и есть граница «не пачкой».
    const slot = ownerPage.slice(
      ownerPage.indexOf("emptyRoom ? ("),
      ownerPage.indexOf(") : itemCount < SHARE_READY_ITEMS"),
    );
    expect(slot, "слот пустой комнаты не найден — проверь разметку страницы").not.toBe("");

    const hrefs = [...slot.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);
    expect(hrefs).toEqual(["/room/add"]);

    const buttons = [...slot.matchAll(/<button\b/gu)];
    expect(buttons, "в пустой комнате появилась кнопка помимо полосы света").toHaveLength(0);
  });

  it("комната не зовёт ни одного сервиса, кладущего вещи пачкой", () => {
    // `createItem` в цикле по зонам — это и есть автонаполнение, как бы оно ни
    // называлось. Страница комнаты вещей не создаёт вовсе.
    expect(ownerPage).not.toMatch(/createItem|seedStandRoom|standPoolSeeds|livePoolSeeds/u);
  });

  it("зёрна пакета доступны только посеву стенда", () => {
    // Единственные потребители `pack-seeds` — стенд и его тест. Появится
    // третий, живущий в продуктовом маршруте, — набор вернулся под новым именем.
    const users = mentions(/from "@\/server\/services\/pack-seeds"/u);
    expect(users.map((file) => file.split("\\").join("/"))).toEqual([
      "server/services/stand-seed.ts",
    ]);
  });
});
