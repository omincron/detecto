import { Button, Group, Paper, SimpleGrid, Slider, Stack, Text } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { snapToEndOfDay, validateRange } from "../utils/history.js";

export const EMPTY_FILTERS = { from: null, to: null, minConfidencePct: 0 };

/**
 * Date/time range + confidence threshold. Controlled: `value` is the draft being
 * edited; nothing is queried until Apply (so dragging the slider doesn't fire a request
 * per step). Reset clears the draft and applies it at once.
 */
export default function FilterBar({ value, onChange, onApply, onReset, loading = false }) {
  const rangeError = validateRange(value.from, value.to);
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      component="form"
      aria-label="Filters"
      onSubmit={(event) => {
        event.preventDefault();
        if (!rangeError) onApply();
      }}
    >
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" verticalSpacing="sm">
        <DateTimePicker
          label="From"
          placeholder="Any time"
          value={value.from}
          onChange={(from) => set({ from })}
          clearable
          withSeconds={false}
          valueFormat="MMM D, YYYY HH:mm"
          error={rangeError ? true : undefined}
        />
        <DateTimePicker
          label="To"
          placeholder="Now"
          value={value.to}
          onChange={(to) => set({ to: snapToEndOfDay(value.to, to) })}
          clearable
          withSeconds={false}
          valueFormat="MMM D, YYYY HH:mm"
          error={rangeError ?? undefined}
        />
        <Stack gap={6} style={{ gridColumn: "span 1" }}>
          <Group justify="space-between">
            <Text id="min-confidence-label" size="sm" fw={500}>
              Minimum confidence
            </Text>
            <Text size="sm" ff="monospace" c="periwinkle.9">
              {value.minConfidencePct === 0 ? "Any" : `${value.minConfidencePct}%`}
            </Text>
          </Group>
          {/* thumbLabel names the focusable thumb (role="slider"); an aria-labelledby on
              the Slider lands on its wrapper and leaves the thumb unnamed. */}
          <Slider
            thumbLabel="Minimum confidence"
            min={0}
            max={100}
            step={5}
            value={value.minConfidencePct}
            onChange={(minConfidencePct) => set({ minConfidencePct })}
            label={(v) => `${v}%`}
            mt={8}
          />
          <Text size="xs" c="dimmed">
            Frames with nobody present are always shown.
          </Text>
        </Stack>
        <Group gap="sm" align="flex-end" justify="flex-end">
          <Button variant="default" onClick={onReset} disabled={loading}>
            Reset
          </Button>
          <Button type="submit" disabled={Boolean(rangeError)} loading={loading}>
            Apply
          </Button>
        </Group>
      </SimpleGrid>
    </Paper>
  );
}
