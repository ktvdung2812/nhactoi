import type {
  NhactoiFoldingFeature,
  WindowRect,
} from "../../modules/nhactoi-window";

export type AdaptiveWidthClass = "compact" | "medium" | "expanded";
export type AdaptiveMode = "single" | "dual";
export type AdaptiveNavigation = "bottom" | "rail";

export type LayoutRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AdaptiveLayout = {
  mode: AdaptiveMode;
  navigation: AdaptiveNavigation;
  widthClass: AdaptiveWidthClass;
  /** Primary content region; the list is the primary region in a dual layout. */
  primary: LayoutRegion;
  /** Detail/content region when the window can show two logical areas. */
  secondary?: LayoutRegion;
  /** Region occupied by the navigation rail or bottom navigation. */
  navigationRegion: LayoutRegion;
  /** The hinge gap that was excluded from the content regions, when present. */
  hinge?: LayoutRegion;
  /** Useful to render tabletop controls in the lower pane. */
  posture: "flat" | "tabletop" | "book";
};

export type AdaptiveLayoutInput = {
  width: number;
  height: number;
  /** React Native font scale. It changes safe gutters/heights without resetting content. */
  fontScale?: number;
  foldingFeatures?: NhactoiFoldingFeature[];
};

export const ADAPTIVE_BREAKPOINTS = {
  mediumWidth: 600,
  expandedWidth: 840,
};

const BASE_BOTTOM_NAV_HEIGHT = 72;
const BASE_RAIL_WIDTH = 88;
const BASE_PANE_GAP = 16;
const MIN_PANE_WIDTH = 280;
const MIN_TABLETOP_HEIGHT = 240;

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

