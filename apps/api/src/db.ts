import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GeneratedImage, HistoryDetail, HistoryItem, GenerationStatus } from "@imaginate/shared";

const file = process.env.DATABASE_FILE
  ? resolve(process.env.DATABASE_FILE)
  : resolve(process.cwd(), "data/history.db");

mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    input_image_count INTEGER NOT NULL DEFAULT 0,
    output_image_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    text TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generation_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    data_url TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_images_generation ON generation_images(generation_id);
`);

const hasColumn = (table: string, col: string): boolean =>
  db.prepare(`SELECT * FROM pragma_table_info(?)`).all(table).some(
    (c) => (c as Row).name === col,
  );

if (!hasColumn("generations", "cost_usd")) {
  db.exec(`ALTER TABLE generations ADD COLUMN cost_usd REAL`);
}

if (!hasColumn("generations", "completion_tokens")) {
  db.exec(`ALTER TABLE generations ADD COLUMN completion_tokens INTEGER`);
}

type Row = Record<string, unknown>;

function toItem(row: Row): HistoryItem {
  return {
    id: Number(row.id),
    model: String(row.model),
    prompt: String(row.prompt),
    status: String(row.status) as GenerationStatus,
    error: (row.error as string | null) ?? null,
    inputImageCount: Number(row.input_image_count),
    outputImageCount: Number(row.output_image_count),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: String(row.created_at),
    cost: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    completionTokens:
      row.completion_tokens === null || row.completion_tokens === undefined
        ? null
        : Number(row.completion_tokens),
  };
}

export function createGeneration(input: {
  model: string;
  prompt: string;
  inputImageCount: number;
}): number {
  const stmt = db.prepare(
    `INSERT INTO generations (model, prompt, status, input_image_count, created_at)
     VALUES (?, ?, 'pending', ?, ?)`,
  );
  const result = stmt.run(
    input.model,
    input.prompt,
    input.inputImageCount,
    new Date().toISOString(),
  );
  return Number(result.lastInsertRowid);
}

export function completeGeneration(
  id: number,
  data: {
    images: GeneratedImage[];
    text?: string;
    durationMs: number;
    cost?: number | null;
    completionTokens?: number | null;
  },
): void {
  db.prepare(
    `UPDATE generations
     SET status = 'success', output_image_count = ?, duration_ms = ?, text = ?, cost_usd = ?, completion_tokens = ?
     WHERE id = ?`,
  ).run(
    data.images.length,
    data.durationMs,
    data.text ?? null,
    data.cost ?? null,
    data.completionTokens ?? null,
    id,
  );

  const insert = db.prepare(
    `INSERT INTO generation_images (generation_id, data_url) VALUES (?, ?)`,
  );
  for (const image of data.images) insert.run(id, image.dataUrl);
}

export function cancelGeneration(id: number, durationMs: number): void {
  db.prepare(`UPDATE generations SET status = 'cancelled', duration_ms = ? WHERE id = ?`).run(
    durationMs,
    id,
  );
}

export function failGeneration(id: number, error: string, durationMs: number): void {
  db.prepare(`UPDATE generations SET status = 'error', error = ?, duration_ms = ? WHERE id = ?`).run(
    error,
    durationMs,
    id,
  );
}

export function listHistory(limit = 50): HistoryItem[] {
  return db
    .prepare(`SELECT * FROM generations ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map((row) => toItem(row as Row));
}

export function getHistoryDetail(id: number): HistoryDetail | null {
  const row = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  const images = db
    .prepare(`SELECT data_url FROM generation_images WHERE generation_id = ? ORDER BY id`)
    .all(id)
    .map((r) => ({ dataUrl: String((r as Row).data_url) }));
  return { ...toItem(row), text: (row.text as string | null) ?? null, images };
}

/** Average measured output tokens per image per model, from successful generations. */
export function avgOutputTokensByModel(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT model, AVG(completion_tokens / output_image_count) AS avg_tokens
       FROM generations
       WHERE status = 'success' AND completion_tokens IS NOT NULL AND output_image_count > 0
       GROUP BY model`,
    )
    .all() as Row[];
  const result: Record<string, number> = {};
  for (const row of rows) {
    const tokens = Number(row.avg_tokens);
    if (Number.isFinite(tokens) && tokens > 0) result[String(row.model)] = Math.round(tokens);
  }
  return result;
}
