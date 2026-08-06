// Вырезает пары «базовый ↔ открыто» по прямоугольникам зон с запасом.
// Только читает изображения комнат; пишет во временную папку тикета.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const REPO = "C:/Wishlist/wishlist-platform";
const REFS = path.join(REPO, "design/package/refs");
const OUT = path.join(REPO, ".scratch/design-round-7/identity-check");

const contract = JSON.parse(await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"));
const IMG = contract.scene.phone.image; // 630×351

await mkdir(OUT, { recursive: true });

/** Прямоугольник зоны + запас: поле шириной примерно с саму зону, минимум 22 px кадра. */
function withMargin(rect, W, H) {
  const mx = Math.max(rect.w, 22);
  const my = Math.max(rect.h, 22);
  const x0 = Math.max(0, rect.x - mx);
  const y0 = Math.max(0, rect.y - my);
  const x1 = Math.min(IMG.w, rect.x + rect.w + mx);
  const y1 = Math.min(IMG.h, rect.y + rect.h + my);
  const sx = W / IMG.w, sy = H / IMG.h;
  return {
    left: Math.round(x0 * sx), top: Math.round(y0 * sy),
    width: Math.round((x1 - x0) * sx), height: Math.round((y1 - y0) * sy),
    // прямоугольник зоны внутри вырезки, в пикселях вырезки
    zx: Math.round((rect.x - x0) * sx), zy: Math.round((rect.y - y0) * sy),
    zw: Math.round(rect.w * sx), zh: Math.round(rect.h * sy),
  };
}

const VIEW = 620; // ширина одной вырезки в готовом файле

/**
 * Кадр «открыто» этой зоны. У снятых тикетом 49 `openFrame` уже null, а файл
 * лежит в legacy — чтобы вырезки оставались воспроизводимыми, берём и его.
 */
function openFileOf(room, zone) {
  if (zone.openFrame) return path.join(REFS, path.basename(zone.openFrame));
  if (zone.reshootReason?.includes("тикет 49"))
    return path.join(REFS, "legacy", `round3-o-${room.id}-${zone.key}.jpg`);
  return null;
}

const rows = [];
for (const room of contract.rooms) {
  for (const zone of room.zones) {
    const openFile = openFileOf(room, zone);
    if (!openFile) continue;
    const baseFile = path.join(REFS, path.basename(room.base));
    const meta = await sharp(await readFile(baseFile)).metadata();
    const W = meta.width, H = meta.height;

    const box = withMargin(zone.rect, W, H);
    const scale = VIEW / box.width;
    const vh = Math.round(box.height * scale);

    const baseBuf = await sharp(await readFile(baseFile))
      .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      .resize(VIEW, vh, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();

    // кадр «открыто» может быть другого размера — приводим к базовому перед вырезкой
    // (два прохода: sharp не даёт resize → extract → resize в одном конвейере)
    const openFull = await sharp(await readFile(openFile)).resize(W, H, { fit: "fill" }).png().toBuffer();
    const openBuf = await sharp(openFull)
      .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      .resize(VIEW, vh, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();

    const name = `${room.id}-${zone.key}`;
    await writeFile(path.join(OUT, `${name}-1-base.jpg`), baseBuf);
    await writeFile(path.join(OUT, `${name}-2-open.jpg`), openBuf);

    // пара рядом: слева базовый, справа «открыто», с обводкой прямоугольника зоны
    const zx = Math.round(box.zx * scale), zy = Math.round(box.zy * scale);
    const zw = Math.round(box.zw * scale), zh = Math.round(box.zh * scale);
    const overlay = Buffer.from(
      `<svg width="${VIEW}" height="${vh}"><rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" ` +
        `fill="none" stroke="#ff2d95" stroke-width="2"/></svg>`,
    );
    const mark = (buf) => sharp(buf).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
    const pair = await sharp({
      create: { width: VIEW * 2 + 12, height: vh, channels: 3, background: "#000" },
    })
      .composite([
        { input: await mark(baseBuf), left: 0, top: 0 },
        { input: await mark(openBuf), left: VIEW + 12, top: 0 },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
    await writeFile(path.join(OUT, `${name}-3-pair.jpg`), pair);

    // у снятых зон глагол уже стёрт вместе с кадром — показываем причину съёма
    const label = zone.openVerb ?? `СНЯТ · ${zone.reshootReason}`;
    rows.push({ zone: `${room.id}/${zone.key}`, label, rect: zone.rect, view: `${VIEW}x${vh}` });
  }
}
console.log(`вырезано пар: ${rows.length}`);
for (const r of rows) console.log(`${r.zone.padEnd(18)} ${r.view.padEnd(10)} ${r.label}`);
