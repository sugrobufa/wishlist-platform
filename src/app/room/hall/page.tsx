import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { listHallItems } from "@/server/services/items";
import { itemPhotoUrl } from "@/server/dto/items";
import { roomImageUrl } from "@/app/rooms/room-image";
import { rooms } from "@/config/design";
import { HallShowcase, type HallItemView } from "./hall-showcase";
import s from "./hall.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Hall");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Зал славы хозяйки (тикет 10, турн 11b): витрина вещей «люблю» с историей
 * дарения — inHall и не спрятанных из витрины. Фото + CSS-вращение по
 * партитуре макета (hall.module.css), three.js не раньше Phase 3.
 * Цен здесь нет ни у одной вещи (инвариант №8 — «люблю» без цены вообще).
 */
export default async function HallPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const t = await getTranslations("Hall");
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const accent = preset?.accent ?? "#E7C9A9";

  // Allowlist-вид витрины: id/название/фото/даритель/год — и ничего больше.
  const items: HallItemView[] = (await listHallItems(room.id)).map((item) => ({
    id: item.id,
    title: item.title,
    photoUrl: itemPhotoUrl(item.photoKey),
    giverName: item.giverName,
    // Год строкой — ICU не расставит разряды («2 024»), как в ItemTile.
    receivedYear: item.receivedAt ? String(item.receivedAt.getUTCFullYear()) : null,
  }));

  return (
    <main className="min-h-screen bg-surface-hall-ground pb-16">
      {/* Витрина зала из пакета (refs/c-hall.jpg) — фон шапки с виньеткой. */}
      <div className={s.hero}>
        <div
          className={s.heroImg}
          style={{ backgroundImage: `url(${roomImageUrl("refs/c-hall.jpg")})` }}
          aria-hidden
        />
        <div className={s.heroVignette} aria-hidden />
        <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl px-5 pb-5 lg:px-0">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>
          <h1 className="display mt-3 text-3xl lg:text-4xl">{t("title")}</h1>
          {items.length > 0 && (
            <p className="overline mt-2.5 text-text-muted">
              {t("count", { count: items.length })}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pt-8 lg:px-0">
        {items.length > 0 ? (
          <HallShowcase items={items} accent={accent} />
        ) : (
          <p className="max-w-md text-sm leading-relaxed text-text-muted">{t("empty")}</p>
        )}
      </div>
    </main>
  );
}
