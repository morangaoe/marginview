import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  source?: string;
}

/** Minimal, safe markdown: **bold**, `code`, and -/* / 1. lists. No HTML is ever injected. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length} style={{ margin: "4px 0", paddingLeft: 20 }}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const bullet = raw.match(/^\s*[-*•]\s+(.*)/);
    const number = raw.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet || number) {
      const ordered = !!number;
      if (list && list.ordered !== ordered) flush();
      list = list ?? { ordered, items: [] };
      list.items.push((bullet ?? number)![1]);
    } else {
      flush();
      if (raw.trim()) blocks.push(<p key={blocks.length} style={{ margin: "4px 0" }}>{inline(raw.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

/**
 * Persistent on every screen, per App Flow 3.4. Opening it never navigates
 * away from the current page; closing it returns the user to exactly
 * where they were, since it is an overlay, not a route.
 */
export function AiAssistant({ productVariantId }: { productVariantId?: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi, I'm the Marginview assistant. Ask me about your products, stock, prices and margins, how to do something in the app, what a result or term means, or anything else you're wondering." },
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
      { role: "assistant", content: "New chat. What can I help with?" },
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
        { question: cleanQuestion, productVariantId, conversationId, page: pathname },
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
                <div className="mv-assistant-caption">Your data, how-to help, and general questions</div>
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
                  <div className="mv-assistant-bubble">{m.role === "assistant" ? <RichText text={m.content} /> : m.content}</div>
                  {m.source && <div className="mv-assistant-source">Based on {m.source}</div>}
                </div>
              </div>
            ))}

            {messages.length === 1 && !pending && (
              <div className="mv-assistant-suggestions" aria-label="Suggested questions">
                <span>Try asking</span>
                {[
                  "How do I set a price for a product?",
                  "What's the difference between margin and markup?",
                  "Which products need reordering?",
                  "What does an out_of_band price mean?",
                  "What can I do on this page?",
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
              placeholder="Ask anything about your data or the app…"
              disabled={pending}
            />
            <button type="submit" aria-label="Send question" title="Send" disabled={pending || !input.trim()}>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_upward</span>
            </button>
          </form>
          <div className="mv-assistant-footnote">
            {error ? <span role="alert">{error}</span> : "Uses your catalog, saved price checks and the Marginview guide. Check important numbers before acting."}
          </div>
        </section>
      )}
    </>
  );
}
