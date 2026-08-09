import { readFile } from "node:fs/promises";
import path from "node:path";

// Локап Grace раздаётся ИЗ ПАКЕТА как есть — тем же способом, что кадры комнат
// (src/app/rooms/[image]/route.ts): файл дизайна — источник правды, копия в
// репозитории рано или поздно разъедется с ним (design/package/handoff/logo/README.md).
//
// Почему файлом, а не вшитой в разметку разметкой SVG: локап — не иконка
// набора, у него 5 КБ контуров и свои цвета. В onboarding он стоит на трёх
// экранах подряд, и одна закэшированная навсегда картинка дешевле трёх
// килобайтов в каждом ответе.
const LOGO_DIR = path.join(process.cwd(), "design", "package", "handoff", "logo");

// Только плоские имена вида "grace-lockup-outlined.svg": ни точек в имени, ни
// слэшей — обход каталога невозможен по построению.
const SAFE_LOGO_NAME = /^[a-z0-9][a-z0-9-]*\.svg$/;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_LOGO_NAME.test(file)) {
    return new Response(null, { status: 404 });
  }
  try {
    const svg = await readFile(path.join(LOGO_DIR, file));
    return new Response(new Uint8Array(svg), {
      headers: {
        "Content-Type": "image/svg+xml",
        // Файл по контракту дизайн-пакета неизменяем — кэшируем навсегда.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
