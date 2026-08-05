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

/**
 * Часть значений в tokens.json записана прозой («панель приглушена до 62%»):
 * вынимаем число регуляркой и падаем громко, если формулировка изменилась.
 * Молча подставить своё число нельзя — это ровно то «изобретание значений»,
 * которое запрещает CLAUDE.md.
 */
function pick(value, re, what) {
  const m = String(value).match(re);
  if (!m) throw new Error(`tokens.json: не удалось разобрать ${what}: "${value}"`);
  return m;
}
const num = (value, re, what) => Number(pick(value, re, what)[1]);

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

// ---- Метка зоны (zoneMarker, раунд 2) — рисует тикет 23 -------------------
// Рамки в покое нет: зона обозначена светом (bloom) и тенью по краям
// (vignette). Что из двух весит больше — решает светлота комнаты.
const zm = tokens.zoneMarker;
lines.push("");
lines.push("  /* Метка зоны (tokens.json → zoneMarker). Прямоугольник из rooms.json");
lines.push("     остаётся невидимой областью нажатия; эффект живёт внутри него. */");
lines.push(`  --zone-bloom-rest: ${zm.bloom.restAlpha};`);
lines.push(`  --zone-bloom-hover: ${zm.bloom.hoverAlpha};`);
lines.push(`  --zone-bloom-press: ${zm.bloom.pressAlpha};`);
lines.push(`  --zone-bloom-blend: ${zm.bloom.blend};`);
lines.push(`  --zone-vignette-rest: ${zm.vignette.restAlpha};`);
lines.push(`  --zone-vignette-hover: ${zm.vignette.hoverAlpha};`);
// "rgba(24,14,6,{weight})" — вес подставляется на месте, цвет тени постоянен.
lines.push(
  `  --zone-vignette-rgb: ${pick(zm.vignette.shadow, /rgba\(\s*([\d\s,]+?)\s*,\s*\{/u, "zoneMarker.vignette.shadow")[1].replace(/\s+/gu, "")};`,
);
lines.push(`  --zone-spark-size: ${zm.spark.size}px;`);
lines.push(`  --zone-spark-blur: ${zm.spark.blur}px;`);
lines.push(`  --zone-spark-rest: ${zm.spark.restAlpha};`);
lines.push(`  --zone-dim-hover: ${zm.dim.hoverAlpha};`);
lines.push(`  --zone-dim-ms: ${zm.dim.duration}ms;`);
// "Onest 600 13px"
lines.push(`  --zone-label-weight: ${num(zm.label.type, /\s(\d{3})\s/u, "zoneMarker.label.type")};`);
lines.push(
  `  --zone-label-size: ${num(zm.label.type, /([\d.]+)px/u, "zoneMarker.label.type")}px;`,
);
lines.push(`  --zone-label-color: ${zm.label.color};`);
// "0 1px 8px rgba(0,0,0,.9) — тень обязательна: …" — хвост прозы отрезаем.
lines.push(
  `  --zone-label-shadow: ${pick(zm.label.shadow, /^([^—]+?)\s*(?:—|$)/u, "zoneMarker.label.shadow")[1]};`,
);
// "opacity 0→1 + translateY(4px→0), 240ms out" — вход подписи зоны.
lines.push(
  `  --zone-label-ms: ${num(zm.label.enter, /([\d.]+)\s*ms/u, "zoneMarker.label.enter")}ms;`,
);
lines.push(
  `  --zone-label-rise: ${num(zm.label.enter, /translateY\(\s*([\d.]+)px/u, "zoneMarker.label.enter")}px;`,
);
lines.push(`  --zone-focus-offset: ${zm.focus.offset}px;`);
// "bloom .42 за 90ms, затем стартует наезд" — нажатие отвечает светом быстрее,
// чем идёт обычный переход метки (260 мс), иначе палец не получает ответа.
lines.push(
  `  --zone-bloom-press-ms: ${num(zm.states.press, /([\d.]+)\s*ms/u, "zoneMarker.states.press")}ms;`,
);
// "opacity 260ms cubic-bezier(.23,1,.32,1) на каждом слое…"
lines.push(`  --zone-marker-ms: ${num(zm.transition, /([\d.]+)ms/u, "zoneMarker.transition")}ms;`);
lines.push(
  `  --zone-marker-ease: ${pick(zm.transition, /(cubic-bezier\([^)]+\))/u, "zoneMarker.transition")[1]};`,
);
// Вес света против тени: одно число на комнату вместо 130 масок. Формулы —
// из контракта как есть; код обязан выставить --room-lightness (rooms.json).
lines.push(`  --room-lightness: 0.5;`);
lines.push(`  --zone-bloom-weight: ${asCalc(zm.lightnessMix.bloomWeight)};`);
lines.push(`  --zone-vignette-weight: ${asCalc(zm.lightnessMix.vignetteWeight)};`);

// ---- Выбор «люблю / хочу» (stateChoice, раунд 2) — тикет 27 ---------------
const sc = tokens.stateChoice;
lines.push("");
lines.push("  /* Карточка добавления: выбор состояния кропами комнаты (tokens.json → stateChoice) */");
lines.push(
  `  --state-choice-ar: ${num(sc.crop, /([\d.]+)\s*:\s*1/u, "stateChoice.crop")} / 1;`,
);
lines.push(
  `  --state-choice-dim: ${num(sc.unselected, /(\d+)\s*%/u, "stateChoice.unselected") / 100};`,
);
lines.push(`  --state-choice-ms: ${num(sc.transition, /([\d.]+)ms/u, "stateChoice.transition")}ms;`);

// ---- Иммерсивная раскладка (layout.*Immersive, раунд 2) — тикет 24 --------
// Сцена перестаёт быть полосой в 352 px и становится фоном всего экрана;
// интерфейс уезжает на вуали по краям.
lines.push("");
lines.push("  /* Сцена почти во весь экран (tokens.json → layout.phoneImmersive/desktopImmersive) */");
for (const [key, value] of Object.entries(tokens.layout.phoneImmersive)) {
  if (typeof value !== "number") continue;
  lines.push(`  --imm-${kebab(key)}: ${value}px;`);
}
for (const [key, value] of Object.entries(tokens.layout.desktopImmersive)) {
  if (typeof value !== "number") continue;
  lines.push(`  --imm-d-${kebab(key)}: ${value}px;`);
}

lines.push("}");
lines.push("");

function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** "1 - roomLightness * 0.75" → "calc(1 - var(--room-lightness) * 0.75)" */
function asCalc(formula) {
  if (!/roomLightness/u.test(formula)) {
    throw new Error(`tokens.json: в формуле нет roomLightness: "${formula}"`);
  }
  return `calc(${formula.replace(/roomLightness/gu, "var(--room-lightness)")})`;
}

const out = resolve(root, "src/styles/tokens.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"), "utf8");
console.log(`tokens.css written: ${out}`);
