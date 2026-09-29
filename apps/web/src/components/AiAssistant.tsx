import { useState } from "react";
import { api } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  source?: string;
}

/**
 * Persistent on every screen, per App Flow 3.4. Opening it never navigates
 * away from the current page; closing it returns the user to exactly
 * where they were, since it is an overlay, not a route.
 */
export function AiAssistant({ productVariantId }: { productVariantId?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ask me about this product's price, stock, or margin." },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function send() {
    if (!input.trim() || pending) return;
    const question = input;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setPending(true);
    try {
      const res = await api.post<{ conversationId: string; answer: string; referencedRecords: any }>(
        "/assistant/ask",
        { question, productVariantId, conversationId }
      );
      setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, source: res.referencedRecords?.source },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Something went wrong reaching the assistant. Please try again." },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        aria-label="Ask Marginview"
        className="btn primary"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 52,
          height: 52,
          borderRadius: "50%",
          fontSize: 20,
          zIndex: 50,
        }}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "fixed",
            bottom: 80,
            right: 20,
            width: 320,
            maxHeight: "60vh",
            display: "flex",
            flexDirection: "column",
            zIndex: 50,
            padding: 0,
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 600,
            }}
          >
            Ask Marginview
            <button aria-label="Close" className="btn" style={{ border: "none" }} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 14, fontSize: 13 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 10, textAlign: m.role === "user" ? "right" : "left" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: m.role === "user" ? "var(--accent)" : "var(--paper)",
                    color: m.role === "user" ? "#fff" : "var(--ink)",
                    maxWidth: "85%",
                  }}
                >
                  {m.content}
                </span>
                {m.source && (
                  <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>Source: {m.source}</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", borderTop: "1px solid var(--hairline)" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="e.g. why is this out of stock?"
              style={{ flex: 1, border: "none", padding: 10, fontSize: 13, background: "transparent" }}
            />
            <button className="btn" style={{ border: "none", color: "var(--accent)", fontWeight: 600 }} onClick={send} disabled={pending}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
