import { useEffect, useRef, useState } from "react";
import { Button, Group, Paper, Text, ThemeIcon } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { MAX_UPLOAD_MB } from "../config.js";

const ACCEPT = "image/jpeg,image/png";

/**
 * File picker + drag-and-drop + demo samples from public/samples/. Calls onSelect(file)
 * with a File; the page runs the upload pre-check and the backend does the real
 * validation.
 *
 * Samples are listed in public/samples/index.json — a static site can't list a folder.
 */
export default function ImageUploader({ onSelect, disabled = false }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [samples, setSamples] = useState([]);
  const [sampleError, setSampleError] = useState(null);
  // Every selection bumps this. A sample download that finishes after a newer
  // selection (or once disabled) is dropped, so it can't override the user's latest pick.
  const selectionId = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    let cancelled = false;
    fetch("/samples/index.json")
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => !cancelled && setSamples(Array.isArray(list) ? list : []))
      .catch(() => !cancelled && setSamples([])); // no samples is fine; just hide the row
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file && !disabled) {
      selectionId.current += 1;
      onSelect(file);
    }
  };

  const loadSample = async (sample) => {
    if (disabled) return;
    const id = ++selectionId.current;
    setSampleError(null);
    try {
      const response = await fetch(`/samples/${sample.file}`);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      // Static servers often answer a missing file with 200 + an HTML fallback page.
      if (!blob.type.startsWith("image/")) throw new Error();
      if (id !== selectionId.current || disabledRef.current) return;
      onSelect(new File([blob], sample.file, { type: blob.type }));
    } catch {
      if (id !== selectionId.current) return;
      setSampleError(`Couldn't load the sample "${sample.label ?? sample.file}".`);
    }
  };

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      className={`dropzone${isDragging ? " dropzone--active" : ""}${disabled ? " dropzone--disabled" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      data-testid="dropzone"
    >
      <Group gap="md" wrap="wrap">
        <ThemeIcon color="sky" variant="light" size={44} radius="md" aria-hidden>
          <IconUpload size={20} stroke={2} />
        </ThemeIcon>
        <div style={{ flexGrow: 1, minWidth: 200 }}>
          <Text fw={600}>Drop an image here</Text>
          <Text size="sm" c="dimmed">
            JPEG or PNG, up to {MAX_UPLOAD_MB} MB
          </Text>
        </div>

        {samples.length > 0 && (
          <Group gap={8} wrap="wrap">
            <Text size="sm" c="dimmed">
              Or try a sample:
            </Text>
            {samples.map((sample) => (
              <Button
                key={sample.file}
                variant="default"
                radius="xl"
                size="xs"
                onClick={() => loadSample(sample)}
                disabled={disabled}
              >
                {sample.label ?? sample.file}
              </Button>
            ))}
          </Group>
        )}

        <Button size="md" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Choose an image
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          data-testid="file-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = ""; // allow re-selecting the same file
          }}
        />
      </Group>

      {sampleError && (
        <Text size="sm" c="peach.8" mt="sm">
          {sampleError}
        </Text>
      )}
    </Paper>
  );
}