const region = (
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutRegion => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

const intersection = (
  a: LayoutRegion,
  b: WindowRect,
): LayoutRegion | undefined => {
  let left = Math.max(a.x, b.left);
  let top = Math.max(a.y, b.top);
  let right = Math.min(a.x + a.width, b.right);
  let bottom = Math.min(a.y + a.height, b.bottom);
  if (right < left || bottom < top) return undefined;

  // Android can report a zero-pixel hinge line for a continuous fold. Keep a one dp exclusion
  // centered on that line so content never straddles it after the native px -> dp conversion.
  if (right === left && left >= a.x && left <= a.x + a.width) {
    left = Math.max(a.x, left - 0.5);
    right = Math.min(a.x + a.width, right + 0.5);
  }
  if (bottom === top && top >= a.y && top <= a.y + a.height) {
    top = Math.max(a.y, top - 0.5);
    bottom = Math.min(a.y + a.height, bottom + 0.5);
  }
  return right > left && bottom > top
    ? region(left, top, right - left, bottom - top)
    : undefined;
};

const featureIsSeparating = (feature: NhactoiFoldingFeature) =>
  feature.isSeparating || feature.occlusionType === "FULL";

/**
 * Computes stable local-window regions for the adaptive frame.
 *
 * All coordinates are density-independent pixels relative to the app window. A separating
 * vertical feature becomes the gap between primary and secondary; a separating horizontal
 * feature becomes the gap between the upper and lower tabletop rows. The function is pure so
 * resize/posture changes can replace the layout without remounting either pane.
 */
export function getAdaptiveLayout({
  width: rawWidth,
  height: rawHeight,
  fontScale: rawFontScale = 1,
  foldingFeatures = [],
}: AdaptiveLayoutInput): AdaptiveLayout {
  const width = finite(rawWidth, 0);
  const height = finite(rawHeight, 0);
  const fontScale = Math.min(1.5, Math.max(1, finite(rawFontScale, 1)));
  const widthClass: AdaptiveWidthClass =
    width >= ADAPTIVE_BREAKPOINTS.expandedWidth
      ? "expanded"
      : width >= ADAPTIVE_BREAKPOINTS.mediumWidth
        ? "medium"
        : "compact";
  const navigation: AdaptiveNavigation =
    widthClass === "compact" ? "bottom" : "rail";
  const bottomNavHeight = Math.min(height, BASE_BOTTOM_NAV_HEIGHT * fontScale);
  const railWidth = Math.min(width, BASE_RAIL_WIDTH * fontScale);
  const navigationRegion =
    navigation === "bottom"
      ? region(0, Math.max(0, height - bottomNavHeight), width, bottomNavHeight)
      : region(0, 0, railWidth, height);
  const available =
    navigation === "bottom"
      ? region(0, 0, width, Math.max(0, height - bottomNavHeight))
      : region(railWidth, 0, Math.max(0, width - railWidth), height);
  const paneGap = BASE_PANE_GAP * fontScale;
  const minPaneWidth = MIN_PANE_WIDTH * Math.min(fontScale, 1.25);
  const minTabletopHeight = MIN_TABLETOP_HEIGHT * Math.min(fontScale, 1.25);
  const usableFeatures = foldingFeatures.filter(featureIsSeparating);
  const feature = usableFeatures
    .map((candidate) => ({
      candidate,
      bounds: intersection(available, candidate.bounds),
    }))
    .find((entry) => entry.bounds !== undefined);

  if (feature?.bounds && feature.candidate.orientation === "VERTICAL") {
    const hinge = feature.bounds;
    const leftWidth = hinge.x - available.x;
    const rightX = hinge.x + hinge.width;
    const rightWidth = available.x + available.width - rightX;
    if (leftWidth >= minPaneWidth && rightWidth >= minPaneWidth) {
      return {
        mode: "dual",
        navigation,
        widthClass,
        primary: region(available.x, available.y, leftWidth, available.height),
        secondary: region(rightX, available.y, rightWidth, available.height),
        navigationRegion,
        hinge,
        posture: "book",
      };
    }
    // Keep a narrow split-screen/book posture on one side of the hinge. Falling back to the
    // whole window would put interactive content underneath the hinge.
    const useLeft = leftWidth >= rightWidth;
    return {
      mode: "single",
      navigation,
      widthClass,
      primary: useLeft
        ? region(available.x, available.y, leftWidth, available.height)
        : region(rightX, available.y, rightWidth, available.height),
      navigationRegion,
      hinge,
      posture: "book",
    };
  }

  if (feature?.bounds && feature.candidate.orientation === "HORIZONTAL") {
    const hinge = feature.bounds;
    const topHeight = hinge.y - available.y;
    const bottomY = hinge.y + hinge.height;
    const bottomHeight = available.y + available.height - bottomY;
    const topUsable = topHeight >= minTabletopHeight;
    const bottomUsable = bottomHeight >= minTabletopHeight;
    // A rail that spans the full height would itself land on a horizontal hinge. Keep it on
    // one physical side; the content panes use the same hinge-safe x origin below.
    const hingeSafeNavigationRegion =
      navigation === "rail"
        ? topHeight >= minTabletopHeight
          ? region(0, available.y, railWidth, topHeight)
          : region(0, bottomY, railWidth, bottomHeight)
        : navigationRegion;
    if (topUsable && bottomUsable) {
      return {
        mode: "dual",
        navigation,
        widthClass,
        primary: region(available.x, available.y, available.width, topHeight),
        secondary: region(available.x, bottomY, available.width, bottomHeight),
        navigationRegion: hingeSafeNavigationRegion,
        hinge,
        posture: "tabletop",
      };
    }
    // A short lower pane is reserved for the tabletop controls only when it is usable. Keep
    // the primary content on one complete side of the hinge when a split-screen resize makes
    // the other side too short for accessible controls.
    if (topUsable || bottomUsable) {
      const useTop = topUsable && (!bottomUsable || topHeight >= bottomHeight);
      return {
        mode: "single",
        navigation,
        widthClass,
        primary: useTop
          ? region(available.x, available.y, available.width, topHeight)
          : region(available.x, bottomY, available.width, bottomHeight),
        navigationRegion: hingeSafeNavigationRegion,
        hinge,
        posture: "tabletop",
      };
    }
    const useTop = topHeight >= bottomHeight;
    return {
      mode: "single",
      navigation,
      widthClass,
      primary: useTop
        ? region(available.x, available.y, available.width, topHeight)
        : region(available.x, bottomY, available.width, bottomHeight),
      navigationRegion: hingeSafeNavigationRegion,
      hinge,
      posture: "tabletop",
    };
  }

  if (
    widthClass === "expanded" &&
    available.width >= minPaneWidth * 2 + paneGap
  ) {
    const primaryWidth = (available.width - paneGap) / 2;
    return {
      mode: "dual",
      navigation,
      widthClass,
      primary: region(available.x, available.y, primaryWidth, available.height),
      secondary: region(
        available.x + primaryWidth + paneGap,
        available.y,
        primaryWidth,
        available.height,
      ),
      navigationRegion,
      posture: "flat",
    };
  }

  return {
    mode: "single",
    navigation,
    widthClass,
    primary: available,
    navigationRegion,
    posture: "flat",
  };
}
