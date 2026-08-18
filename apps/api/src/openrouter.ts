import type {
  GenerateRequest,
  GenerateResponse,
  GeneratedImage,
  ImageModel,
  ImageModelProvider,
  InputImage,
  ProviderRouting,
} from "@imaginate/shared";

const BASE_URL = "https://openrouter.ai/api/v1";

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Add it to apps/api/.env");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:8080",
    "X-Title": process.env.OPENROUTER_SITE_NAME ?? "Imaginate",
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(body.error?.message ?? `OpenRouter request failed (${res.status})`);
  }
  return body;
}

/* ---------------------------------------------------------------------------
 * Discovery
 * ------------------------------------------------------------------------- */

type CapabilityDescriptor =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

interface RawSupportedParameters {
  [key: string]: CapabilityDescriptor;
}

interface RawEndpoint {
  provider_name?: string;
  provider_slug?: string;
  provider_tag?: string | null;
  supported_parameters?: RawSupportedParameters;
  allowed_passthrough_parameters?: string[];
  supports_streaming?: boolean;
  pricing?: Array<{
    billable?: string;
    unit?: string;
    cost_usd?: number;
    variant?: string;
  }>;
}

interface RawImageModel {
  id: string;
  name?: string;
  description?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: RawSupportedParameters;
  supports_streaming?: boolean;
}

interface RawEndpointResponse {
  id?: string;
  endpoints?: RawEndpoint[];
}

let cache: { at: number; models: ImageModel[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

const enumValues = (s: unknown): string[] =>
  s && typeof s === "object" && "values" in s && Array.isArray(s.values)
    ? s.values.map(String)
    : [];

export async function listImageModels(): Promise<ImageModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  const body = await fetchJson<{ data: RawImageModel[] }>(`${BASE_URL}/images/models`);
  const models: ImageModel[] = [];

  for (const m of body.data ?? []) {
    const param = m.supported_parameters ?? {};
    let providers: ImageModelProvider[] = [];
    let supportsStreaming = m.supports_streaming ?? false;

    try {
      const ep = await fetchJson<RawEndpointResponse>(`${BASE_URL}/images/models/${m.id}/endpoints`);
      supportsStreaming = (ep.endpoints ?? []).some((e) => e.supports_streaming);
      providers = (ep.endpoints ?? []).map((e) => ({
        slug: e.provider_slug ?? "",
        tag: e.provider_tag ?? null,
        name: e.provider_name ?? e.provider_slug ?? "",
        supportsStreaming: Boolean(e.supports_streaming),
        pricing: (e.pricing ?? []).map((p) => ({
          billable: p.billable ?? "",
          unit: p.unit ?? "",
          costUsd: p.cost_usd ?? 0,
          variant: p.variant,
        })),
      }));
    } catch {
      /* Optional per-endpoint detail is not required for the model list. */
    }

    const nRange: CapabilityDescriptor | undefined = param.n;
    let maxN = 1;
    if (nRange && "max" in nRange && typeof nRange.max === "number") maxN = nRange.max;

    const maxInputImages =
      typeof m.architecture?.input_modalities?.length === "number" &&
      m.architecture.input_modalities.length > 0
        ? null
        : null;

    models.push({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description,
      maxInputImages,
      supportsImageInput: Boolean(m.architecture?.input_modalities?.includes("image")),
      aspectRatios: enumValues(param.aspect_ratio),
      resolutions: enumValues(param.resolution),
      qualities: enumValues(param.quality),
      outputFormats: enumValues(param.output_format),
      backgrounds: enumValues(param.background),
      maxN,
      supportsSeed: Boolean(param.seed),
      supportsOutputCompression: Boolean(param.output_compression),
      supportsStreaming,
      providers,
    });
  }

  models.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  return models;
}

/* ---------------------------------------------------------------------------
 * Generation
 * ------------------------------------------------------------------------- */

interface GenerateInput {
  model: string;
  prompt: string;
  images?: InputImage[];
  aspectRatio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  outputCompression?: number;
  n?: number;
  seed?: number;
  provider?: ProviderRouting;
}

interface ImageDataItem {
  b64_json?: string;
  media_type?: string;
}

interface ImageResponse {
  data?: ImageDataItem[];
  created?: number;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
}

const toImage = (item: ImageDataItem): GeneratedImage | null => {
  const b64 = item.b64_json;
  if (!b64) return null;
  return { dataUrl: `data:${item.media_type ?? "image/png"};base64,${b64}`, mediaType: item.media_type };
};

function buildBody(input: GenerateInput, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
  };

  const references =
    input.images && input.images.length > 0
      ? input.images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUrl } }))
      : undefined;
  if (references && references.length > 0) body.input_references = references;

  for (const [key, value] of [
    ["aspect_ratio", input.aspectRatio],
    ["resolution", input.resolution],
    ["size", input.size],
    ["quality", input.quality],
    ["output_format", input.outputFormat],
    ["background", input.background],
    ["output_compression", input.outputCompression],
    ["n", input.n],
    ["seed", input.seed],
  ] as const) {
    if (value !== undefined) body[key] = value;
  }

  if (input.provider) {
    const provider: Record<string, unknown> = {};
    if (input.provider.only) provider.only = input.provider.only;
    if (input.provider.order) provider.order = input.provider.order;
    if (input.provider.ignore) provider.ignore = input.provider.ignore;
    if (input.provider.sort) provider.sort = input.provider.sort;
    if (input.provider.allowFallbacks !== undefined)
      provider.allow_fallbacks = input.provider.allowFallbacks;
    if (input.provider.options) provider.options = input.provider.options;
    if (Object.keys(provider).length > 0) body.provider = provider;
  }

  if (stream) body.stream = true;
  return body;
}

