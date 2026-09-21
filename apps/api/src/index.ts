import "dotenv/config";
import express from "express";
import cors from "cors";
import type { GenerateRequest, GenerateResponse, GeneratedImage } from "@imaginate/shared";
import { listImageModels, generateImage, generateImageStream } from "./openrouter.js";
import { listFalImageModels, generateFalImage } from "./fal.js";
import {
  avgOutputTokensByModel,
  cancelGeneration,
  completeGeneration,
  createGeneration,
  failGeneration,
  getHistoryDetail,
  listHistory,
} from "./db.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const message = (err: unknown) => (err instanceof Error ? err.message : "Unexpected error");

const describeError = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" && err ? err : "Unexpected error";

type RequestLike = {
  method: string;
  originalUrl: string;
  body?: { model?: unknown; n?: unknown; provider?: unknown };
};
const startedAtByReq = new WeakMap<object, number>();
const now = () => new Date().toISOString();

const reqSummary = (req: RequestLike) => {
  const parts: string[] = [];
  if (typeof req.body?.model === "string") parts.push(`model=${req.body.model}`);
  if (typeof req.body?.n === "number") parts.push(`n=${req.body.n}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
};

const logRequestStart = (req: RequestLike) => {
  startedAtByReq.set(req, Date.now());
  console.log(`[api] ${now()} -> ${req.method} ${req.originalUrl}${reqSummary(req)}`);
};
const logRequestEnd = (req: RequestLike, status: number) => {
  const durationMs = Date.now() - (startedAtByReq.get(req) ?? Date.now());
  const mark = status >= 400 ? "!" : "+";
  console.log(
    `[api] ${now()} ${mark} ${req.method} ${req.originalUrl}${reqSummary(req)} ${status} ${durationMs}ms`,
  );
};
const logRequestError = (req: RequestLike, err: unknown) => {
  console.log(
    `[api] ${now()} ! ${req.method} ${req.originalUrl}${reqSummary(req)} ${describeError(err)}`,
  );
};

app.use((req, res, next) => {
  logRequestStart(req);
  res.on("finish", () => logRequestEnd(req, res.statusCode));
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasFalKey: Boolean(process.env.FAL_API_KEY),
  });
});

app.get("/api/models", async (req, res) => {
  try {
    const [openrouterModels, falModels] = await Promise.all([
      listImageModels(),
      listFalImageModels().catch(() => []),
    ]);
    const seen = new Set<string>();
    const models = [...openrouterModels, ...falModels].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    const avgTokens = avgOutputTokensByModel();
    for (const m of models) m.avgOutputTokens = avgTokens[m.id] ?? null;
    res.json({ models });
  } catch (err) {
    logRequestError(req, err);
    res.status(500).json({ error: message(err) });
  }
});

function pickGenerateFields(body: GenerateRequest) {
  return {
    model: body?.model,
    prompt: body?.prompt,
    images: Array.isArray(body?.images) ? body.images : [],
    aspectRatio: body?.aspectRatio,
    resolution: body?.resolution,
    size: body?.size,
    quality: body?.quality,
    outputFormat: body?.outputFormat,
    background: body?.background,
    outputCompression: body?.outputCompression,
    n: body?.n,
    seed: body?.seed,
    provider: body?.provider,
  };
}

const isFalModel = (model: string) => model.startsWith("fal/");

async function runGeneration(
  body: GenerateRequest,
  signal: AbortSignal,
): Promise<{ images: GeneratedImage[]; cost: number | null; completionTokens: number | null }> {
  const { images, ...rest } = pickGenerateFields(body);
  const input = { ...rest, images, prompt: body.prompt, model: body.model };
  return isFalModel(body.model) ? generateFalImage(input, signal) : generateImage(input, signal);
}

app.post("/api/generate", async (req, res) => {
  const body = req.body as GenerateRequest;
  if (!body?.model || typeof body.model !== "string") {
    return res.status(400).json({ error: "A model is required." });
  }
  if (!body?.prompt || !body.prompt.trim()) {
    return res.status(400).json({ error: "A prompt is required." });
  }

  const { images } = pickGenerateFields(body);
  const id = createGeneration({
    model: body.model,
    prompt: body.prompt,
    inputImageCount: images.length,
  });
  const startedAt = Date.now();

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const result = await runGeneration(body, abort.signal);
    const durationMs = Date.now() - startedAt;
    completeGeneration(id, { ...result, durationMs });

    const payload: GenerateResponse = {
      id,
      model: body.model,
      prompt: body.prompt,
      images: result.images,
      createdAt: new Date().toISOString(),
      durationMs,
      cost: result.cost,
      completionTokens: result.completionTokens,
    };
    res.json(payload);
  } catch (err) {
    logRequestError(req, err);
    if (abort.signal.aborted) {
      cancelGeneration(id, Date.now() - startedAt);
      return;
    }
    failGeneration(id, message(err), Date.now() - startedAt);
    res.status(502).json({ error: message(err) });
  }
});

app.post("/api/generate/stream", async (req, res) => {
  const body = req.body as GenerateRequest;
  if (!body?.model || typeof body.model !== "string") {
    return res.status(400).json({ error: "A model is required." });
  }
  if (!body?.prompt || !body.prompt.trim()) {
    return res.status(400).json({ error: "A prompt is required." });
  }

  const { images, ...rest } = pickGenerateFields(body);
  const id = createGeneration({
    model: body.model,
    prompt: body.prompt,
    inputImageCount: images.length,
  });
  const startedAt = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const send = (event: string, data: object) => {
    res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
  };

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const models = await listImageModels();
    const model = models.find((m) => m.id === body.model);
    const supportsStreaming = model?.supportsStreaming ?? false;

    if (!supportsStreaming || images.length > 0) {
      const result = await runGeneration(body, abort.signal);
      const durationMs = Date.now() - startedAt;
      completeGeneration(id, { ...result, durationMs });
      send("done", {
        result: {
          id,
          model: body.model,
          prompt: body.prompt,
          images: result.images,
          createdAt: new Date().toISOString(),
          durationMs,
          cost: result.cost,
          completionTokens: result.completionTokens,
        },
      });
      res.end();
      return;
    }

    for await (const event of generateImageStream(
      { ...rest, images, prompt: body.prompt, model: body.model },
      { id, model: body.model, prompt: body.prompt },
      abort.signal,
    )) {
      if (event.type === "partial_image") {
        send("partial_image", { image: event.image, index: event.index });
      } else if (event.type === "error") {
        logRequestError(req, event.message);
        failGeneration(id, event.message, Date.now() - startedAt);
        send("error", { message: event.message });
        res.end();
        return;
      } else if (event.type === "done") {
        const result = event.result;
        completeGeneration(id, {
          images: result.images,
          durationMs: result.durationMs,
          cost: result.cost,
          completionTokens: result.completionTokens,
        });
        send("done", { result });
        res.end();
        return;
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      logRequestError(req, "Client disconnected");
      cancelGeneration(id, Date.now() - startedAt);
    } else {
      logRequestError(req, err);
      failGeneration(id, message(err), Date.now() - startedAt);
      send("error", { message: message(err) });
      res.end();
    }
  }
});

app.get("/api/history", (_req, res) => {
  res.json({ items: listHistory() });
});

app.get("/api/history/:id", (req, res) => {
  const detail = getHistoryDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: "Not found" });
  res.json(detail);
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
