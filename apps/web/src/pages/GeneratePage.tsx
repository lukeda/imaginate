import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  MultiSelect,
  NumberInput,
  Overlay,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE, type FileWithPath } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconDownload, IconPhotoPlus, IconPlayerStop, IconX } from "@tabler/icons-react";
import type {
  GenerateRequest,
  GenerateResponse,
  GeneratedImage,
  ImageModel,
  InputImage,
  ProviderRouting,
} from "@imaginate/shared";
import { api } from "../api";
import {
  estimatePerImageCost,
  formatCost,
  pricingLineLabel,
  resolutionToMegapixels,
} from "../cost";

const DEFAULT_MAX_IMAGES = 8;
const DEFAULT_TOKENS_PER_IMAGE = 2000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function extensionFor(image: GeneratedImage): string {
  switch (image.mediaType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

const SORT_OPTIONS = [
  { value: "price", label: "Price" },
  { value: "throughput", label: "Throughput" },
  { value: "latency", label: "Latency" },
];

export function GeneratePage() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<InputImage[]>([]);

  const [aspectRatio, setAspectRatio] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<string | null>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [count, setCount] = useState<number | string>(1);
  const [seed, setSeed] = useState<number | string>("");

  const [providerMode, setProviderMode] = useState<string>("none");
  const [providerList, setProviderList] = useState<string[]>([]);
  const [providerSort, setProviderSort] = useState<string | null>(null);
  const [allowFallbacks, setAllowFallbacks] = useState(true);
  const [providerOptions, setProviderOptions] = useState("");

  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [preview, setPreview] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [tokenBasis, setTokenBasis] = useState<number | string>(DEFAULT_TOKENS_PER_IMAGE);
  const tokenBasisEdited = useRef(false);

  useEffect(() => {
    api
      .models()
      .then((res) => {
        setModels(res.models);
        setModel((current) => current ?? res.models[0]?.id ?? null);
      })
      .catch((err: Error) => setModelsError(err.message))
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    return () => window.clearInterval(timer);
  }, [loading]);

  const selected = useMemo(() => models.find((m) => m.id === model) ?? null, [models, model]);
  const maxImages = selected?.maxInputImages ?? DEFAULT_MAX_IMAGES;
  const canAttach = selected?.supportsImageInput ?? false;

  const basis = useMemo(
    () => ({
      tokensPerImage:
        Number.isFinite(Number(tokenBasis)) && Number(tokenBasis) > 0
          ? Number(tokenBasis)
          : DEFAULT_TOKENS_PER_IMAGE,
      megapixels: resolutionToMegapixels(resolution),
    }),
    [tokenBasis, resolution],
  );

  const hasRatePricing = useMemo(
    () =>
      selected?.providers.some((p) =>
        p.pricing.some((l) => l.unit === "token" || l.unit === "megapixel"),
      ) ?? false,
    [selected],
  );

  const cheapestPrice = useMemo(() => {
    if (!selected?.providers.length) return null;
    const costs = selected.providers
      .map((p) => estimatePerImageCost(p.pricing, basis))
      .filter((c): c is number => c !== null);
    return costs.length > 0 ? Math.min(...costs) : null;
  }, [selected, basis]);

  const prevModel = useRef<string | null>(null);
  useEffect(() => {
    if (prevModel.current === model) return;
    prevModel.current = model;
    setAspectRatio(null);
    setResolution(null);
    setQuality(null);
    setOutputFormat(null);
    setBackground(null);
    setCount(1);
    setProviderList([]);
    tokenBasisEdited.current = false;
  }, [model, models]);

  useEffect(() => {
    if (!selected) return;
    const basisDefault = selected.avgOutputTokens ?? DEFAULT_TOKENS_PER_IMAGE;
    if (!tokenBasisEdited.current) setTokenBasis(basisDefault);
  }, [selected?.avgOutputTokens]);

  const options = useMemo(() => models.map((m) => ({ value: m.id, label: m.name })), [models]);

  const providerChoices = useMemo(
    () => (selected?.providers ?? []).map((p) => ({ value: p.slug, label: p.name || p.slug })),
    [selected],
  );

  const streaming = selected?.supportsStreaming ?? false;
  const maxN = selected?.maxN ?? 1;

  function buildProvider(): ProviderRouting | undefined {
    if (providerMode === "none" && !providerSort && !providerOptions.trim()) return undefined;
    const routing: ProviderRouting = {};
    if (providerMode === "only" && providerList.length > 0) routing.only = providerList;
    if (providerMode === "ignore" && providerList.length > 0) routing.ignore = providerList;
    if (providerMode === "order" && providerList.length > 0) routing.order = providerList;
    if (providerSort) routing.sort = providerSort as ProviderRouting["sort"];
    if (!allowFallbacks) routing.allowFallbacks = false;
    if (providerOptions.trim()) {
      try {
        routing.options = JSON.parse(providerOptions);
      } catch {
        notifications.show({
          color: "yellow",
          message: "Provider options must be valid JSON; ignoring invalid options.",
        });
      }
    }
    return Object.keys(routing).length > 0 ? routing : undefined;
  }

  async function handleDrop(files: FileWithPath[]) {
    const room = Math.max(0, maxImages - images.length);
    if (room === 0) {
      notifications.show({
        color: "yellow",
        message: `This model accepts at most ${maxImages} image${maxImages === 1 ? "" : "s"}.`,
      });
      return;
    }
    const accepted = files.slice(0, room);
    const next = await Promise.all(
      accepted.map(async (file) => ({ name: file.name, dataUrl: await fileToDataUrl(file) })),
    );
    setImages((current) => [...current, ...next]);
  }

  function buildPayload(): GenerateRequest | null {
    if (!model || !prompt.trim()) return null;
    return {
      model,
      prompt: prompt.trim(),
      images,
      aspectRatio: aspectRatio ?? undefined,
      resolution: resolution ?? undefined,
      quality: quality ?? undefined,
      outputFormat: outputFormat ?? undefined,
      background: background ?? undefined,
      n: count === "" ? undefined : Number(count),
      seed: seed === "" ? undefined : Number(seed),
      provider: buildProvider(),
    };
  }

  async function handleGenerate() {
    const payload = buildPayload();
    if (!payload) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setPreview([]);

    try {
      if (streaming) {
        for await (const event of api.generateStream(payload, controller.signal)) {
          if (event.type === "partial_image") {
            setPreview((cur) => [...cur, event.image]);
          } else if (event.type === "done") {
            setResult(event.result);
            notifications.show({
              color: "green",
              message: `Generated in ${(event.result.durationMs / 1000).toFixed(1)}s`,
            });
            api.models().then((res) => setModels(res.models)).catch(() => undefined);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      } else {
        const response = await api.generate(payload, controller.signal);
        setResult(response);
        notifications.show({
          color: "green",
          message: `Generated in ${(response.durationMs / 1000).toFixed(1)}s`,
        });
        api.models().then((res) => setModels(res.models)).catch(() => undefined);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const providerOptionsError = useMemo(() => {
    if (!providerOptions.trim()) return undefined;
    try {
      JSON.parse(providerOptions);
      return undefined;
    } catch {
      return "Invalid JSON";
    }
  }, [providerOptions]);

  const displayImages = result?.images ?? preview;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Generate an image</Title>
          <Text c="dimmed" size="sm">
            Runs locally against your OpenRouter account.
          </Text>
        </div>
        {selected && (
          <Group gap="xs">
            {canAttach ? (
              <Badge variant="light">Accepts up to {maxImages} images</Badge>
            ) : (
              <Badge variant="light" color="gray">
                Text input only
              </Badge>
            )}
            {streaming && (
              <Badge variant="light" color="indigo">
                Streaming
              </Badge>
            )}
          </Group>
        )}
      </Group>

      {modelsError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title="Could not load models">
          {modelsError}
        </Alert>
      )}

      <Grid align="flex-start">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Select
                label="Model"
                placeholder={modelsLoading ? "Loading models…" : "Search models"}
                searchable
                nothingFoundMessage="No model found"
                data={options}
                value={model}
                onChange={setModel}
                disabled={modelsLoading}
                rightSection={modelsLoading ? <Loader size="xs" /> : undefined}
                limit={100}
              />

              {selected && selected.providers.length > 0 && (
                <Card withBorder radius="sm" padding="sm">
                  <Stack gap={6}>
                    <Group justify="space-between">
                      <Text size="xs" fw={600} c="dimmed">
                        Pricing
                      </Text>
                      {cheapestPrice !== null && (
                        <Badge color="teal" variant="light" size="xs">
                          from {formatCost(cheapestPrice)}/image est.
                        </Badge>
                      )}
                    </Group>
                    {selected.providers.map((provider) => {
                      const providerCost = estimatePerImageCost(provider.pricing, basis);
                      const isCheapest = providerCost !== null && providerCost === cheapestPrice;
                      return (
                        <Stack key={provider.slug} gap={1}>
                          <Group justify="space-between" wrap="nowrap">
                            <Group gap={6} wrap="nowrap" maw="60%">
                              <Text size="xs" truncate>
                                {provider.name}
                              </Text>
                              {provider.supportsStreaming && (
                                <Badge size="xs" variant="dot" color="indigo" tt="none">
                                  stream
                                </Badge>
                              )}
                            </Group>
                            <Text
                              size="xs"
                              fw={isCheapest ? 600 : 400}
                              c={isCheapest ? "teal" : "dimmed"}
                            >
                              {providerCost === null
                                ? "—"
                                : `${formatCost(providerCost)}/image`}
                            </Text>
                          </Group>
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                          >
                            {provider.pricing.map(pricingLineLabel).join(" · ")}
                          </Text>
                        </Stack>
                      );
                    })}
                    {hasRatePricing && (
                      <Divider my={2} />
                    )}
                    {hasRatePricing && (
                      <Group justify="space-between" align="flex-end">
                        <NumberInput
                          label="Est. tokens/image"
                          min={1}
                          value={tokenBasis}
                          onChange={(value) => {
                            tokenBasisEdited.current = true;
                            setTokenBasis(value);
                          }}
                          size="xs"
                          w={150}
                        />
                        <Text size="xs" c="dimmed">
                          {resolution
                            ? `${resolution} ≈ ${resolutionToMegapixels(resolution)} MP`
                            : "est. 1 MP"}
                        </Text>
                      </Group>
                    )}
                  </Stack>
                </Card>
              )}

              <Textarea
                label="Prompt"
                placeholder="A watercolour lighthouse at dusk…"
                autosize
                minRows={5}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
              />

              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Reference images
                </Text>
                <Dropzone
                  onDrop={handleDrop}
                  accept={IMAGE_MIME_TYPE}
                  disabled={!canAttach || images.length >= maxImages}
                  multiple
                >
                  <Center mih={90}>
                    <Group gap="sm">
                      <IconPhotoPlus size={22} />
                      <Text size="sm" c="dimmed">
                        {canAttach
                          ? `Drop images or click to select (${images.length}/${maxImages})`
                          : "This model does not accept image input"}
                      </Text>
                    </Group>
                  </Center>
                </Dropzone>

                {images.length > 0 && (
                  <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
                    {images.map((image, index) => (
                      <Paper key={`${image.name}-${index}`} withBorder radius="sm" pos="relative">
                        <Image src={image.dataUrl} alt={image.name} radius="sm" h={70} fit="cover" />
                        <ActionIcon
                          size="xs"
                          color="red"
                          variant="filled"
                          pos="absolute"
                          top={4}
                          right={4}
                          onClick={() => setImages((c) => c.filter((_, i) => i !== index))}
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      </Paper>
                    ))}
                  </SimpleGrid>
                )}
              </Stack>

              <Grid>
                {selected && selected.aspectRatios.length > 0 && (
                  <Grid.Col span={6}>
                    <Select
                      label="Aspect ratio"
                      placeholder="auto"
                      data={selected.aspectRatios}
                      value={aspectRatio}
                      onChange={setAspectRatio}
                      clearable
                      searchable
                    />
                  </Grid.Col>
                )}
                {selected && selected.resolutions.length > 0 && (
                  <Grid.Col span={6}>
                    <Select
                      label="Resolution"
                      placeholder="default"
                      data={selected.resolutions}
                      value={resolution}
                      onChange={setResolution}
                      clearable
                      searchable
                    />
                  </Grid.Col>
                )}
                {selected && selected.qualities.length > 0 && (
                  <Grid.Col span={6}>
                    <Select
                      label="Quality"
                      placeholder="auto"
                      data={selected.qualities}
                      value={quality}
                      onChange={setQuality}
                      clearable
                      searchable
                    />
                  </Grid.Col>
                )}
                {selected && selected.outputFormats.length > 0 && (
                  <Grid.Col span={6}>
                    <Select
                      label="Output format"
                      placeholder="default"
                      data={selected.outputFormats}
                      value={outputFormat}
                      onChange={setOutputFormat}
                      clearable
                      searchable
                    />
                  </Grid.Col>
                )}
                {selected && selected.backgrounds.length > 0 && (
                  <Grid.Col span={6}>
                    <Select
                      label="Background"
                      placeholder="auto"
                      data={selected.backgrounds}
                      value={background}
                      onChange={setBackground}
                      clearable
                      searchable
                    />
                  </Grid.Col>
                )}
                {maxN > 1 && (
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Images"
                      min={1}
                      max={maxN}
                      value={count}
                      onChange={setCount}
                    />
                  </Grid.Col>
                )}
                {selected && selected.supportsSeed && (
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Seed"
                      placeholder="random"
                      value={seed}
                      onChange={setSeed}
                    />
                  </Grid.Col>
                )}
              </Grid>

              <Divider />

              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={500}>
                    Provider routing
                  </Text>
                  <Switch
                    label="Allow fallbacks"
                    checked={allowFallbacks}
                    onChange={(e) => setAllowFallbacks(e.currentTarget.checked)}
                    size="xs"
                  />
                </Group>
                <Select
                  label="Mode"
                  data={[
                    { value: "none", label: "No restrictions" },
                    { value: "only", label: "Use only these providers" },
                    { value: "ignore", label: "Exclude these providers" },
                    { value: "order", label: "Ordered preference" },
                  ]}
                  value={providerMode}
                  onChange={(value) => setProviderMode(value ?? "none")}
                />
                {providerMode !== "none" && (
                  <MultiSelect
                    label="Providers"
                    placeholder="Select providers…"
                    data={providerChoices}
                    value={providerList}
                    onChange={setProviderList}
                    searchable
                  />
                )}
                <Select
                  label="Route sort"
                  placeholder="Provider default"
                  data={SORT_OPTIONS}
                  value={providerSort}
                  onChange={setProviderSort}
                  clearable
                />
                <Textarea
                  label="Provider options (JSON)"
                  placeholder='{ "provider-slug": { "steps": 40 } }'
                  autosize
                  minRows={1}
                  value={providerOptions}
                  onChange={(event) => setProviderOptions(event.currentTarget.value)}
                  error={providerOptionsError}
                />
              </Stack>

              <Button
                onClick={handleGenerate}
                loading={loading}
                disabled={loading || !model || !prompt.trim()}
                size="md"
              >
                Generate{streaming ? " (streaming)" : ""}
              </Button>

              {loading && (
                <Stack gap={4}>
                  <Progress value={100} animated striped />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Generating… {(elapsed / 1000).toFixed(1)}s
                    </Text>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      leftSection={<IconPlayerStop size={14} />}
                      onClick={() => abortRef.current?.abort()}
                    >
                      Stop
                    </Button>
                  </Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder radius="md" padding="lg" mih={360} pos="relative">
            {loading && displayImages.length === 0 && (
              <Overlay blur={2} backgroundOpacity={0.35} zIndex={1}>
                <Center h="100%">
                  <Stack align="center" gap="xs">
                    <Loader />
                    <Text size="sm">Generating…</Text>
                  </Stack>
                </Center>
              </Overlay>
            )}

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />} title="Generation failed">
                {error}
              </Alert>
            )}

            {!error && displayImages.length === 0 && !loading && (
              <Center mih={320}>
                <Text c="dimmed" size="sm">
                  Your generated image will appear here.
                </Text>
              </Center>
            )}

            {displayImages.length > 0 && (
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={500}>{result?.model ?? model}</Text>
                  <Group gap={6}>
                    {loading && displayImages.length > 0 && (
                      <Badge variant="light" color="indigo">
                        {preview.length} / {count}
                      </Badge>
                    )}
                    {result?.cost !== null && result?.cost !== undefined && (
                      <Badge variant="light" color="teal">
                        {formatCost(result.cost)}
                      </Badge>
                    )}
                    {result && <Badge variant="light">{(result.durationMs / 1000).toFixed(1)}s</Badge>}
                  </Group>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: displayImages.length > 1 ? 2 : 1 }} spacing="md">
                  {displayImages.map((image, index) => (
                    <Stack key={index} gap="xs">
                      <Image
                        src={image.dataUrl}
                        alt={`Generated ${index + 1}`}
                        radius="md"
                        style={{ opacity: loading && result === null ? 0.7 : 1 }}
                      />
                      {result && (
                        <Button
                          component="a"
                          href={image.dataUrl}
                          download={`generation-${result.id}-${index + 1}.${extensionFor(image)}`}
                          variant="light"
                          leftSection={<IconDownload size={16} />}
                          size="xs"
                        >
                          Download
                        </Button>
                      )}
                    </Stack>
                  ))}
                </SimpleGrid>
                {result?.text && (
                  <Text size="sm" c="dimmed">
                    {result.text}
                  </Text>
                )}
              </Stack>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}