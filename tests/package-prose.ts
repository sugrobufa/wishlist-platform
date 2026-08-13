// ПРОЗА ПАКЕТА — ОДИН ЧИТАТЕЛЬ НА ДВУХ СТОРОЖЕЙ (тикет 240).
//
// Что такое «проза пакета» и почему она отдельно от контракта. Пакет дизайна
// состоит из двух разных веществ: ЗНАЧЕНИЯ, которые читает код (координаты,
// токены, строки словаря), и ТЕКСТ, который читает человек, — README, CHANGES,
// ключи с подчёркиванием, поля `note`/`why`/`rule` внутри контрактов. Первое
// проверено насквозь: на каждое число есть тест. Второе не проверял никто, и
// именно там дизайн промахнулся счётом три раза за четыре пакета, а мы ловили
// его руками четырежды (38 против 5, «шесть и четырнадцать» против 7 и 13,
// 15 против 19, «стало 23» против 22).
//
// Слова самого дизайна, письмо к пакету 52: **«Это не внимательность, это
// отсутствующая проверка»**. Обе проверки, которые он предложил, читают отсюда.
//
// ГРАНИЦА ЧИТАТЕЛЯ: он только достаёт текст и говорит, ГДЕ тот лежит. Ни одного
// правила здесь нет — правила у сторожей. Место (`file` + `place`) обязательно:
// сторож, который не может назвать файл и строку, глазами пропускают.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const HANDOFF = resolve(__dirname, "../design/package/handoff");

export type Prose = {
  /** Путь относительно `handoff/` — так он и печатается в отчёте. */
  readonly file: string;
  /** Номер строки у `.md`, путь ключа у `.json`. */
  readonly place: string;
  readonly text: string;
};

/** «Файл:место» — единственная форма адреса, которую печатают сторожа. */
export const at = ({ file, place }: Prose) => `${file}:${place}`;

/**
 * ПРОЗАИЧЕСКИЕ КЛЮЧИ КОНТРАКТА. Ключ с подчёркиванием — записка дизайна самому
 * себе или нам (`_rule`, `_examples`, `_letter57`), а `note`/`why`/`rule` —
 * объяснение рядом со значением. Всё остальное в контракте это ДАННЫЕ: числа,
 * координаты, строки словаря. Их сторожат другие тесты и по-другому.
 *
 * Контейнеры (`rules: { gender: "…" }`) считаются прозой целиком: внутри такого
 * узла строк-данных не бывает, а правило письма — самый прозаический текст в
 * пакете.
 */
const PROSE_KEY = /^_|^(?:note|notes|why|rule|rules)$/u;

const isProseKey = (key: string) => PROSE_KEY.test(key);

function collectStrings(file: string, node: unknown, path: string[], out: Prose[]): void {
  if (typeof node === "string") {
    out.push({ file, place: path.join("."), text: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectStrings(file, value, [...path, String(index)], out));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    collectStrings(file, value, [...path, key], out);
  }
}

function collectJson(file: string, node: unknown, path: string[], out: Prose[]): void {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectJson(file, value, [...path, String(index)], out));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const next = [...path, key];
    if (isProseKey(key)) collectStrings(file, value, next, out);
    else collectJson(file, value, next, out);
  }
}

function readOne(relative: string): Prose[] {
  const full = join(HANDOFF, relative);
  const out: Prose[] = [];
  if (relative.endsWith(".md")) {
    readFileSync(full, "utf8")
      .split(/\r?\n/u)
      .forEach((text, index) => {
        if (text.trim() !== "") out.push({ file: relative, place: String(index + 1), text });
      });
    return out;
  }
  if (relative.endsWith(".json")) {
    collectJson(relative, JSON.parse(readFileSync(full, "utf8")), [], out);
    return out;
  }
  return out;
}

/**
 * Проза одного файла или целой папки пакета. Папка читается на один уровень —
 * раунд это плоская пачка файлов, и подпапок в нём не бывает.
 */
export function proseOf(...relatives: readonly string[]): Prose[] {
  const out: Prose[] = [];
  for (const relative of relatives) {
    const full = join(HANDOFF, relative);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) {
        if (statSync(join(full, name)).isFile()) out.push(...readOne(`${relative}/${name}`));
      }
    } else out.push(...readOne(relative));
  }
  return out;
}

/**
 * ВЕСЬ ТЕКСТ области, а не только прозаические ключи. Сторожу СЧЁТА нужен
 * именно он: обещание «27 ключей раздела `Pool.*`» дизайн положил в ключ `pool`
 * своей дельты — ни подчёркивания, ни имени `note` там нет, и по узкому чтению
 * оно проехало бы мимо. Ложных тревог это не добавляет: числа сторож считает не
 * по корпусу, а по ЯКОРЮ, и без якоря молчит.
 */
export function textOf(...relatives: readonly string[]): Prose[] {
  const out: Prose[] = [];
  for (const relative of relatives) {
    const full = join(HANDOFF, relative);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) {
        if (statSync(join(full, name)).isFile()) out.push(...readAll(`${relative}/${name}`));
      }
    } else out.push(...readAll(relative));
  }
  return out;
}

function readAll(relative: string): Prose[] {
  const out: Prose[] = [];
  if (relative.endsWith(".md")) return readOne(relative);
  if (relative.endsWith(".json"))
    collectStrings(relative, JSON.parse(readFileSync(join(HANDOFF, relative), "utf8")), [], out);
  return out;
}

/** Все `.json` папки — сторожу счёта нужны ВСЕ файлы, а не только прозаические. */
export const jsonFilesIn = (relative: string): string[] =>
  readdirSync(join(HANDOFF, relative))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => `${relative}/${name}`);

/** Имена файлов верхнего уровня — оттуда сторожа берут свой корпус. */
export const topLevelFiles = (): string[] =>
  readdirSync(HANDOFF)
    .filter((name) => statSync(join(HANDOFF, name)).isFile())
    .sort();

/** Папки раундов по возрастанию номера: `round29` … `round52`. */
export const roundDirs = (): string[] =>
  readdirSync(HANDOFF)
    .filter((name) => /^round\d+$/u.test(name) && statSync(join(HANDOFF, name)).isDirectory())
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));

/** Последний приехавший раунд. Сторожа читают его наравне с живыми файлами. */
export const newestRound = (): string => roundDirs().at(-1) as string;
