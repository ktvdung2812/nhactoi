"use client";

import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "nhactoi_theme";
let themeOverride = null;

// Workspace appearance takes precedence while the authenticated shell is active.
export function setThemeOverride(mode, onChange) {
  themeOverride = mode ? { mode, onChange } : null;
  applyTheme();
  notifyListeners();
}

/**
 * Returns the currently configured theme ('system' | 'light' | 'dark').
 */
export function getSavedTheme() {
  if (themeOverride) return themeOverride.mode;
  if (typeof window === "undefined") return "system";
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch (e) {}
  return "system";
}

/**
 * Returns system color scheme ('dark' | 'light').
 */
export function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch (e) {
    return "light";
  }
}

/**
 * Resolves effective theme ('dark' | 'light') from stored setting.
 */
export function resolveTheme(theme = getSavedTheme()) {
  if (theme === "system") {
    return getSystemTheme();
  }
  return theme === "dark" ? "dark" : "light";
}

/**
 * Applies the resolved theme to document root.
 */
export function applyTheme(theme = getSavedTheme()) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// Subscribers for cross-component and external state sync
const listeners = new Set();
function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

/**
 * Persists theme setting and applies it immediately.
 */
export function setTheme(theme) {
  const nextTheme =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";
  if (themeOverride) {
    themeOverride.onChange?.(nextTheme);
    return;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (e) {}
  applyTheme(nextTheme);
  notifyListeners();
}

export const THEME_CYCLE = {
  light: "dark",
  dark: "system",
  system: "light",
};

/**
 * Cycles sequentially through 3 theme modes: Sáng -> Tối -> Tự động (Auto).
 */
export function toggleTheme() {
  const current = getSavedTheme();
  const next = THEME_CYCLE[current] || "light";
  setTheme(next);
  return next;
}

export const cycleTheme = toggleTheme;

/**
 * React hook to read and update theme state.
 */
export function useTheme() {
  const [theme, setLocalTheme] = useState(() => getSavedTheme());
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    resolveTheme(getSavedTheme()),
  );

  useEffect(() => {
    const update = () => {
      const current = getSavedTheme();
      setLocalTheme(current);
      setResolvedTheme(resolveTheme(current));
    };

    listeners.add(update);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = () => {
      if (getSavedTheme() === "system") {
        applyTheme("system");
        update();
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleMediaChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleMediaChange);
    }

    // Ensure initial sync
    applyTheme(getSavedTheme());
    update();

    return () => {
      listeners.delete(update);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleMediaChange);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    cycleTheme,
    isDark: resolvedTheme === "dark",
  };
}
