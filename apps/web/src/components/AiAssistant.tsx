import { useEffect, useRef, useState } from "react";
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
    { role: "assistant", content: "Hi. I can answer using your products, stock, prices, margins, and competitor snapshots. What would you like to check?" },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open, pending]);

  function newChat() {
    setConversationId(undefined);
    setMessages([
      { role: "assistant", content: "New chat. Ask about your product catalog, stock, pricing, margins, or tracked competitors." },
    ]);
    setInput("");
    setError(null);
  }

  async function send(question = input) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || pending) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content: cleanQuestion }]);
    setInput("");
    setPending(true);
    try {
      const res = await api.post<{ conversationId: string; answer: string; referencedRecords: any }>(
        "/assistant/ask",
        { question: cleanQuestion, productVariantId, conversationId },
      );
      setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, source: res.referencedRecords?.source },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the assistant. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        aria-label="Ask Marginview"
        aria-expanded={open}
        className="mv-assistant-launcher"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
        <span>{open ? "Close assistant" : "Ask Marginview"}</span>
      </button>

      {open && (
        <section className="mv-assistant-panel" aria-label="Ask Marginview assistant">
          <header className="mv-assistant-header">
            <div className="mv-assistant-heading">
              <span className="mv-assistant-mark material-symbols-rounded" aria-hidden="true">auto_awesome</span>
              <div>
                <strong>Ask Marginview</strong>
                <div className="mv-assistant-caption">Answers from your workspace data</div>
              </div>
            </div>
            <div className="mv-assistant-tools">
              <button type="button" aria-label="Start a new chat" title="New chat" onClick={newChat}>
                <span className="material-symbols-rounded" aria-hidden="true">add_comment</span>
              </button>
              <button type="button" aria-label="Close assistant" title="Close" onClick={() => setOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
          </header>

          <div className="mv-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
            {messages.map((m, i) => (
              <div key={i} className={`mv-assistant-message ${m.role}`}>
                {m.role === "assistant" && <span className="mv-assistant-avatar material-symbols-rounded" aria-hidden="true">auto_awesome</span>}
                <div className="mv-assistant-bubble-wrap">
                  <div className="mv-assistant-bubble">{m.content}</div>
                  {m.source && <div className="mv-assistant-source">Based on {m.source}</div>}
                </div>
              </div>
            ))}

            {messages.length === 1 && !pending && (
              <div className="mv-assistant-suggestions" aria-label="Suggested questions">
                <span>Try asking</span>
                {[
                  "Summarize my inventory",
                  "Which products need reordering?",
                  "Show my low-stock items",
                  "How is my catalog priced?",
                ].map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {pending && (
              <div className="mv-assistant-message assistant" role="status">
                <span className="mv-assistant-avatar material-symbols-rounded" aria-hidden="true">auto_awesome</span>
                <div className="mv-assistant-bubble mv-assistant-thinking">Checking your workspace…</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="mv-assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Ask a question about your store"
              placeholder="Ask about a product, stock, or margin…"
              disabled={pending}
            />
            <button type="submit" aria-label="Send question" title="Send" disabled={pending || !input.trim()}>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_upward</span>
            </button>
          </form>
          <div className="mv-assistant-footnote">
            {error ? <span role="alert">{error}</span> : "Uses your current catalog and saved price checks"}
          </div>
        </section>
      )}
    </>
  );
}
