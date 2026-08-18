export interface ImageModel {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  /** Max number of input images the model accepts, when known. */
  maxInputImages: number | null;
  supportsImageInput: boolean;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
}

export interface ModelsResponse {
  models: ImageModel[];
}

/** An image attached to a request, as a base64 data URL. */
export interface InputImage {
  name: string;
  dataUrl: string;
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  images?: InputImage[];
  /** Optional extra generation controls the model may support. */
  temperature?: number;
  seed?: number;
  systemPrompt?: string;
}

export interface GeneratedImage {
  /** base64 data URL */
  dataUrl: string;
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
}

export type GenerationStatus = "pending" | "success" | "error";

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
}

export interface HistoryDetail extends HistoryItem {
  images: GeneratedImage[];
  text?: string | null;
}

export interface ApiError {
  error: string;
}
