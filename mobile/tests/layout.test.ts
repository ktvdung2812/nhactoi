import assert from "node:assert/strict";
import test from "node:test";
import { currentWindowSnapshot, getAdaptiveLayout, localizeFoldingFeatures } from "../src/ui/layout.ts";

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

test("every separating feature is excluded from content and navigation", () => {
  const layout = getAdaptiveLayout({
    width: 1400,
    height: 900,
    foldingFeatures: [
      feature("VERTICAL", { left: 690, top: 0, right: 710, bottom: 900 }),
      feature("HORIZONTAL", { left: 0, top: 440, right: 1400, bottom: 460 }),
    ],
  });
  for (const area of [layout.primary, layout.secondary!, layout.navigationRegion]) {
    assert.ok(area.y + area.height <= 440 || area.y >= 460);
    assert.ok(area.x + area.width <= 690 || area.x >= 710);
  }
});

test("hinges at the edge and outside the content do not obscure navigation", () => {
  const edge = getAdaptiveLayout({ width: 480, height: 800, foldingFeatures: [
    feature("VERTICAL", { left: 0, top: 0, right: 10, bottom: 800 }),
  ] });
  assert.equal(edge.primary.x, 10);
  assert.equal(edge.navigationRegion.x, 10);
  const rail = getAdaptiveLayout({ width: 900, height: 800, foldingFeatures: [
    feature("VERTICAL", { left: 40, top: 0, right: 48, bottom: 800 }),
  ] });
  assert.ok(rail.navigationRegion.x >= 48 || rail.navigationRegion.x + rail.navigationRegion.width <= 40);
  assert.equal(rail.posture, "flat");
});

test("font scale is clamped and invalid scales fall back", () => {
  const layout = (fontScale: number) => getAdaptiveLayout({ width: 400, height: 800, fontScale });
  assert.equal(layout(2).navigationRegion.height, 108);
  assert.equal(layout(0.5).navigationRegion.height, 72);
  assert.equal(layout(Number.NaN).navigationRegion.height, 72);
});

test("a feature touching the content edge does not create a phantom hinge", () => {
  const layout = getAdaptiveLayout({ width: 900, height: 800, foldingFeatures: [
    feature("VERTICAL", { left: 80, top: 0, right: 88, bottom: 800 }),
  ] });
  assert.equal(layout.posture, "flat");
  assert.equal(layout.primary.x, 88);
});

test("a cached native snapshot is ignored during a resize until dimensions match", () => {
  const snapshot = { width: 900, height: 800, density: 2, origin: { x: 100, y: 0 },
    windowBounds: { left: 100, top: 0, right: 1000, bottom: 800 }, foldingFeatures: [] };
  assert.equal(currentWindowSnapshot(snapshot, { width: 800, height: 900 }), null);
  assert.equal(currentWindowSnapshot(snapshot, { width: 899, height: 801 }), snapshot);
  assert.equal(currentWindowSnapshot(null, { width: 900, height: 800 }), null);
});

test("measured frame offsets translate window-local features, independent of display origin", () => {
  const [local] = localizeFoldingFeatures([
    feature("HORIZONTAL", { left: 0, top: 440, right: 900, bottom: 460 }),
  ], 12, 24);
  assert.deepEqual(local.bounds, { left: -12, top: 416, right: 888, bottom: 436 });
  const layout = getAdaptiveLayout({ width: 876, height: 750, foldingFeatures: [local] });
  assert.equal(layout.hinge?.y, 416);
});

test("an unfolded ~700dp foldable shows list and detail when both panes fit", () => {
  const layout = getAdaptiveLayout({ width: 700, height: 840 });

  assert.equal(layout.widthClass, "medium");
  assert.equal(layout.mode, "dual");
  assert.equal(layout.posture, "flat");
  assert.deepEqual(layout.primary, { x: 88, y: 0, width: 298, height: 840 });
  assert.deepEqual(layout.secondary, { x: 402, y: 0, width: 298, height: 840 });
});

test("medium windows stay single when larger text would squeeze either pane", () => {
  const layout = getAdaptiveLayout({ width: 700, height: 840, fontScale: 1.3 });

  assert.equal(layout.widthClass, "medium");
  assert.equal(layout.mode, "single");
});

test("an unfolded Pixel Fold keeps two panes at the largest font scale", () => {
  const layout = getAdaptiveLayout({ width: 851.7, height: 882.8, fontScale: 2 });
  assert.equal(layout.mode, "dual");
  assert.ok(layout.primary.width >= 336);
  assert.ok(layout.secondary && layout.secondary.width >= 336);
});
