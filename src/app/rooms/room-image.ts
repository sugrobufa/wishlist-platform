/**
 * Путь кадра из rooms.json ("refs/v4-cream.jpg") → URL раздачи ("/rooms/v4-cream.jpg").
 * Файлы отдаёт маршрут src/app/rooms/[image]/route.ts напрямую из
 * design/package/refs — без пережатия и переименования.
 */
export function roomImageUrl(ref: string): string {
  return `/rooms/${ref.replace(/^refs\//, "")}`;
}
