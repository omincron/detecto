import { useState } from "react";
import { Alert, Button, Group, List, Loader, Modal, Text } from "@mantine/core";
import { clearHistory, getHistory } from "../api/client.js";

/**
 * "Clear history" with a confirmation that states the real scope (PROGRESS.md, M4
 * decision): /reset deletes EVERY record, regardless of the filters on screen, and
 * can't be undone. The dialog fetches the unfiltered total so the number it shows is
 * what will actually be deleted.
 */
export default function ClearHistoryButton({ onCleared }) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(null); // null while counting
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const openDialog = async () => {
    setOpen(true);
    setTotal(null);
    setError(null);
    try {
      setTotal((await getHistory()).length);
    } catch (err) {
      setError(err.message);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const removed = await clearHistory();
      setOpen(false);
      onCleared(removed);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const recordsLabel = total === 1 ? "1 record" : `${total} records`;

  return (
    <>
      <Button variant="outline" color="peach.8" onClick={openDialog}>
        Clear history
      </Button>
      <Modal
        opened={open}
        onClose={() => !busy && setOpen(false)}
        title={<Text fw={700}>Clear detection history?</Text>}
        centered
        radius="lg"
        closeButtonProps={{ "aria-label": "Close" }}
      >
        {total === null && !error ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm">Counting records…</Text>
          </Group>
        ) : total === 0 ? (
          <Text size="sm">History is already empty. There is nothing to delete.</Text>
        ) : total !== null ? (
          <>
            <Text size="sm">
              {total === 1 ? (
                <>
                  This deletes <strong>the only record</strong> in the history.
                </>
              ) : (
                <>
                  This deletes <strong>all {recordsLabel}</strong> in the history.
                </>
              )}
            </Text>
            <List size="sm" mt="xs" spacing={4}>
              <List.Item>It ignores the filters currently applied.</List.Item>
              <List.Item>It can't be undone.</List.Item>
            </List>
          </>
        ) : null}

        {error && (
          <Alert color="peach" variant="light" mt="md">
            {error}
          </Alert>
        )}

        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button color="peach.8" onClick={confirm} loading={busy} disabled={!total}>
            {total === 1 ? "Delete 1 record" : total ? `Delete all ${recordsLabel}` : "Delete"}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
