// Theme contract shared by the mobile UI kit and the appearance-sync feature.
// The exported names and types below are the stable API; the implementation
// (palettes, accent derivation, dark mode) is filled in by the theme work.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Appearance, useColorScheme } from "react-native";

import { resolveTheme, sanitizeMobileAppearance, type MobileAppearance, type Theme } from "./theme-core";
import { StatusBar } from "expo-status-bar";

export * from "./theme-core";

export const MOBILE_APPEARANCE_FIELDS = [
  "mode", "accent", "background", "font", "fontSize", "density", "corners", "contrast", "motion",
] as const satisfies readonly (keyof MobileAppearance)[];



const ThemeContext = createContext<Theme>(resolveTheme(null, "light"));

export function ThemeProvider({ preferences, children }: { preferences?: Partial<MobileAppearance> | null; children: ReactNode }) {
  const observedScheme = useColorScheme();
  const mode = sanitizeMobileAppearance(preferences).mode ?? "system";
  const [, refreshScheme] = useState(0);
  useLayoutEffect(() => {
    Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
    // Resetting the override updates Appearance's cache without emitting a change event.
    refreshScheme(value => value + 1);
  }, [mode]);
  useEffect(() => () => Appearance.setColorScheme("unspecified"), []);
  const system = mode === "system" ? Appearance.getColorScheme() : observedScheme;
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReduceMotion);
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setSystemReduceMotion(value); }).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);
  const theme = useMemo(() => {
    const resolved = resolveTheme(preferences, system === "dark" ? "dark" : "light");
    return { ...resolved, reduceMotion: resolved.reduceMotion || systemReduceMotion };
  }, [preferences, system, systemReduceMotion]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === "dark" ? "light" : "dark"} />;
}
