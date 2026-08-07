// Вшить шрифт в SVG-локап, чтобы он не зависел от машины.
//
//   node scripts/embed-lockup-font.mjs <локап.svg> <шрифт.woff2> <куда.svg>
//
// ЗАЧЕМ. Локап `grace-lockup.svg` рисует слово живым элементом `<text>` с
// `font-family="OnestLockup, Onest, system-ui, sans-serif"`. В нашем приложении
// это сработало бы — Onest грузится через next/font, — но локап нужен и там,
// где нашего CSS нет: письма, внешние площадки, чужой просмотрщик. Там
// сработает последний запасной вариант, и надпись поедет.
//
// Раунд 13 прислал письмо «Onest 700 вшит в SVG data-URI, от машины не
// зависит». В самом файле его не оказалось: 781 байт, ни `@font-face`, ни
// `data:font`. Зато приехали сабсеты woff2 — из них и вшиваем.
//
// ЧТО ДЕЛАЕТ. Кладёт в `<defs>` элемент `<style>` с `@font-face`, где
// `src: url(data:font/woff2;base64,…)` — то есть сам шрифт. Ничего другого в
// файле не трогает: разметка локапа остаётся дизайнерской.
//
// ПОЧЕМУ НЕ КОНТУРЫ. Перевод текста в `<path>` дал бы файл меньше, но требует
// шрифтового движка, которого в проекте нет, и убивает возможность поправить
// надпись правкой строки. Вшитый сабсет — обратимо и проверяемо: наличие
// шрифта видно поиском по файлу.
import { readFileSync, writeFileSync } from "node:fs";

const [, , svgPath, fontPath, outPath] = process.argv;
if (!svgPath || !fontPath || !outPath) {
  console.error("Использование: node scripts/embed-lockup-font.mjs <svg> <woff2> <out.svg>");
  process.exit(1);
}

const svg = readFileSync(svgPath, "utf8");
if (!svg.includes("<defs>")) {
  console.error(`В ${svgPath} нет <defs> — не знаю, куда класть @font-face.`);
  process.exit(1);
}
if (/@font-face/.test(svg)) {
  console.error(`В ${svgPath} уже есть @font-face — второй раз вшивать нечего.`);
  process.exit(1);
}

// Имя семейства берём из самого локапа: первое в списке font-family — то, ради
// которого он и написан. Придумывать своё нельзя, иначе @font-face не поймают.
const family = svg.match(/font-family="([^",]+)/)?.[1]?.trim();
if (!family) {
  console.error(`В ${svgPath} не нашёл font-family у <text>.`);
  process.exit(1);
}

const base64 = readFileSync(fontPath).toString("base64");
const style =
  `<style>@font-face{font-family:"${family}";font-weight:700;font-style:normal;` +
  `src:url(data:font/woff2;base64,${base64}) format("woff2")}</style>`;

const out = svg.replace("<defs>", `<defs>\n    ${style}`);
writeFileSync(outPath, out);

const kb = (n) => (n / 1024).toFixed(1);
console.log(`семейство:  ${family}`);
console.log(`шрифт:      ${fontPath} → ${kb(base64.length)} KB в base64`);
console.log(`результат:  ${outPath}, ${kb(Buffer.byteLength(out))} KB`);
