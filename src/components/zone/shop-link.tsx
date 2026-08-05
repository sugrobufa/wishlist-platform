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
// Ссылку сюда приносит только гостевой DTO, и только у «хочу» с видимой ценой
// (dto/guest-items.ts) — компонент ничего не решает про видимость сам.
import { useTranslations } from "next-intl";
import s from "./shop-link.module.css";

/** Где нажали: плитка в сетке зоны или лист брони (колонка context в БД). */
export type ShopLinkPlace = "tile" | "sheet";

const CONTEXT: Record<ShopLinkPlace, "ZONE" | "RESERVE_PAGE"> = {
  tile: "ZONE",
  sheet: "RESERVE_PAGE",
};

/**
 * Переход наружу — fire-and-forget POST, как пинг визита (тикет 11): ответа
 * не ждём и ошибки глотаем, потому что человек в этот момент уже уходит в
 * магазин, и подсчёт интереса не вправе ему мешать. `keepalive` — чтобы
 * запрос пережил уход со страницы, если браузер откроет ссылку в этой же
 * вкладке (блокировщик всплывающих окон).
 */
function recordOutbound(itemId: string, place: ShopLinkPlace): void {
  void fetch(`/api/v1/items/${encodeURIComponent(itemId)}/outbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: CONTEXT[place] }),
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
  /** Плитка — компактно в столбик; лист брони — строкой, как в турне 8b. */
  place?: ShopLinkPlace;
};

export function ShopLink({ itemId, url, domain, place = "tile" }: ShopLinkProps) {
  const t = useTranslations("Shop");

  return (
    <a
      className={`pressable ${s.link} ${place === "sheet" ? s.sheet : s.tile}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("aria", { domain })}
      onClick={() => recordOutbound(itemId, place)}
    >
      <span className={s.domain}>{domain}</span>
      <span className={s.go}>{t("go")}</span>
    </a>
  );
}
