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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
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
