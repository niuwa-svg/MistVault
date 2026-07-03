import type { ThemeMode } from "@shared/types";

const darkQuery = "(prefers-color-scheme: dark)";

export const resolveTheme = (mode: ThemeMode): "light" | "dark" => {
  if (mode !== "system") {
    return mode;
  }

  return window.matchMedia(darkQuery).matches ? "dark" : "light";
};

export const applyThemeMode = (mode: ThemeMode): void => {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
};

export const watchSystemTheme = (getMode: () => ThemeMode): (() => void) => {
  const media = window.matchMedia(darkQuery);
  const update = () => {
    if (getMode() === "system") {
      applyThemeMode("system");
    }
  };

  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
};
