"use client";

// Указатель зон и сводка по зоне (тикет 34).
//
// ЗАЧЕМ. Человек, открывший комнату, не знает, что в ней есть что трогать:
// метка зоны — это свет и искра (тикет 23), без подписи. На десктопе подпись
// показывает наведение, на телефоне наведения нет вовсе — и названия зон
// узнать неоткуда. Список внизу и есть ответ: он же оглавление, он же второй
// способ подойти к зоне.
//
// ГДЕ ЖИВЁТ. В нижней полосе интерфейса, поверх вуали — прямо по контракту
// (tokens.json → layout.desktopImmersive.note: «указатель зон переезжает в
// нижнюю вуаль»). Не рядом с полосой и не поверх кадра: любой элемент над
// сценой отбирал бы нажатие у зон, а тикет 24 держит все 130 зон нажимаемыми.
//
// ТЕЛЕФОН. Сводки по наведению на телефоне не бывает, и разговор «первое
// касание — сводка, второе — вход» решён в пользу одного касания: подход к
// зоне остаётся однажестовым, а самое ценное из сводки — сколько в зоне
// вещей — стоит прямо в пункте списка и не требует жеста вовсе. Разбор — в
// Comments тикета.
import { useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RoomZone } from "@/config/design";
import type { ZoneSummaryDto } from "@/server/dto/zone-summary";
import { visibleZones, zoneLabel } from "./zones";
import { useZoneIndexActions, useZoneIndexState } from "./zone-index-context";
import s from "./zone-index.module.css";

/**
 * С какой доли списка карточка сводки раскрывается влево. Карточка шириной
 * 340 px (макет 17a) у крайних правых пунктов вылезла бы за экран; порог —
 * доля, а не пиксели, потому что зон в комнате 12, а ширина окна любая.
 */
const FLIP_AFTER = 0.6;

export type ZoneIndexProps = {
  /** Зоны пресета целиком — фильтр выключенных тот же, что в сцене. */
  zones: readonly RoomZone[];
  /** Room.zonesOff: выключенная зона исчезает и из списка (инвариант №5). */
  zonesOff?: string[];
  /** Сводки по ключу зоны; что в них попало — решил DTO-слой. */
  summaries?: Record<string, ZoneSummaryDto>;
  /**
   * Чьими глазами читается строка счётчиков (handoff/answers-04.md):
   * хозяйке «19 в подарок», гостю «19 можно подарить» — одно и то же число
   * про желания. Сколько уже забрали, не видит никто и нигде в этой карточке.
   */
  viewer: "owner" | "guest";
  /** Акцент комнаты — номер активной зоны, рамка фокуса, детали карточки. */
  accent: string;
};

/** «01», «02» … — нумерация по видимым зонам, как в макете 17a. */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Деньги для показа. Number() здесь — ровно там же, где он законен у плитки
 * вещи (components/zone/ItemTile): Intl принимает число, а само значение
 * приехало строкой Decimal и в таком виде и живёт в DTO.
 */
