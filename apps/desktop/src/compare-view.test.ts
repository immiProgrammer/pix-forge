import { describe, it, expect } from "vitest";
import { zoomCompareView } from "./compare-view";
import type { CompareGeometry } from "./compare-view";
const geometry: CompareGeometry = {
  width: 2000,
  height: 1000,
  viewportWidth: 1000,
  viewportHeight: 800,
  fit: 0.468,
};
describe("free comparison panning and zoom", () => {
  it("keeps a centered image centered at every zoom level", () => {
    for (const zoom of [0.1, 0.7, 1, 2, 10])
      expect(
        zoomCompareView({ zoom: 2, pan: { x: 0, y: 0 } }, zoom, geometry).pan,
      ).toEqual({ x: 0, y: 0 });
  });
  it("preserves a smaller image's dragged position when fully visible during zoom-out", () => {
    expect(
      zoomCompareView({ zoom: 0.5, pan: { x: 150, y: -120 } }, 0.4, geometry)
        .pan,
    ).toEqual({ x: 150, y: -120 });
  });
  it("does not clamp a dragged offset when zooming in", () => {
    expect(
      zoomCompareView({ zoom: 0.5, pan: { x: 600, y: 500 } }, 0.6, geometry)
        .pan,
    ).toEqual({ x: 720, y: 600 });
  });
  it("smoothly reduces an oversized image's pan during zoom-out", () => {
    const next = zoomCompareView(
      { zoom: 2, pan: { x: 900, y: 500 } },
      1.6,
      geometry,
    );
    expect(next.pan.x).toBeCloseTo(540);
    expect(next.pan.y).toBeCloseTo(300);
    expect(zoomCompareView(next, 1, geometry).pan).toEqual({ x: 0, y: 0 });
  });
  it("moves a small image back toward the viewport only if it extends outside", () => {
    const next = zoomCompareView(
      { zoom: 0.5, pan: { x: 600, y: -500 } },
      0.4,
      geometry,
    );
    expect(next.pan).toEqual({ x: 480, y: -400 });
  });
  it("handles actual-size views above the regular zoom limit without a sudden jump", () => {
    const large = { ...geometry, fit: 0.01 };
    expect(
      zoomCompareView({ zoom: 100, pan: { x: 0, y: 0 } }, 80, large).zoom,
    ).toBe(80);
  });
});
