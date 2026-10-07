import { CSSProperties, FormEvent, Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Platform operator dashboard (PLATFORM_ADMIN_EMAILS only; the API enforces it).
 * Failures: every API 5xx, browser crash, failed sign-in, scrape and AI failure, grouped.
 * People: everyone in every workspace; add, disable, change role, reset password.
 */

interface Overview {
  organizations: number;
  users: number;
  active_users: number;
  signed_in_7d: number;
  open_errors: number;
  errors_24h: number;
  failed_logins_24h: number;
  failed_scrapes_24h: number;
}

interface Issue {
  fingerprint: string;
  source: Source;
  level: "error" | "warn";
  count: number;
  open_count: number;
  first_seen: string;
  last_seen: string;
  message: string;
  method: string | null;
  path: string | null;
  status: number | null;
  organizations: number;
  users: number;
}

interface Occurrence {
  id: string;
  created_at: string;
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  context: Record<string, unknown>;
  resolved_at: string | null;
  user_email: string | null;
  organization_name: string | null;
}

interface PlatformUser {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "invited" | "disabled";
  role: string | null;
  created_at: string;
  last_login_at: string | null;
  organization_id: string;
  organization_name: string;
}

interface Org {
  id: string;
  name: string;
  users: number;
  plan: string | null;
}

type Source = "api" | "web" | "scraper" | "auth" | "ai" | "worker";

const SOURCE_LABEL: Record<Source, string> = {
  api: "API",
  web: "Web app",
  auth: "Sign-in",
  scraper: "Scraper",
  ai: "AI",
  worker: "Background",
};

const ROLES = ["owner", "pricing_manager", "inventory_manager", "viewer"];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function PlatformAdmin() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"failures" | "people">("failures");
  const [overview, setOverview] = useState<Overview | null>(null);

  const loadOverview = useCallback(() => {
    api.get<Overview>("/platform/overview").then(setOverview).catch(() => undefined);
  }, []);
  useEffect(loadOverview, [loadOverview]);

  if (me && !me.isPlatformAdmin) return <Navigate to="/app" replace />;

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Platform admin</h1>
      <p style={{ color: "var(--slate)", fontSize: 13, margin: "0 0 16px" }}>
        Every workspace, every account, and everything that has failed.
      </p>

      {overview && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
          <Stat label="Open error issues" value={overview.open_errors} alert={overview.open_errors > 0} />
          <Stat label="Errors (24h)" value={overview.errors_24h} alert={overview.errors_24h > 0} />
          <Stat label="Failed sign-ins (24h)" value={overview.failed_logins_24h} />
          <Stat label="Failed scrapes (24h)" value={overview.failed_scrapes_24h} />
          <Stat label="Active users" value={`${overview.active_users} / ${overview.users}`} />
          <Stat label="Signed in (7d)" value={overview.signed_in_7d} />
          <Stat label="Workspaces" value={overview.organizations} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--hairline)" }}>
        {(["failures", "people"] as const).map((t) => (
          <button key={t} className="btn" style={tabStyle(tab === t)} onClick={() => setTab(t)}>
            {t === "failures" ? "Failures" : "People"}
          </button>
        ))}
      </div>

      {tab === "failures" ? <Failures onChange={loadOverview} /> : <People onChange={loadOverview} />}
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--slate)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: alert ? "var(--critical)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

// ─── Failures ────────────────────────────────────────────────────────────────

