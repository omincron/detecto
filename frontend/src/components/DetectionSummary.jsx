import { formatMs, formatPercent } from "../utils/bbox.js";

/** Count, average confidence, timings, and a per-person confidence list. */
export default function DetectionSummary({
  result,
  roundTripMs,
  highlightedIndex = null,
  onHighlight = () => {},
}) {
  const { count, detections, averageConfidence, inferenceTimeMs, imageWidth, imageHeight } =
    result;

  return (
    <section className="summary" aria-label="Detection summary">
      <dl className="summary__stats">
        <div className="stat">
          <dt>People detected</dt>
          <dd data-testid="person-count">{count}</dd>
        </div>
        <div className="stat">
          <dt>Average confidence</dt>
          <dd>{count > 0 ? formatPercent(averageConfidence) : "—"}</dd>
        </div>
        <div className="stat">
          <dt title="Time spent in the model itself, on the server">Model time</dt>
          <dd>{formatMs(inferenceTimeMs)}</dd>
        </div>
        {roundTripMs != null && (
          <div className="stat">
            <dt title="Upload + server processing + response, as measured by the browser">
              Total time
            </dt>
            <dd>{formatMs(roundTripMs)}</dd>
          </div>
        )}
      </dl>

      {count === 0 ? (
        <p className="summary__empty">No people detected in this image.</p>
      ) : (
        <ol className="summary__list">
          {detections.map((detection, index) => (
            <li
              key={index}
              className={index === highlightedIndex ? "is-highlighted" : undefined}
              onMouseEnter={() => onHighlight(index)}
              onMouseLeave={() => onHighlight(null)}
            >
              <span>Person #{index + 1}</span>
              <span className="summary__confidence">{formatPercent(detection.confidence)}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="summary__meta">
        Processed at {imageWidth} × {imageHeight} px
      </p>
    </section>
  );
}
