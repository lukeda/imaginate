import "dotenv/config";
import express from "express";
import cors from "cors";
import type { GenerateRequest, GenerateResponse } from "@imaginate/shared";
import { listImageModels, generateImage } from "./openrouter.js";
import {
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.OPENROUTER_API_KEY) });
});

app.get("/api/models", async (_req, res) => {
  try {
    res.json({ models: await listImageModels() });
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

app.post("/api/generate", async (req, res) => {
  const body = req.body as GenerateRequest;

  if (!body?.model || typeof body.model !== "string") {
    return res.status(400).json({ error: "A model is required." });
  }
  if (!body?.prompt || !body.prompt.trim()) {
    return res.status(400).json({ error: "A prompt is required." });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  const id = createGeneration({
    model: body.model,
    prompt: body.prompt,
    inputImageCount: images.length,
  });
  const startedAt = Date.now();

  try {
    const result = await generateImage({
      model: body.model,
      prompt: body.prompt,
      images,
      temperature: body.temperature,
      seed: body.seed,
      systemPrompt: body.systemPrompt,
    });
    const durationMs = Date.now() - startedAt;
    completeGeneration(id, { ...result, durationMs });

    const payload: GenerateResponse = {
      id,
      model: body.model,
      prompt: body.prompt,
      images: result.images,
      text: result.text,
      createdAt: new Date().toISOString(),
      durationMs,
      cost: result.cost,
    };
    res.json(payload);
  } catch (err) {
    failGeneration(id, message(err), Date.now() - startedAt);
    res.status(502).json({ error: message(err) });
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
