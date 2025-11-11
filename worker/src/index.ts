import type { Ai } from "@cloudflare/workers-types";

const SYSTEM_PROMPT = `You are Johann Sebastian Bach helping modern music students prepare for theory and history exams.
Respond with the warmth of a mentor, sprinkle in short Baroque metaphors, and emphasize how concepts connect to real compositions.
Keep answers focused, cite relevant works when possible, and suggest short exercises students can try at the keyboard.`;

const MODEL_NAME = "@cf/meta/llama-3.1-8b-instruct";
const HISTORY_LIMIT = 12;

interface Env {
  AI: Ai;
  CHAT_MEMORY: DurableObjectNamespace;
  MOCK_AI?: string;
}

type ChatRole = "user" | "assistant";

type StoredMessage = {
  role: ChatRole;
  content: string;
  timestamp: number;
};

interface ChatRequestBody {
  message?: string;
  topic?: string;
}

function createCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Session-ID");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return headers;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function buildSessionCookie(id: string, url: URL): string {
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toUTCString();
  const parts = [
    `bach_session=${encodeURIComponent(id)}`,
    "Path=/",
    "SameSite=Lax",
    `Expires=${expires}`,
  ];

  if (url.protocol === "https:") {
    parts.push("Secure");
  }

  return `${parts.join("; ")}`;
}

function getSessionIdentifier(request: Request, url: URL) {
  const headerValue = request.headers.get("X-Session-ID");
  if (headerValue) {
    return { id: headerValue, shouldSetCookie: false };
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const cookieValue = cookies["bach_session"];
  if (cookieValue) {
    return { id: cookieValue, shouldSetCookie: false };
  }

  return { id: crypto.randomUUID(), shouldSetCookie: true };
}

function extractAiText(result: unknown): string {
  if (!result) return "";
  if (typeof result === "string") return result;

  const tryRead = (obj: any): string | undefined => {
    if (!obj) return undefined;
    if (typeof obj === "string") return obj;
    if (Array.isArray(obj)) {
      for (const entry of obj) {
        const value = tryRead(entry);
        if (value) return value;
      }
      return undefined;
    }

    if (typeof obj === "object") {
      if (obj.text && typeof obj.text === "string") return obj.text;
      if (obj.content && Array.isArray(obj.content)) {
        const text = obj.content
          .map((piece: any) => piece.text ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      if (obj.response) return tryRead(obj.response);
      if (obj.output) return tryRead(obj.output);
      if (obj.result) return tryRead(obj.result);
      if (obj.results) return tryRead(obj.results);
    }

    return undefined;
  };

  return tryRead(result) ?? "I am momentarily lost in counterpoint. Please try again.";
}

function errorResponse(request: Request, message: string, status = 400) {
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

async function handleOptions(request: Request): Promise<Response> {
  const headers = createCorsHeaders(request);
  return new Response(null, { status: 204, headers });
}

async function readBody(request: Request): Promise<ChatRequestBody> {
  try {
    return (await request.json()) as ChatRequestBody;
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env, url);
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      return handleHistory(request, env, url);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readBody(request);
  if (!body.message || !body.message.trim()) {
    return errorResponse(request, "Please include a message.");
  }

  const session = getSessionIdentifier(request, url);
  const sessionId = session.id;
  const stub = env.CHAT_MEMORY.get(env.CHAT_MEMORY.idFromName(sessionId));

  const resp = await stub.fetch("https://memory/chat", {
    method: "POST",
    body: JSON.stringify({ message: body.message, topic: body.topic ?? null }),
  });

  const payload = await resp.json<unknown>();
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");
  if (session.shouldSetCookie) {
    headers.append("Set-Cookie", buildSessionCookie(sessionId, url));
  }

  return new Response(JSON.stringify(payload), {
    status: resp.status,
    headers,
  });
}

async function handleHistory(request: Request, env: Env, url: URL): Promise<Response> {
  const session = getSessionIdentifier(request, url);
  const sessionId = session.id;
  const stub = env.CHAT_MEMORY.get(env.CHAT_MEMORY.idFromName(sessionId));

  const resp = await stub.fetch("https://memory/chat", { method: "GET" });
  const payload = await resp.json<unknown>();
  const headers = createCorsHeaders(request);
  headers.set("Content-Type", "application/json");

  if (session.shouldSetCookie) {
    headers.append("Set-Cookie", buildSessionCookie(sessionId, url));
  }

  return new Response(JSON.stringify(payload), {
    status: resp.status,
    headers,
  });
}

export class ConversationMemory {
  #state: DurableObjectState;
  #env: Env;
  #history: StoredMessage[] = [];
  #init: Promise<void>;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
    this.#init = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<StoredMessage[]>("history");
      this.#history = stored ?? [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.#init;

    if (request.method === "GET") {
      return Response.json({ history: this.#history });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { message, topic } = (await request.json()) as ChatRequestBody;
    if (!message) {
      return Response.json({ error: "Missing message" }, { status: 400 });
    }

    const trimmedHistory = this.#history.slice(-(HISTORY_LIMIT - 2));
    const topicLine = topic ? `The student is currently studying ${topic}.` : "";
    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n${topicLine}`.trim() },
      ...trimmedHistory.map(({ role, content }) => ({ role, content })),
      { role: "user", content: message },
    ];

    const mockEnabled = (this.#env.MOCK_AI ?? "").toLowerCase() === "true";

    let reply: string;
    if (mockEnabled) {
      reply = buildMockReply(message, topic);
    } else {
      try {
        const aiResult = await this.#env.AI.run(MODEL_NAME, {
          messages,
          temperature: 0.35,
          max_tokens: 512,
        });
        reply = extractAiText(aiResult).trim();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        console.error("Workers AI call failed", details);
        return Response.json(
          {
            error:
              "Workers AI failed to generate a response. If you are running locally, start the worker with `wrangler dev --remote` so the AI binding is available, or set MOCK_AI=true in .dev.vars for an offline mock.",
            details,
          },
          { status: 502 }
        );
      }
    }

    const now = Date.now();
    const updatedHistory: StoredMessage[] = [
      ...trimmedHistory,
      { role: "user", content: message, timestamp: now },
      { role: "assistant", content: reply, timestamp: now },
    ].slice(-HISTORY_LIMIT);

    this.#history = updatedHistory;
    await this.#state.storage.put("history", this.#history);

    return Response.json({
      reply,
      history: this.#history,
    });
  }
}

function buildMockReply(question: string, topic?: string | null) {
  const focus = topic ? ` while focusing on ${topic}` : "";
  return [
    "🎻 *Mock Bach Reply*",
    `You asked${focus}: \"${question}\"`,
    "Imagine I referenced a related invention, pointed you to a chorale, and gave you two short keyboard drills.",
    "Enable Workers AI (or deploy) to hear the full Baroque treatment.",
  ].join("\n\n");
}
