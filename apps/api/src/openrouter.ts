import type { GeneratedImage, ImageModel, InputImage } from "@imaginate/shared";

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

interface RawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string>;
  max_input_images?: number;
}

let cache: { at: number; models: ImageModel[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function listImageModels(): Promise<ImageModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  const res = await fetch(`${BASE_URL}/models`, { headers: headers() });
  if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`);
  const body = (await res.json()) as { data: RawModel[] };

  const models: ImageModel[] = body.data
    .filter((m) => m.architecture?.output_modalities?.includes("image"))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description,
      contextLength: m.context_length,
      supportsImageInput: Boolean(m.architecture?.input_modalities?.includes("image")),
      maxInputImages: typeof m.max_input_images === "number" ? m.max_input_images : null,
      pricing: m.pricing,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache = { at: Date.now(), models };
  return models;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      images?: Array<{ image_url?: { url?: string }; type?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    images?: number;
  };
  error?: { message?: string };
}

function toUsd(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getPricing(modelId: string): ImageModel["pricing"] | null {
  const models = cache?.models ?? [];
  const model = models.find((m) => m.id === modelId);
  return model?.pricing && Object.keys(model.pricing).length > 0 ? model.pricing : null;
}

export async function generateImage(input: {
  model: string;
  prompt: string;
  images: InputImage[];
  temperature?: number;
  seed?: number;
  systemPrompt?: string;
}): Promise<{ images: GeneratedImage[]; text?: string; cost: number | null }> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const image of input.images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }

  const messages: Array<Record<string, unknown>> = [];
  if (input.systemPrompt?.trim()) {
    messages.push({ role: "system", content: input.systemPrompt.trim() });
  }
  messages.push({ role: "user", content });

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: input.model,
      messages,
      modalities: ["image", "text"],
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    }),
  });

  const body = (await res.json()) as ChatResponse;
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `OpenRouter request failed (${res.status})`);
  }

  const message = body.choices?.[0]?.message;
  const images: GeneratedImage[] = (message?.images ?? [])
    .map((img) => img.image_url?.url)
    .filter((url): url is string => Boolean(url))
    .map((dataUrl) => ({ dataUrl }));

  if (images.length === 0) {
    throw new Error(
      message?.content
        ? `Model returned text instead of an image: ${message.content}`
        : "Model returned no images.",
    );
  }

  const usage = body.usage;
  const pricing = getPricing(input.model);
  let cost: number | null = null;
  if (pricing && usage) {
    const promptPrice = toUsd(pricing.prompt);
    const completionPrice = toUsd(pricing.completion);
    const imagePrice = toUsd(pricing.image);
    let c = 0;
    if (promptPrice && usage.prompt_tokens) c += (usage.prompt_tokens / 1_000_000) * promptPrice;
    if (completionPrice && usage.completion_tokens)
      c += (usage.completion_tokens / 1_000_000) * completionPrice;
    if (imagePrice && usage.images) c += usage.images * imagePrice;
    cost = c > 0 ? c : null;
  }

  return { images, text: message?.content ?? undefined, cost };
}
