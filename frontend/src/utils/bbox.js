// Box-scaling math, kept in one place so it's tested once (ARCHITECTURE.md §4.2).
//
// Boxes come back in pixels of the frame the backend processed (frameWidth x
// frameHeight), which may be a downscaled copy of the upload. Expressing each box as a
// percentage of that frame makes it independent of the displayed size: the overlay
// scales with the <img> through CSS alone, with no resize measuring or re-rendering.

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * [x1, y1, x2, y2] in frame pixels → {left, top, width, height} in percent of the frame,
 * clamped to the frame so a box that spills slightly over an edge stays visible.
 */
export function bboxToPercentRect([x1, y1, x2, y2], frameWidth, frameHeight) {
  const left = clamp(Math.min(x1, x2) / frameWidth, 0, 1);
  const top = clamp(Math.min(y1, y2) / frameHeight, 0, 1);
  const right = clamp(Math.max(x1, x2) / frameWidth, 0, 1);
  const bottom = clamp(Math.max(y1, y2) / frameHeight, 0, 1);
  return {
    left: left * 100,
    top: top * 100,
    width: (right - left) * 100,
    height: (bottom - top) * 100,
  };
}

export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

// Rounds before choosing the unit, so 999.6 ms reads "1.00 s" rather than "1000 ms".
export const formatMs = (ms) =>
  Math.round(ms) >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
