import { memo } from "react";
import { bboxToPercentRect, formatPercent } from "../utils/bbox.js";

/**
 * The image with one absolutely-positioned box per detection. Boxes are placed in
 * percent of the processed frame (see utils/bbox.js), so they track the image at any
 * displayed size without measuring it.
 *
 * `frameWidth`/`frameHeight` must be the backend's image_width/image_height — the frame
 * the boxes are relative to — not the uploaded file's own dimensions.
 */
function BoundingBoxOverlay({
  src,
  alt,
  frameWidth,
  frameHeight,
  detections = [],
  showBoxes = true,
  highlightedIndex = null,
  onHighlight = () => {},
}) {
  return (
    <div className="overlay">
      <img className="overlay__image" src={src} alt={alt} />
      {showBoxes &&
        detections.map((detection, index) => {
          const rect = bboxToPercentRect(detection.bbox, frameWidth, frameHeight);
          const isHighlighted = index === highlightedIndex;
          return (
            <div
              key={index}
              className={`overlay__box${isHighlighted ? " overlay__box--highlighted" : ""}`}
              style={{
                left: `${rect.left}%`,
                top: `${rect.top}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
              }}
              data-testid="bounding-box"
              aria-label={`Person ${index + 1}, ${formatPercent(detection.confidence)} confidence`}
              onMouseEnter={() => onHighlight(index)}
              onMouseLeave={() => onHighlight(null)}
            >
              <span className="overlay__label">
                #{index + 1} · {formatPercent(detection.confidence)}
              </span>
            </div>
          );
        })}
    </div>
  );
}

// Memoized: hovering in the summary list re-renders the page, and with many detections
// the overlay should only re-render when its own props change.
export default memo(BoundingBoxOverlay);
