// СБОРКА ОБЩЕСАЙТОВОЙ КАРТИНКИ ССЫЛКИ (тикет 205).
//
// ЗАЧЕМ СКРИПТ, А НЕ РИСОВАНИЕ РУКАМИ. Локап — канон дизайна
// (`design/package/handoff/logo/grace-lockup-outlined.svg`), и картинка обязана
// быть его функцией, а не копией: приедет новая редакция локапа — прогнали
// скрипт, получили новую обложку. Руками собранный PNG разошёлся бы с каноном
// молча, а это ровно тот класс ошибок, который мы ловим третий день.
//
// ЗАЧЕМ КОММИТИТЬ РЕЗУЛЬТАТ. Скрипт — рецепт, а не шаг сборки: гонять его на
// каждом деплое значит поставить выкат в зависимость от `sharp`, который у нас
// не свой, а транзитивный (приезжает с Next). Рецепт воспроизводимый, выход
// лежит в репозитории, продукт читает готовый файл.
//
// ГОНЯТЬ: node scripts/build-og-cover.mjs
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCKUP = resolve(root, "design/package/handoff/logo/grace-lockup-outlined.svg");
const OUT = resolve(root, "public/og-cover.png");

/** Канон карточки ссылки: 1200×630 у всех мессенджеров и соцсетей. */
const W = 1200;
const H = 630;

/** Земля продукта — `tokens.json → surface.app.ground`, тот же #0B0806. */
const GROUND = { r: 11, g: 8, b: 6, alpha: 1 };

/**
 * Локап на обложке — 520 в ширину: это 43% полотна.
 *
 * Меньше — теряется в ленте чата, где карточка показывается шириной пальца;
 * больше — упирается в края и читается как баннер, а не как знак. Пропорция
 * берётся из вьюбокса самого локапа (176×48), а не задаётся второй раз.
 */
const LOCKUP_W = 520;

const svg = await readFile(LOCKUP, "utf8");
const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/u);
if (!viewBox) throw new Error("у локапа не нашёлся viewBox — файл не тот");
const ratio = Number(viewBox[2]) / Number(viewBox[1]);
const lockupH = Math.round(LOCKUP_W * ratio);

// Плотность считается от нужной ширины, иначе sharp растеризует SVG в его
// собственные 176 px и потом растянет — знак поедет краями.
const density = Math.ceil((72 * LOCKUP_W) / Number(viewBox[1]));
const lockup = await sharp(Buffer.from(svg), { density })
  .resize(LOCKUP_W, lockupH, { fit: "fill" })
  .png()
  .toBuffer();

await mkdir(dirname(OUT), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 4, background: GROUND } })
  .composite([
    {
      input: lockup,
      // По центру полотна: карточку обрезают по-разному, и центр переживает
      // любую обрезку. Оптического сдвига вверх нет намеренно — у локапа своя
      // засветка вокруг знака, и она уже смещает вес.
      left: Math.round((W - LOCKUP_W) / 2),
      top: Math.round((H - lockupH) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const { size } = await sharp(OUT).metadata().then(async (meta) => ({
  size: (await readFile(OUT)).length,
  meta,
}));
console.log(`обложка собрана: ${OUT} — ${W}×${H}, локап ${LOCKUP_W}×${lockupH}, ${size} байт`);
