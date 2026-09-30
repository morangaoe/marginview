import { useState } from "react";
import { request } from "../lib/useApi";
import "../styles/extra-pages.css";

export default function Contact() {
  const [f, setF] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email) || !f.message.trim()) {
      setStatus("error"); setErr("Enter your name, a valid email and a message."); return;
    }
    setStatus("sending"); setErr(null);
    try { await request("/contact", { method: "POST", body: JSON.stringify(f) }); setStatus("sent"); }
    catch (e) { setStatus("error"); setErr((e as Error).message); }
  }

  if (status === "sent") return <div className="mv-page"><h1>Message sent</h1><p className="mv-sub">Thanks. We'll reply to {f.email}.</p></div>;

  return (
    <div className="mv-page" style={{ maxWidth: 640 }}>
      <h1>Contact us</h1>
      <p className="mv-sub">Questions about Marginview, pricing plans or your data? Send us a note.</p>
      <div className="mv-field"><label htmlFor="c-name">Name</label><input id="c-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="mv-field" style={{ marginTop: 12 }}><label htmlFor="c-email">Email</label><input id="c-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="mv-field" style={{ marginTop: 12 }}><label htmlFor="c-msg">Message</label><textarea id="c-msg" rows={6} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      {err && <p className="mv-error" role="alert">{err}</p>}
      <p><button className="mv-btn" onClick={submit} disabled={status === "sending"}>Send message</button></p>
    </div>
  );
}
