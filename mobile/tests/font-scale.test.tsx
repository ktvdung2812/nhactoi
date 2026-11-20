import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import {
  FONT_SCALE_SETTLE_MS,
  getFontScaleEpoch,
  notifyFontScale,
  resetFontScaleEpochForTests,
  subscribeFontScaleEpoch,
} from "../src/ui/font-scale";
import { Text } from "../src/ui/kit";

beforeEach(() => {
  jest.useFakeTimers();
  resetFontScaleEpochForTests();
});
afterEach(() => {
  jest.useRealTimers();
});

test("the first reported scale is only a baseline", () => {
  const before = getFontScaleEpoch();
  notifyFontScale(1);
  expect(getFontScaleEpoch()).toBe(before);
});

test("a real font-scale change remeasures now and once more after native settles", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeFontScaleEpoch(listener);
  // Subscribing records the device's current scale; start this test from a known baseline.
  resetFontScaleEpochForTests();
  notifyFontScale(1);
  const before = getFontScaleEpoch();
  notifyFontScale(2);
  expect(getFontScaleEpoch()).toBe(before + 1);
  jest.advanceTimersByTime(FONT_SCALE_SETTLE_MS);
  expect(getFontScaleEpoch()).toBe(before + 2);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

test("repeated or invalid reports of the same scale do not remount text", () => {
  notifyFontScale(1.3);
  const before = getFontScaleEpoch();
  notifyFontScale(1.3);
  notifyFontScale(Number.NaN);
  notifyFontScale(undefined);
  notifyFontScale(0);
  jest.advanceTimersByTime(FONT_SCALE_SETTLE_MS);
  expect(getFontScaleEpoch()).toBe(before);
});

test("kit Text remounts its host text node on a font-scale change and keeps its content", async () => {
  notifyFontScale(1);
  await render(<Text testID="label">Họp cập nhật dự án</Text>);
  const first = screen.getByTestId("label");
  await act(async () => {
    notifyFontScale(2);
  });
  const second = screen.getByTestId("label");
  expect(second).not.toBe(first);
  expect(second).toHaveTextContent("Họp cập nhật dự án");
  // The settle pass remounts once more, after native surfaces have applied the multiplier.
  await act(async () => {
    jest.advanceTimersByTime(FONT_SCALE_SETTLE_MS);
  });
  expect(screen.getByTestId("label")).not.toBe(second);
});

test("an unchanged scale leaves rendered text nodes alone", async () => {
  notifyFontScale(1.5);
  await render(<Text testID="still">Kế hoạch</Text>);
  const node = screen.getByTestId("still");
  await act(async () => {
    notifyFontScale(1.5);
    jest.advanceTimersByTime(FONT_SCALE_SETTLE_MS);
  });
  expect(screen.getByTestId("still")).toBe(node);
});

test("a Dimensions change (iOS Dynamic Type) reaches the store once it is subscribed", () => {
  const unsubscribe = subscribeFontScaleEpoch(() => {});
  resetFontScaleEpochForTests();
  const window = Dimensions.get("window");
  const screenSize = Dimensions.get("screen");
  Dimensions.set({ window: { ...window, fontScale: 1 }, screen: screenSize });
  const before = getFontScaleEpoch();
  Dimensions.set({ window: { ...window, fontScale: 2.6 }, screen: screenSize });
  expect(getFontScaleEpoch()).toBe(before + 1);
  Dimensions.set({ window, screen: screenSize });
  unsubscribe();
});
