import React, { useRef, useState, useCallback } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdaptiveWindow } from "./adaptive";
import type { LayoutRegion } from "./layout";
export const position = (r: LayoutRegion) => ({
  position: "absolute" as const,
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});
export function useMeasuredWindow() {
  const size = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState({
    width: size.width - insets.left - insets.right,
    height: size.height - insets.top - insets.bottom,
    offsetX: insets.left,
    offsetY: insets.top,
  });
  const adaptive = useAdaptiveWindow(frame);
  const attach = useCallback((node: View | null) => {
    ref.current = node;
  }, []);
  const onLayout = () =>
    ref.current?.measureInWindow((x, y, width, height) =>
      setFrame((current) =>
        current.width === width &&
        current.height === height &&
        current.offsetX === x &&
        current.offsetY === y
          ? current
          : { width, height, offsetX: x, offsetY: y },
      ),
    );
  return { attach, onLayout, ...adaptive };
}
/** A single document/form stays on one usable side of a separating fold. */
export function HingeSafe({ children }: { children: React.ReactNode }) {
  const {
    attach: frameRef,
    onLayout: measureFrame,
    ...window
  } = useMeasuredWindow();
  let region: LayoutRegion = {
    x: 0,
    y: 0,
    width: window.width,
    height: window.height,
  };
  for (const feature of window.foldingFeatures) {
    if (!feature.isSeparating && feature.occlusionType !== "FULL") continue;
    const b = feature.bounds;
    if (
      feature.orientation === "VERTICAL" &&
      b.left >= 0 &&
      b.left < window.width
    ) {
      const left = Math.max(0, b.left - 8),
        right = Math.min(window.width, b.right + 8);
      region =
        left >= window.width - right
          ? { x: 0, y: 0, width: left, height: window.height }
          : {
              x: right,
              y: 0,
              width: window.width - right,
              height: window.height,
            };
    }
    if (
      feature.orientation === "HORIZONTAL" &&
      b.top >= 0 &&
      b.top < window.height
    ) {
      const top = Math.max(0, b.top - 8),
        bottom = Math.min(window.height, b.bottom + 8);
      region =
        top >= window.height - bottom
          ? { x: 0, y: 0, width: window.width, height: top }
          : {
              x: 0,
              y: bottom,
              width: window.width,
              height: window.height - bottom,
            };
    }
  }
  return (
    <View ref={frameRef} onLayout={measureFrame} style={{ flex: 1 }}>
      <View style={position(region)}>{children}</View>
    </View>
  );
}
