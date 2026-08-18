export interface ImageModelProvider {
  /** Provider slug, e.g. "bytedance" */
  slug: string;
  /** Provider tag, usable to pin routing; null when provider routing is unavailable. */
  tag: string | null;
  name: string;
  /** Whether this endpoint supports native SSE streaming. */
  supportsStreaming: boolean;
  pricing: {
    billable: string;
    unit: string;
    costUsd: number;
    variant?: string;
  }[];
}

export interface ImageModel {
  id: string;
  name: string;
  description?: string;
  /** Max number of input images the model accepts, when known. */
  maxInputImages: number | null;
  supportsImageInput: boolean;
  /** Aspect ratios this model accepts; empty when unsupported. */
  aspectRatios: string[];
  /** Resolution tiers this model accepts, e.g. ["512","1K","2K","4K"]. */
  resolutions: string[];
  /** Quality levels this model accepts, e.g. ["auto","low","high"]. */
  qualities: string[];
  /** Output formats this model accepts, e.g. ["png","jpeg","webp","svg"]. */
  outputFormats: string[];
  /** Background options, e.g. ["auto","transparent","opaque"]. */
  backgrounds: string[];
  /** Max batch size accepted by `n` (0/1 = single image only). */
  maxN: number;
  /** Whether the model accepts a seed for deterministic generation. */
  supportsSeed: boolean;
  /** Whether any endpoint has an API-level output compression knob. */
  supportsOutputCompression: boolean;
  /** Whether any endpoint supports native SSE streaming. */
  supportsStreaming: boolean;
  /** Measured avg output tokens per image from recent generations, when known. */
  avgOutputTokens?: number | null;
  /** Legacy pricing map (chat-completions style). */
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
  /** Endpoint/provider records for routing. */
  providers: ImageModelProvider[];
}

export interface ModelsResponse {
  models: ImageModel[];
}

/** An image attached to a request, as a base64 data URL. */
export interface InputImage {
  name: string;
  dataUrl: string;
}

export interface ProviderRouting {
  /** Allow only these provider slugs. */
  only?: string[];
  /** Try providers in this order. */
  order?: string[];
  /** Exclude these provider slugs. */
  ignore?: string[];
  /** Sort eligible endpoints by price, throughput, or latency. */
  sort?: "price" | "throughput" | "latency";
  /** When false, stop after the primary provider instead of trying fallbacks. */
  allowFallbacks?: boolean;
  /** Provider-specific passthrough params keyed by provider slug. */
  options?: Record<string, Record<string, unknown>>;
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  /** Reference images for image-to-image generation. */
  images?: InputImage[];
  aspectRatio?: string;
  resolution?: string;
  /** Convenience shorthand — a tier or explicit pixels like "2048x2048". */
  size?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  outputCompression?: number;
  /** Upper bound on images to generate (1–10). */
  n?: number;
  seed?: number;
  provider?: ProviderRouting;
}

export interface GeneratedImage {
  /** base64 data URL */
  dataUrl: string;
  /** Image media type, when known (e.g. "image/png", "image/svg+xml"). */
  mediaType?: string;
}

export interface GenerateResponse {
  id: number;
  model: string;
  prompt: string;
  images: GeneratedImage[];
  text?: string;
  createdAt: string;
  durationMs: number;
  /** Estimated cost in USD, when pricing/usage was available. */
  cost?: number | null;
  /** Output tokens used, when the endpoint reported them. */
  completionTokens?: number | null;
}

/** Streaming event sent to the browser while generating. */
export type GenerateStreamEvent =
  | { type: "partial_image"; image: GeneratedImage; index: number }
  | { type: "done"; result: GenerateResponse }
  | { type: "error"; message: string };

export type GenerationStatus = "pending" | "success" | "error" | "cancelled";

export interface HistoryItem {
  id: number;
  model: string;
  prompt: string;
  status: GenerationStatus;
  error?: string | null;
  inputImageCount: number;
  outputImageCount: number;
  durationMs: number | null;
  createdAt: string;
  /** Estimated cost in USD, when pricing/usage was available. */
  cost?: number | null;
  /** Output tokens reported by the endpoint, when available. */
  completionTokens?: number | null;
}

export interface HistoryDetail extends HistoryItem {
  images: GeneratedImage[];
  text?: string | null;
}

export interface ApiError {
  error: string;
}