function Failures({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [source, setSource] = useState<Source | "">("");
  const [days, setDays] = useState(14);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status, days: String(days), ...(source ? { source } : {}) });
    api
      .get<Issue[]>(`/platform/errors?${qs}`)
      .then((rows) => {
        setIssues(rows);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [status, source, days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function resolve(fp: string) {
    try {
      await api.post(`/platform/errors/${fp}/resolve`);
      load();
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={selectStyle}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as any)} style={selectStyle}>
          <option value="">All sources</option>
          {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle}>
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button className="btn" style={{ fontSize: 12 }} onClick={load}>Refresh</button>
        <span style={{ fontSize: 11, color: "var(--slate)" }}>Updates every 30s</span>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {issues === null ? (
          <p style={emptyStyle}>Loading…</p>
        ) : issues.length === 0 ? (
          <p style={emptyStyle}>Nothing here. No {status === "all" ? "" : status} failures in this window.</p>
        ) : (
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th></th>
                <th>Issue</th>
                <th>Where</th>
                <th style={{ textAlign: "right" }}>Count</th>
                <th>Affected</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <Fragment key={i.fingerprint}>
                  <tr
                    style={{ cursor: "pointer", opacity: i.open_count === 0 ? 0.6 : 1 }}
                    onClick={() => setExpanded(expanded === i.fingerprint ? null : i.fingerprint)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Badge tone={i.level === "error" ? "critical" : "warning"}>{i.level}</Badge>{" "}
                      <Badge tone="info">{SOURCE_LABEL[i.source] ?? i.source}</Badge>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 420 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.message}>
                        {i.message}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--slate)", whiteSpace: "nowrap" }}>
                      {[i.method, i.path].filter(Boolean).join(" ") || "—"}
                      {i.status ? ` · ${i.status}` : ""}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{i.count}</td>
                    <td style={{ fontSize: 12, color: "var(--slate)", whiteSpace: "nowrap" }}>
                      {i.users} user{i.users === 1 ? "" : "s"} · {i.organizations} workspace{i.organizations === 1 ? "" : "s"}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--slate)", whiteSpace: "nowrap" }} title={new Date(i.last_seen).toLocaleString()}>
                      {ago(i.last_seen)}
                    </td>
                    <td>
                      {i.open_count > 0 && (
                        <button
                          className="btn"
                          style={{ fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            resolve(i.fingerprint);
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === i.fingerprint && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--paper)" }}>
                        <IssueDetail issue={i} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function IssueDetail({ issue }: { issue: Issue }) {
  const [rows, setRows] = useState<Occurrence[] | null>(null);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    api.get<Occurrence[]>(`/platform/errors/${issue.fingerprint}`).then(setRows).catch(() => setRows([]));
  }, [issue.fingerprint]);

  if (!rows) return <p style={emptyStyle}>Loading occurrences…</p>;
  if (!rows.length) return <p style={emptyStyle}>No occurrences recorded.</p>;
  const sel = rows[Math.min(open, rows.length - 1)];

  return (
    <div style={{ padding: "8px 4px", display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--slate)" }}>
        First seen {new Date(issue.first_seen).toLocaleString()} · showing the latest {rows.length} of {issue.count}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {rows.slice(0, 12).map((r, idx) => (
          <button key={r.id} className="btn" style={{ fontSize: 11, ...(idx === open ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }} onClick={() => setOpen(idx)}>
            {new Date(r.created_at).toLocaleString()}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13 }}>
        <strong>{sel.message}</strong>
        <div style={{ color: "var(--slate)", fontSize: 12, marginTop: 4 }}>
          {sel.user_email ? `User: ${sel.user_email}` : "No signed-in user"}
          {sel.organization_name ? ` · Workspace: ${sel.organization_name}` : ""}
          {sel.path ? ` · ${[sel.method, sel.path].filter(Boolean).join(" ")}` : ""}
          {sel.status ? ` · HTTP ${sel.status}` : ""}
          {sel.resolved_at ? ` · resolved ${ago(sel.resolved_at)}` : ""}
        </div>
      </div>
      {Object.keys(sel.context ?? {}).length > 0 && <pre style={preStyle}>{JSON.stringify(sel.context, null, 2)}</pre>}
      {sel.stack && <pre style={preStyle}>{sel.stack}</pre>}
    </div>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────

function People({ onChange }: { onChange: () => void }) {
  const { me } = useAuth();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const [form, setForm] = useState({ fullName: "", email: "", role: "owner", organizationId: "", organizationName: "", password: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<PlatformUser[]>("/platform/users").then(setUsers).catch((e) => setError(e.message));
    api.get<Org[]>("/platform/organizations").then(setOrgs).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.full_name} ${u.email} ${u.organization_name}`.toLowerCase().includes(q));
  }, [users, filter]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addPerson(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await run(async () => {
      const newOrg = form.organizationId === "__new";
      const res = await api.post<{ email: string; password: string }>("/platform/users", {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        ...(newOrg ? { organizationName: form.organizationName } : { organizationId: form.organizationId }),
        ...(form.password ? { password: form.password } : {}),
      });
      setSecret({ email: res.email, password: res.password });
      setForm({ fullName: "", email: "", role: "owner", organizationId: "", organizationName: "", password: "" });
    });
    setSaving(false);
  }

  function resetPassword(u: PlatformUser) {
    if (!window.confirm(`Reset the password for ${u.email}? They will be signed out everywhere.`)) return;
    run(async () => {
      const res = await api.post<{ password: string }>(`/platform/users/${u.id}/reset-password`, {});
      setSecret({ email: u.email, password: res.password });
    });
  }

  return (
    <div>
      {error && <div style={errorStyle}>{error}</div>}
      {secret && <PasswordNotice {...secret} onClose={() => setSecret(null)} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <strong style={{ display: "block", marginBottom: 4 }}>Add a person</strong>
        <p style={{ color: "var(--slate)", fontSize: 12, margin: "0 0 12px" }}>
          Only people added here or by a workspace owner can sign in. Leave the password blank to generate one.
        </p>
        <form onSubmit={addPerson} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
          <Field label="Full name">
            <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Email">
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Workspace">
            <select required value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} style={inputStyle}>
              <option value="" disabled>Choose…</option>
              <option value="__new">+ New workspace</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.users})</option>
              ))}
            </select>
          </Field>
          {form.organizationId === "__new" && (
            <Field label="New workspace name">
              <input required value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} style={inputStyle} />
            </Field>
          )}
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </select>
          </Field>
          <Field label="Password (optional)">
            <input type="text" minLength={8} value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} style={inputStyle} placeholder="Generate for me" />
          </Field>
          <button type="submit" className="btn primary" disabled={saving} style={{ fontSize: 13, height: 36 }}>
            {saving ? "Adding…" : "Add person"}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <strong>Everyone ({users.length})</strong>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name, email, workspace" style={{ ...inputStyle, maxWidth: 280, marginLeft: "auto" }} />
        </div>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Workspace</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id} style={{ opacity: u.status === "active" ? 1 : 0.55 }}>
                  <td style={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{u.full_name}{self && <span style={{ fontSize: 10, color: "var(--slate)", marginLeft: 6 }}>(you)</span>}</div>
                    <div style={{ color: "var(--slate)", fontSize: 12 }}>{u.email}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>{u.organization_name}</td>
                  <td>
                    <select
                      disabled={self}
                      value={u.role ?? ""}
                      onChange={(e) => run(() => api.patch(`/platform/users/${u.id}`, { role: e.target.value }))}
                      style={selectStyle}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                    </select>
                  </td>
                  <td>
                    <Badge tone={u.status === "active" ? "success" : u.status === "invited" ? "warning" : "critical"}>
                      {u.status === "invited" ? "pending" : u.status}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--slate)" }}>{ago(u.last_login_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!self && (
                      <>
                        <button className="btn" style={{ fontSize: 12, marginRight: 6 }} onClick={() => resetPassword(u)}>
                          Reset password
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12 }}
                          onClick={() => run(() => api.patch(`/platform/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }))}
                        >
                          {u.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Shows a password exactly once. It is not stored anywhere readable. */
export function PasswordNotice({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ ...successStyle, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span>
        Password for <strong>{email}</strong>:{" "}
        <code className="mono" style={{ fontSize: 14, padding: "2px 6px", background: "var(--card)", borderRadius: 4 }}>{password}</code>
      </span>
      <span style={{ fontSize: 12 }}>Copy it now and send it privately. It won't be shown again.</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <button
          className="btn"
          style={{ fontSize: 12 }}
          onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true), () => undefined)}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn" style={{ fontSize: 12 }} onClick={onClose}>Done</button>
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const TONES = {
  success: { bg: "#EAF3EC", color: "var(--success)" },
  critical: { bg: "#FBEAE7", color: "var(--critical)" },
  warning: { bg: "#FBF0E4", color: "var(--warning)" },
  info: { bg: "#EAEFF4", color: "var(--info)" },
};

function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: TONES[tone].bg, color: TONES[tone].color }}>
      {children}
    </span>
  );
}

const tabStyle = (active: boolean): CSSProperties => ({
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  borderRadius: "6px 6px 0 0",
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  color: active ? "var(--accent)" : "var(--slate)",
  fontWeight: active ? 600 : 400,
  fontSize: 13,
  padding: "8px 14px",
  background: "transparent",
});
const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  background: "var(--paper)",
  color: "var(--ink)",
  boxSizing: "border-box",
};
const selectStyle: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "5px 8px",
  fontSize: 12,
  background: "var(--paper)",
  color: "var(--ink)",
};
const preStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  fontSize: 11,
  lineHeight: 1.5,
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 320,
};
const emptyStyle: CSSProperties = { color: "var(--slate)", fontSize: 13, padding: 16, margin: 0 };
const errorStyle: CSSProperties = {
  background: "#FBEAE7",
  color: "var(--critical)",
  border: "1px solid var(--critical)",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 16,
};
const successStyle: CSSProperties = {
  background: "#EAF3EC",
  color: "var(--success)",
  border: "1px solid var(--success)",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 16,
};
