import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const storageKey = "pixforge-site-theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#141414" : "#fafafa");
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* Private browsing can disable storage. */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
