import type {
  GenerateRequest,
  GenerateResponse,
  GenerateStreamEvent,
  GeneratedImage,
  HistoryDetail,
  HistoryItem,
  ModelsResponse,
} from "@imaginate/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function parseSse(event: string): Record<string, unknown> {
  const json = event.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("Malformed stream event");
  return JSON.parse(json[0]);
}

/** Streams a generation; yields partial images and finally the full result. */
async function* generateStream(payload: GenerateRequest, signal?: AbortSignal): AsyncGenerator<GenerateStreamEvent> {
  const res = await fetch("/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const parsed = parseSse(line);
      const type = parsed.type;
      if (type === "partial_image") {
        const image = parsed.image as GeneratedImage;
        yield { type: "partial_image", image, index: parsed.index as number };
      } else if (type === "done") {
        yield { type: "done", result: parsed.result as GenerateResponse };
      } else if (type === "error") {
        throw new Error(String(parsed.message ?? "Generation failed"));
      }
    }
  }
}

export const api = {
  models: () => request<ModelsResponse>("/api/models"),
  generate: (payload: GenerateRequest, signal?: AbortSignal) =>
    request<GenerateResponse>("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    }),
  generateStream,
  history: () => request<{ items: HistoryItem[] }>("/api/history"),
  historyDetail: (id: number) => request<HistoryDetail>(`/api/history/${id}`),
};