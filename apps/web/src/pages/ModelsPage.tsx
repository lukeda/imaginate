import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
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
const PAGE_SIZE = 100;

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

interface ModelRowProps {
  model: ImageModel;
  price: number | null;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ModelRow = memo(function ModelRow({ model, price, selected, onSelect }: ModelRowProps) {
  return (
    <Table.Tr
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(model.id)}
      bg={selected ? "var(--mantine-color-default-hover)" : undefined}
    >
      <Table.Td>
        <Stack gap={2}>
          <Group gap={6} wrap="nowrap">
            <Text fw={500} size="sm" truncate>
              {model.name}
            </Text>
            <Badge variant="light" color={model.source === "fal" ? "orange" : "blue"} size="xs" tt="uppercase">
              {model.source}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
            {model.id}
          </Text>
          {model.description && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {model.description}
            </Text>
          )}
        </Stack>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {CAPABILITY_LABELS.filter((c) => model[c.key]).map((c) => (
            <Badge key={c.key} variant="light" color={c.color} size="xs">
              {c.label}
            </Badge>
          ))}
          {model.maxN > 1 && (
            <Badge variant="light" color="blue" size="xs">
              {model.maxN} images
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{model.providers.length}</Text>
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
});

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

  const derived = useMemo(() => {
    const map = new Map<string, { haystack: string; price: number | null }>();
    for (const m of models) {
      const haystack = [
        m.name,
        m.description ?? "",
        m.id,
        m.id.replace(/^fal\//, ""),
        ...m.providers.map((p) => p.name),
      ]
        .join(" ")
        .toLowerCase();
      map.set(m.id, { haystack, price: cheapestFor(m) });
    }
    return map;
  }, [models]);

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = q
      ? models.filter((m) => derived.get(m.id)?.haystack.includes(q))
      : [...models];

    list.sort((a, b) => {
      const da = derived.get(a.id)!;
      const db = derived.get(b.id)!;
      switch (sort) {
        case "price": {
          const pa = da.price ?? Infinity;
          const pb = db.price ?? Infinity;
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
  }, [models, deferredQuery, sort, derived]);

  const visible = filtered.slice(0, PAGE_SIZE);
  const truncated = filtered.length > PAGE_SIZE;

  const selected = useMemo(() => models.find((m) => m.id === selectedId) ?? null, [models, selectedId]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Models</Title>
        <Text c="dimmed" size="sm">
          Every image model OpenRouter and fal.ai expose, with pricing from each provider.
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
                {visible.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    price={derived.get(m.id)?.price ?? null}
                    selected={selectedId === m.id}
                    onSelect={handleSelect}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {truncated && (
            <Text size="xs" c="dimmed" p="sm">
              Showing {visible.length} of {filtered.length} models — refine your search to narrow results.
            </Text>
          )}
        </Card>
      )}

      {selected && (
        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Group gap={6}>
                  <Title order={4}>{selected.name}</Title>
                  <Badge variant="light" color={selected.source === "fal" ? "orange" : "blue"} size="sm" tt="uppercase">
                    {selected.source}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
                  {selected.id}
                </Text>
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