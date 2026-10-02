import { Badge, Group, Paper, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconClockHour4, IconCpu, IconShieldCheck, IconUsers } from "@tabler/icons-react";
import { formatMs, formatPercent } from "../utils/bbox.js";

// One term/value pair of the stats <dl>: dt/dd keep each label tied to its value for
// screen readers, which plain paragraphs would lose. (A div wrapping a dt/dd group is
// valid inside a dl.)
function StatCard({ icon: Icon, color, label, value, title }) {
  return (
    <Paper withBorder radius="lg" p="sm">
      <ThemeIcon color={color} variant="light" size={32} radius="md" aria-hidden>
        <Icon size={17} stroke={2} />
      </ThemeIcon>
      <Text component="dt" size="xs" c="dimmed" mt={10} title={title}>
        {label}
      </Text>
      <Text component="dd" fz={26} fw={700} lh={1.15} className="stat-value tabular">
        {value}
      </Text>
    </Paper>
  );
}

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
    <Stack component="section" aria-label="Detection summary" gap="md">
      <SimpleGrid component="dl" cols={2} spacing="sm" className="stat-list">
        <StatCard icon={IconUsers} color="mint" label="People detected" value={<span data-testid="person-count">{count}</span>} />
        <StatCard
          icon={IconShieldCheck}
          color="lavender"
          label="Average confidence"
          value={count > 0 ? formatPercent(averageConfidence) : "—"}
        />
        <StatCard
          icon={IconCpu}
          color="sky"
          label="Model time"
          title="Time spent in the model itself, on the server"
          value={formatMs(inferenceTimeMs)}
        />
        {roundTripMs != null && (
          <StatCard
            icon={IconClockHour4}
            color="peach"
            label="Total time"
            title="Upload + server processing + response, as measured by the browser"
            value={formatMs(roundTripMs)}
          />
        )}
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md">
        <Group justify="space-between" mb="sm">
          <Title order={3} size="h5">
            Detections
          </Title>
          <Badge color={count > 0 ? "mint" : "gray"} variant="light" radius="xl" tt="none">
            {count === 1 ? "1 person" : `${count} people`}
          </Badge>
        </Group>

        {count === 0 ? (
          <Text c="dimmed" size="sm">
            No people detected in this image.
          </Text>
        ) : (
          <ol className="detection-list">
            {detections.map((detection, index) => (
              <li
                key={index}
                className={index === highlightedIndex ? "is-highlighted" : undefined}
                onMouseEnter={() => onHighlight(index)}
                onMouseLeave={() => onHighlight(null)}
              >
                <Group justify="space-between" mb={6}>
                  <Text size="sm" fw={600}>
                    Person #{index + 1}
                  </Text>
                  <Text size="sm" ff="monospace">
                    {formatPercent(detection.confidence)}
                  </Text>
                </Group>
                <Progress value={detection.confidence * 100} size="sm" color="periwinkle.4" aria-hidden />
              </li>
            ))}
          </ol>
        )}

        <Text size="xs" c="dimmed" mt="sm">
          Processed at {imageWidth} × {imageHeight} px
        </Text>
      </Paper>
    </Stack>
  );
}
