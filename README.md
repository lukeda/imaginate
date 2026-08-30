# Imaginate

Local-first UI for generating images through OpenRouter and fal.ai.

## Stack

- Node 24, pnpm workspaces, Turbo
- `apps/web` — React + Vite + react-router-dom + Mantine 9
- `apps/api` — Express + `node:sqlite` history
- `packages/shared` — shared TypeScript types (built in watch mode during dev)

## Setup

```bash
nvm use            # node 24
pnpm install
cp .env.example apps/api/.env   # add your OPENROUTER_API_KEY and optionally FAL_API_KEY
pnpm dev
```

`pnpm dev` starts the shared types watcher, the Express API on
`http://localhost:8787`, and the web app on `http://localhost:5173`
(the web dev server proxies `/api` to the Express server).

## Providers

- **OpenRouter** — image models discovered from `/images/models`; supports
  provider routing, per-provider pricing, and SSE streaming.
- **fal.ai** — image models discovered from fal's model catalog (requires
  `FAL_API_KEY`). Models are prefixed `fal/` (e.g. `fal/fal-ai/nano-banana-2`).
  Generations go through fal's queue API; results are downloaded and stored
  as base64 data URLs. Cost/token reporting is not available for fal.

## Endpoints

- `GET /api/models` — image-output models from OpenRouter and fal.ai (cached 5 min)
- `POST /api/generate` — `{ model, prompt, images[], ... }` → generated images
- `GET /api/history` — past generations
- `GET /api/history/:id` — one generation with its images
