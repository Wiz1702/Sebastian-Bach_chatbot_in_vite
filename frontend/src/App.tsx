import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "./lib/api";
import { fetchHistory, sendMessage } from "./lib/api";

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState("Counterpoint");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory()
      .then((result) => {
        setMessages(result.history ?? []);
      })
      .catch((err) => {
        console.error(err);
      });
  }, []);

  const composerTip = useMemo(() => {
    if (!topic) {
      return "State a focus topic to nudge Bach toward the material you are reviewing.";
    }
    return `Bach remembers you are studying ${topic}. Ask how it appears in his cantatas or chorales.`;
  }, [topic]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    const optimistic: ChatMessage = {
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const response = await sendMessage(input.trim(), topic.trim() || undefined);
      setMessages(response.history);
      setInput("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setMessages((prev) => prev.filter((msg) => msg !== optimistic));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="header">
        <div className="header__avatar">JB</div>
        <div className="header__titles">
          <h1>Sabastian Bach Study Companion</h1>
          <p>Ask theory, analysis, or history questions and get Baroque-flavored coaching.</p>
        </div>
      </header>

      <form className="topic-input" onSubmit={(event) => event.preventDefault()}>
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Exam focus: e.g., Secondary dominants, Well-Tempered Clavier"
        />
        <button type="button" disabled>
          Memory on
        </button>
      </form>

      <div className="composer-tip">{composerTip}</div>

      <section className="chat-window">
        {messages.length === 0 && (
          <p>
            No conversation yet. Ask Bach how to voice-lead a cadential 6/4 or review the inventions for
            inspiration.
          </p>
        )}

        {messages.map((message) => (
          <article key={`${message.timestamp}-${message.role}-${message.content.slice(0, 8)}`} className={`message ${message.role}`}>
            <div>{message.content}</div>
            <small>{message.role === "user" ? "You" : "Bach"} · {formatTimestamp(message.timestamp)}</small>
          </article>
        ))}
      </section>

      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          value={input}
          placeholder="Ask about counterpoint rules, exam drills, or a Bach piece."
          onChange={(event) => setInput(event.target.value)}
        />
        {error && <span style={{ color: "#f88080" }}>{error}</span>}
        <button type="submit" disabled={loading}>
          {loading ? "Composing..." : "Send"}
        </button>
      </form>
    </div>
  );
}
