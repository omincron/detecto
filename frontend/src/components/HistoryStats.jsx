import { Paper, SimpleGrid, Text } from "@mantine/core";
import { formatMs } from "../utils/bbox.js";

const CARDS = [
  { key: "detections", label: "Detections", accent: "var(--mantine-color-mint-3)", format: (v) => String(v) },
  { key: "avgPeople", label: "Avg people per frame", accent: "var(--mantine-color-lavender-3)", format: (v) => v.toFixed(1) },
  { key: "peak", label: "Peak count", accent: "var(--mantine-color-sky-3)", format: (v) => String(v) },
  { key: "avgModelMs", label: "Avg model time", accent: "var(--mantine-color-peach-3)", format: formatMs },
];

/** KPI cards for the records currently shown. A <dl>, so labels pair with values. */
export default function HistoryStats({ summary }) {
  return (
    <SimpleGrid component="dl" cols={{ base: 2, md: 4 }} spacing="sm" className="stat-list" aria-label="Totals">
      {CARDS.map(({ key, label, accent, format }) => (
        <Paper key={key} withBorder radius="lg" p="sm" style={{ borderTop: `3px solid ${accent}` }}>
          <Text component="dt" size="xs" c="dimmed">
            {label}
          </Text>
          <Text component="dd" fz={26} fw={700} lh={1.2} className="stat-value tabular">
            {summary[key] == null ? "—" : format(summary[key])}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
