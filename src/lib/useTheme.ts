import { useCallback, useEffect, useState } from "react";
import { loadTheme, saveTheme, type Theme } from "./tauri";

/**
 * Theme preference, with "system" as a real third state rather than a guess.
 *
 * The choice is stamped on the root element as `data-theme`; "system" stamps
 * nothing and lets `prefers-color-scheme` decide. That way the CSS has one
 * source of truth and the OS setting keeps working when the user hasn't
 * expressed a preference.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    void loadTheme().then(setTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const update = useCallback((next: Theme) => {
    setTheme(next);
    void saveTheme(next);
  }, []);

  return [theme, update];
}
