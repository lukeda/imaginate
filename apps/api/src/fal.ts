import type { GeneratedImage, ImageModel, InputImage } from "@imaginate/shared";

const CATALOG_URL = "https://fal.ai/api/models";
const SCHEMA_URL = "https://fal.ai/api/openapi/queue/openapi.json";
const QUEUE_URL = "https://queue.fal.run";

const FAL_CATEGORIES = ["text-to-image", "image-to-image"] as const;

function headers(): Record<string, string> {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set. Add it to apps/api/.env");
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const detail = (body as { detail?: string }).detail;
    throw new Error(detail ?? `fal request failed (${res.status})`);
  }
  return body;
}

/* ---------------------------------------------------------------------------
 * Discovery
 * ------------------------------------------------------------------------- */

interface CatalogItem {
  id: string;
  title?: string;
  category?: string;
  shortDescription?: string;
  deprecated?: boolean;
  removed?: boolean;
}

interface CatalogPage {
  items: CatalogItem[];
  pages: number;
}

/** Capability knobs derived from a model's input JSON schema. */
interface FalCapabilities {
  aspectRatios: string[];
  aspectParam: "aspect_ratio" | "image_size" | null;
  resolutions: string[];
  qualities: string[];
  outputFormats: string[];
  backgrounds: string[];
  maxN: number;
  supportsSeed: boolean;
  imageParam: "image_url" | "image_urls" | null;
  maxInputImages: number | null;
}

let cache: { at: number; models: ImageModel[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

const enumValues = (s: unknown): string[] => {
  const out: string[] = [];
  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as { enum?: unknown; anyOf?: unknown[]; allOf?: unknown[] };
    if (Array.isArray(obj.enum)) out.push(...obj.enum.map(String));
    for (const branch of [...(obj.anyOf ?? []), ...(obj.allOf ?? [])]) collect(branch);
  };
  collect(s);
  return [...new Set(out)];
};

const maxOf = (s: unknown): number | null => {
  if (!s || typeof s !== "object") return null;
  const obj = s as { maximum?: unknown; anyOf?: unknown[] };
  if (typeof obj.maximum === "number") return obj.maximum;
  for (const branch of obj.anyOf ?? []) {
    const max = maxOf(branch);
    if (max !== null) return max;
  }
  return null;
};

/**
 * Fetches a model's input/output JSON schema from fal's public OpenAPI
 * registry. Returns null when the model has no schema or the fetch fails.
 */
export async function fetchFalCapabilities(modelId: string): Promise<FalCapabilities | null> {
  try {
    const body = await fetchJson<{
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    }>(`${SCHEMA_URL}?endpoint_id=${encodeURIComponent(modelId)}`);

    const schemas = body.components?.schemas ?? {};
    const input = Object.values(schemas).find((s) => s?.properties && "prompt" in s.properties);
    if (!input?.properties) return null;

    const p = input.properties;
    const aspectParam = p.aspect_ratio ? "aspect_ratio" : p.image_size ? "image_size" : null;
    const imageParam = p.image_urls ? "image_urls" : p.image_url ? "image_url" : null;
    return {
      aspectRatios: enumValues(p.aspect_ratio ?? p.image_size),
      aspectParam,
      resolutions: enumValues(p.resolution),
      qualities: enumValues(p.quality),
      outputFormats: enumValues(p.output_format ?? p.format),
      backgrounds: enumValues(p.background),
      maxN: maxOf(p.num_images) ?? 1,
      supportsSeed: Boolean(p.seed),
      imageParam,
      maxInputImages: maxOf(p.image_urls ?? p.image_url),
    };
  } catch {
    return null;
  }
}

const schemaCache = new Map<string, { at: number; caps: FalCapabilities | null }>();
const SCHEMA_CACHE_MS = 60 * 60 * 1000;

async function getCapabilities(modelId: string): Promise<FalCapabilities | null> {
  const cached = schemaCache.get(modelId);
  if (cached && Date.now() - cached.at < SCHEMA_CACHE_MS) return cached.caps;
  const caps = await fetchFalCapabilities(modelId);
  schemaCache.set(modelId, { at: Date.now(), caps });
  return caps;
}

function toModel(item: CatalogItem, category: string): ImageModel {
  return {
    id: `fal/${item.id}`,
    source: "fal",
    name: item.title ?? item.id,
    description: item.shortDescription,
    maxInputImages: null,
    supportsImageInput: category === "image-to-image",
    aspectRatios: [],
    resolutions: [],
    qualities: [],
    outputFormats: [],
    backgrounds: [],
    maxN: 1,
    supportsSeed: false,
    supportsOutputCompression: false,
    supportsStreaming: false,
    providers: [],
  };
}

/**
 * Lists image models available on fal. Requires FAL_API_KEY; returns an empty
 * list (so the catalog stays OpenRouter-only) when it is unset.
 */
export async function listFalImageModels(): Promise<ImageModel[]> {
  if (!process.env.FAL_API_KEY) return [];
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  const byId = new Map<string, ImageModel>();
  await Promise.all(
    FAL_CATEGORIES.map(async (category) => {
      try {
        const first = await fetchJson<CatalogPage>(`${CATALOG_URL}?categories=${category}&page=1`);
        const pages = Math.min(first.pages, 15);
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            fetchJson<CatalogPage>(`${CATALOG_URL}?categories=${category}&page=${i + 2}`).catch(
              () => null,
            ),
          ),
        );
        for (const page of [first, ...rest.filter((p): p is CatalogPage => p !== null)]) {
          for (const item of page.items) {
            const existing = byId.get(item.id);
            if (!existing) {
              byId.set(item.id, toModel(item, category));
            } else if (category === "image-to-image") {
              existing.supportsImageInput = true;
            }
          }
        }
      } catch {
        /* Category fetch failures are non-fatal; keep the rest of the catalog. */
      }
    }),
  );

  const models = [...byId.values()];
  await enrichCapabilities(models);

  models.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  return models;
}

