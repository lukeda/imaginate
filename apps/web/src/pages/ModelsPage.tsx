import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";
import type { ImageModel } from "@imaginate/shared";
import { api } from "../api";
import { estimatePerImageCost, formatCost, pricingLineLabel } from "../cost";

const DEFAULT_TOKENS_PER_IMAGE = 2000;

function basisFor(model: ImageModel): { tokensPerImage: number } {
  return { tokensPerImage: model.avgOutputTokens ?? DEFAULT_TOKENS_PER_IMAGE };
}

function cheapestFor(model: ImageModel): number | null {
  const basis = basisFor(model);
  const costs = model.providers
    .map((p) => estimatePerImageCost(p.pricing, basis))
    .filter((c): c is number => c !== null);
  return costs.length > 0 ? Math.min(...costs) : null;
}

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "price", label: "Cheapest price" },
  { value: "providers", label: "Provider count" },
];

const CAPABILITY_LABELS: { key: keyof Pick<ImageModel, "supportsImageInput" | "supportsStreaming">; label: string; color: string }[] = [
  { key: "supportsImageInput", label: "Image input", color: "grape" },
  { key: "supportsStreaming", label: "Streaming", color: "indigo" },
];

export function ModelsPage() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string | null>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .models()
      .then((res) => {
        setModels(res.models);
        setSelectedId(res.models[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.description?.toLowerCase().includes(q) ||
            m.providers.some((p) => p.name.toLowerCase().includes(q)),
        )
      : [...models];

    list.sort((a, b) => {
      switch (sort) {
        case "price": {
          const pa = cheapestFor(a) ?? Infinity;
          const pb = cheapestFor(b) ?? Infinity;
          if (pa !== pb) return pa - pb;
          break;
        }
        case "providers":
          return b.providers.length - a.providers.length;
        default:
          break;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [models, query, sort]);

  const selected = useMemo(() => models.find((m) => m.id === selectedId) ?? null, [models, selectedId]);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Models</Title>
        <Text c="dimmed" size="sm">
          Every image model OpenRouter exposes, with pricing from each provider.
        </Text>
      </div>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}

      <Group justify="space-between" align="flex-end">
        <TextInput
          placeholder="Search models or providers…"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          w={{ base: "100%", sm: 360 }}
        />
        <Select
          label="Sort"
          data={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
          w={180}
        />
      </Group>

      {loading ? (
        <Center mih={200}>
          <Loader />
        </Center>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" size="sm">
          No models match your search.
        </Text>
      ) : (
        <Card withBorder radius="md" padding={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Capabilities</Table.Th>
                  <Table.Th>Providers</Table.Th>
                  <Table.Th>Price</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((m) => {
                  const price = cheapestFor(m);
                  return (
                    <Table.Tr
                      key={m.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedId(m.id)}
                      bg={selectedId === m.id ? "var(--mantine-color-default-hover)" : undefined}
                    >
                      <Table.Td>
                        <Stack gap={2}>
                          <Text fw={500} size="sm">
                            {m.name}
                          </Text>
                          {m.description && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {m.description}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {CAPABILITY_LABELS.filter((c) => m[c.key]).map((c) => (
                            <Badge key={c.key} variant="light" color={c.color} size="xs">
                              {c.label}
                            </Badge>
                          ))}
                          {m.maxN > 1 && (
                            <Badge variant="light" color="blue" size="xs">
                              {m.maxN} images
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{m.providers.length}</Text>
                      </Table.Td>
                      <Table.Td>
                        {price === null ? (
                          <Text size="sm" c="dimmed">
                            —
                          </Text>
                        ) : (
                          <Badge variant="light" color="teal" size="sm">
                            {formatCost(price)}/image est.
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {selected && (
        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Title order={4}>{selected.name}</Title>
                {selected.description && (
                  <Text size="sm" c="dimmed">
                    {selected.description}
                  </Text>
                )}
              </Stack>
              <Group gap={6}>
                {CAPABILITY_LABELS.filter((c) => selected[c.key]).map((c) => (
                  <Badge key={c.key} variant="light" color={c.color}>
                    {c.label}
                  </Badge>
                ))}
              </Group>
            </Group>

            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">
                Capabilities
              </Text>
              <Group gap={8}>
                {[
                  ["Aspect ratios", selected.aspectRatios],
                  ["Resolutions", selected.resolutions],
                  ["Qualities", selected.qualities],
                  ["Formats", selected.outputFormats],
                  ["Backgrounds", selected.backgrounds],
                ].map(([label, values]) => (
                  <Badge key={label as string} variant="outline" size="sm">
                    {label as string}: {values.length ? (values as string[]).join(", ") : "—"}
                  </Badge>
                ))}
              </Group>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed">
                Provider pricing
              </Text>
              <Card withBorder radius="sm" padding={0}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Provider</Table.Th>
                      <Table.Th>Streaming</Table.Th>
                      <Table.Th>Pricing</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {selected.providers.map((provider) => {
                      const price = estimatePerImageCost(provider.pricing, basisFor(selected));
                      return (
                        <Table.Tr key={provider.slug}>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {provider.name}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{provider.supportsStreaming ? "Yes" : "No"}</Text>
                          </Table.Td>
                          <Table.Td>
                            {price === null ? (
                              <Text size="sm" c="dimmed">
                                —
                              </Text>
                            ) : (
                              <Stack gap={2}>
                                <Text size="sm" c="teal" fw={600}>
                                  {formatCost(price)}/image est.
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {provider.pricing.map(pricingLineLabel).join(" · ")}
                                </Text>
                              </Stack>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Card>
            </Stack>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
