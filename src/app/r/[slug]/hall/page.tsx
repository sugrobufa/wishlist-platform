import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getGuestHall } from "@/server/services/guest-hall";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { formatHallMoney } from "@/app/room/hall/money";
import s from "@/components/hall/hall.module.css";

type Params = { params: Promise<{ slug: string }> };

// ISR, как у самой комнаты (тикет 07): вещи витрины лежат в Data Cache с тем
// же тегом room-{id}, и мутации хозяйки ревалидируют обе страницы разом.
export const revalidate = 300;

// Только generateMetadata: рядом с ним `export const metadata` Next запрещает.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Hall");
  // Витрина гостя не индексируется — как и сама /r/{slug} (инвариант №7).
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Сокровищница глазами ГОСТЯ (тикет 93, доска А5 · турны 11b и 11c).
 *
 * ЧТО ВИДНО ГОСТЮ, РЕШАЕТ НЕ ЭТОТ ФАЙЛ. `getGuestHall` уже отдал ровно то, что
 * можно: спрятанные вещи и выключенные зоны отфильтрованы на чтении (инвариант
 * №5), спрятанные глазком — фильтром наблюдателя (тикет 89), цена появляется
 * ключом только по настройке зала (инвариант №8, ADR-0004). Здесь раскладка.
 *
 * Действий на этой странице нет ни одного: вещи «люблю» уже подарены, дарить
 * их нельзя, а бронями витрина не занимается вовсе (инвариант №1).
 */
export default async function GuestHallPage({ params }: Params) {
  const { slug } = await params;
  const hall = await getGuestHall(slug);
  if (!hall) notFound();

  const preset = rooms.find((candidate) => candidate.id === hall.preset);
  if (!preset) notFound();

  const t = await getTranslations("Hall");
  const locale = await getLocale();
  const accent = preset.accent;
  const back = `/r/${hall.nick ?? hall.shareSlug}`;

  const totalLine =
    hall.totals.length === 0
      ? null
      : hall.totals
          .map((total) =>
            t("total", { sum: formatHallMoney(total.amount, total.currency, locale) }),
          )
          .join(" · ");

  return (
    <main className="min-h-screen bg-surface-hall-ground pb-16">
      <div className={s.hero}>
        <div
          className={s.heroImg}
          style={{ backgroundImage: `url(${roomImageUrl("refs/c-hall.jpg")})` }}
          aria-hidden
        />
        <div className={s.heroVignette} aria-hidden />
        <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl px-5 pb-5 lg:px-0">
          <Link href={back} className="pressable text-xs font-semibold text-text-strong">
            ← {t("guestBack")}
          </Link>
          {/* Заголовок говорит именем хозяйки: это её витрина, и гость пришёл
              смотреть на неё, а не на «сокровищницу вообще». */}
          <h1 className="display mt-3 text-3xl lg:text-4xl">
            {hall.ownerName === null ? t("title") : t("guestTitle", { name: hall.ownerName })}
          </h1>
          {hall.items.length > 0 && (
            <p className="overline mt-2.5 text-text-muted">
              {t("count", { count: hall.items.length })}
              {totalLine !== null && ` · ${totalLine}`}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pt-8 lg:px-0">
        {hall.items.length === 0 ? (
          <p className="max-w-md text-sm leading-relaxed text-text-muted">{t("guestEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {hall.items.map((item) => (
              <li key={item.id}>
                <div className={s.showcase}>
                  <div
                    className={item.photoUrl ? s.spin : `${s.spin} ${s.spinEmpty}`}
                    style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
                    aria-hidden
                  />
                  <div className={s.vignette} aria-hidden />
                </div>
                <p className="mt-3 truncate text-[13px] font-semibold text-text-primary">
                  {item.title}
                </p>

                {/* Ключа цены может не быть вовсе — тогда и строки нет. */}
                {item.price != null && (
                  <p className="mt-2 text-[15px] font-bold" style={{ color: accent }}>
                    {item.rounded
                      ? t("priceAbout", {
                          price: formatHallMoney(item.price, item.currency ?? "RUB", locale),
                        })
                      : formatHallMoney(item.price, item.currency ?? "RUB", locale)}
                  </p>
                )}

                <p className="mt-1.5 text-[10.5px] font-medium" style={{ color: accent }}>
                  {caption(item, t)}
                </p>

                {/* Заметка хозяйки (тикет 92) — то, ради чего доска и звала
                    показать витрину гостю: она объясняет вкус лучше списка. */}
                {item.note && (
                  <p className={`mt-2 text-xs leading-relaxed text-text-muted ${s.note}`}>
                    {t("noteQuote", { note: item.note })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Подпись витрины — та же, что у хозяйки: «Подарен в {год} · {имя}». */
function caption(
  item: { receivedYear: string | null; giverName: string | null },
  t: Translator,
): string {
  if (item.receivedYear && item.giverName) {
    return t("captionYearGiver", { year: item.receivedYear, giver: item.giverName });
  }
  if (item.giverName) return t("captionGiver", { giver: item.giverName });
  if (item.receivedYear) return t("captionYear", { year: item.receivedYear });
  return t("captionMine");
}
