"use client";

// Пустая зона (тикет 99, доска Б27 · турн 25c; числа — `task15.json →
// emptyStates.emptyZone`). Доска объясняет, зачем это отдельный экран:
// «пустая полка не должна выглядеть как невыполненное задание».
//
// МЕСТ БЫЛО ТРИ, СТАЛО ОДНО (тикет 193, приёмка владельца 11.08.2026):
// «отрисовываются 3 пустых иконки, причём рисуются все 3 по-разному… смысл
// пустых плиток не очевиден».
//
// Замысел доски был верен — три места читаются как «сюда поставят», а сетка
// из двадцати как «двадцать раз не сделано», — но до телефона он не доехал по
// двум причинам сразу, и обе проверяемые:
//
//  1. места различались ТОЛЬКО прозрачностью (.45 / .28 / .16 затуханием в
//     глубину), а над тёмной базой в руке эти ступени не различаются. Тот же
//     вид расхождения, что был у света: числа сходились, глаза нет;
//  2. места были НЕМЫМИ — `aria-hidden`, ни ссылки, ни обработчика, — и при
//     этом в двух сантиметрах над ними стояла живая кнопка «+ Добавить вещь».
//     «Сюда поставят» говорили три прямоугольника, которые нельзя нажать, а
//     поставить умел соседний элемент.
//
// Поэтому место теперь ОДНО, и в панели сцены оно само стало кнопкой: плюс
// посередине, ссылка в форму добавления. Дубля «+ Добавить вещь» рядом больше
// нет (`room/page.tsx`). На полном экране зоны место осталось немым — там
// главное действие полосой света, и спорить с ним нечем.
//
// Язык тот же, что у пустой комнаты (тикет 104): пустота показывается
// темнотой и ожиданием, а не чужими вещами-примерами.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconEyeOff, IconPlus } from "@/components/icons";
import { setZoneOffAction } from "@/app/room/zone/[zone]/actions";

type EmptyZoneProps = {
  zoneKey: string;
  accent: string;
  /** Место зоны в комнате: «полка 02 из 13» — подпись шапки. */
  position?: { index: number; total: number };
  /**
   * «Убрать полку из комнаты» — только на экране зоны (доска просит это
   * действие «прямо из зоны»). В панели сцены его нет: там не решают судьбу
   * мебели, там смотрят вещи.
   */
  removable?: boolean;
  /** Компактный вид для панели сцены: места меньше, без крупного текста. */
  compact?: boolean;
};

/**
 * Прозрачность места — верхняя ступень прежней тройки (`emptyZone.slots.alpha`).
 * Две другие ушли вместе с местами: они кодировали глубину, а глубина не
 * читалась (см. шапку файла).
 */
const SLOT_ALPHA = "73";

export function EmptyZone({
  zoneKey,
  accent,
  position,
  removable = false,
  compact = false,
}: EmptyZoneProps) {
  const t = useTranslations("EmptyZone");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function removeShelf() {
    setBusy(true);
    setFailed(false);
    startTransition(async () => {
      const result = await setZoneOffAction(zoneKey, true);
      setBusy(false);
      if (result?.error) {
        setFailed(true);
        return;
      }
      // Зоны в комнате больше нет — оставаться на её экране незачем.
      router.push("/room");
    });
  }

  return (
    <div className={compact ? "" : "mt-5"}>
      {position && !compact && (
        <p className="overline text-text-faint">
          {t("position", { index: position.index, total: position.total })}
        </p>
      )}

      {/* ОДНО МЕСТО. Полоса света понизу обещает то же, что метка зоны в
          комнате: здесь загорится, когда встанет вещь.

          В ПАНЕЛИ СЦЕНЫ ОНО И ЕСТЬ ДЕЙСТВИЕ. Ссылкой, а не обработчиком: чтобы
          работали долгое нажатие и «открыть в новой вкладке», как у плитки
          вещи (тикет 186). `aria-hidden` снят — у места появилось имя, потому
          что появился смысл.

          НА ПОЛНОМ ЭКРАНЕ ЗОНЫ ОНО НЕМОЕ. Там ниже стоит полоса света
          «Добавить вещь →», и два действия одного смысла в одном экране — это
          ровно то замечание приёмки, из-за которого тикет и заведён. */}
      <div className={compact ? "mt-1" : "mt-4"}>
        {compact ? (
          <Link
            href={`/room/add?zone=${zoneKey}`}
            aria-label={t("cta")}
            className="pressable flex h-16 max-w-31 items-center justify-center"
            style={{
              border: `1px dashed ${accent}${SLOT_ALPHA}`,
              background: `linear-gradient(180deg,${accent}17,transparent)`,
              borderBottom: `2px solid ${accent}${SLOT_ALPHA}`,
            }}
          >
            <IconPlus size={22} style={{ color: accent }} />
          </Link>
        ) : (
          <div
            aria-hidden
            className="relative h-26 max-w-31"
            style={{
              border: `1px dashed ${accent}${SLOT_ALPHA}`,
              background: `linear-gradient(180deg,${accent}17,transparent)`,
            }}
          >
            <span
              className="absolute inset-x-0 bottom-0 h-0.5"
              style={{ background: `${accent}${SLOT_ALPHA}` }}
            />
          </div>
        )}
      </div>

      {compact ? (
        <p className="mt-3 text-[11px] leading-snug text-text-muted">{t("compactBody")}</p>
      ) : (
        <>
          <h2 className="display mt-6 text-xl">{t("title")}</h2>
          <p className="mt-2.5 max-w-md text-[13px] leading-relaxed text-text-muted">
            {t("body")}
          </p>

          {/* Главная кнопка — «полоса света» (турн 22). */}
          <Link
            href={`/room/add?zone=${zoneKey}`}
            className="pressable mt-5 inline-block border-b-2 px-6 py-3 font-semibold text-text-primary"
            style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
          >
            {t("cta")} →
          </Link>
        </>
      )}

      {removable && (
        <div className="mt-8 border-t border-surface-hairline pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={removeShelf}
            className="pressable flex min-h-11 w-full items-center gap-3 text-left disabled:opacity-60"
          >
            <IconEyeOff size={19} strokeWidth={1.6} className="flex-none text-text-faint" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text-primary">
                {t("removeTitle")}
              </span>
              {/* Вторая строка — наша, не с доски: человек, убирающий полку,
                  должен знать, что вещи при этом не исчезают (setZoneOff их
                  не трогает), иначе кнопка читается как удаление. */}
              <span className="mt-1 block text-[11px] leading-snug text-text-muted">
                {t("removeSub")}
              </span>
            </span>
          </button>
          {failed && <p className="mt-2 text-sm text-text-muted">{t("errGeneric")}</p>}
        </div>
      )}
    </div>
  );
}