export async function generateImage(input: GenerateInput, signal?: AbortSignal): Promise<{
  images: GeneratedImage[];
  cost: number | null;
  completionTokens: number | null;
}> {
  const res = await fetch(`${BASE_URL}/images`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(buildBody(input, false)),
    signal,
  });

  const body = (await res.json().catch(() => ({}))) as ImageResponse & {
    error?: { message?: string };
  };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `OpenRouter request failed (${res.status})`);
  }

  const images = (body.data ?? []).map(toImage).filter((i): i is GeneratedImage => i !== null);
  if (images.length === 0) {
    throw new Error("Model returned no images.");
  }

  return {
    images,
    cost: body.usage?.cost ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
  };
}

interface StreamResult {
  items: ImageDataItem[];
  cost: number | null;
  completionTokens: number | null;
}

async function readImageStream(body: ReadableStream<Uint8Array>): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const items: ImageDataItem[] = [];
  let cost: number | null = null;
  let completionTokens: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return { items, cost, completionTokens };
      let event: {
        type?: string;
        b64_json?: string;
        media_type?: string;
        usage?: { cost?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      try {
        event = JSON.parse(payload) as typeof event;
      } catch {
        continue;
      }
      if (event.type === "image_generation.partial_image") {
        items.push({ b64_json: event.b64_json, media_type: event.media_type });
      }
      if (event.type === "image_generation.completed") {
        items.push({ b64_json: event.b64_json, media_type: event.media_type });
        if (event.usage?.cost != null) cost = event.usage.cost;
        if (event.usage?.completion_tokens != null)
          completionTokens = event.usage.completion_tokens;
      }
      if (event.type === "error" && event.error?.message) {
        throw new Error(event.error.message);
      }
    }
  }
  return { items, cost, completionTokens };
}

/**
 * Generates an image and yields streaming events. Terminates with a `done`
 * event carrying the final result, or an `error` event.
 */
export async function* generateImageStream(
  input: GenerateInput,
  modelParams: { id: number; model: string; prompt: string },
  signal?: AbortSignal,
): AsyncGenerator<
  { type: "partial_image"; image: GeneratedImage; index: number } | { type: "done"; result: GenerateResponse } | { type: "error"; message: string }
> {
  const startedAt = Date.now();
  const res = await fetch(`${BASE_URL}/images`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(buildBody(input, true)),
    signal,
  });

  if (!res.ok || !res.body) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(errBody.error?.message ?? `OpenRouter stream failed (${res.status})`);
  }

  let images: GeneratedImage[] = [];
  let cost: number | null = null;
  let completionTokens: number | null = null;
  try {
    const stream = await readImageStream(res.body);
    cost = stream.cost;
    completionTokens = stream.completionTokens;
    for (const item of stream.items) {
      const image = toImage(item);
      if (!image) continue;
      if (images.some((i) => i.dataUrl === image.dataUrl)) continue;
      images.push(image);
      yield { type: "partial_image", image, index: images.length - 1 };
    }
  } catch (err) {
    yield { type: "error", message: (err as Error).message };
    return;
  }

  if (images.length === 0) {
    yield { type: "error", message: "Model returned no images." };
    return;
  }

  yield {
    type: "done",
    result: {
      id: modelParams.id,
      model: modelParams.model,
      prompt: modelParams.prompt,
      images,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      cost,
      completionTokens,
    },
  };
}

export type { GenerateInput };