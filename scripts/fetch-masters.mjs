// Забрать оригиналы кадров у поставщика (handoff/masters.json) и сразу ужать.
//
// ЗАЧЕМ. Дизайн отдаёт кадры в 2400 px, а десктопная сцена при наезде 1.45×
// на экране с DPR 2 требует 3248 px — трети не хватает. Оригиналы 5504×3072
// лежат у поставщика по прямым ссылкам, но ссылки живут не вечно.
//
// ПОЧЕМУ НЕ PNG. Три гигабайта ради формата без потерь не нужны: исходники
// и так нарисованы моделью, а не сняты камерой. Но и ужимать по ширине
// НЕЛЬЗЯ — вот арифметика, из-за которой рекомендация дизайна (4096 px)
// оказалась мала:
//
//   дизайн считал от ФИКСИРОВАННОГО наезда 1.45× → 1120 × 2 × 1.45 = 3248;
//   тикет 22 перевёл масштаб на формулу motion.json, её потолок на
//   десктопе — 2.05× → 1120 × 2 × 2.05 = 4592.
//
// Телефону нужно 430 × 3 × 2.6 = 3354. То есть 4096 закрывает телефон, но не
// десктоп на крупных зонах. Ссылки живут считанные дни, второго захода не
// будет — забираем всё, что дали (5504), и жмём только форматом: JPEG q92
// весит ~4 МБ против 21 МБ PNG. Экранные производные — дело сборки.
//
// ИМЁН У ССЫЛОК НЕТ: у поставщика файл называется UUID задания. Поэтому здесь
// только скачивание по индексу + манифест; сопоставление с именами зон —
// отдельным проходом (scripts/name-masters.mjs), по содержимому.
//
//   node scripts/fetch-masters.mjs <masters.json> <папка-назначения>
//
// Повторный запуск безопасен: уже скачанные файлы пропускаются.

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [, , MASTERS = "C:/Wishlist/4к/handoff/masters.json", OUT = "C:/Wishlist/masters-4k"] =
  process.argv;

/** 0 — не уменьшать вовсе: храним исходные 5504 (обоснование в шапке). */
const TARGET_WIDTH = 0;
const QUALITY = 92;
/** Одновременных загрузок: больше четырёх упирается в диск, а не в сеть. */
const CONCURRENCY = 4;
const RETRIES = 3;

const manifestPath = path.join(OUT, "manifest.json");

async function fetchOne(url, index) {
  const name = `master-${String(index).padStart(3, "0")}.jpg`;
  const dest = path.join(OUT, name);
  if (existsSync(dest)) {
    const s = await stat(dest);
    if (s.size > 100_000) return { index, name, url, skipped: true, bytes: s.size };
  }

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const png = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(png).metadata();
      // Перекодируем сразу в памяти: 21 МБ PNG на диск не кладём вовсе.
      const pipeline = sharp(png);
      if (TARGET_WIDTH > 0) pipeline.resize({ width: TARGET_WIDTH, withoutEnlargement: true });
      await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toFile(dest);
      const s = await stat(dest);
      return {
        index,
        name,
        url,
        source: { w: meta.width, h: meta.height, bytes: png.length },
        bytes: s.size,
      };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { index, name, url, error: String(lastError) };
}

async function main() {
  const masters = JSON.parse(await readFile(MASTERS, "utf8"));
  const urls = masters.urls ?? [];
  await mkdir(OUT, { recursive: true });

  console.log(`ссылок: ${urls.length}`);
  console.log(`оригинал: ${masters.master?.width}×${masters.master?.height}`);
  console.log(`сохраняю: ${TARGET_WIDTH} px JPEG q${QUALITY} → ${OUT}\n`);

  const results = new Array(urls.length);
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      const r = await fetchOne(urls[i], i);
      results[i] = r;
      done++;
      const mark = r.error ? "ОШИБКА" : r.skipped ? "есть" : "ок";
      console.log(
        `[${String(done).padStart(3)}/${urls.length}] ${r.name} ${mark}` +
          (r.source ? ` ${r.source.w}×${r.source.h} → ${Math.round(r.bytes / 1024)} КБ` : "") +
          (r.error ? ` ${r.error}` : ""),
      );
      if (done % 12 === 0) await writeFile(manifestPath, JSON.stringify(results, null, 1));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(manifestPath, JSON.stringify(results, null, 1));

  const failed = results.filter((r) => r?.error);
  const total = results.reduce((a, r) => a + (r?.bytes ?? 0), 0);
  console.log(`\nготово: ${results.length - failed.length}/${urls.length}`);
  console.log(`на диске: ${Math.round(total / 1024 / 1024)} МБ`);
  if (failed.length) {
    console.log(`НЕ СКАЧАЛОСЬ ${failed.length}:`);
    failed.forEach((f) => console.log(`  ${f.name} ${f.error}`));
    process.exitCode = 1;
  }
}

void main();
