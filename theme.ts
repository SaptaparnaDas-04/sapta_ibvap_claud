const THEME_KEY = "ibvap.theme";

export type Theme = "dark" | "light";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset["theme"] = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — theme just won't persist across reloads */
  }
}

/**
 * Inlined into the document head (see __root.tsx) so the correct theme is
 * set before first paint — without this, the page would flash the default
 * dark theme for a frame even when the visitor previously chose light.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = window.localStorage.getItem("${THEME_KEY}");
    document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
  } catch (e) {}
})();
`;
