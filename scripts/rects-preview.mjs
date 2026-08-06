#!/usr/bin/env node
/**
 * rects-preview.mjs — смотреть прямоугольники зон глазами на оригиналах 5504×3072.
 *
 * Тикет 47: расстановка прямоугольника — измерение, а не вкус. Единственная
 * надёжная проверка (`.scratch/STATE.md`, «чему НЕ верить» §1) — вырезать кусок
 * оригинала и посмотреть, тот ли там предмет.
 *
 * Система координат — КАДР 630×351 (ADR-0006), та же, что в handoff/rooms.json.
 * Перевод в пиксели оригинала — как в check-frames.mjs: нормировка по каждой оси
 * отдельно (кадр 630×351 и оригинал 5504×3072 отличаются по пропорции на 0.18%).
 *
 *   node scripts/rects-preview.mjs overview <room> [--grid 30] [--out f.jpg]
 *   node scripts/rects-preview.mjs crop <room> <x,y,w,h> [--pad 40] [--out f.jpg]
 *   node scripts/rects-preview.mjs sheet <room> <x,y,w,h> --label "cream/money" --out f.jpg
 *
 * Изображения комнат только читаются, ничего не перезаписывается (CLAUDE.md).
 * Новых зависимостей нет: sharp уже в проекте.
 */
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MASTERS = "C:/Wishlist/masters-4k";
const FRAME_W = 630, FRAME_H = 351;
/**
 * Размер оригинала берём из файла, а не из константы: женские комнаты сняты
 * в 5504×3072, мужские (gamer, sport, study, loft) — в 4096×2286. Ставить
 * 5504 всем — способ незаметно уехать на четверть кадра.
 */
let SRC_W = 5504, SRC_H = 3072;
let KX = SRC_W / FRAME_W, KY = SRC_H / FRAME_H;

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

/** Базовый кадр каждой комнаты — по имени из audit.json, а не по догадке. */
async function baseOf(room) {
  const audit = JSON.parse(await readFile(path.join(MASTERS, "audit.json"), "utf8"));
  const row = audit.find((r) => r.room === room);
  if (!row) throw new Error(`нет комнаты ${room} в audit.json`);
  const file = path.join(MASTERS, row.base);
  const m = await sharp(await readFile(file)).metadata();
  SRC_W = m.width;
  SRC_H = m.height;
  KX = SRC_W / FRAME_W;
  KY = SRC_H / FRAME_H;
  return file;
}

const toPx = (r) => ({
  left: Math.round(r.x * KX),
  top: Math.round(r.y * KY),
  width: Math.round(r.w * KX),
  height: Math.round(r.h * KY),
});

const parseRect = (s) => {
  const [x, y, w, h] = s.split(",").map(Number);
  return { x, y, w, h };
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function save(buf, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log(out);
}

/** Весь кадр целиком с координатной сеткой 630×351 поверх. */
async function overview() {
  const room = args[1];
  const src = await baseOf(room);
  const step = Number(flag("--grid", 30));
  const W = Number(flag("--width", 1260));
  const H = Math.round((W * SRC_H) / SRC_W);
  const out = flag("--out", `.scratch/design-round-7/rects-check/_work/${room}-overview.jpg`);
  const rects = (flag("--rects", "") || "")
    .split(";")
    .filter(Boolean)
    .map((s) => {
      const [label, geom] = s.includes("=") ? s.split("=") : ["", s];
      return { label, ...parseRect(geom) };
    });

  const sx = W / FRAME_W, sy = H / FRAME_H;
  let g = "";
  for (let x = 0; x <= FRAME_W; x += step) {
    g += `<line x1="${x * sx}" y1="0" x2="${x * sx}" y2="${H}" stroke="#00ffff" stroke-width="1" opacity=".55"/>`;
    g += `<text x="${x * sx + 3}" y="14" font-family="monospace" font-size="13" fill="#00ffff">${x}</text>`;
  }
  for (let y = 0; y <= FRAME_H; y += step) {
    g += `<line x1="0" y1="${y * sy}" x2="${W}" y2="${y * sy}" stroke="#00ffff" stroke-width="1" opacity=".55"/>`;
    g += `<text x="3" y="${y * sy - 3}" font-family="monospace" font-size="13" fill="#00ffff">${y}</text>`;
  }
  for (const r of rects) {
    g += `<rect x="${r.x * sx}" y="${r.y * sy}" width="${r.w * sx}" height="${r.h * sy}" fill="none" stroke="#ff2d55" stroke-width="3"/>`;
    if (r.label)
      g += `<text x="${r.x * sx}" y="${r.y * sy - 6}" font-family="monospace" font-size="18" font-weight="bold" fill="#ff2d55" stroke="#000" stroke-width=".6">${esc(r.label)}</text>`;
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g}</svg>`);
  const buf = await sharp(await readFile(src))
    .resize(W, H, { fit: "fill" })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  await save(buf, out);
}

/** Кусок оригинала вокруг прямоугольника, сам прямоугольник обведён. */
async function crop() {
  const room = args[1];
  const src = await baseOf(room);
  const rect = parseRect(args[2]);
  const pad = Number(flag("--pad", 40));           // запас в единицах кадра
  const outW = Number(flag("--width", 1200));
  const label = flag("--label", `${room} ${rect.x},${rect.y},${rect.w},${rect.h}`);
  const out = flag("--out", `.scratch/design-round-7/rects-check/_work/${room}-${rect.x}-${rect.y}.jpg`);

  const outer = {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
  };
  outer.w = Math.min(FRAME_W, rect.x + rect.w + pad) - outer.x;
  outer.h = Math.min(FRAME_H, rect.y + rect.h + pad) - outer.y;

  const px = toPx(outer);
  px.width = Math.min(px.width, SRC_W - px.left);
  px.height = Math.min(px.height, SRC_H - px.top);

  const scale = outW / px.width;
  const outH = Math.round(px.height * scale);

  const rx = (rect.x - outer.x) * KX * scale;
  const ry = (rect.y - outer.y) * KY * scale;
  const rw = rect.w * KX * scale;
  const rh = rect.h * KY * scale;

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">` +
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `<rect x="${rx + 1.5}" y="${ry + 1.5}" width="${Math.max(0, rw - 3)}" height="${Math.max(0, rh - 3)}" fill="none" stroke="#fff" stroke-width="1" opacity=".8"/>` +
      `<text x="8" y="${outH - 10}" font-family="monospace" font-size="20" fill="#fff" stroke="#000" stroke-width=".8">${esc(label)}</text>` +
      `</svg>`,
  );

  const buf = await sharp(await readFile(src))
    .extract(px)
    .resize(outW, outH, { fit: "fill" })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  await save(buf, out);
}