function formatMoney(value: string, currency: string, locale: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`.trim();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Неизвестный код валюты — показываем как есть, не падаем.
    return `${value} ${currency}`.trim();
  }
}

export function ZoneIndex({ zones, zonesOff, summaries, viewer, accent }: ZoneIndexProps) {
  const t = useTranslations("Scene");
  const tCounts = useTranslations("ZoneGrid");
  const locale = useLocale();

  const actions = useZoneIndexActions();
  const { lit, active } = useZoneIndexState();

  // Тот же список и тот же порядок, что в сцене: номер пункта = номер метки.
  const shown = useMemo(() => visibleZones(zones, zonesOff), [zones, zonesOff]);

  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  // Открытая зона подтягивает свой пункт в видимую часть списка: на телефоне
  // список листается вбок и все пункты сразу не помещаются, а он здесь —
  // единственный указатель «где я сейчас».
  useEffect(() => {
    if (!active) return;
    itemRefs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  if (shown.length === 0) return null;

  return (
    <nav
      className={s.rail}
      aria-label={t("indexAria")}
      style={
        {
          "--zi-accent": accent,
          // Разведённые оттенки акцента для карточки — те же доли, что в
          // макете 17a (32% рамка, 30% линия плашки, 12% её заливка).
          "--zi-accent-soft": `${accent}52`,
          "--zi-accent-line": `${accent}4D`,
          "--zi-accent-wash": `${accent}1F`,
        } as React.CSSProperties
      }
    >
      <div className={s.scroller}>
        <ul className={s.list}>
          {shown.map((zone, index) => {
            const label = zoneLabel(zone);
            const summary = summaries?.[zone.key];
            const state = zone.key === active ? s.itemActive : zone.key === lit ? s.itemLit : "";
            // Карточка живёт внутри своего пункта: позиция — обычный поток CSS,
            // без замеров и без второго состояния. У правой части списка она
            // раскрывается влево, иначе уехала бы за край экрана.
            const flip = index / shown.length > FLIP_AFTER;
            return (
              <li key={zone.key} className={s.item}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) itemRefs.current.set(zone.key, el);
                    else itemRefs.current.delete(zone.key);
                  }}
                  className={`pressable ${s.button} ${state}`}
                  // Номер входит в имя не для красоты: без него у пункта списка
                  // и у хотспота сцены получается ОДНО имя на две кнопки —
                  // тот, кто идёт по списку кнопок голосом, слышит «Одежда —
                  // подойти ближе» дважды и не понимает, чем они отличаются.
                  // Номер к тому же есть на экране, а имя обязано содержать
                  // видимый текст (WCAG 2.5.3).
                  aria-label={t("zoneAria", { label: `${ordinal(index)} ${label}` })}
                  aria-current={zone.key === active ? "true" : undefined}
                  onClick={() => actions?.open(zone.key)}
                  onPointerEnter={() => actions?.setLit(zone.key)}
                  onPointerLeave={() => actions?.setLit(null)}
                  onFocus={() => actions?.setLit(zone.key)}
                  onBlur={() => actions?.setLit(null)}
                >
                  <span className={s.ordinal}>{ordinal(index)}</span>
                  <span className={s.label}>{label}</span>
                  {summary && summary.count > 0 && <span className={s.count}>{summary.count}</span>}
                </button>

                {/* Сводка: только там, где есть настоящее наведение (ворота в
                    CSS-модуле), и только пока зона не открыта — подойдя, человек
                    видит сами вещи. Нажатие не перехватывает никогда. */}
                {zone.key === lit && !active && (
                  <div className={flip ? `${s.card} ${s.cardFlip}` : s.card} aria-hidden>
                    <div className={s.cardHead}>
                      <span className={s.cardTitle}>{label}</span>
                      {summary && summary.count > 0 && (
                        <span className={s.cardSub}>
                          {/* Одно и то же число двумя словами: хозяйке «в
                              подарок», гостю «можно подарить». Строка хозяйки —
                              дословно из пакета (ZoneGrid.zoneCounts). */}
                          {viewer === "owner"
                            ? tCounts("zoneCounts", {
                                total: summary.count,
                                want: summary.wantCount,
                              })
                            : t("summaryCountsGuest", {
                                total: summary.count,
                                want: summary.wantCount,
                              })}
                        </span>
                      )}
                    </div>

                    {!summary || summary.count === 0 ? (
                      <p className={s.cardEmpty}>{t("summaryEmpty")}</p>
                    ) : (
                      <>
                        <div className={s.thumbs}>
                          {summary.thumbs.map((thumb, i) => (
                            <div
                              key={i}
                              // Пунктир кодирует «хочу», а не отсутствие фото
                              // (инвариант №3) — тот же язык, что у плитки.
                              className={thumb.want ? `${s.thumb} ${s.thumbWant}` : s.thumb}
                              style={
                                thumb.photoUrl
                                  ? { backgroundImage: `url(${thumb.photoUrl})` }
                                  : undefined
                              }
                            />
                          ))}
                          {summary.more > 0 && (
                            <div className={s.thumbMore}>
                              {t("summaryMore", { count: summary.more })}
                            </div>
                          )}
                        </div>

                        {/* Вилка цен и марки приезжают уже по правилу трёх
                            (dto/zone-summary.ts): ключа нет — строки нет. */}
                        {summary.price && (
                          <div className={s.row}>
                            <span className={s.rowKey}>{t("summaryPrice")}</span>
                            <span className={s.rowValue}>
                              {summary.price.low === summary.price.high
                                ? formatMoney(summary.price.low, summary.price.currency, locale)
                                : `${formatMoney(summary.price.low, summary.price.currency, locale)} — ${formatMoney(summary.price.high, summary.price.currency, locale)}`}
                            </span>
                          </div>
                        )}

                        {summary.brands && (
                          <div className={s.row}>
                            <span className={s.rowKey}>{t("summaryBrands")}</span>
                            <span className={s.rowValue}>{summary.brands.join(" · ")}</span>
                          </div>
                        )}
                      </>
                    )}

                    <div className={s.cardCta}>{t("summaryEnter")}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
