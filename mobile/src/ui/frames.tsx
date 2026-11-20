import React, { useRef, useState, useCallback } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NhactoiFoldingFeature } from "../../modules/nhactoi-window";
import { useAdaptiveWindow } from "./adaptive";
import type { LayoutRegion } from "./layout";
/** Keep this much space between a document and a separating fold. */
const HINGE_MARGIN = 8;
export const position = (r: LayoutRegion) => ({
  position: "absolute" as const,
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});
/**
 * Returns the largest single rectangle of `width` x `height` that clears every
 * separating fold by `margin`. Each feature is applied to the region that is
 * left after the previous one, so two display features can never leave content
 * straddling either fold.
 */
export function hingeSafeRegion(
  width: number,
  height: number,
  features: readonly NhactoiFoldingFeature[],
  margin = HINGE_MARGIN,
): LayoutRegion {
  return features.reduce<LayoutRegion>(
    (region, feature) => {
      if (!feature.isSeparating && feature.occlusionType !== "FULL")
        return region;
      const b = feature.bounds;
      const regionRight = region.x + region.width;
      const regionBottom = region.y + region.height;
      if (feature.orientation === "VERTICAL") {
        // Compare against the frame unclamped: clamping a fold that sits just
        // outside the frame would invent an edge and shrink usable content.
        if (b.bottom <= region.y || b.top >= regionBottom) return region;
        const gapLeft = b.left - margin;
        const gapRight = b.right + margin;
        if (gapRight <= region.x || gapLeft >= regionRight) return region;
        const leftWidth = Math.max(0, Math.min(gapLeft, regionRight) - region.x);
        const rightWidth = Math.max(
          0,
          regionRight - Math.max(gapRight, region.x),
        );
        if (leftWidth <= 0 && rightWidth <= 0) return region;
        return leftWidth >= rightWidth
          ? { ...region, width: leftWidth }
          : {
              x: regionRight - rightWidth,
              y: region.y,
              width: rightWidth,
              height: region.height,
            };
      }
      if (feature.orientation === "HORIZONTAL") {
        if (b.right <= region.x || b.left >= regionRight) return region;
        const gapTop = b.top - margin;
        const gapBottom = b.bottom + margin;
        if (gapBottom <= region.y || gapTop >= regionBottom) return region;
        const topHeight = Math.max(0, Math.min(gapTop, regionBottom) - region.y);
        const bottomHeight = Math.max(
          0,
          regionBottom - Math.max(gapBottom, region.y),
        );
        if (topHeight <= 0 && bottomHeight <= 0) return region;
        return topHeight >= bottomHeight
          ? { ...region, height: topHeight }
          : {
              x: region.x,
              y: regionBottom - bottomHeight,
              width: region.width,
              height: bottomHeight,
            };
      }
      return region;
    },
    {
      x: 0,
      y: 0,
      width: Math.max(0, width),
      height: Math.max(0, height),
    },
  );
}
export function useMeasuredWindow() {
  const size = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState({
    width: Math.max(0, size.width - insets.left - insets.right),
    height: Math.max(0, size.height - insets.top - insets.bottom),
    offsetX: insets.left,
    offsetY: insets.top,
  });
  const adaptive = useAdaptiveWindow(frame);
  const attach = useCallback((node: View | null) => {
    ref.current = node;
  }, []);
  const onLayout = () =>
    ref.current?.measureInWindow((x, y, width, height) => {
      // Rotation and modal transitions can report a not-yet-laid-out frame.
      // Keep the safe-area estimate instead of collapsing the layout to zero.
      if (!(width > 0 && height > 0)) return;
      setFrame((current) =>
        current.width === width &&
        current.height === height &&
        current.offsetX === x &&
        current.offsetY === y
          ? current
          : { width, height, offsetX: x, offsetY: y },
      );
    });
  return { attach, onLayout, ...adaptive };
}
/** A single document/form stays on one usable side of every separating fold. */
export function HingeSafe({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const {
    attach: frameRef,
    onLayout: measureFrame,
    ...window
  } = useMeasuredWindow();
  const region = hingeSafeRegion(
    window.width,
    window.height,
    window.foldingFeatures,
  );
  return (
    <View ref={frameRef} onLayout={measureFrame} style={{ flex: 1 }}>
      <View testID={testID} style={position(region)}>
        {children}
      </View>
    </View>
  );
}
