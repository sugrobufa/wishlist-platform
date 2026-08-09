import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getGuestHall } from "@/server/services/guest-hall";
import { getSessionUserId } from "@/server/services/rooms";
import { rooms } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import s from "@/components/hall/hall.module.css";

type Params = { params: Promise<{ slug: string }> };

// ПОЛНОСТРАНИЧНОГО ISR ЗДЕСЬ БОЛЬШЕ НЕТ (тикет 116, ADR-0011). Витрина
// получила настройку «кто её видит», и «только взаимным друзьям» — это ответ
// про КОНКРЕТНОГО зрителя: страница обязана читать сессию, а страница,
// читающая сессию, кэшироваться целиком не может — иначе первый же гость
// раздал бы свой ответ всем следующим.
//
// НАГРУЗКА НА БД ОТ ЭТОГО НЕ РАСТЁТ. Сами вещи витрины по-прежнему лежат в
// Data Cache (unstable_cache в guest-hall.ts, тег room-{id}) и переживают
// смену зрителя; per-request остаётся только сборка HTML и две дешёвые
// проверки по unique-индексам — комната по слагу и взаимность пары.
//
// Соседняя /r/{slug} свой ISR СОХРАНЯЕТ и сессию не читает (её шапка):
// вход «Сокровищница» узнаёт свой ответ из некэшируемого канала «занято».
export const dynamic = "force-dynamic";

// Только generateMetadata: рядом с ним `export const metadata` Next запрещает.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Hall");
  // Витрина гостя не индексируется — как и сама /r/{slug} (инвариант №7).
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * userId сессии БЕЗ требования сессии — тот же ленивый auth, что в канале
 * «занято» и в роутах брони (тикеты 08/11/41): `@/server/auth` живёт только в
 * runtime Next (request-scope), а вне его — vitest зовёт эту страницу
 * напрямую — зритель честно считается анонимом.
 */
async function optionalSessionUserId(): Promise<string | null> {
  try {
    const { auth } = await import("@/server/auth");
    const session = await auth();
    return await getSessionUserId(session?.user);
  } catch {
    return null;
  }
}

/**
 * Сокровищница глазами ГОСТЯ (тикет 93, доска А5 · турны 11b и 11c).
 *
 * ЧТО ВИДНО ГОСТЮ, РЕШАЕТ НЕ ЭТОТ ФАЙЛ. `getGuestHall` уже отдал ровно то, что
 * можно: сама дверь — «кто видит сокровищницу» (тикет 116, ADR-0011),
 * спрятанные вещи и выключенные зоны отфильтрованы на чтении (инвариант №5),
 * спрятанные глазком — фильтром наблюдателя (тикет 89), цена появляется
 * ключом только по настройке зала (инвариант №8, ADR-0004). Здесь раскладка.
 *
 * Закрытая витрина — 404 тем же `notFound()`, что и неизвестный слаг: «пусто»
 * и «закрыто» гость различать не должен. Пустая витрина при этом 404 НЕ даёт
 * — она приезжает своим пустым состоянием.
 *
 * Действий на этой странице нет ни одного: вещи «люблю» уже подарены, дарить
 * их нельзя, а бронями витрина не занимается вовсе (инвариант №1).
 */
export default async function GuestHallPage({ params }: Params) {
  const { slug } = await params;
  const hall = await getGuestHall(slug, await optionalSessionUserId());
  if (!hall) notFound();

  const preset = rooms.find((candidate) => candidate.id === hall.preset);
  if (!preset) notFound();

  const t = await getTranslations("Hall");
  const accent = preset.accent;
  const back = `/r/${hall.nick ?? hall.shareSlug}`;

  // Суммы витрины у гостя больше нет (тикет 124): цен вещей сокровищницы он
  // не видит ни одной, и складывать нечего. Строка остаётся местом, чтобы
  // разметку не переписывать в этом заходе, — заход про экраны её снимет.
  const totalLine: string | null = null;

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
          {/* «Всё здесь уже дома» (раунд 19): гость сразу понимает, что тут
              не выбирают подарок — тут смотрят на человека. */}
          <p className="mt-1.5 text-xs text-text-muted">{t("guestSubtitle")}</p>
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

                {/* Цены здесь нет и не будет (тикет 124): витрина
                    рассказывает о человеке, а не продаёт. */}

                {/* Подпись гостю — только год: имени дарителя здесь нет и
                    быть не может (раунд 19, см. dto/hall.HallGuestItemDto). */}
                <p className="mt-1.5 text-[10.5px] font-medium" style={{ color: accent }}>
                  {item.receivedYear === null
                    ? t("captionMine")
                    : t("captionYear", { year: item.receivedYear })}
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

// Своей сборки подписи здесь больше нет: гостю показывается только год, и
// разветвлять нечего. Хозяйкина `caption` (с именем дарителя) живёт в
// hall-showcase.tsx и сюда не переезжает — это и была ошибка тикета 93.
