// Фон экранов входа (тикет 56, турн 13a): базовый кадр «Кремовой» поверх
// surface.app.ground, вуаль — цветом фона, как у вуалей комнаты в globals.css.
//
// Кадр — существующий файл дизайн-пакета (design/package/refs/v4-cream.jpg),
// его раздаёт src/app/rooms/[image]/route.ts. Ничего не генерируется и не
// кадрируется: CSS-позиция повторяет кроп доски — окно 430 на доске показывает
// кусок кадра левее центра (left:-300 при ширине 1670 ⇒ центр окна на ~31%
// ширины кадра).
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";

const cream = rooms.find((room) => room.id === "cream");
const IMAGE = roomImageUrl(cream?.base ?? "refs/v4-cream.jpg");

type Variant = "hero" | "quiet";

// Вуали с доски: шаг 1 («Вход») — градиент, тяжёлый снизу под формой почты;
// шаг 2 («Письмо ушло») и подтверждение — ровное затемнение, комната тише.
// rgb(11,8,6) = surface.app.ground (#0B0806).
const VEIL: Record<Variant, string> = {
  hero: "linear-gradient(0deg, rgba(11,8,6,.97) 40%, rgba(11,8,6,.2) 72%, rgba(11,8,6,.55))",
  quiet: "rgba(11,8,6,.72)",
};

const DIM: Record<Variant, string> = {
  hero: "brightness(.72)",
  quiet: "brightness(.4)",
};

/** Кадр комнаты + вуаль. Кладётся первым ребёнком в relative-контейнер. */
export function SigninBackdrop({ variant }: { variant: Variant }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover"
        style={{
          backgroundImage: `url(${IMAGE})`,
          backgroundPosition: "31% 50%",
          filter: DIM[variant],
        }}
      />
      <div className="absolute inset-0" style={{ background: VEIL[variant] }} />
    </div>
  );
}
