import { Paper, Text, Title } from "@mantine/core";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTimestamp } from "../utils/history.js";

const tickFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <Paper withBorder shadow="sm" radius="md" p="xs">
      <Text size="xs" c="dimmed">
        {formatTimestamp(new Date(point.time))}
      </Text>
      <Text size="sm" fw={600}>
        {point.count} {point.count === 1 ? "person" : "people"}
      </Text>
    </Paper>
  );
}

/**
 * People count over time, one dot per detection and no connecting line: detections
 * are isolated snapshots, and a line would imply the count changed steadily between
 * them. A true time axis (numeric ms, scale="time"), so irregular
 * detections are spaced by when they happened, not evenly by index — which is why this
 * uses Recharts directly rather than a categorical chart wrapper.
 */
export default function HistoryChart({ records }) {
  const data = records.map((r) => ({ time: r.timestamp.getTime(), count: r.count }));
  const description =
    records.length === 0
      ? "No detections to chart."
      : `People over time: ${records.length} ${records.length === 1 ? "detection" : "detections"} from ${formatTimestamp(records[0].timestamp)} to ${formatTimestamp(records[records.length - 1].timestamp)}, peak ${Math.max(...records.map((r) => r.count))}.`;

  return (
    <Paper withBorder radius="lg" p="md" component="section" aria-label="People over time">
      <Title order={3} size="h5" mb="sm">
        People over time
      </Title>
      {/* The SVG isn't readable by screen readers; this text carries the same summary. */}
      <div role="img" aria-label={description} style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 240 }}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => tickFormat.format(new Date(t))}
              tick={{ fontSize: 11, fill: "#5b6676" }}
              stroke="#d5dae3"
              minTickGap={40}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#5b6676" }}
              stroke="#d5dae3"
              width={48}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="linear"
              dataKey="count"
              stroke="none"
              dot={{ r: 4, fill: "var(--mantine-color-periwinkle-3)", stroke: "var(--mantine-color-periwinkle-7)", strokeWidth: 1.5 }}
              activeDot={{ r: 6, fill: "var(--mantine-color-periwinkle-5)", stroke: "#fff" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Paper>
  );
}
