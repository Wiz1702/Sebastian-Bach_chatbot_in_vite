export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  reply: string;
  history: ChatMessage[];
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const SESSION_STORAGE_KEY = "bach-chat-session-id";
let cachedSessionId: string | null = null;

function ensureSessionId(): string | null {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") return null;

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    cachedSessionId = existing;
    return existing;
  }

  const generator = typeof crypto !== "undefined" && crypto.randomUUID ? () => crypto.randomUUID() : () => Math.random().toString(36).slice(2);
  const fresh = generator();
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  cachedSessionId = fresh;
  return fresh;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const sessionId = ensureSessionId();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
      ...(sessionId ? { "X-Session-ID": sessionId } : {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "Unexpected error");
  }

  return response.json() as Promise<T>;
}

export function fetchHistory() {
  return request<{ history: ChatMessage[] }>("/api/history", { method: "GET" });
}

export function sendMessage(message: string, topic?: string) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, topic }),
  });
}
