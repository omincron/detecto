import { useCallback, useEffect, useRef, useState } from "react";
import { detectPeople } from "../api/client.js";
import BoundingBoxOverlay from "../components/BoundingBoxOverlay.jsx";
import DetectionSummary from "../components/DetectionSummary.jsx";
import ImageUploader from "../components/ImageUploader.jsx";

export default function DetectionView() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [roundTripMs, setRoundTripMs] = useState(null);
  const [error, setError] = useState(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(null);
  // Only the latest request may update the page: picking a new image while one is
  // still processing must not let the older response overwrite the newer one.
  const latestRequest = useRef(0);

  // Release the previous preview's object URL whenever it's replaced or on unmount.
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const runDetection = useCallback(async (selected) => {
    const requestId = ++latestRequest.current;
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setStatus("loading");
    setResult(null);
    setError(null);
    setHighlightedIndex(null);

    const started = performance.now();
    try {
      const detection = await detectPeople(selected);
      if (requestId !== latestRequest.current) return;
      setResult(detection);
      setRoundTripMs(performance.now() - started);
      setStatus("done");
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err.message || "Something went wrong");
      setStatus("error");
    }
  }, []);

  return (
    <div className="detection-view">
      {/* Stays enabled while loading so a slow or hung request can be replaced; the
          latestRequest guard keeps only the newest result. */}
      <ImageUploader onSelect={runDetection} />

      {status === "error" && (
        <div className="error" role="alert">
          <strong>Couldn't analyse {file?.name ?? "this file"}.</strong> {error}
        </div>
      )}

      {previewUrl && status !== "error" && (
        <div className="detection-view__result">
          <div className="detection-view__image">
            {status === "loading" && (
              <div className="loading" role="status">
                Detecting people…
              </div>
            )}
            {result ? (
              <>
                <BoundingBoxOverlay
                  src={previewUrl}
                  alt={file?.name ?? "Uploaded image"}
                  frameWidth={result.imageWidth}
                  frameHeight={result.imageHeight}
                  detections={result.detections}
                  showBoxes={showBoxes}
                  highlightedIndex={highlightedIndex}
                  onHighlight={setHighlightedIndex}
                />
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showBoxes}
                    onChange={(event) => setShowBoxes(event.target.checked)}
                  />
                  Show bounding boxes
                </label>
              </>
            ) : (
              <img className="overlay__image overlay__image--pending" src={previewUrl} alt="" />
            )}
          </div>

          {result && (
            <DetectionSummary
              result={result}
              roundTripMs={roundTripMs}
              highlightedIndex={highlightedIndex}
              onHighlight={setHighlightedIndex}
            />
          )}
        </div>
      )}
    </div>
  );
}
