import { Paper, Stack, Text, Title } from "@mantine/core";

// Placeholder until Milestone 4 (HistoryTable, HistoryChart, FilterBar).
export default function HistoryView() {
  return (
    <Stack gap="lg" maw={1280} mx="auto">
      <div>
        <Title order={2}>Detection history</Title>
        <Text c="dimmed" size="sm" mt={4}>
          People counted over time.
        </Text>
      </div>
      <Paper withBorder radius="lg" p="xl">
        <Text c="dimmed">Detection history is coming in the next milestone.</Text>
      </Paper>
    </Stack>
  );
}
