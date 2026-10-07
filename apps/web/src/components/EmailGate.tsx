import { useState } from "react";
import { captureLead } from "../lib/lead";

export function EmailGate({ source, title, body, onUnlocked }: {
  source: "market_search" | "audit"; title: string; body: string; onUnlocked: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await captureLead(email, source); onUnlocked(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ display: "grid", gap: 10, background: "var(--card)" }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--slate)", fontSize: 13 }}>{body}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
          aria-label="Email address" autoComplete="email" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn primary" disabled={busy}>{busy ? "Unlocking…" : "Unlock"}</button>
      </div>
      {error && <div role="alert" style={{ color: "var(--critical)", fontSize: 13 }}>{error}</div>}
      <div style={{ color: "var(--slate)", fontSize: 12 }}>No spam. We'll email you about Marginview, and you can unsubscribe any time.</div>
    </form>
  );
}