/**
 * Enriches models with capability enums from their input schemas, bounded by
 * a time budget so the first catalog request stays responsive. Models that
 * miss the budget keep their base metadata.
 */
async function enrichCapabilities(models: ImageModel[]): Promise<void> {
  const budgetMs = 3000;
  const started = Date.now();
  const concurrency = 16;
  let index = 0;

  const worker = async (): Promise<void> => {
    while (Date.now() - started < budgetMs) {
      const i = index++;
      if (i >= models.length) return;
      const model = models[i];
      const caps = await getCapabilities(model.id.slice("fal/".length));
      if (!caps) continue;
      model.aspectRatios = caps.aspectRatios;
      model.resolutions = caps.resolutions;
      model.qualities = caps.qualities;
      model.outputFormats = caps.outputFormats;
      model.backgrounds = caps.backgrounds;
      model.maxN = caps.maxN;
      model.supportsSeed = caps.supportsSeed;
      model.supportsImageInput = caps.imageParam !== null;
      model.maxInputImages = caps.maxInputImages;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}

/* ---------------------------------------------------------------------------
 * Generation
 * ------------------------------------------------------------------------- */

export interface FalGenerateInput {
  model: string;
  prompt: string;
  images?: InputImage[];
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  n?: number;
  seed?: number;
}

interface FalImageItem {
  url?: string;
  content_type?: string | null;
}

interface SubmitResponse {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

interface QueueStatus {
  status?: string;
  error?: string;
}

function buildBody(input: FalGenerateInput, caps: FalCapabilities | null): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: input.prompt };

  if (input.images && input.images.length > 0) {
    const urls = input.images.map((img) => img.dataUrl);
    if (caps?.imageParam === "image_url") body.image_url = urls[0];
    else body.image_urls = urls;
  }

  if (
    input.aspectRatio !== undefined &&
    caps?.aspectParam &&
    caps.aspectRatios.includes(input.aspectRatio)
  ) {
    body[caps.aspectParam] = input.aspectRatio;
  }
  if (input.resolution !== undefined && caps?.resolutions.includes(input.resolution)) {
    body.resolution = input.resolution;
  }
  if (input.quality !== undefined && caps?.qualities.includes(input.quality)) {
    body.quality = input.quality;
  }
  if (input.outputFormat !== undefined && caps?.outputFormats.includes(input.outputFormat)) {
    body.output_format = input.outputFormat;
  }
  if (input.background !== undefined && caps?.backgrounds.includes(input.background)) {
    body.background = input.background;
  }
  if (input.n !== undefined && caps && caps.maxN > 1) body.num_images = input.n;
  if (input.seed !== undefined && caps?.supportsSeed) body.seed = input.seed;

  return body;
}

const toImage = async (item: FalImageItem): Promise<GeneratedImage | null> => {
  if (!item.url) return null;
  try {
    const res = await fetch(item.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mediaType = item.content_type ?? res.headers.get("content-type") ?? "image/png";
    return { dataUrl: `data:${mediaType};base64,${buf.toString("base64")}`, mediaType };
  } catch {
    return null;
  }
};

/**
 * Generates an image via fal's queue API: submits the request, polls until
 * COMPLETED, then downloads the resulting CDN URLs as base64 data URLs.
 */
export async function generateFalImage(
  input: FalGenerateInput,
  signal?: AbortSignal,
): Promise<{ images: GeneratedImage[]; cost: number | null; completionTokens: number | null }> {
  const modelId = input.model.replace(/^fal\//, "");
  const caps = await getCapabilities(modelId);

  const submitted = await fetchJson<SubmitResponse>(`${QUEUE_URL}/${modelId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(buildBody(input, caps)),
    signal,
  });
  const requestId = submitted.request_id;
  if (!requestId) throw new Error("fal returned no request_id.");

  const statusUrl = submitted.status_url ?? `${QUEUE_URL}/${modelId}/requests/${requestId}/status`;
  const responseUrl =
    submitted.response_url ?? `${QUEUE_URL}/${modelId}/requests/${requestId}/response`;
  const cancelUrl = submitted.cancel_url ?? `${QUEUE_URL}/${modelId}/requests/${requestId}/cancel`;

  for (;;) {
    if (signal?.aborted) {
      await fetch(cancelUrl, { method: "PUT", headers: headers() }).catch(() => {});
      throw new Error("Request cancelled");
    }

    const status = await fetchJson<QueueStatus>(statusUrl, { headers: headers(), signal });
    if (status.status === "COMPLETED") {
      if (status.error) throw new Error(status.error);
      const result = await fetchJson<{ images?: FalImageItem[] }>(responseUrl, {
        headers: headers(),
        signal,
      });
      const images = (await Promise.all((result.images ?? []).map((item) => toImage(item)))).filter(
        (img): img is GeneratedImage => img !== null,
      );
      if (images.length === 0) throw new Error("Model returned no images.");
      return { images, cost: null, completionTokens: null };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
