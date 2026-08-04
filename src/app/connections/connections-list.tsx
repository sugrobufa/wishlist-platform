"use client";

// Список связей с фильтрами (тикет 11, турн 21). Чисто читающий клиент:
// данные приходят DTO с сервера (без email — allowlist listConnections),
// здесь только фильтр по kind и сборка подписи происхождения из структуры
// origin (все строки — через next-intl, CLAUDE.md). Никаких форм и мутаций:
// связи не добавляются руками (инвариант №4).
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ConnectionOriginDto, ConnectionRowDto } from "@/server/services/connections";

type Filter = "ALL" | "MUTUAL" | "FOLLOW" | "VIEWED";

const FILTERS: Filter[] = ["ALL", "MUTUAL", "FOLLOW", "VIEWED"];

type ConnectionsListProps = {
  rows: ConnectionRowDto[];
  accent: string;
  ink: string;
};

/** Аватар собеседника: фото — или тихий силуэт, если аватара нет. */
function Avatar({ url }: { url: string | null }) {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-surface-hairline bg-surface-fill"
      style={
        url ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined
      }
    >
      {!url && (
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-faint"
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
        </svg>
      )}
    </span>
  );
}

export function ConnectionsList({ rows, accent, ink }: ConnectionsListProps) {
  const t = useTranslations("Connections");
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>("ALL");

  const visible = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((row) => row.kind === filter)),
    [rows, filter],
  );

  /** Строка под именем ВСЕГДА объясняет, откуда связь (README турн 21). */
  function originLabel(origin: ConnectionOriginDto): string {
    switch (origin.type) {
      case "gift":
        if (origin.received > 0 && origin.given > 0) {
          return t("originGiftBoth", { received: origin.received, given: origin.given });
        }
        if (origin.received === 1 && origin.lastTitle) {
          return origin.lastInHall
            ? t("originGiftOneHall", { title: origin.lastTitle })
            : t("originGiftOne", { title: origin.lastTitle });
        }
        if (origin.received > 0) return t("originGiftMany", { count: origin.received });
        return t("originGiftGiven", { count: origin.given });
      case "visit":
        return t("originVisits", { count: origin.visits });
      default:
        return t("originLink");
    }
  }

  function filterLabel(key: Filter): string {
    if (key === "ALL") return t("filterAll", { count: rows.length });
    return t(`filter${key}`);
  }

  return (
    <div>
      {/* Фильтры — чипы турна 21: активный залит акцентом комнаты. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filtersAria")}>
        {FILTERS.map((key) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={`pressable flex min-h-11 items-center px-3.5 text-[11px] font-semibold ${
                active ? "" : "border border-surface-hairline bg-surface-fill text-text-muted"
              }`}
              style={active ? { background: accent, color: ink } : undefined}
            >
              {filterLabel(key)}
            </button>
          );
        })}
      </div>

      {visible.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-px bg-surface-hairline">
          {visible.map((row) => (
            <li
              key={row.id}
              className={`flex items-center gap-3 bg-surface-app-ground py-3.5 ${
                row.kind === "VIEWED" ? "opacity-75" : ""
              }`}
            >
              <Avatar url={row.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text-primary">
                    {row.displayName ?? t("nameFallback")}
                  </span>
                  <span
                    className={`flex-none px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] ${
                      row.kind === "MUTUAL" ? "" : "bg-surface-fill text-text-muted"
                    }`}
                    style={
                      row.kind === "MUTUAL"
                        ? { background: `${accent}2E`, color: accent }
                        : undefined
                    }
                  >
                    {t(`badge${row.kind}`)}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-text-muted">
                  {originLabel(row.origin)}
                </p>
              </div>
              {/* «N дней назад» — последнее событие связи. */}
              <span className="flex-none text-right text-[11px] font-medium text-text-muted">
                {format.relativeTime(new Date(row.lastAt))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-text-muted">{t("emptyFiltered")}</p>
      )}
    </div>
  );
}
