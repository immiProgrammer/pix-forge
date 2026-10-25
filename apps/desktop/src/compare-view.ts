export interface CompareView {
  zoom: number;
  pan: { x: number; y: number };
}
export interface CompareGeometry {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  fit: number;
}
export const initialCompareView: CompareView = { zoom: 1, pan: { x: 0, y: 0 } };

/** Free panning; zoom-out recenters only images extending beyond the viewport. */
export function zoomCompareView(
  view: CompareView,
  nextZoom: number,
  geometry: CompareGeometry,
): CompareView {
  const zoom = Math.max(
    0.1,
    Math.min(Math.max(24, 1 / geometry.fit), nextZoom),
  );
  const ratio = zoom / view.zoom;
  const scale = geometry.fit * view.zoom;
  const fullyVisible =
    Math.abs(view.pan.x) + (geometry.width * scale) / 2 <=
      geometry.viewportWidth / 2 &&
    Math.abs(view.pan.y) + (geometry.height * scale) / 2 <=
      geometry.viewportHeight / 2;
  let panRatio = ratio;
  if (zoom < view.zoom) {
    panRatio = fullyVisible
      ? 1
      : view.zoom > 1
        ? Math.min(ratio, Math.max(0, (zoom - 1) / (view.zoom - 1)))
        : ratio;
  }
  return {
    zoom,
    pan: { x: view.pan.x * panRatio, y: view.pan.y * panRatio },
  };
}
