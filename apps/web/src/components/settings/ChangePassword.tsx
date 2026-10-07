import { CSSProperties, FormEvent, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

/** Changing the password signs out every other session; this one gets a fresh token. */
export default function ChangePassword() {
  const { me, login } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMsg({ ok: false, text: "The new passwords don't match." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const { token } = await api.post<{ token: string }>("/auth/change-password", { currentPassword: current, newPassword: next });
      login(token);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <strong style={{ display: "block", marginBottom: 4 }}>Your account</strong>
      {me && (
        <p style={{ color: "var(--slate)", fontSize: 12, margin: "0 0 16px" }}>
          {me.fullName} · {me.email} · {me.organizationName}
        </p>
      )}
      {msg && (
        <div style={{ ...noticeStyle, ...(msg.ok ? okStyle : errStyle) }}>{msg.text}</div>
      )}
      <form onSubmit={submit}>
        <label style={labelStyle}>
          Current password
          <input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          New password
          <input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Confirm new password
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" className="btn primary" disabled={saving} style={{ fontSize: 13 }}>
          {saving ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}

const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 14 };
const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 5,
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  fontWeight: 400,
  background: "var(--paper)",
  color: "var(--ink)",
  boxSizing: "border-box",
};
const noticeStyle: CSSProperties = { borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 16, border: "1px solid" };
const okStyle: CSSProperties = { background: "#EAF3EC", color: "var(--success)", borderColor: "var(--success)" };
const errStyle: CSSProperties = { background: "#FBEAE7", color: "var(--critical)", borderColor: "var(--critical)" };
