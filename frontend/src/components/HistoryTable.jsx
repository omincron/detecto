import { useEffect, useState } from "react";
import { Badge, Group, Pagination, Paper, Table, Text } from "@mantine/core";
import { formatMs, formatPercent } from "../utils/bbox.js";
import { formatTimestamp } from "../utils/history.js";

const PAGE_SIZE = 15;

const badgeColor = (count) => (count === 0 ? "gray" : count >= 4 ? "peach" : "mint");

/** Records newest first, paginated client-side. */
export default function HistoryTable({ records }) {
  const [page, setPage] = useState(1);
  const newestFirst = [...records].reverse();
  const pageCount = Math.max(1, Math.ceil(newestFirst.length / PAGE_SIZE));

  // A new result set (filters applied, history cleared) starts again at page 1.
  useEffect(() => setPage(1), [records]);

  const rows = newestFirst.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Paper withBorder radius="lg" component="section" aria-label="Records" style={{ overflow: "hidden" }}>
      <Table.ScrollContainer minWidth={520}>
        <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
          <Table.Thead bg="#fafbfc">
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>People</Table.Th>
              <Table.Th>Avg confidence</Table.Th>
              <Table.Th>Model time</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((record) => (
              <Table.Tr key={record.id}>
                <Table.Td ff="monospace" fz="sm">
                  <time dateTime={record.timestamp.toISOString()}>{formatTimestamp(record.timestamp)}</time>
                </Table.Td>
                <Table.Td>
                  <Badge color={badgeColor(record.count)} variant="light" radius="xl" miw={32}>
                    {record.count}
                  </Badge>
                </Table.Td>
                {/* A frame with nobody in it has no confidence to report. */}
                <Table.Td className="tabular">
                  {record.count > 0 ? formatPercent(record.averageConfidence) : "—"}
                </Table.Td>
                <Table.Td className="tabular" c="#3d4757">
                  {formatMs(record.inferenceTimeMs)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group justify="space-between" px="md" py="sm" gap="sm">
        <Text size="sm" c="dimmed">
          {newestFirst.length} {newestFirst.length === 1 ? "record" : "records"}, newest first
        </Text>
        {pageCount > 1 && (
          <Pagination
            total={pageCount}
            value={page}
            onChange={setPage}
            size="sm"
            getControlProps={(control) =>
              ({ previous: { "aria-label": "Previous page" }, next: { "aria-label": "Next page" } })[control] ?? {}
            }
          />
        )}
      </Group>
    </Paper>
  );
}
