// Генерирует src/styles/tokens.css из design/package/handoff/tokens.json.
// Единственный источник значений — tokens.json (правило CLAUDE.md: код не
// изобретает значения дизайна). Запуск: npm run tokens.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(
  readFileSync(resolve(root, "design/package/handoff/tokens.json"), "utf8"),
);

const lines = [
  "/* GENERATED FILE — do not edit by hand.",
  " * Source: design/package/handoff/tokens.json",
  " * Regenerate: npm run tokens */",
  "",
  "@theme {",
];

// Поверхности
for (const [key, value] of Object.entries(tokens.surface)) {
  if (typeof value !== "string") continue;
  lines.push(`  --color-surface-${kebab(key)}: ${value};`);
}

// Текстовые ступени (note/onAccent — справочные, пропускаем)
for (const [key, value] of Object.entries(tokens.text)) {
  if (key === "note" || key === "onAccent") continue;
  lines.push(`  --color-text-${kebab(key)}: ${value};`);
}

// Шрифтовые семейства
lines.push(`  --font-display: "${tokens.type.display.family}", sans-serif;`);
lines.push(`  --font-ui: "${tokens.type.ui.family}", sans-serif;`);
lines.push(`  --font-annotation: "${tokens.type.annotation.family}", sans-serif;`);
lines.push(`  --font-mono: ${tokens.type.mono.family}, monospace;`);

// Радиусы: прямые углы по умолчанию, скругление только у пилюль и аватаров
lines.push(`  --radius-pill: ${tokens.radius.pill};`);

// Отступы-константы макета
lines.push(`  --spacing-gutter: ${tokens.spacing.gutter}px;`);
lines.push(`  --spacing-sheet: ${tokens.spacing.sheetPadding}px;`);
lines.push(`  --spacing-card: ${tokens.spacing.cardPadding}px;`);

lines.push("}");
lines.push("");

// Константы сцены и типографики, доступные как обычные CSS-переменные
lines.push(":root {");
lines.push(`  --scene-w: ${tokens.layout.phone.w};`);
lines.push(`  --scene-h: ${tokens.layout.phone.scene};`);
lines.push(`  --hit-target-min: ${tokens.layout.phone.hitTargetMin}px;`);
lines.push(`  --display-tracking: ${tokens.type.display.tracking};`);
lines.push("}");
lines.push("");

function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const out = resolve(root, "src/styles/tokens.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"), "utf8");
console.log(`tokens.css written: ${out}`);
