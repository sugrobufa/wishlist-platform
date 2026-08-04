import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-безопасный matchMedia: на сервере — false (мобильный дефолт),
 * на клиенте — живая подписка. Нужен сцене, чтобы считать transform наезда
 * для актуального вида (телефон/десктоп) и укорачивать таймеры партитуры
 * при prefers-reduced-motion.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
