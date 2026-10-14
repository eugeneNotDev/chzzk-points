import { useSyncExternalStore } from "react";
import { STORAGE } from "./config";
import { writeStorage } from "./storage";

export type Theme = "dark" | "light";

const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  writeStorage(STORAGE.theme, theme);
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
  );
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
