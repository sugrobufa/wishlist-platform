import Link from "next/link";
import { IconHall, IconPeople, IconPerson, IconPlus, IconRoom } from "@/components/icons";
import { ADD_HREF, TAB_HREF, TAB_SLOTS, type SlotKey, type TabKey } from "./tabs";
import s from "./tab-bar.module.css";

export type SlotLabels = Record<SlotKey, string>;

type TabSlotsProps = {
  /** Какая вкладка подсвечена акцентом; активность — только цветом (25a). */
  active: TabKey;
  labels: SlotLabels;
  /** Иконка вкладки: 21 в шторке, 22 в постоянном (25a). */
  iconSize: number;
  /** Плюс в кружке «Добавить»: 18 в шторке, 19 в постоянном. */
  addIconSize: number;
  /** Шторка закрывается по переходу — постоянному бару колбэк не нужен. */
  onNavigate?: () => void;
};

/**
 * Пять мест таб-бара — одна разметка для шторки и постоянного состояния,
 * различия (размер иконки, шаги) приезжают пропами и классом контейнера.
 * Файл серверный по умолчанию; из шторки импортируется в клиентскую границу.
 */
export function TabSlots({ active, labels, iconSize, addIconSize, onNavigate }: TabSlotsProps) {
  return (
    <>
      {TAB_SLOTS.map((slot) => {
        if (slot === "add") {
          return (
            <Link
              key={slot}
              href={ADD_HREF}
              className={`pressable ${s.slot} ${s.slotAdd}`}
              onClick={onNavigate}
            >
              <span className={s.addBadge}>
                <IconPlus size={addIconSize} strokeWidth={2.1} />
              </span>
              {labels.add}
            </Link>
          );
        }
        const isActive = slot === active;
        return (
          <Link
            key={slot}
            href={TAB_HREF[slot]}
            aria-current={isActive ? "page" : undefined}
            className={isActive ? `pressable ${s.slot} ${s.slotActive}` : `pressable ${s.slot}`}
            onClick={onNavigate}
          >
            <SlotIcon slot={slot} active={isActive} size={iconSize} />
            {labels[slot]}
          </Link>
        );
      })}
    </>
  );
}

function SlotIcon({ slot, active, size }: { slot: TabKey; active: boolean; size: number }) {
  switch (slot) {
    case "room":
      // Тёплая точка-лампа горит только у активной «Комнаты» — так рисует
      // 25a (шторка против состояния «в списках»).
      return <IconRoom size={size} dot={active} />;
    case "connections":
      return <IconPeople size={size} />;
    case "hall":
      return <IconHall size={size} />;
    case "settings":
      return <IconPerson size={size} />;
  }
}
