import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MONEY_ZONE_KEY, type RoomZone } from "@/config/design";
import { MoneyGoalCard } from "@/components/zone/money-goal-card";
import { zoneLabel } from "./zones";
import s from "./scene.module.css";

type ZonePanelProps = {
  zone: RoomZone | null;
  /** Фаза «сетка гаснет» (closeZone[0], 220 мс) перед отъездом камеры. */
  closing: boolean;
  /** Акцент комнаты — карточке копилки (полоса, плашка). */
  accent: string;
  /** ink комнаты — текст на акценте. */
  ink: string;
  /** Сетка вещей зоны — придёт тикетом 03; без неё честная заглушка. */
  children?: ReactNode;
};

/** Люфт «дальше есть ещё»: меньше пикселя — это округление, а не содержимое. */
const EDGE_SLACK = 1;

/**
 * Панель открытой зоны под сценой. Заголовок — из zones.json; появление по
 * партитуре openZone[3] («вещи встают в сетку»), уход — closeZone[0].
 *
 * ОВЕРЛАЙНА НАД СПИСКОМ БОЛЬШЕ НЕТ (тикет 59). В нём стоял `openVerb`
 * («чемодан раскрывается») — слово СЪЁМКИ: оно описывает, что показывает кадр
 * раскрытия, нужно нам с дизайнером и проверяется `tests/design-contract.test.ts`,
 * а человеку не говорит ничего. Рядом подмешивался `Scene.noOpenFrame` —
 * строка, которую сам дизайн убрал из пакета в раунде 4 («не сообщаем человеку
 * о том, чего у нас нет», ADR-0005). Данные съёмки остались на месте, из
 * интерфейса ушёл только показ.
 *
 * Зона «Просто деньги» — единственная, у которой содержимое рождается не из
 * вещей: в ней стоит копилка на мечту (тикет 44). Карточка добавляется К
 * сетке, а не вместо неё: цель вещью не является, но вещи в этой зоне никто не
 * запрещает — обе части живут рядом.
 */
export function ZonePanel({ zone, closing, accent, ink, children }: ZonePanelProps) {
  const t = useTranslations("Scene");
  const panelRef = useRef<HTMLElement | null>(null);
  // «Ниже есть ещё» — честная кромка у нижней границы прокрутки (тикет 59):
  // владелец с телефона увидел ровно срезанную плитку и прочитал это как
  // обрезку вёрстки, а не как «список продолжается».
  const [more, setMore] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Высоту содержимого меряем по .panelBody, а НЕ по scrollHeight листа:
    // входная анимация openZone[3] поднимает тело на 18 px (rise-in), и эти
    // 18 px попадают в scrollHeight контейнера — кромка загоралась бы на
    // секунду в каждой зоне, даже когда всё поместилось. У самого тела
    // transform на его scrollHeight не влияет.
    const update = () => {
      const body = panel.firstElementChild;
      const contentHeight = body ? body.scrollHeight : panel.scrollHeight;
      setMore(contentHeight - panel.scrollTop - panel.clientHeight > EDGE_SLACK);
      // Своя высота — сцене, переменной (тикет 84). Подпись зоны с кнопкой
      // «Отойти» стоит НАД листом, и её место считалось по худшему случаю:
      // лист вправе подняться в нижнюю четверть кадра, поэтому подпись висела
      // на 25% высоты кадра — посреди комнаты, поверх предметов. Владелец
      // попросил опустить её в угол. Лист почти всегда ниже своего потолка,
      // и с настоящей высотой подпись садится ровно на его кромку, а в
      // пределе (лист во весь потолок) возвращается туда, где стояла.
      panel.parentElement?.style.setProperty("--panel-h", `${panel.clientHeight}px`);
    };
    update();
    panel.addEventListener("scroll", update, { passive: true });
    // Содержимое меняется без прокрутки: смена вкладки «Люблю»/«Хочу», приезд
    // картинок, поворот экрана. Наблюдаем и лист, и тело — высота меняется
    // то у одного, то у другого.
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    const body = panel.firstElementChild;
    if (body) observer.observe(body);
    return () => {
      panel.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [zone?.key]);

  if (!zone) return null;

  return (
    <section
      ref={panelRef}
      className={more ? `${s.panel} ${s.panelMore}` : s.panel}
      aria-label={zoneLabel(zone)}
    >
      <div key={zone.key} className={`${s.panelBody}${closing ? ` ${s.panelBodyOut}` : ""}`}>
        {zone.key === MONEY_ZONE_KEY && <MoneyGoalCard accent={accent} ink={ink} />}
        {children ??
          (zone.key === MONEY_ZONE_KEY ? null : <p className={s.panelEmpty}>{t("itemsSoon")}</p>)}
      </div>
      {/* Кромка живёт ВНУТРИ прокрутки (sticky снизу) и не занимает высоты:
          отрицательный внешний отступ возвращает её собственные 30 px. */}
      <div className={s.panelFade} aria-hidden />
    </section>
  );
}
