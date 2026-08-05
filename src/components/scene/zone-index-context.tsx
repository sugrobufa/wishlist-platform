"use client";

// Мост между сценой и указателем зон (тикет 34).
//
// ЗАЧЕМ ОН ЕСТЬ. Указатель обязан лежать В НИЖНЕЙ ПОЛОСЕ интерфейса (контракт:
// tokens.json → layout.desktopImmersive.note), а полоса — не часть сцены: она
// соседний слой раскладки тикета 24. Значит два поддерева, которым нужно одно
// состояние: какая зона подсвечена сейчас и какая открыта. Пробрасывать это
// пропсами через серверную страницу нельзя (обработчики не пересекают
// RSC-границу), поэтому — контекст.
//
// ДВА КОНТЕКСТА, А НЕ ОДИН, намеренно: действия стабильны (useCallback с
// пустыми зависимостями), состояние меняется на каждое наведение. Слей их —
// и эффект сцены, который регистрирует вход в зону, перезапускался бы на
// каждое движение мыши по списку.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Вход в зону: тот же наезд, что по касанию самой зоны (сцена его и даёт). */
type Opener = (zoneKey: string) => void;

type ZoneIndexActions = {
  /** Подсветить зону: наведение/фокус с любой стороны — списка или сцены. */
  setLit: (zoneKey: string | null) => void;
  /** Сцена сообщает, какая зона сейчас открыта (или null). */
  setActive: (zoneKey: string | null) => void;
  /** Войти в зону из списка. */
  open: (zoneKey: string) => void;
  /** Сцена оставляет здесь свой обработчик входа; null — снимает. */
  registerOpener: (opener: Opener | null) => void;
};

type ZoneIndexState = {
  /** Зона под наведением или фокусом — общая подсветка списка и сцены. */
  lit: string | null;
  /** Открытая зона: пункт списка помечен aria-current, карточка сводки молчит. */
  active: string | null;
};

const IDLE: ZoneIndexState = { lit: null, active: null };

const ActionsContext = createContext<ZoneIndexActions | null>(null);
const StateContext = createContext<ZoneIndexState>(IDLE);

/**
 * Оборачивает сцену и нижнюю полосу на странице комнаты (хозяйки и гостя).
 * Без него сцена работает по-прежнему, а указателя просто нет — все
 * потребители переживают отсутствие провайдера.
 */
export function ZoneIndexProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ZoneIndexState>(IDLE);
  const openerRef = useRef<Opener | null>(null);

  const actions = useMemo<ZoneIndexActions>(
    () => ({
      setLit: (zoneKey) =>
        setState((prev) => (prev.lit === zoneKey ? prev : { ...prev, lit: zoneKey })),
      setActive: (zoneKey) =>
        setState((prev) => (prev.active === zoneKey ? prev : { ...prev, active: zoneKey })),
      open: (zoneKey) => openerRef.current?.(zoneKey),
      registerOpener: (opener) => {
        openerRef.current = opener;
      },
    }),
    [],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Действия моста; null — провайдера нет (указатель на странице не смонтирован). */
export function useZoneIndexActions(): ZoneIndexActions | null {
  return useContext(ActionsContext);
}

/** Подсвеченная и открытая зона. Без провайдера — покой. */
export function useZoneIndexState(): ZoneIndexState {
  return useContext(StateContext);
}

/** Ключ зоны у элемента или его предка (метка `data-zone` в слое хотспотов). */
function zoneKeyOf(node: EventTarget | null): string | null {
  return node instanceof Element
    ? (node.closest("[data-zone]")?.getAttribute("data-zone") ?? null)
    : null;
}

type SceneBridge = {
  /** Подсвеченная зона — сцена вешает по ней `data-lit` на свой хотспот. */
  lit: string | null;
  /**
   * Обработчики для слоя хотспотов ЦЕЛИКОМ: наведение и фокус всплывают,
   * поэтому одна пара на слой вместо пропа в каждой метке зоны (zone-hotspot.tsx
   * тикет не трогает).
   */
  zoneEvents: {
    onPointerOver: (event: { target: EventTarget | null }) => void;
    onPointerOut: (event: { relatedTarget: EventTarget | null }) => void;
    onFocus: (event: { target: EventTarget | null }) => void;
    onBlur: (event: { relatedTarget: EventTarget | null }) => void;
  };
};

/**
 * Сторона сцены: отдать мосту вход в зону и открытую зону, забрать подсветку.
 * Вся связь сцены с указателем — этот один вызов.
 */
export function useSceneZoneIndex(openZone: Opener, activeKey: string | null): SceneBridge {
  const actions = useZoneIndexActions();
  const { lit } = useZoneIndexState();

  // Обработчик входа держим в ref: он меняется на каждый рендер сцены, а
  // перерегистрировать мост из-за этого незачем.
  const openRef = useRef(openZone);
  useEffect(() => {
    openRef.current = openZone;
  }, [openZone]);

  useEffect(() => {
    if (!actions) return;
    actions.registerOpener((zoneKey) => openRef.current(zoneKey));
    return () => actions.registerOpener(null);
  }, [actions]);

  useEffect(() => {
    actions?.setActive(activeKey);
  }, [actions, activeKey]);

  // Уход со сцены гасит подсветку: иначе она осталась бы висеть после
  // размонтирования (смена комнаты в настройках).
  useEffect(() => () => actions?.setLit(null), [actions]);

  const setLit = actions?.setLit;
  const zoneEvents = useMemo(
    () => ({
      onPointerOver: (event: { target: EventTarget | null }) => setLit?.(zoneKeyOf(event.target)),
      // Переход с зоны на зону — это pointerout + pointerover: гасим не в null,
      // а в ту зону, куда указатель уехал, иначе подсветка мигает.
      onPointerOut: (event: { relatedTarget: EventTarget | null }) =>
        setLit?.(zoneKeyOf(event.relatedTarget)),
      onFocus: (event: { target: EventTarget | null }) => setLit?.(zoneKeyOf(event.target)),
      onBlur: (event: { relatedTarget: EventTarget | null }) =>
        setLit?.(zoneKeyOf(event.relatedTarget)),
    }),
    [setLit],
  );

  return { lit: lit, zoneEvents };
}
