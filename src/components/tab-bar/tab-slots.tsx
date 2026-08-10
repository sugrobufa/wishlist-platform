import Link from "next/link";
import { IconPeople, IconPerson, IconPlus, IconRoom, IconTreasury } from "@/components/icons";
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
 * Пять мест таб-бара: четыре вкладки и «Добавить» кружком посередине (тикет
 * 132 вернул «Сокровищницу», иначе кружок уезжал из центра). Прежде размеры
 * приезжали пропами: у бара и у шторки они различались на единицу (22/21 и
 * 19/18). Шторки не стало (тикет 65) — остались два числа контракта, и они
 * живут здесь константами.
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

/**
 * Знак вкладки. ВОЗВРАЩАЕТ УЗЕЛ ВСЕГДА — тип `TabKey` перечислен здесь
 * целиком, и это не педантизм: у «Сокровищницы» ветки не было, и место в баре
 * рисовалось голым словом (приёмка владельца 10.08, замечание 1). Тикет 132
 * вернул её в состав и подпись, а сюда правка не доехала — switch без ветки
 * молча отдавал undefined. Добавляешь вкладку — добавляй и знак.
 */
function SlotIcon({ slot, active, size }: { slot: TabKey; active: boolean; size: number }) {
  switch (slot) {
    case "room":
      // Тёплая точка-лампа горит только у активной «Комнаты» — так рисует
      // 25a (шторка против состояния «в списках»).
      return <IconRoom size={size} dot={active} />;
    case "connections":
      return <IconPeople size={size} />;
    case "hall":
      // БРИЛЛИАНТ, А НЕ АРКА ИЗ `tab-treasury.svg` — и это осознанное
      // расхождение с набором (письмо дизайну 10.08).
      //
      // Канон бара рисует витрину аркой со скважиной (`IconHall`), но арка
      // уже занята соседней вкладкой: «Комната» — та же арка с точкой, и на
      // 22 px через одно место от неё второй силуэт читается как та же
      // кнопка. Тот же довод владелец высказал 09.08 про шкатулку в углу
      // сцены («нужна другая, более читаемая, может бриллиант»), и знаком
      // витрины стал бриллиант. В комнате оба знака видны ОДНОВРЕМЕННО —
      // угол сцены и бар, — так что арка здесь означала бы два разных знака
      // одного места на одном экране.
      //
      // `IconHall` из набора не удалён и продолжает сверяться с файлом
      // (tests/tab-icons): пакет описывает набор доски, а не то, что сейчас
      // на экране.
      return <IconTreasury size={size} />;
    case "settings":
      return <IconPerson size={size} />;
  }
}
