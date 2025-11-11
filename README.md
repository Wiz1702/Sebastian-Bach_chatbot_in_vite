# Sebastian Bach Chatbot

An AI-powered study companion that emulates Johann Sebastian Bach to coach music students through theory and history exam prep. The stack demonstrates the components requested in the assignment:

- **Workers AI (LLM)** – Llama 3.3 Instruct generates Bach's responses.
- **Workflow & coordination** – A Cloudflare Worker orchestrates requests and a Durable Object keeps per-session transcripts.
- **User input** – A Vite (React) front-end offers a chat interface with topic priming.
- **Memory / state** – Durable Object storage remembers the last messages for each session ID so Bach can reference earlier answers.

## Project structure

```
Sebastian-Bach_chatbot_in_vite/
├── package.json      # npm workspace root (frontend + worker)
├── frontend/          # Vite React UI
├── worker/            # Cloudflare Worker + Durable Object
└── wrangler.toml      # Worker configuration & bindings
```

## Prerequisites

- Node.js 18+
- npm (or pnpm/yarn)
- Cloudflare account with Workers + Workers AI enabled
- Wrangler CLI authenticated with `wrangler login`

## Local development

### 1. Install dependencies

```bash
cd worker && npm install
cd ../frontend && npm install
```

### 2. Run the Worker (port 8787 by default)

```bash
cd worker
# Run remotely so Workers AI is available
npx wrangler dev --remote
```

The Worker exposes `/api/chat` and `/api/history`, calls Workers AI, and keeps conversation state in the `ConversationMemory` Durable Object.

> Need to work completely offline? Copy `worker/.dev.vars.example` to `worker/.dev.vars`, keep `MOCK_AI=true`, and run `wrangler dev` (local or remote). The Worker will return clearly-labeled mock replies so you can test the UI without hitting Workers AI.

### 3. Run the Vite front-end (port 5173)

```bash
cd frontend
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:8787`, so chatting in the UI talks to the Worker automatically. Cookies keep a session ID so every browser tab keeps its own memory.

## Deployment

1. Deploy the Worker

   ```bash
   cd worker
   npx wrangler deploy
   ```

   Update `wrangler.toml` with your desired `name`/`routes` before deploying.

2. Build and deploy the front-end

   ```bash
   cd frontend
   npm run build
   ```

   Host the contents of `frontend/dist` with Cloudflare Pages (or any static host). Point the Pages project to the same domain as the Worker or configure an `API_BASE_URL` via `VITE_API_BASE_URL` if they live on different origins.

## Configuration notes

- Workers AI binding (`AI`) and Durable Object (`CHAT_MEMORY`) are declared in `wrangler.toml`. On the free plan, Durable Objects must use SQLite-backed storage, so the included migration uses `new_sqlite_classes` for `ConversationMemory`.
- The Worker defaults to `@cf/meta/llama-3.1-8b-instruct`. Run `npx wrangler ai models` to see which models are enabled for your account and, if needed, update `MODEL_NAME` in `worker/src/index.ts`.
- The Worker trims history to the most recent 12 turns to stay inside token limits. The stored transcript includes timestamps so the React UI can display message times.
- The `topic` field in the UI nudges Bach toward whatever the student is reviewing; it is passed through the Worker into the system prompt each time.
- CI environments that call `npx wrangler` from the repo root are supported via the lightweight `wrangler-proxy` dev dependency (aliased as `wrangler`), which forwards to the Worker workspace's Wrangler installation.

### Troubleshooting Workers AI access

1. Run `npx wrangler whoami` to ensure you are logged into the Cloudflare account that has Workers AI enabled.
2. Verify your account has access by running `npx wrangler ai models`. If this fails (or the command is unavailable), request Workers AI access in the Cloudflare dashboard (Workers → AI).
3. Always start the dev server with `wrangler dev --remote` so the AI binding resolves against Cloudflare's edge environment.
4. When the binding is missing or misconfigured, the API responds with HTTP 502 and an explanatory `details` field. Use `MOCK_AI=true` only for UI development; switch it off again before deploying.

## Next ideas

1. Add authentication or named study rooms per class.
2. Persist long-term transcripts in KV/R2 for sharing with teachers.
3. Enrich answers with sheet-music snippets by calling an additional API.
