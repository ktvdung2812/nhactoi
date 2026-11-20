import React from "react";
import { cleanup, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { HingeSafe, hingeSafeRegion } from "../src/ui/frames";
import type { NhactoiFoldingFeature } from "../modules/nhactoi-window";

jest.mock("react-native-safe-area-context", () =>
  jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../src/ui/adaptive", () => {
  type MockWindow = {
    width: number;
    height: number;
    foldingFeatures: unknown[];
  };
  let state: MockWindow = { width: 1000, height: 800, foldingFeatures: [] };
  return {
    __setWindow(next: Partial<MockWindow>) {
      state = { ...state, ...next };
    },
    useAdaptiveWindow: () => state,
  };
});

const setWindow = (
  jest.requireMock("../src/ui/adaptive") as {
    __setWindow: (next: {
      width?: number;
      height?: number;
      foldingFeatures?: NhactoiFoldingFeature[];
    }) => void;
  }
).__setWindow;

const feature = (
  orientation: "VERTICAL" | "HORIZONTAL",
  bounds: { left: number; top: number; right: number; bottom: number },
  overrides: Partial<NhactoiFoldingFeature> = {},
): NhactoiFoldingFeature => ({
  bounds,
  state: "HALF_OPENED",
  orientation,
  occlusionType: "NONE",
  isSeparating: true,
  ...overrides,
});

const vertical = (
  left: number,
  right: number,
  top = 0,
  bottom = 800,
  overrides: Partial<NhactoiFoldingFeature> = {},
) => feature("VERTICAL", { left, top, right, bottom }, overrides);

const horizontal = (top: number, bottom: number, left = 0, right = 1000) =>
  feature("HORIZONTAL", { left, top, right, bottom });

const FRAME = { x: 0, y: 0, width: 1000, height: 800 };

afterEach(() => {
  cleanup();
  setWindow({ width: 1000, height: 800, foldingFeatures: [] });
});

test("a window without display features uses the whole frame", () => {
  expect(hingeSafeRegion(1000, 800, [])).toEqual(FRAME);
});

test("a book posture keeps the form on one side of a vertical hinge", () => {
  const region = hingeSafeRegion(1000, 800, [vertical(480, 520)]);
  // Both sides are 472 dp wide, so the first (left) side wins the tie.
  expect(region).toEqual({ x: 0, y: 0, width: 472, height: 800 });
  expect(region.x + region.width).toBeLessThanOrEqual(480);
});

test("a tabletop posture keeps the form above a horizontal hinge", () => {
  const region = hingeSafeRegion(1000, 800, [horizontal(380, 420)]);
  expect(region).toEqual({ x: 0, y: 0, width: 1000, height: 372 });
  expect(region.y + region.height).toBeLessThanOrEqual(380);
});

test("a vertical and a horizontal hinge both cut the usable region", () => {
  const region = hingeSafeRegion(1200, 1000, [
    vertical(500, 540, 0, 1000),
    horizontal(400, 440, 0, 1200),
  ]);
  // The wider right pane (652 dp) is kept, then the taller lower pane (552 dp).
  expect(region).toEqual({ x: 548, y: 448, width: 652, height: 552 });
  expect(region.x).toBeGreaterThanOrEqual(540);
  expect(region.y).toBeGreaterThanOrEqual(440);
});

test("a zero-width hinge line still reserves the margin around it", () => {
  const region = hingeSafeRegion(1000, 800, [vertical(500, 500)]);
  expect(region).toEqual({ x: 0, y: 0, width: 492, height: 800 });
  expect(region.x + region.width).toBeLessThanOrEqual(500 - 8);
});

test("a hinge partially outside the frame is clipped instead of shrinking the whole side", () => {
  const left = hingeSafeRegion(1000, 800, [vertical(-100, 120)]);
  expect(left).toEqual({ x: 128, y: 0, width: 872, height: 800 });

  const right = hingeSafeRegion(1000, 800, [vertical(900, 1100)]);
  expect(right).toEqual({ x: 0, y: 0, width: 892, height: 800 });
});

test("a hinge fully outside the frame is ignored", () => {
  expect(hingeSafeRegion(1000, 800, [vertical(1100, 1200)])).toEqual(FRAME);
  expect(hingeSafeRegion(1000, 800, [vertical(-200, -100)])).toEqual(FRAME);
  // Outside on the other axis is just as irrelevant as outside on the fold's own axis.
  expect(hingeSafeRegion(1000, 800, [vertical(480, 520, 900, 1000)])).toEqual(
    FRAME,
  );
  expect(hingeSafeRegion(1000, 800, [horizontal(900, 1000)])).toEqual(FRAME);
});

test("a fold that does not separate the app is ignored, but full occlusion is respected", () => {
  expect(
    hingeSafeRegion(1000, 800, [
      vertical(480, 520, 0, 800, { isSeparating: false }),
    ]),
  ).toEqual(FRAME);
  expect(
    hingeSafeRegion(1000, 800, [
      vertical(480, 520, 0, 800, {
        isSeparating: false,
        occlusionType: "FULL",
      }),
    ]),
  ).toEqual({ x: 0, y: 0, width: 472, height: 800 });
});

test("the margin is applied on both sides of the fold", () => {
  const region = hingeSafeRegion(1000, 800, [vertical(480, 520)], 20);
  expect(region).toEqual({ x: 0, y: 0, width: 460, height: 800 });
  expect(region.x + region.width).toBeLessThanOrEqual(480 - 20);
});

test("the larger remaining side is chosen in both orientations", () => {
  expect(hingeSafeRegion(1000, 800, [vertical(100, 140)])).toEqual({
    x: 148,
    y: 0,
    width: 852,
    height: 800,
  });
  expect(hingeSafeRegion(1000, 1000, [horizontal(200, 260)])).toEqual({
    x: 0,
    y: 268,
    width: 1000,
    height: 732,
  });
});

test("HingeSafe positions its content inside the computed region", async () => {
  setWindow({
    width: 1000,
    height: 800,
    foldingFeatures: [vertical(480, 520)],
  });
  await render(
    <HingeSafe testID="safe">
      <Text>Nội dung</Text>
    </HingeSafe>,
  );
  expect(StyleSheet.flatten(screen.getByTestId("safe").props.style)).toEqual({
    position: "absolute",
    left: 0,
    top: 0,
    width: 472,
    height: 800,
  });
});
