import Link from "next/link";
import { IconHall, IconPeople, IconPerson, IconPlus, IconRoom } from "@/components/icons";
import { ADD_HREF, TAB_HREF, TAB_SLOTS, type SlotKey, type TabKey } from "./tabs";
import s from "./tab-bar.module.css";

export type SlotLabels = Record<SlotKey, string>;

/** Иконка вкладки в постоянном баре (25a). */
const ICON_SIZE = 22;

/** Плюс в кружке «Добавить» — на единицу тише вкладок, как в 25a. */
const ADD_ICON_SIZE = 19;

type TabSlotsProps = {
  /** Какая вкладка подсвечена акцентом; активность — только цветом (25a). */
  active: TabKey;
  labels: SlotLabels;
};

/**
 * Пять мест таб-бара. Прежде размеры приезжали пропами: у бара и у шторки они
 * различались на единицу (22/21 и 19/18). Шторки не стало (тикет 65) —
 * остались два числа контракта, и они живут здесь константами.
 */
export function TabSlots({ active, labels }: TabSlotsProps) {
  return (
    <>
      {TAB_SLOTS.map((slot) => {
        if (slot === "add") {
          return (
            <Link key={slot} href={ADD_HREF} className={`pressable ${s.slot} ${s.slotAdd}`}>
              <span className={s.addBadge}>
                <IconPlus size={ADD_ICON_SIZE} strokeWidth={2.1} />
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
          >
            <SlotIcon slot={slot} active={isActive} size={ICON_SIZE} />
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
