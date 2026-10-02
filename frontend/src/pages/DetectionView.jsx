import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Checkbox, Grid, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { detectPeople } from "../api/client.js";
import BoundingBoxOverlay from "../components/BoundingBoxOverlay.jsx";
import DetectionSummary from "../components/DetectionSummary.jsx";
import ImageUploader from "../components/ImageUploader.jsx";
import { MAX_UPLOAD_BYTES } from "../config.js";
import { validateUpload } from "../utils/validateUpload.js";

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
    setResult(null);
    setHighlightedIndex(null);

    // Fail fast in the browser on what it can already see; the backend still validates.
    const problem = validateUpload(selected, MAX_UPLOAD_BYTES);
    if (problem) {
      setPreviewUrl(null);
      setError(problem);
      setStatus("error");
      return;
    }

    setPreviewUrl(URL.createObjectURL(selected));
    setStatus("loading");
    setError(null);

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
    <Stack gap="lg" maw={1280} mx="auto">
      <div>
        <Title order={2}>Detect people</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Upload a JPEG or PNG to count people and see where they are.
        </Text>
      </div>

      {/* Stays enabled while loading so a slow or hung request can be replaced; the
          latestRequest guard keeps only the newest result. */}
      <ImageUploader onSelect={runDetection} />

      {status === "error" && (
        <Alert
          color="peach"
          variant="light"
          radius="md"
          icon={<IconAlertCircle size={20} />}
          title={`Couldn't analyse ${file?.name ?? "this file"}.`}
        >
          {error}
        </Alert>
      )}

      {previewUrl && status !== "error" && (
        <Grid gutter="lg" align="flex-start">
          <Grid.Col span={{ base: 12, md: 7.5 }}>
            <Paper withBorder radius="lg" p="md">
              <Group justify="space-between" mb="sm" wrap="nowrap">
                <Text fw={600} truncate>
                  {file?.name}
                </Text>
                {result && (
                  <Checkbox
                    label="Show bounding boxes"
                    checked={showBoxes}
                    onChange={(event) => setShowBoxes(event.currentTarget.checked)}
                  />
                )}
              </Group>

              <Box pos="relative">
                {status === "loading" && (
                  <Group className="loading" role="status" gap="xs" justify="center">
                    <Loader size="sm" />
                    <Text fw={600}>Detecting people…</Text>
                  </Group>
                )}
                {result ? (
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
                ) : (
                  <img className="overlay__image overlay__image--pending" src={previewUrl} alt="" />
                )}
              </Box>
            </Paper>
          </Grid.Col>

          {result && (
            <Grid.Col span={{ base: 12, md: 4.5 }}>
              <DetectionSummary
                result={result}
                roundTripMs={roundTripMs}
                highlightedIndex={highlightedIndex}
                onHighlight={setHighlightedIndex}
              />
            </Grid.Col>
          )}
        </Grid>
      )}
    </Stack>
  );
}
