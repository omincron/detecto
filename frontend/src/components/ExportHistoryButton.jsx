import { useState } from "react";
import { Button } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { exportHistory } from "../api/client.js";
import { saveBlob } from "../utils/download.js";

/**
 * Downloads the records matching `params` (the /history query params) as CSV, with a
 * local-time column in the browser's zone. Errors go to `onError` so each place that
 * uses it can show them where they belong; `onError(null)` clears a previous one.
 * `onBusyChange(true/false)` lets a parent lock actions that must wait for the file.
 */
export default function ExportHistoryButton({
  params = {},
  onError = () => {},
  onBusyChange = () => {},
  children,
  ...buttonProps
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    onBusyChange(true);
    onError(null);
    try {
      const { blob, filename } = await exportHistory(params);
      saveBlob(blob, filename);
    } catch (err) {
      onError(err.message || "Couldn't export the history");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <Button leftSection={<IconDownload size={16} />} onClick={run} loading={busy} {...buttonProps}>
      {children}
    </Button>
  );
}
