import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { getHistory } from "../api/client.js";
import ClearHistoryButton from "../components/ClearHistoryButton.jsx";
import FilterBar, { EMPTY_FILTERS } from "../components/FilterBar.jsx";
import HistoryChart from "../components/HistoryChart.jsx";
import HistoryStats from "../components/HistoryStats.jsx";
import HistoryTable from "../components/HistoryTable.jsx";
import { buildHistoryParams, localTimeZone, summarize } from "../utils/history.js";

const isFiltered = (f) => Boolean(f.from || f.to || f.minConfidencePct > 0);

export default function HistoryView({ onNavigate = () => {} }) {
  const [draft, setDraft] = useState(EMPTY_FILTERS); // what the filter bar shows
  const [applied, setApplied] = useState(EMPTY_FILTERS); // what the results reflect
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | done | error
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // Only the latest query may update the page (e.g. Apply clicked twice quickly).
  const latestRequest = useRef(0);

  const load = useCallback(async (filters) => {
    const requestId = ++latestRequest.current;
    setStatus("loading");
    setError(null);
    try {
      const result = await getHistory(buildHistoryParams(filters));
      if (requestId !== latestRequest.current) return;
      setRecords(result);
      setApplied(filters);
      setStatus("done");
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err.message || "Couldn't load the history");
      setStatus("error");
    }
  }, []);

  // Pages mount when shown, so this also refreshes after detections on the Detect page.
  useEffect(() => {
    load(EMPTY_FILTERS);
  }, [load]);

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setNotice(null);
    load(EMPTY_FILTERS);
  };

  const hasRecords = status === "done" && records.length > 0;

  return (
    <Stack gap="lg" maw={1280} mx="auto">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Detection history</Title>
          <Text c="dimmed" size="sm" mt={4}>
            People counted over time. Times are shown in your local time zone ({localTimeZone()}).
          </Text>
        </div>
        <ClearHistoryButton
          onCleared={(removed) => {
            // Everything is gone, so filters no longer mean anything: reset them, or the
            // page would say "No detections match these filters" as if data remained.
            setDraft(EMPTY_FILTERS);
            setNotice(`Deleted ${removed} ${removed === 1 ? "record" : "records"}.`);
            load(EMPTY_FILTERS);
          }}
        />
      </Group>

      <FilterBar
        value={draft}
        onChange={setDraft}
        onApply={() => {
          setNotice(null);
          load(draft);
        }}
        onReset={reset}
        loading={status === "loading"}
      />

      {notice && (
        <Alert color="mint" variant="light" radius="md" icon={<IconCircleCheck size={20} />} withCloseButton onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {status === "error" && (
        <Alert color="peach" variant="light" radius="md" icon={<IconAlertCircle size={20} />} title="Couldn't load the history.">
          {error}
        </Alert>
      )}

      {status === "loading" && records.length === 0 && (
        <Group gap="xs" role="status">
          <Loader size="sm" />
          <Text>Loading history…</Text>
        </Group>
      )}

      {status === "done" && records.length === 0 && (
        <Paper withBorder radius="lg" p="xl">
          {isFiltered(applied) ? (
            <Stack gap="sm" align="flex-start">
              <Text fw={600}>No detections match these filters.</Text>
              <Button variant="default" onClick={reset}>
                Reset filters
              </Button>
            </Stack>
          ) : (
            <Stack gap="sm" align="flex-start">
              <Text fw={600}>No detections yet.</Text>
              <Text c="dimmed" size="sm">
                Every successful detection is recorded here.
              </Text>
              <Button onClick={() => onNavigate("detect")}>Go to Detect</Button>
            </Stack>
          )}
        </Paper>
      )}

      {(hasRecords || (status === "loading" && records.length > 0)) && (
        <>
          <HistoryStats summary={summarize(records)} />
          <HistoryChart records={records} />
          <HistoryTable records={records} />
        </>
      )}
    </Stack>
  );
}
