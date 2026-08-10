// Сборка src/components/pool-icons.tsx из SVG пакета (тикет 82).
// Пути НЕ переносятся руками: файл генерируется, чтобы расхождение с пакетом
// было невозможно. Повторный прогон после новой партии значков — норма.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = "design/round15/icons";
const OUT = "src/components/pool-icons.tsx";

const files = (await readdir(SRC)).filter((f) => f.endsWith(".svg")).sort();
const entries = [];
for (const file of files) {
  const key = path.basename(file, ".svg").replace(/^pool-/u, "");
  const raw = await readFile(path.join(SRC, file), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/u, "").replace(/<\/svg>\s*$/u, "");
  // Атрибуты SVG → JSX; самозакрывающиеся теги вместо парных.
  const jsx = inner
    .replace(/<\/(rect|circle|path|ellipse|line|polyline|polygon)>/gu, "")
    .replace(/<(rect|circle|path|ellipse|line|polyline|polygon)\b([^>]*)>/gu, "<$1$2 />")
    .replace(/\s(stroke-width|stroke-linecap|stroke-linejoin|fill-rule|clip-rule)="/gu, (m, a) =>
      ` ${a.replace(/-([a-z])/gu, (_, c) => c.toUpperCase())}="`,
    );
  entries.push({ key, jsx });
}

const header = `// Значки пулов — набор зон, заведён раундом 15 (тикет 82). ФАЙЛ СГЕНЕРИРОВАН
// из design/round15/icons/*.svg скриптом .scratch/round16/gen-pool-icons.mjs:
// пути пакета руками не переносятся, иначе расхождение с доской неизбежно.
// Папка названа раундом ПЕРВОЙ поставки; правки приезжают в неё же — раунд 36
// переписал \`music\` и \`bags\` и добавил \`money\` (тикет 150).
//
// Зачем они. У ВЕЩИ категории нет — её заводит человек, и «Подарок маме» ни в
// какой значок не ложится. А у ЗОНЫ категория есть всегда: это ключ пула
// (rooms.json → zone.pool), и вещь всегда лежит в какой-то зоне. Поэтому
// плитка без фотографии показывает значок ЗОНЫ, а не выдуманный значок вещи.
//
// Формат тот же, что у канонических иконок интерфейса (icons.tsx): сетка 24,
// контур 1.7, скруглённые концы, без заливки. Цвет из пакета (#F2EDE4) снят
// намеренно — знак берёт currentColor, как весь остальной интерфейс.
//
// У ПУЛА \`money\` ЗНАК ПОЯВИЛСЯ (раунд 36, тикет 150): конверт. Прежде его тут
// не было вовсе, и зона «Просто деньги» — а строка есть в КАЖДОЙ комнате —
// показывала букву. Дизайн назвал это своей пропажей, а не нашим пропуском.
// Запасной путь никуда не делся: у зоны без пула и у пула, которого нет в
// наборе, остаётся буква названия (тикет 68) — она честно говорит
// «фотографии нет».
import { Icon24, type IconProps } from "./icons";

`;

const body =
  `/** Ключи пулов, у которых есть значок. Источник — имена файлов пакета. */\n` +
  `export const POOL_ICON_KEYS = [\n${entries.map((e) => `  "${e.key}",`).join("\n")}\n] as const;\n\n` +
  `export type PoolIconKey = (typeof POOL_ICON_KEYS)[number];\n\n` +
  `const SHAPES: Record<PoolIconKey, React.ReactNode> = {\n` +
  entries.map((e) => `  ${/^[a-zA-Z][\w]*$/u.test(e.key) ? e.key : `"${e.key}"`}: (\n    <>\n      ${e.jsx.replace(/>\s*</gu, ">\n      <")}\n    </>\n  ),`).join("\n") +
  `\n};\n\n` +
  `/** Есть ли у пула свой значок. Пул \`money\` и зона без пула — нет. */\n` +
  `export function hasPoolIcon(pool: string | null | undefined): pool is PoolIconKey {\n` +
  `  return pool != null && pool in SHAPES;\n}\n\n` +
  `/** Значок пула зоны. Молчит, если значка нет — вызывающий покажет букву. */\n` +
  `export function PoolIcon({ pool, ...props }: IconProps & { pool: string }) {\n` +
  `  if (!hasPoolIcon(pool)) return null;\n  return <Icon24 {...props}>{SHAPES[pool]}</Icon24>;\n}\n`;

await writeFile(OUT, header + body, "utf8");
console.log(`${OUT}: ${entries.length} значков`);
