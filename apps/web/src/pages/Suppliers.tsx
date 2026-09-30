import { useState } from "react";
import { request, useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Supplier = { id: string; name: string; email: string; phone: string; leadTimeDays: number; currency: string };
const blank = { name: "", email: "", phone: "", leadTimeDays: 7, currency: "USD" };

export default function Suppliers() {
  const { data, error, loading, reload } = useApi<Supplier[]>("/suppliers");
  const [form, setForm] = useState<Omit<Supplier, "id">>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (k: keyof typeof blank, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return setFormError("Enter a supplier name.");
    setSaving(true);
    setFormError(null);
    try {
      await request(editingId ? `/suppliers/${editingId}` : "/suppliers", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      setForm(blank);
      setEditingId(null);
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Supplier) {
    if (!window.confirm(`Delete ${s.name}? Existing purchase orders keep their history.`)) return;
    try {
      await request(`/suppliers/${s.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  return (
    <div className="mv-page">
      <h1>Suppliers</h1>
      <p className="mv-sub">Who you buy from, and how long they take to deliver. Lead time feeds procurement suggestions.</p>

      <div className="mv-row">
        <div className="mv-field"><label htmlFor="s-name">Name</label>
          <input id="s-name" value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="mv-field"><label htmlFor="s-email">Email</label>
          <input id="s-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div className="mv-field"><label htmlFor="s-phone">Phone</label>
          <input id="s-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="mv-field"><label htmlFor="s-lead">Lead time (days)</label>
          <input id="s-lead" type="number" min={0} value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", Number(e.target.value))} /></div>
        <div className="mv-field"><label htmlFor="s-cur">Currency</label>
          <input id="s-cur" maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
        <button className="mv-btn" onClick={save} disabled={saving}>{editingId ? "Save changes" : "Add supplier"}</button>
        {editingId && <button className="mv-btn secondary" onClick={() => { setEditingId(null); setForm(blank); }}>Cancel</button>}
      </div>
      {formError && <p className="mv-error" role="alert">{formError}</p>}

      <StateView loading={loading} error={error} onRetry={reload} isEmpty={!data || data.length === 0}
        emptyTitle="No suppliers yet" emptyHint="Add your first supplier above so purchase orders can be pre-filled.">
        <div className="mv-table-wrap">
          <table className="mv-table">
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Lead time</th><th>Currency</th><th /></tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.email}</td><td>{s.phone}</td><td>{s.leadTimeDays} days</td><td>{s.currency}</td>
                  <td>
                    <button className="mv-btn secondary" onClick={() => { setEditingId(s.id); const { id, ...rest } = s; setForm(rest); }}>Edit</button>{" "}
                    <button className="mv-btn danger" onClick={() => remove(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateView>
    </div>
  );
}
