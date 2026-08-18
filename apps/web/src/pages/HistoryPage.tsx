import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import type { HistoryDetail, HistoryItem } from "@imaginate/shared";
import { api } from "../api";
import { formatCost } from "../cost";

const statusColor: Record<string, string> = {
  success: "green",
  error: "red",
  pending: "yellow",
  cancelled: "gray",
};

export function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);

  useEffect(() => {
    api
      .history()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>History</Title>
        <Text c="dimmed" size="sm">
          Every request made from this device, stored in a local SQLite file.
        </Text>
      </div>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Center mih={200}>
          <Loader />
        </Center>
      ) : items.length === 0 ? (
        <Text c="dimmed" size="sm">
          No generations yet.
        </Text>
      ) : (
        <Card withBorder radius="md" padding={0}>
          <Table.ScrollContainer minWidth={640}>
            <Table highlightOnHover striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Prompt</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item) => (
                  <Table.Tr
                    key={item.id}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      api
                        .historyDetail(item.id)
                        .then(setDetail)
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    <Table.Td>{new Date(item.createdAt).toLocaleString()}</Table.Td>
                    <Table.Td>{item.model}</Table.Td>
                    <Table.Td style={{ maxWidth: 320 }}>
                      <Text size="sm" lineClamp={1}>
                        {item.prompt}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor[item.status] ?? "gray"} variant="light">
                        {item.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {item.durationMs === null ? "—" : `${(item.durationMs / 1000).toFixed(1)}s`}
                    </Table.Td>
                    <Table.Td>{formatCost(item.cost ?? null) ?? "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {detail && (
        <Card withBorder radius="md" padding="lg">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={500}>{detail.model}</Text>
              <Group gap={6}>
                {detail.cost !== null && detail.cost !== undefined && (
                  <Badge color="teal" variant="light">
                    {formatCost(detail.cost)}
                  </Badge>
                )}
                <Badge color={statusColor[detail.status] ?? "gray"} variant="light">
                  {detail.status}
                </Badge>
              </Group>
            </Group>
            <Text size="sm">{detail.prompt}</Text>
            {detail.error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {detail.error}
              </Alert>
            )}
            {detail.images.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {detail.images.map((image, index) => (
                  <Image key={index} src={image.dataUrl} alt={`Result ${index + 1}`} radius="md" />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
