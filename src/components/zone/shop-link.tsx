"use client";

// «Где купить» (тикет 37, турны 8b/8e): единственное место в продукте, откуда
// гость уходит наружу. Живёт одним компонентом, потому что у перехода три
// обязательства, и все три легко потерять поодиночке:
//   1. `rel="noopener noreferrer"` и `target="_blank"` — чужая страница не
//      получает ни доступа к нашему окну, ни реферера (инвариант №6);
//   2. человеку показывается ДОМЕН, а не адрес: важно «ozon.ru», а не путь
//      с параметрами (домен считает guest-DTO из canonicalUrl);
//   3. переход записывается в OutboundClick.
//
// Ссылку сюда приносит DTO вещи КОМНАТЫ — и гостевой, и хозяйский; видимость
// цены на неё не влияет (тикет 195). Компонент ничего не решает про показ сам.
import { useTranslations } from "next-intl";
import s from "./shop-link.module.css";

/**
 * Где нажали: лист брони или карточка вещи хозяйки.
 *
 * ПЛИТКИ ЗДЕСЬ БОЛЬШЕ НЕТ (тикет 207, пакет 47: турн 8b в этой части снят).
 * Вложенная ссылка в плитке была компромиссом времени, когда карточки вещи не
 * существовало; теперь она есть, и плитка ведёт в неё целиком. Вид `tile` ушёл
 * вместе с последним вызовом — мёртвая ветка однажды снова кем-нибудь
 * позовётся. Контекст `ZONE` при этом остаётся на сервере
 * (`services/outbound.ts`): в БД лежат прежние записи, и стирать историю
 * переходов правка вида не вправе.
 *
 * `null` — место, которое НЕ СЧИТАЕТСЯ. Счётчик переходов меряет интерес
 * ГОСТЕЙ (тикет 37), а карточка хозяйки — её собственный экран: она ходит по
 * своей же ссылке проверить цену, и такие переходы в счётчике чужого интереса
 * не данные, а шум. Поэтому «считать или нет» решает не отдельный флаг, а само
 * место: у него либо есть колонка `context` в БД, либо его там нет.
 */
export type ShopLinkPlace = "sheet" | "card";

const CONTEXT: Record<ShopLinkPlace, "RESERVE_PAGE" | null> = {
  sheet: "RESERVE_PAGE",
  card: null,
};

/**
 * Переход наружу — fire-and-forget POST, как пинг визита (тикет 11): ответа
 * не ждём и ошибки глотаем, потому что человек в этот момент уже уходит в
 * магазин, и подсчёт интереса не вправе ему мешать. `keepalive` — чтобы
 * запрос пережил уход со страницы, если браузер откроет ссылку в этой же
 * вкладке (блокировщик всплывающих окон).
 */
function recordOutbound(itemId: string, place: ShopLinkPlace): void {
  const context = CONTEXT[place];
  // Место без колонки `context` не считается вовсе — см. `ShopLinkPlace`.
  if (context === null) return;
  void fetch(`/api/v1/items/${encodeURIComponent(itemId)}/outbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context }),
    keepalive: true,
  }).catch(() => {});
}

type ShopLinkProps = {
  /** id вещи — им переход и записывается. */
  itemId: string;
  /** Канонический адрес страницы товара (guest-DTO → shop.url). */
  url: string;
  /** Хост без «www.» (guest-DTO → shop.domain). */
  domain: string;
  /**
   * Лист брони — строкой, как в турне 8b; карточка — строка тела карточки вещи
   * хозяйки (round39 → body.link).
   *
   * БЕЗ ДЕФОЛТА И ЭТО НАРОЧНО (тикет 207): дефолтом был снятый `tile`, и любой
   * дефолт на его месте молча приписывал бы переход чужому месту. Мест два, оба
   * вызова их называют, и `place` теперь обязателен — за этим смотрит typecheck,
   * а не память.
   */
  place: ShopLinkPlace;
  /**
   * ГЛАВНАЯ ДВЕРЬ (тикет 196, contract round46 → storeBlock.primaryRow):
   * та же ссылка, но крупно и в рамке. Включается там, где путь стал якорем
   * экрана, — на гостевой карточке со скрытой ценой.
   *
   * Это ВИД, а не место: считается переход по-прежнему местом (`place`), и
   * второй записи в `OutboundClick` дверь не заводит.
   */
  door?: boolean;
  /**
   * Слово действия. По умолчанию «Перейти →» из словаря `Shop` (турн 8b:
   * стрелка типографская, часть текста). Дверь зовёт его «Открыть» — слово
   * приезжает пропом, потому что живёт в разделе карточки, а не магазина.
   */
  action?: string;
};

/** Вид места: класс модуля. Разбор в одном месте — иначе он расползётся. */
const LOOK: Record<ShopLinkPlace, string | undefined> = {
  sheet: s.sheet,
  card: s.card,
};

export function ShopLink({ itemId, url, domain, place, door = false, action }: ShopLinkProps) {
  const t = useTranslations("Shop");

  return (
    <a
      className={`pressable ${s.link} ${door ? s.door : LOOK[place]}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("aria", { domain })}
      onClick={() => recordOutbound(itemId, place)}
    >
      <span className={s.domain}>{domain}</span>
      <span className={s.go}>{action ?? t("go")}</span>
    </a>
  );
}
