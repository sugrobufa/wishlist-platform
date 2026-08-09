// Набор иконок таб-бара (тикет 111, доска Б19; файлы — раунд 21).
//
// Иконки пришли шестью SVG. Тест сверяет НАШИ компоненты с ЕГО файлами
// путь в путь: набор — контракт дизайна, и «похоже» здесь не считается.
// Один сдвинутый узел ломает рифму знаков, а увидеть это глазами на 22 px
// нельзя.
//
// Сверяется и формат набора: сетка 24, контур 1.7, скруглённые концы. Цвет
// у нас `currentColor` (у него в файлах вшит #F2EDE4) — это не расхождение,
// а единственный способ дать иконке гореть акцентом активной вкладки.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { IconHall, IconPeople, IconPerson, IconPlus, IconRoom } from "../src/components/icons";

/**
 * Файлы набора лежат В РЕПОЗИТОРИИ, а не в папке входящих пакетов: та живёт
 * на машине владельца, и тест, читающий оттуда, зелёный только у него —
 * в CI такой проверки просто нет.
 */
const PACKAGE_ICONS = path.join("design", "package", "handoff", "icons");

/** Геометрия знака: пути и круги по порядку — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((m) => `path:${m[1]}`);
  const circles = [...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g)].map(
    (m) => `circle:${m[1]},${m[2]},${m[3]}`,
  );
  return [...paths, ...circles].sort();
}

function fromPackage(file: string): string[] {
  return shapeOf(readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8"));
}

function fromOurs(component: Parameters<typeof createElement>[0]): string[] {
  return shapeOf(renderToStaticMarkup(createElement(component)));
}

describe("иконки таб-бара — путь в путь с набором дизайна", () => {
  it.each([
    ["tab-add", IconPlus],
    ["tab-friends", IconPeople],
    ["tab-profile", IconPerson],
    ["tab-treasury", IconHall],
  ])("%s совпадает с файлом набора", (file, component) => {
    expect(fromOurs(component)).toEqual(fromPackage(file));
  });

  it("«Комната» совпадает по арке, а тёплая точка — НАША и остаётся", () => {
    // Доска Б19 просит «арку с тёплой точкой», но в присланном файле точки
    // нет. Точка — единственная законная заливка набора (tokens.json →
    // icons.exception) и горит только у активной вкладки. Сверяем арку, а
    // расхождение по точке записано в письме.
    const withoutDot = fromOurs(() => createElement(IconRoom, { dot: false }));
    expect(withoutDot).toEqual(fromPackage("tab-room"));
    expect(fromOurs(IconRoom).length).toBe(withoutDot.length + 1);
  });

  it("формат набора: сетка 24, контур 1.7, скруглённые концы, currentColor", () => {
    const svg = renderToStaticMarkup(createElement(IconHall));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    // Цвет иконка берёт у вкладки — вшитого в набор #F2EDE4 у нас нет.
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
  });
});