/** Лист на одну зону: весь кадр с рамкой сверху + крупный план снизу. */
async function sheet() {
  const room = args[1];
  const rect = parseRect(args[2]);
  const label = flag("--label", room);
  const note = flag("--note", "");
  const out = flag("--out", `.scratch/design-round-7/rects-check/${label.replace("/", "-")}.jpg`);

  const src = await readFile(await baseOf(room));
  const W = 1280;
  const topH = Math.round((W * SRC_H) / SRC_W);
  const sx = W / FRAME_W, sy = topH / FRAME_H;

  const capH = 44;
  const topSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${topH}">` +
      `<rect x="${rect.x * sx}" y="${rect.y * sy}" width="${rect.w * sx}" height="${rect.h * sy}" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `</svg>`,
  );
  const top = await sharp(src).resize(W, topH, { fit: "fill" }).composite([{ input: topSvg, top: 0, left: 0 }]).toBuffer();

  // крупный план: запас пропорционален размеру зоны, но не меньше 25 единиц
  const pad = Math.max(25, Math.round(Math.max(rect.w, rect.h) * 0.6));
  const outer = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad) };
  outer.w = Math.min(FRAME_W, rect.x + rect.w + pad) - outer.x;
  outer.h = Math.min(FRAME_H, rect.y + rect.h + pad) - outer.y;
  const px = toPx(outer);
  px.width = Math.min(px.width, SRC_W - px.left);
  px.height = Math.min(px.height, SRC_H - px.top);
  const scale = W / px.width;
  const botH = Math.round(px.height * scale);
  const botSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${botH}">` +
      `<rect x="${(rect.x - outer.x) * KX * scale}" y="${(rect.y - outer.y) * KY * scale}" width="${rect.w * KX * scale}" height="${rect.h * KY * scale}" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `</svg>`,
  );
  const bot = await sharp(src).extract(px).resize(W, botH, { fit: "fill" }).composite([{ input: botSvg, top: 0, left: 0 }]).toBuffer();

  const capSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${capH}">` +
      `<rect width="${W}" height="${capH}" fill="#111"/>` +
      `<text x="10" y="29" font-family="monospace" font-size="21" fill="#fff">${esc(label)}  rect ${rect.x},${rect.y},${rect.w},${rect.h}${note ? "  — " + note : ""}</text>` +
      `</svg>`,
  );

  const buf = await sharp({
    create: { width: W, height: capH + topH + botH, channels: 3, background: "#111" },
  })
    .composite([
      { input: capSvg, top: 0, left: 0 },
      { input: top, top: capH, left: 0 },
      { input: bot, top: capH + topH, left: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
  await save(buf, out);
}

const table = { overview, crop, sheet };
if (!table[cmd]) {
  console.error("команды: overview | crop | sheet");
  process.exit(1);
}
await table[cmd]();
