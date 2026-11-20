/** Appearance fields that apply on mobile. Values mirror shared/appearance.mjs. */
export type MobileAppearance = {
  mode: "system" | "light" | "dark";
  accent: string; // #RRGGBB
  background: "default" | "warm" | "cool";
  font: "vietnam" | "system";
  fontSize: "small" | "medium" | "large" | "xlarge";
  density: "comfortable" | "compact";
  corners: "rounded" | "square";
  contrast: "standard" | "high";
  motion: "system" | "reduced";
};

export const MOBILE_APPEARANCE_DEFAULTS: MobileAppearance = {
  mode: "system", accent: "#245bc0", background: "default", font: "vietnam",
  fontSize: "medium", density: "comfortable", corners: "square", contrast: "standard", motion: "system",
};

const CHOICES: { [K in Exclude<keyof MobileAppearance, "accent">]: readonly MobileAppearance[K][] } = {
  mode: ["system", "light", "dark"], background: ["default", "warm", "cool"], font: ["vietnam", "system"],
  fontSize: ["small", "medium", "large", "xlarge"], density: ["comfortable", "compact"], corners: ["rounded", "square"],
  contrast: ["standard", "high"], motion: ["system", "reduced"],
};

/**
 * Keeps only known mobile fields with valid values. Unknown keys, unknown enum
 * values (e.g. from a newer server or a corrupt cache) and malformed accents are
 * dropped so callers fall back to defaults instead of crashing the root theme.
 */
export function sanitizeMobileAppearance(input: unknown): Partial<MobileAppearance> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: Partial<MobileAppearance> = {};
  for (const key of Object.keys(CHOICES) as (keyof typeof CHOICES)[]) {
    const value = source[key];
    if ((CHOICES[key] as readonly unknown[]).includes(value)) (result as Record<string, unknown>)[key] = value;
  }
  if (typeof source.accent === "string" && /^#[0-9a-f]{6}$/i.test(source.accent)) result.accent = source.accent.toLowerCase();
  return result;
}

export type Palette = {
  ink: string; muted: string; accent: string; onAccent: string; pale: string;
  bg: string; surface: string; line: string;
  red: string; redPale: string; orange: string; orangePale: string; overlay: string;
};

export type Theme = {
  scheme: "light" | "dark";
  colors: Palette;
  radius: { control: number; card: number; sheet: number };
  /** Multiplier applied on top of the OS font scale. */
  fontScale: number;
  /** Multiplier for paddings/gaps (compact < 1). */
  space: number;
  reduceMotion: boolean;
  fontFamily: "vietnam" | "system";
  preferences: MobileAppearance;
};

const LIGHT: Palette = {
  ink: "#1f2a3d", muted: "#5f6d84", accent: "#245bc0", onAccent: "#fff", pale: "#e8effb",
  bg: "#f3f5f9", surface: "#fff", line: "#dbe2ec", red: "#aa3535", redPale: "#fcebec", orange: "#9a5b0b", orangePale: "#fff0dd", overlay: "#101a2e77",
};
const DARK: Omit<Palette, 'accent'> = {
  ink: "#f0f2f5", muted: "#8b94a2", onAccent: "#101214", pale: "#24334b",
  bg: "#101214", surface: "#16181b", line: "#2b3038", red: "#ffaaaa", redPale: "#482b35", orange: "#ffc57a", orangePale: "#493723", overlay: "#00000099",
};

