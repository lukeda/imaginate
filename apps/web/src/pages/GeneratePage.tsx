import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Grid,
  Group,
  Image,
  Loader,
  NumberInput,
  Overlay,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE, type FileWithPath } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconDownload, IconPhotoPlus, IconX } from "@tabler/icons-react";
import type { GenerateResponse, ImageModel, InputImage } from "@imaginate/shared";
import { api } from "../api";
import { formatCost } from "../cost";

const DEFAULT_MAX_IMAGES = 8;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function GeneratePage() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState<number | string>("");
  const [seed, setSeed] = useState<number | string>("");
  const [images, setImages] = useState<InputImage[]>([]);

  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const options = useMemo(
    () => models.map((m) => ({ value: m.id, label: m.name })),
    [models],
  );

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

  async function handleGenerate() {
    if (!model || !prompt.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.generate(
        {
          model,
          prompt: prompt.trim(),
          images,
          systemPrompt: systemPrompt.trim() || undefined,
          temperature: temperature === "" ? undefined : Number(temperature),
          seed: seed === "" ? undefined : Number(seed),
        },
        controller.signal,
      );
      setResult(response);
      notifications.show({ color: "green", message: `Generated in ${(response.durationMs / 1000).toFixed(1)}s` });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

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

              <Group grow>
                <NumberInput
                  label="Temperature"
                  placeholder="default"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={setTemperature}
                />
                <NumberInput
                  label="Seed"
                  placeholder="random"
                  value={seed}
                  onChange={setSeed}
                />
              </Group>

              <Textarea
                label="System prompt (optional)"
                placeholder="Style or safety instructions"
                autosize
                minRows={2}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.currentTarget.value)}
              />

              <Button
                onClick={handleGenerate}
                loading={loading}
                disabled={!model || !prompt.trim()}
                size="md"
              >
                Generate
              </Button>

              {loading && (
                <Stack gap={4}>
                  <Progress value={100} animated striped />
                  <Text size="xs" c="dimmed">
                    Generating… {(elapsed / 1000).toFixed(1)}s
                  </Text>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder radius="md" padding="lg" mih={360} pos="relative">
            {loading && (
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

            {!error && !result && !loading && (
              <Center mih={320}>
                <Text c="dimmed" size="sm">
                  Your generated image will appear here.
                </Text>
              </Center>
            )}

            {result && (
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={500}>{result.model}</Text>
                  <Group gap={6}>
                    {result.cost !== null && result.cost !== undefined && (
                      <Badge variant="light" color="teal">
                        {formatCost(result.cost)}
                      </Badge>
                    )}
                    <Badge variant="light">{(result.durationMs / 1000).toFixed(1)}s</Badge>
                  </Group>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: result.images.length > 1 ? 2 : 1 }} spacing="md">
                  {result.images.map((image, index) => (
                    <Stack key={index} gap="xs">
                      <Image src={image.dataUrl} alt={`Generated ${index + 1}`} radius="md" />
                      <Button
                        component="a"
                        href={image.dataUrl}
                        download={`generation-${result.id}-${index + 1}.png`}
                        variant="light"
                        leftSection={<IconDownload size={16} />}
                        size="xs"
                      >
                        Download
                      </Button>
                    </Stack>
                  ))}
                </SimpleGrid>
                {result.text && (
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
