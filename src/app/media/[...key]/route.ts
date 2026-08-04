import { getObjectStream } from "@/server/s3";

// Раздача загруженных файлов из MinIO/S3 (тикет 04): GET /media/{key} —
// стрим объекта публичного бакета. DTO превращает голый S3-ключ photoKey
// в `/media/{key}` (src/server/dto/items.ts → itemPhotoUrl); тем же маршрутом
// пойдёт аватар (тикет 13). Прод с CDN просто закэширует эти же URL.
//
// Ключи генерируются только нами (items/{roomId}/{random}.{ext}), поэтому
// сегменты с чем-то кроме [A-Za-z0-9._-] — сразу 404: обход пути невозможен
// по построению (сегмент не может начинаться с точки — «..» не пройдёт).
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  if (!Array.isArray(segments) || segments.length === 0) {
    return new Response(null, { status: 404 });
  }
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    return new Response(null, { status: 404 });
  }

  // SAFE_SEGMENT исключает «%», так что декодировать нечего: ключ — как есть.
  const object = await getObjectStream(segments.join("/"));
  if (!object) return new Response(null, { status: 404 });

  // Тип отдаём только картиночный (и не SVG — скрипты в SVG с нашего origin
  // были бы XSS); всё незнакомое — октеты со скачиванием, не исполнением.
  const isSafeImage =
    object.contentType != null &&
    /^image\//i.test(object.contentType) &&
    !/svg/i.test(object.contentType);

  const headers = new Headers({
    "Content-Type": isSafeImage ? (object.contentType as string) : "application/octet-stream",
    "Content-Disposition": isSafeImage ? "inline" : "attachment",
    // Ключ случайный и никогда не переиспользуется — кэшируем навсегда.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  });
  if (object.contentLength != null) {
    headers.set("Content-Length", String(object.contentLength));
  }

  return new Response(object.stream, { headers });
}
