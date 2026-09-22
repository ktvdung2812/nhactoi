import assert from "node:assert/strict";
import test from "node:test";
import { getAdaptiveLayout } from "../src/ui/layout.ts";

const feature = (
  orientation: "VERTICAL" | "HORIZONTAL",
  bounds: { left: number; top: number; right: number; bottom: number },
) => ({
  orientation,
  bounds,
  state: "HALF_OPENED" as const,
  occlusionType: "FULL" as const,
  isSeparating: true,
});

test("compact windows use a bottom navigation region and one content pane", () => {
  const layout = getAdaptiveLayout({ width: 320, height: 800 });

  assert.equal(layout.widthClass, "compact");
  assert.equal(layout.navigation, "bottom");
  assert.equal(layout.mode, "single");
  assert.deepEqual(layout.primary, { x: 0, y: 0, width: 320, height: 728 });
  assert.deepEqual(layout.navigationRegion, {
    x: 0,
    y: 728,
    width: 320,
    height: 72,
  });
});

test("medium windows move navigation to a rail at the 600dp breakpoint", () => {
  const layout = getAdaptiveLayout({ width: 600, height: 900 });

  assert.equal(layout.widthClass, "medium");
  assert.equal(layout.navigation, "rail");
  assert.equal(layout.mode, "single");
  assert.deepEqual(layout.navigationRegion, {
    x: 0,
    y: 0,
    width: 88,
    height: 900,
  });
  assert.deepEqual(layout.primary, { x: 88, y: 0, width: 512, height: 900 });
});

test("expanded windows show list and detail panes at the 840dp breakpoint", () => {
  const layout = getAdaptiveLayout({ width: 840, height: 900 });

  assert.equal(layout.widthClass, "expanded");
  assert.equal(layout.mode, "dual");
  assert.equal(layout.navigation, "rail");
  assert.deepEqual(layout.primary, { x: 88, y: 0, width: 368, height: 900 });
  assert.deepEqual(layout.secondary, { x: 472, y: 0, width: 368, height: 900 });
});

test("large font scale grows navigation affordances without making regions negative", () => {
  const layout = getAdaptiveLayout({ width: 900, height: 500, fontScale: 1.5 });

  assert.equal(layout.mode, "dual");
  assert.equal(layout.navigation, "rail");
  assert.equal(layout.navigationRegion.width, 132);
  assert.ok(layout.primary.width > 0);
  assert.ok(layout.secondary && layout.secondary.width > 0);
  assert.ok(layout.primary.height > 0);
});

test("split-screen width stays single pane and reserves compact bottom navigation", () => {
  const layout = getAdaptiveLayout({ width: 480, height: 500 });

  assert.equal(layout.mode, "single");
  assert.equal(layout.navigation, "bottom");
  assert.deepEqual(layout.primary, { x: 0, y: 0, width: 480, height: 428 });
});

test("a separating vertical hinge becomes the excluded gap between two panes", () => {
  const layout = getAdaptiveLayout({
    width: 1400,
    height: 900,
    foldingFeatures: [
      feature("VERTICAL", { left: 690, top: 0, right: 710, bottom: 900 }),
    ],
  });

  assert.equal(layout.mode, "dual");
  assert.equal(layout.posture, "book");
  assert.deepEqual(layout.primary, { x: 88, y: 0, width: 602, height: 900 });
  assert.deepEqual(layout.secondary, { x: 710, y: 0, width: 690, height: 900 });
  assert.deepEqual(layout.hinge, { x: 690, y: 0, width: 20, height: 900 });
});

test("a zero-width continuous fold is expanded to a one dp safe gap", () => {
  const layout = getAdaptiveLayout({
    width: 1400,
    height: 900,
    foldingFeatures: [
      feature("VERTICAL", { left: 700, top: 0, right: 700, bottom: 900 }),
    ],
  });

  assert.equal(layout.mode, "dual");
  assert.equal(layout.hinge?.width, 1);
  assert.equal(layout.primary.x + layout.primary.width, layout.hinge?.x);
  assert.equal(
    layout.secondary?.x,
    (layout.hinge?.x ?? 0) + (layout.hinge?.width ?? 0),
  );
});

test("a horizontal tabletop hinge creates upper and lower rows when both are usable", () => {
  const layout = getAdaptiveLayout({
    width: 900,
    height: 1200,
    foldingFeatures: [
      feature("HORIZONTAL", { left: 0, top: 540, right: 900, bottom: 560 }),
    ],
  });

  assert.equal(layout.mode, "dual");
  assert.equal(layout.posture, "tabletop");
  assert.deepEqual(layout.primary, { x: 88, y: 0, width: 812, height: 540 });
  assert.deepEqual(layout.secondary, {
    x: 88,
    y: 560,
    width: 812,
    height: 640,
  });
  assert.deepEqual(layout.navigationRegion, {
    x: 0,
    y: 0,
    width: 88,
    height: 540,
  });
});

test("a horizontal hinge never lets a short split-screen pane overlap the hinge", () => {
  const layout = getAdaptiveLayout({
    width: 480,
    height: 500,
    foldingFeatures: [
      feature("HORIZONTAL", { left: 0, top: 220, right: 480, bottom: 240 }),
    ],
  });

  assert.equal(layout.mode, "single");
  assert.equal(layout.posture, "tabletop");
  assert.deepEqual(layout.primary, { x: 0, y: 0, width: 480, height: 220 });
  assert.ok(layout.primary.y + layout.primary.height <= 220);
});
