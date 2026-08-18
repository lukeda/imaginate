import type {
  GenerateRequest,
  GenerateResponse,
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

export const api = {
  models: () => request<ModelsResponse>("/api/models"),
  generate: (payload: GenerateRequest, signal?: AbortSignal) =>
    request<GenerateResponse>("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    }),
  history: () => request<{ items: HistoryItem[] }>("/api/history"),
  historyDetail: (id: number) => request<HistoryDetail>(`/api/history/${id}`),
};
