// Вырезки «база ↔ открыто» партии «Кремовая» (раунд 8, тикет 53) — для глаз.
// Только читает изображения; пишет в папку тикета.
//
// Базой для пары служит база ПАРТИИ (base/v4-cream.jpg): глазной вердикт
// «тот же предмет? то же содержимое?» выносится против того файла, от
// которого дизайн правил. Отдельно кладётся `-0-ourbase.jpg` — тот же
// прямоугольник из НАШЕЙ продуктовой базы: по нему видно, чем источник
// дизайна отличается от того, что показывает продукт (сдвиг базы, шаг 1
// приёмки). Для `home` запас вниз — 2.6 высоты зоны (урок пробника: там
// пропажа пряталась ниже прямоугольника).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const REPO = "C:/Wishlist/wishlist-platform";
const BATCH = "C:/Wishlist/Wishlist платформа главный экран 9/round8/cream";
const OUT = path.join(REPO, ".scratch/design-round-8/cream-check");

const contract = JSON.parse(
  await readFile(path.join(REPO, "design/package/handoff/rooms.json"), "utf8"),
);
const IMG = contract.scene.phone.image; // 630×351

const room = contract.rooms.find((r) => r.id === "cream");
const zones = room.zones.map((z) => ({ key: z.key, rect: { ...z.rect } }));
// Новые прямоугольники events/money — подтверждены дизайном (rects-fix.json,
// ОТВЕТ-раунд-8 «восемь да»); партия снималась уже под них.
zones.find((z) => z.key === "events").rect = { x: 454, y: 143, w: 112, h: 30 };
zones.find((z) => z.key === "money").rect = { x: 226, y: 282, w: 40, h: 58 };

await mkdir(OUT, { recursive: true });

/** Запас: поле шириной с саму зону (мин. 22 px кадра); у home низ — 2.6 высоты. */
function withMargin(rect, key, W, H) {
  const mx = Math.max(rect.w, 22);
  const my = Math.max(rect.h, 22);
  const myDown = key === "home" ? 2.6 * rect.h : my;
  const x0 = Math.max(0, rect.x - mx);
  const y0 = Math.max(0, rect.y - my);
  const x1 = Math.min(IMG.w, rect.x + rect.w + mx);
  const y1 = Math.min(IMG.h, rect.y + rect.h + myDown);
  const sx = W / IMG.w, sy = H / IMG.h;
  return {
    left: Math.round(x0 * sx), top: Math.round(y0 * sy),
    width: Math.round((x1 - x0) * sx), height: Math.round((y1 - y0) * sy),
    zx: Math.round((rect.x - x0) * sx), zy: Math.round((rect.y - y0) * sy),
    zw: Math.round(rect.w * sx), zh: Math.round(rect.h * sy),
  };
}

const VIEW = 620;

const hisBaseFile = path.join(BATCH, "base", "v4-cream.jpg");
const ourBaseFile = path.join(REPO, "design/package/refs", "v4-cream.jpg");
const meta = await sharp(await readFile(ourBaseFile)).metadata();
const W = meta.width, H = meta.height; // 2800×1563 — рабочая сетка вырезок

/** Файл → PNG в сетке W×H (его база 2400 приводится к 2800 базовой сетки). */
const normalized = async (file) =>
  sharp(await readFile(file)).resize(W, H, { fit: "fill" }).png().toBuffer();

const hisBaseFull = await normalized(hisBaseFile);
const ourBaseFull = await normalized(ourBaseFile);

async function cut(full, box) {
  const scale = VIEW / box.width;
  const vh = Math.round(box.height * scale);
  return {
    buf: await sharp(full)
      .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      .resize(VIEW, vh, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer(),
    vh, scale,
  };
}

for (const zone of zones) {
  const openFile = path.join(BATCH, `o-cream-${zone.key}.jpg`);
  const openFull = await normalized(openFile);
  const box = withMargin(zone.rect, zone.key, W, H);

  const ours = await cut(ourBaseFull, box);
  const his = await cut(hisBaseFull, box);
  const open = await cut(openFull, box);

  const name = `cream-${zone.key}`;
  await writeFile(path.join(OUT, `${name}-0-ourbase.jpg`), ours.buf);
  await writeFile(path.join(OUT, `${name}-1-base.jpg`), his.buf);
  await writeFile(path.join(OUT, `${name}-2-open.jpg`), open.buf);

  // пара: слева база партии, справа «открыто», прямоугольник обведён розовым
  const zx = Math.round(box.zx * open.scale), zy = Math.round(box.zy * open.scale);
  const zw = Math.round(box.zw * open.scale), zh = Math.round(box.zh * open.scale);
  const overlay = Buffer.from(
    `<svg width="${VIEW}" height="${open.vh}"><rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" ` +
      `fill="none" stroke="#ff2d95" stroke-width="2"/></svg>`,
  );
  const left = await sharp(his.buf).composite([{ input: overlay }]).png().toBuffer();
  const right = await sharp(open.buf).composite([{ input: overlay }]).png().toBuffer();
  const pair = await sharp({
    create: { width: VIEW * 2 + 8, height: open.vh, channels: 3, background: "#101010" },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: VIEW + 8, top: 0 },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
  await writeFile(path.join(OUT, `${name}-3-pair.jpg`), pair);

  // тройка для сдвига базы: наша база | база партии | «открыто»
  const trio = await sharp({
    create: { width: VIEW * 3 + 16, height: open.vh, channels: 3, background: "#101010" },
  })
    .composite([
      { input: await sharp(ours.buf).composite([{ input: overlay }]).png().toBuffer(), left: 0, top: 0 },
      { input: left, left: VIEW + 8, top: 0 },
      { input: right, left: VIEW * 2 + 16, top: 0 },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
  await writeFile(path.join(OUT, `${name}-4-trio.jpg`), trio);
}

console.log("вырезки готовы:", OUT);
