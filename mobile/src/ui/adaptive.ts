import { useEffect, useMemo, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NhactoiWindowModule, {
  type NhactoiFoldingFeature,
  type WindowLayoutInfoEvent,
} from "../../modules/nhactoi-window";
import { currentWindowSnapshot, getAdaptiveLayout, localizeFoldingFeatures, type AdaptiveLayout } from "./layout";

export type AdaptiveWindowState = {
  /** Window dimensions and feature coordinates are density-independent pixels. */
  width: number;
  height: number;
  fontScale: number;
  windowWidth: number;
  windowHeight: number;
  /** Host-display origin retained for edge-to-edge/SafeArea root translation. */
  windowOrigin: { x: number; y: number };
  windowBounds?: WindowLayoutInfoEvent["windowBounds"];
  foldingFeature: NhactoiFoldingFeature | null;
  foldingFeatures: NhactoiFoldingFeature[];
  safeAreaInsets: ReturnType<typeof useSafeAreaInsets>;
  layout: AdaptiveLayout;
};

export type AdaptiveWindowOptions = {
  /** Optional measured frame size in dp. Defaults to the current app window dimensions. */
  width?: number;
  height?: number;
  /** Frame origin in app-window coordinates; native feature bounds are translated by this. */
  offsetX?: number;
  offsetY?: number;
};

/**
 * Observes Android WindowManager / iOS UIKit reserved regions while keeping a useful width-only fallback everywhere else.
 * Native events replace the snapshot in place, so a rotation or split-screen drag does not
 * remount either pane or reset the screen's local state.
 */
export function useAdaptiveWindow(
  options: AdaptiveWindowOptions = {},
): AdaptiveWindowState {
  const dimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const [nativeSnapshot, setNativeSnapshot] =
    useState<WindowLayoutInfoEvent | null>(null);

  useEffect(() => {
    if (
      (Platform.OS !== "android" && Platform.OS !== "ios") ||
      !NhactoiWindowModule
    )
      return;
    let disposed = false;
    const subscription = NhactoiWindowModule.addListener(
      "onWindowLayoutInfo",
      (event: WindowLayoutInfoEvent) => setNativeSnapshot(event),
    );
    // Register first, then read the cached payload. Registration keeps any event
    // emitted during this handoff, while getSnapshot covers listeners added after
    // the module's initial OnStartObserving callback.
    const initialSnapshot = NhactoiWindowModule.getSnapshot?.();
    if (initialSnapshot) {
      // Defer hydration until after the effect has returned; preserve an event that
      // may have arrived synchronously while the listener was being registered.
      queueMicrotask(() => {
        if (!disposed) {
          setNativeSnapshot((current) => current ?? initialSnapshot);
        }
      });
    }
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, []);

  // Native WindowInfoTracker can deliver the next posture after RN has already
  // reported a rotation or split-screen resize. Ignore a cached payload from the
  // previous window shape until its dimensions match the current RN window.
  const currentNativeSnapshot = currentWindowSnapshot(nativeSnapshot, dimensions);
  const fontScale = nativeSnapshot?.fontScale ?? dimensions.fontScale;
  const width =
    options.width ?? currentNativeSnapshot?.width ?? dimensions.width;
  const height =
    options.height ?? currentNativeSnapshot?.height ?? dimensions.height;
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  const foldingFeatures = useMemo(
    () => localizeFoldingFeatures(currentNativeSnapshot?.foldingFeatures ?? [], offsetX, offsetY),
    [currentNativeSnapshot, offsetX, offsetY],
  );
  const layout = useMemo(
    () =>
      getAdaptiveLayout({
        width,
        height,
        fontScale,
        foldingFeatures,
      }),
    [fontScale, foldingFeatures, height, width],
  );

  return {
    width,
    height,
    fontScale,
    windowWidth: currentNativeSnapshot?.width ?? dimensions.width,
    windowHeight: currentNativeSnapshot?.height ?? dimensions.height,
    windowOrigin: currentNativeSnapshot?.origin ?? { x: 0, y: 0 },
    windowBounds: currentNativeSnapshot?.windowBounds,
    foldingFeature: foldingFeatures[0] ?? null,
    foldingFeatures,
    safeAreaInsets,
    layout,
  };
}

export { getAdaptiveLayout };
export type {
  AdaptiveLayout,
  AdaptiveLayoutInput,
  AdaptiveMode,
  AdaptiveNavigation,
  AdaptiveWidthClass,
  LayoutRegion,
} from "./layout";
