import { Dimensions, Platform } from "react-native";
import NhactoiWindowModule from "../../modules/nhactoi-window";

/**
 * React Native (Fabric, 0.86) does not re-measure text that is already mounted when the system
 * font size changes while the app is running: glyphs are drawn at the new size inside boxes
 * measured at the old one, so labels clip and wrapped lines overlap. A fresh mount measures
 * correctly. Text components key their host node on this epoch so only the stateless text nodes
 * remount; inputs, scroll positions and screen state are untouched.
 */
type FontScaleStore = {
  listeners: Set<() => void>;
  epoch: number;
  lastScale: number | undefined;
  started: boolean;
  settleTimer: ReturnType<typeof setTimeout> | undefined;
};
// One store per JS runtime: Fast Refresh re-evaluates this module, and a module-level store would
// reset the epoch and register the native listeners a second time.
const globalStore = globalThis as typeof globalThis & {
  __nhactoiFontScaleStore?: FontScaleStore;
};
const store = (globalStore.__nhactoiFontScaleStore ??= {
  listeners: new Set(),
  epoch: 0,
  lastScale: undefined,
  started: false,
  settleTimer: undefined,
});

/** Native surfaces can apply the new multiplier a moment after JS hears about it. */
export const FONT_SCALE_SETTLE_MS = 300;

const emit = () => {
  store.epoch += 1;
  for (const listener of store.listeners) listener();
};

/** Records a reported font scale and remeasures mounted text when it actually changed. */
export function notifyFontScale(scale: number | undefined) {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
  if (store.lastScale === undefined) {
    store.lastScale = scale;
    return;
  }
  if (Math.abs(scale - store.lastScale) < 0.001) return;
  store.lastScale = scale;
  emit();
  if (store.settleTimer) clearTimeout(store.settleTimer);
  store.settleTimer = setTimeout(() => {
    store.settleTimer = undefined;
    emit();
  }, FONT_SCALE_SETTLE_MS);
}

function start() {
  if (store.started) return;
  store.started = true;
  notifyFontScale(Dimensions.get("window").fontScale);
  // iOS reports Dynamic Type changes here immediately; Android only after the next resume.
  Dimensions.addEventListener("change", ({ window }) =>
    notifyFontScale(window.fontScale),
  );
  // Android: the window module reports configuration font-scale changes while visible,
  // including split-screen where the activity is not resumed.
  if (Platform.OS === "android" && NhactoiWindowModule) {
    try {
      NhactoiWindowModule.addListener("onWindowLayoutInfo", (event) =>
        notifyFontScale(event.fontScale),
      );
    } catch {
      // An older dev build without this event still gets the Dimensions path above.
    }
  }
}

export function subscribeFontScaleEpoch(listener: () => void) {
  start();
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export const getFontScaleEpoch = () => store.epoch;

/** Test hook: forget the baseline and pending settle pass. */
export function resetFontScaleEpochForTests() {
  if (store.settleTimer) clearTimeout(store.settleTimer);
  store.settleTimer = undefined;
  store.lastScale = undefined;
}
