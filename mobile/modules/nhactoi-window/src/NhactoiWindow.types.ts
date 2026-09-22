export type WindowRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type FoldingFeatureState = "FLAT" | "HALF_OPENED" | string;
export type FoldingFeatureOrientation = "HORIZONTAL" | "VERTICAL" | string;
export type FoldingFeatureOcclusion = "NONE" | "FULL" | string;

export type NhactoiFoldingFeature = {
  bounds: WindowRect;
  state: FoldingFeatureState;
  orientation: FoldingFeatureOrientation;
  occlusionType: FoldingFeatureOcclusion;
  isSeparating: boolean;
};

export type WindowLayoutInfoEvent = {
  /** Current application window size in density-independent pixels. */
  width: number;
  height: number;
  /** Logical density used to convert native pixel bounds to dp. */
  density: number;
  /** Original application-window origin in the host display, in dp. */
  origin: { x: number; y: number };
  /** Full WindowMetrics bounds, in display coordinates and dp. */
  windowBounds: WindowRect;
  /** FoldingFeature bounds are local to the application window and in dp. */
  foldingFeatures: NhactoiFoldingFeature[];
};
