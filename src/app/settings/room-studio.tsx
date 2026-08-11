"use client";

// КРУПНЫЙ КАДР НАСТРОЕК — одна комната на две ручки (тикет 181).
//
// ОТКУДА. Приёмка владельца 11.08.2026, три пункта из пяти про один экран:
// «при выборе комнаты на мобильном увеличивать изображение, чтобы пользователь
// понимал, какая комната будет», «выбор света роняет непонятно, просто мигает
// экран», «он просто что-то жмёт и вынужден каждый раз выходить в комнату».
//
// ЧТО ЭТО ЗА УЗЕЛ. Кадр слушается ОБОИХ выборов сразу — интерьера и света, —
// а выборы живут в двух разных разделах. Значит состояние обязано стоять НАД
// обоими: здесь. Разделы забирают его хуком `useRoomStudio`, а не пропсами,
// потому что между ними и этим узлом лежит серверная страница, а обработчики
// RSC-границу не пересекают (тот же довод, что у моста сцены и указателя зон,
// `scene/zone-index-context.tsx`).
//
// ГЛАВНОЕ, ЧЕГО ЭТОТ УЗЕЛ НЕ ДЕЛАЕТ: он не трогает комнату. Ни одного
// серверного действия в файле нет и быть не может — смену интерьера пишет
// «Переехать» в `PresetSection`, свет пишут сами положения. Разведение «что
// стоит в комнате» и «что человек смотрит» — в чистом `room-preview.ts`.
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslations } from "next-intl";
import {
  gradingFilter,
  gradingLayers,
  type LightColor,
  type TimeOfDay,
} from "@/components/scene/grading";
import { previewOf, type PresetCard } from "./room-preview";
import s from "./room-studio.module.css";

type RoomStudioValue = {
  /** Все интерьеры — лента фильтрует их сама, кадр ищет по полному списку. */
  cards: readonly PresetCard[];
  /** Что стоит в комнате СЕЙЧАС (правда сервера). */
  currentPreset: string;
  /** Что показывает кадр; `null` — показывать нечего (пресет незнаком). */
  shown: PresetCard | null;
  /** Показанный интерьер выбран, но в комнате ещё не стоит. */
  pending: boolean;
  /** Выбрать интерьер: меняет КАДР, комнату не трогает. */
  select: (id: string) => void;
  timeOfDay: TimeOfDay;
  setTimeOfDay: Dispatch<SetStateAction<TimeOfDay>>;
  lightColor: LightColor;
  setLightColor: Dispatch<SetStateAction<LightColor>>;
};

const RoomStudioContext = createContext<RoomStudioValue | null>(null);

/**
 * Состояние кадра для раздела настроек. Провайдер обязателен: раздел без
 * кадра — это ровно тот экран, который владелец завернул, и молча работать
 * в таком виде он не должен.
 */
export function useRoomStudio(): RoomStudioValue {
  const value = useContext(RoomStudioContext);
  if (!value) {
    throw new Error("useRoomStudio: раздел стоит вне <RoomStudio> — кадру некуда отвечать");
  }
  return value;
}

/**
 * Обёртка «Интерьер + Свет»: липкий кадр сверху, оба раздела внутри.
 *
 * Порядок разделов задаёт страница (решение владельца, тикет 180, держит
 * `tests/settings-order.test.ts`) — сюда они приезжают `children` в том виде,
 * в каком стоят там.
 */
export function RoomStudio({
  cards,
  currentPreset,
  timeOfDay,
  lightColor,
  children,
}: {
  cards: PresetCard[];
  currentPreset: string;
  timeOfDay: TimeOfDay;
  lightColor: LightColor;
  /** Разделы «Интерьер» и «Свет» — их порядок задаёт страница, а не обёртка. */
  children?: ReactNode;
}) {
  // ВЫБОР ЧЕЛОВЕКА, А НЕ КОМНАТА. Стартует с того, что в комнате стоит, и
  // расходится с ней ровно на время, пока «Переехать» не нажато.
  const [selected, setSelected] = useState(currentPreset);
  // Свет оптимистичен: обе ручки меняют кадр в момент нажатия, а не после
  // ответа сервера (требование тикета — «не сломать»).
  const [tod, setTod] = useState(timeOfDay);
  const [color, setColor] = useState(lightColor);

  const { shown, pending } = previewOf(cards, currentPreset, selected);

  const value = useMemo<RoomStudioValue>(
    () => ({
      cards,
      currentPreset,
      shown,
      pending,
      select: setSelected,
      timeOfDay: tod,
      setTimeOfDay: setTod,
      lightColor: color,
      setLightColor: setColor,
    }),
    [cards, currentPreset, shown, pending, tod, color],
  );

  return (
    <RoomStudioContext.Provider value={value}>
      <div className={s.studio}>
        {shown && (
          <RoomFrame card={shown} pending={pending} timeOfDay={tod} lightColor={color} />
        )}
        {children}
      </div>
    </RoomStudioContext.Provider>
  );
}

/**
 * Сам кадр: фотография, грейдинг и подпись. Состояния не держит — всё, что он
 * показывает, приезжает пропсами.
 *
 * ОТДЕЛЁН ОТ СОСТОЯНИЯ НАМЕРЕННО, той же причины ради, что и `room-preview.ts`:
 * обе редакции подписи — «так и выглядит» и «ещё не применён» — обязаны
 * проверяться ВЫЗОВОМ, а не прокликиванием. Внутри `RoomStudio` расхождение
 * появляется только после тапа, и в юните такое состояние недостижимо.
 */
export function RoomFrame({
  card,
  pending,
  timeOfDay,
  lightColor,
}: {
  card: PresetCard;
  /** Показанный интерьер выбран, но в комнате ещё не стоит. */
  pending: boolean;
  timeOfDay: TimeOfDay;
  lightColor: LightColor;
}) {
  const t = useTranslations("Settings");

  return (
    <div className={s.dock} style={{ "--preview-accent": card.accent } as CSSProperties}>
      {/* Грейдинг считается от РОДНОГО времени суток показанной базы, а не
          текущей комнаты (тикет 107): четыре базы из десяти сняты ночью, и
          превью чужого интерьера обязано считать от его же фотографии — иначе
          выбор «по картинке» показывает одно, а комната становится другой. */}
      <div
        aria-hidden
        className={s.frame}
        style={{ "--grade-filter": gradingFilter(timeOfDay, lightColor, card.tod) } as CSSProperties}
      >
        {/* Тот же файл, что у плитки ленты (`card.imageUrl`) — второго запроса
            за картинкой нет ни одного (условие тикета). */}
        <div className={s.photo} style={{ backgroundImage: `url(${card.imageUrl})` }} />
        {gradingLayers(timeOfDay, lightColor, card.tod).map((grade) => (
          <div
            key={grade.overlay}
            className={s.grade}
            style={{ background: grade.overlay, mixBlendMode: grade.blend }}
          />
        ))}
      </div>
      {/* СОВРАТЬ ЗДЕСЬ ЛЕГКО И ДОРОГО. Пока выбранный интерьер не применён,
          кадр показывает ВЫБРАННЫЙ, и подпись обязана сказать это словами:
          смена интерьера двигает вещи между полками, и человек, решивший, что
          она уже случилась, не поймёт потом, куда они делись. */}
      {pending ? (
        <p className={s.captionPending}>
          <span aria-hidden className={s.captionDot} />
          {t("studioPending", { name: card.name })}
        </p>
      ) : (
        <p className={s.caption}>{t("studioApplied")}</p>
      )}
    </div>
  );
}
