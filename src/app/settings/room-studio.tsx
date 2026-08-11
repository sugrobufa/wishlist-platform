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
  useEffect,
  useMemo,
  useRef,
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
  LIGHT_COLORS,
  TIMES_OF_DAY,
  type GradeLayer,
  type LightColor,
  type NativeTimeOfDay,
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
        {shown && <RoomFrame card={shown} timeOfDay={tod} lightColor={color} />}
        {children}
      </div>
    </RoomStudioContext.Provider>
  );
}

/**
 * Все слои, какие эта база может показать при любом положении обеих ручек:
 * три времени × три цвета, дубликаты схлопнуты.
 *
 * НУЖНО ЭТО РАДИ КРОССФЕЙДА, А НЕ РАДИ КРАСОТЫ. Пока слои рисовались одним
 * `map`'ом по текущему сочетанию, смена света РАЗМОНТИРОВАЛА старые узлы и
 * смонтировала новые — то есть слои менялись встык, мгновенно, и плавно ехал
 * только фильтр. Это и был остаток «мигания», на которое жаловался владелец:
 * на плитке 110×56 стык не читался, на кадре в 375 читается.
 *
 * Теперь узлы стоят ВСЕ и всегда, а меняется только непрозрачность — приём
 * из `motion.json` (460 мс, «кадры лежат стопкой, активный к 1, остальные 0»),
 * которым в комнате раскрывается мебель зоны.
 */
function layerStack(native: NativeTimeOfDay): ReadonlyArray<readonly [string, GradeLayer]> {
  const all = new Map<string, GradeLayer>();
  for (const tod of TIMES_OF_DAY) {
    for (const color of LIGHT_COLORS) {
      for (const layer of gradingLayers(tod, color, native)) {
        all.set(`${layer.overlay}|${layer.blend}`, layer);
      }
    }
  }
  return [...all];
}

/** Ключи слоёв, горящих при этом сочетании ручек. */
function litLayers(tod: TimeOfDay, color: LightColor, native: NativeTimeOfDay): ReadonlySet<string> {
  return new Set(gradingLayers(tod, color, native).map((l) => `${l.overlay}|${l.blend}`));
}

/**
 * Сам кадр: фотография, грейдинг и строка состояния под ними. Своего почти не
 * держит — всё, что он показывает, приезжает пропсами; собственное состояние
 * ровно одно и служебное: уходящая база на время кроссфейда.
 *
 * ОТДЕЛЁН ОТ СОСТОЯНИЯ НАМЕРЕННО, той же причины ради, что и `room-preview.ts`:
 * строка состояния при любом сочетании обеих ручек обязана проверяться
 * ВЫЗОВОМ, а не прокликиванием — сочетаний девять на каждую из десяти баз, и
 * внутри `RoomStudio` до половины из них добираешься только тапами.
 *
 * ПРО ПРИМЕРКУ ЗДЕСЬ НЕТ НИ СЛОВА, И ЭТО НАРОЧНО. Состояние «показано, но не
 * применено» называет плашка в `PresetSection` — там же, где живёт «Переехать».
 * Серверных действий в этом файле нет и быть не может (см. шапку), а плашка
 * без своего действия — половина, которая соврёт при первой же правке.
 */
export function RoomFrame({
  card,
  timeOfDay,
  lightColor,
}: {
  card: PresetCard;
  timeOfDay: TimeOfDay;
  lightColor: LightColor;
}) {
  const t = useTranslations("Settings");
  const leaving = useLeavingCard(card);

  return (
    <div className={s.dock} style={{ "--preview-accent": card.accent } as CSSProperties}>
      <div aria-hidden className={s.frame}>
        <GradedBase card={card} timeOfDay={timeOfDay} lightColor={lightColor} />
        {/* УХОДЯЩАЯ БАЗА ЛЕЖИТ ПОВЕРХ И ГАСНЕТ (пакет 43, `motion.roomChange`).
            Порядок в разметке и есть порядок слоёв: она идёт второй, значит
            выше. Грейдинг у каждой базы свой — он считается от РОДНОГО времени
            её съёмки, — поэтому крестом идут целые узлы «фото со своими
            слоями», а не одна фотография под общими. */}
        {leaving && (
          <GradedBase
            key={leaving.id}
            card={leaving}
            timeOfDay={timeOfDay}
            lightColor={lightColor}
            leaving
          />
        )}
      </div>
      {/* ВЫБРАННОЕ НАЗВАНО СЛОВАМИ, А НЕ ТОЛЬКО ЗАЛИВКОЙ (тикет 185, пакет 43).
          «Кремовая · вечер · тёплый свет» — второй сигнал, и он абсолютный:
          чтобы понять, что выбрано, не надо сравнивать плитку с соседями.
          `aria-live` затем же: смена положения обязана быть слышна, а не
          только видна — кадр читалке не говорит ничего. */}
      <p className={s.state} aria-live="polite">
        {t("roomState", {
          room: card.name,
          tod: t(`state_${timeOfDay}`),
          light: t(`state_${lightColor}`),
        })}
      </p>
    </div>
  );
}

/**
 * Уходящая база — та, что стояла в кадре до последней смены интерьера.
 * Живёт ровно время кроссфейда и исчезает сама.
 */
function useLeavingCard(card: PresetCard): PresetCard | null {
  const [leaving, setLeaving] = useState<PresetCard | null>(null);
  const shownRef = useRef(card);

  useEffect(() => {
    if (shownRef.current.id === card.id) return;
    const gone = shownRef.current;
    shownRef.current = card;
    setLeaving(gone);
    const timer = setTimeout(() => setLeaving(null), ROOM_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [card]);

  return leaving;
}

/** Длительность кроссфейда баз — та же, что у слоёв (`motion.json`). */
const ROOM_CHANGE_MS = 460;

/**
 * Одна база со своими слоями света.
 *
 * Грейдинг считается от РОДНОГО времени суток показанной базы, а не текущей
 * комнаты (тикет 107): ПЯТЬ баз из десяти сняты ночью (emerald, bold, gamer,
 * study, loft — счёт по `rooms.json`, находка пакета 43; прежде здесь стояло
 * «четыре», и это было неверно), и превью чужого интерьера обязано считать от
 * его же фотографии — иначе выбор «по картинке» показывает одно, а комната
 * становится другой.
 */
function GradedBase({
  card,
  timeOfDay,
  lightColor,
  leaving = false,
}: {
  card: PresetCard;
  timeOfDay: TimeOfDay;
  lightColor: LightColor;
  /** База уходит: лежит поверх и гаснет. */
  leaving?: boolean;
}) {
  const stack = useMemo(() => layerStack(card.tod), [card.tod]);
  const lit = litLayers(timeOfDay, lightColor, card.tod);

  return (
    <div
      className={leaving ? `${s.base} ${s.baseLeaving}` : s.base}
      style={{ "--grade-filter": gradingFilter(timeOfDay, lightColor, card.tod) } as CSSProperties}
    >
      {/* Тот же файл, что у плитки ленты (`card.imageUrl`) — второго запроса
          за картинкой нет ни одного (условие тикета 181). */}
      <div className={s.photo} style={{ backgroundImage: `url(${card.imageUrl})` }} />
      {stack.map(([id, layer]) => (
        <div
          key={id}
          className={s.grade}
          style={{
            background: layer.overlay,
            mixBlendMode: layer.blend,
            opacity: lit.has(id) ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
}
