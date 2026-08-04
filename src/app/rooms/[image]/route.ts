import { readFile } from "node:fs/promises";
import path from "node:path";

// Кадры комнат неприкосновенны (CLAUDE.md): раздаём файлы design/package/refs
// как есть — без пережатия, без переименования, минуя оптимизатор изображений.
// Путь rooms.json вида "refs/v4-cream.jpg" отображается на URL /rooms/v4-cream.jpg
// (см. roomImageUrl в src/app/rooms/room-image.ts).
const REFS_DIR = path.join(process.cwd(), "design", "package", "refs");

// Только плоские имена вида "v4-cream.jpg": ни точек в имени, ни слэшей —
// обход каталога невозможен по построению.
const SAFE_IMAGE_NAME = /^[a-z0-9][a-z0-9-]*\.jpg$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ image: string }> },
) {
  const { image } = await params;
  if (!SAFE_IMAGE_NAME.test(image)) {
    return new Response(null, { status: 404 });
  }
  try {
    const file = await readFile(path.join(REFS_DIR, image));
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "image/jpeg",
        // Файлы по контракту дизайн-пакета неизменяемы — кэшируем навсегда.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