function luminance(rgb: number[]) {
  return rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function rgb(hex: string): number[] {
  const normalized = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  return normalized.slice(1).match(/../g)!.map(v => parseInt(v, 16));
}
function hex(values: number[]) { return '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function ratio(a: number[], b: number[]) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function mix(a: string, b: string, weight: number) {
  const other = rgb(b);
  return hex(rgb(a).map((v, i) => v * weight + other[i] * (1 - weight)));
}
// Match the web's darkening/lightening approach, checking the actual rounded output
// against all surfaces on which mobile renders accent text.
function accentColor(input: string, scheme: 'light' | 'dark', high: boolean, surfaces: string[]) {
  const original = rgb(/^#[0-9a-f]{6}$/i.test(input) ? input : MOBILE_APPEARANCE_DEFAULTS.accent);
  let values = original;
  if (scheme === 'light') {
    while (surfaces.some(s => ratio(rgb(hex(values)), rgb(s)) < (high ? 7 : 4.5))) values = values.map(v => v * 0.92);
  } else {
    const [r, g, b] = original.map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let l = (max + min) / 2;
    const sat = !d ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const hue = !d ? 0 : (max === r ? (g-b)/d + (g < b ? 6 : 0) : max === g ? (b-r)/d + 2 : (r-g)/d + 4) / 6;
    const fromHsl = () => {
      if (!sat) return [l, l, l].map(v => v * 255);
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
      return [hue + 1/3, hue, hue - 1/3].map(t => { t = ((t % 1) + 1) % 1; return (t < 1/6 ? p + (q-p)*6*t : t < 1/2 ? q : t < 2/3 ? p + (q-p)*(2/3-t)*6 : p) * 255; });
    };
    while (l < 1 && surfaces.some(s => ratio(rgb(hex(values)), rgb(s)) < (high ? 7 : 4.5))) { l = Math.min(1, l + 0.02); values = fromHsl(); }
  }
  return hex(values);
}

export function resolveTheme(preferences: Partial<MobileAppearance> | null | undefined, systemScheme: "light" | "dark" | null | undefined): Theme {
  const prefs = { ...MOBILE_APPEARANCE_DEFAULTS, ...sanitizeMobileAppearance(preferences) };
  const scheme = prefs.mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : prefs.mode;
  const high = prefs.contrast === 'high';
  const colors: Palette = { ...LIGHT, ...(scheme === 'dark' ? DARK : {}) };
  if (scheme === 'light') {
    colors.bg = { default: LIGHT.bg, warm: '#faf6f0', cool: '#f1f5fb' }[prefs.background];
    colors.surface = { default: LIGHT.surface, warm: '#fffcf7', cool: '#fafcff' }[prefs.background];
    if (high) { colors.ink = '#101827'; colors.muted = '#39465b'; colors.line = '#738198'; colors.red = '#842020'; colors.orange = '#744000'; }
  } else {
    colors.bg = { default: DARK.bg, warm: '#181410', cool: '#10151e' }[prefs.background];
    colors.surface = { default: DARK.surface, warm: '#1e1a15', cool: '#151b26' }[prefs.background];
    if (high) { colors.ink = '#ffffff'; colors.muted = '#e1e9f5'; colors.line = '#a5b4ca'; colors.red = '#ffb0b0'; }
  }
  const accentInput = scheme === 'dark' && prefs.accent === MOBILE_APPEARANCE_DEFAULTS.accent ? '#7aa7ff' : prefs.accent;
  const baseAccent = accentColor(accentInput, scheme, high, [colors.bg, colors.surface]);
  let weight = scheme === 'dark' ? 0.22 : 0.1;
  const defaultPale = scheme === 'light' && !high && prefs.background === 'default' && prefs.accent === MOBILE_APPEARANCE_DEFAULTS.accent;
  colors.pale = defaultPale ? LIGHT.pale : mix(baseAccent, colors.surface, weight);
  while (ratio(rgb(colors.muted), rgb(colors.pale)) < (high ? 7 : defaultPale ? 4.5 : 4.55) && weight > 0) {
    weight = Math.max(0, weight - 0.01);
    colors.pale = mix(baseAccent, colors.surface, weight);
  }
  colors.accent = accentColor(accentInput, scheme, high, [colors.bg, colors.surface, colors.pale]);
  colors.onAccent = ratio(rgb(colors.accent), rgb('#fff')) >= 4.5 ? '#fff' : '#101214';
  return { scheme, colors, radius: prefs.corners === 'rounded' ? { control: 8, card: 12, sheet: 16 } : { control: 4, card: 6, sheet: 8 },
    fontScale: { small: 0.9, medium: 1, large: 1.12, xlarge: 1.25 }[prefs.fontSize], space: prefs.density === 'compact' ? 0.8 : 1,
    reduceMotion: prefs.motion === 'reduced', fontFamily: prefs.font, preferences: prefs };
}
