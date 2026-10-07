import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PasswordNotice } from "./PlatformAdmin";

interface Member {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full access including team management and billing",
  pricing_manager: "Can view and apply pricing changes",
  inventory_manager: "Can adjust inventory and create purchase orders",
  viewer: "Read-only access to all data",
};

const ROLE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  owner: { bg: "#EAF3EC", color: "var(--success)" },
  pricing_manager: { bg: "#EAEFF4", color: "var(--info)" },
  inventory_manager: { bg: "#FBF0E4", color: "var(--warning)" },
  viewer: { bg: "var(--paper)", color: "var(--slate)" },
};

export function Admin() {
  const { user } = useAuth();

  // All hooks must run unconditionally before any early return (Rules of Hooks).
  // The redirect to "/" for non-owners happens below, after every hook has run.
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Invite form
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Member["role"]>("viewer");
  const [tempPassword, setTempPassword] = useState("");
  const [inviting, setInviting] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  function load() {
    api.get<Member[]>("/admin/members").then(setMembers).catch(() => {});
  }

  useEffect(load, []);

  // Only owners may see this page — redirect others (after all hooks have run)
  if (user && user.role !== "owner") {
    return <Navigate to="/" replace />;
  }

  function flash(msg: string) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3500);
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const res = await api.post<{ email: string; temporaryPassword: string }>("/admin/members", {
        email,
        fullName,
        role,
        ...(tempPassword ? { temporaryPassword: tempPassword } : {}),
      });
      setSecret({ email: res.email, password: res.temporaryPassword });
      setEmail("");
      setFullName("");
      setRole("viewer");
      setTempPassword("");
      load();
      flash(`${fullName} added as ${role}.`);
    } catch (err: any) {
      setError(err.message ?? "Could not add team member.");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(memberId: string, newRole: string) {
    try {
      await api.patch(`/admin/members/${memberId}`, { role: newRole });
      load();
      flash("Role updated.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resetPassword(member: Member) {
    if (!window.confirm(`Reset the password for ${member.email}? They will be signed out everywhere.`)) return;
    try {
      const res = await api.post<{ password: string }>(`/admin/members/${member.id}/reset-password`, {});
      setSecret({ email: member.email, password: res.password });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleStatus(member: Member) {
    const newStatus = member.status === "active" ? "disabled" : "active";
    try {
      await api.patch(`/admin/members/${member.id}`, { status: newStatus });
      load();
      flash(`${member.full_name} ${newStatus === "disabled" ? "disabled" : "re-enabled"}.`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Team & access</h1>
      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}
      {secret && <PasswordNotice {...secret} onClose={() => setSecret(null)} />}

      {/* Role legend */}
      <div className="card" style={{ marginBottom: 16 }}>
        <strong style={{ display: "block", marginBottom: 12 }}>Roles</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {Object.entries(ROLE_DESCRIPTIONS).map(([r, desc]) => {
            const badge = ROLE_BADGE_COLORS[r];
            return (
              <div key={r} style={{ fontSize: 13 }}>
                <span style={{
                  display: "inline-block",
                  background: badge.bg,
                  color: badge.color,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 10,
                  marginBottom: 4,
                }}>
                  {r.replace("_", " ")}
                </span>
                <div style={{ color: "var(--slate)", fontSize: 12 }}>{desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Member list */}
      <div className="card" style={{ marginBottom: 16 }}>
        <strong style={{ display: "block", marginBottom: 12 }}>Team members ({members.length})</strong>
        {members.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No members loaded.</p>}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.id === user?.id;
              const badge = ROLE_BADGE_COLORS[m.role] ?? { bg: "var(--paper)", color: "var(--slate)" };
              return (
                <tr key={m.id} style={{ opacity: m.status === "disabled" ? 0.5 : 1 }}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>
                    {m.full_name}
                    {isSelf && <span style={{ fontSize: 10, color: "var(--slate)", marginLeft: 6 }}>(you)</span>}
                  </td>
                  <td style={{ fontSize: 13, color: "var(--slate)" }}>{m.email}</td>
                  <td>
                    {isSelf ? (
                      <span style={{
                        display: "inline-block",
                        background: badge.bg,
                        color: badge.color,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 10,
                      }}>
                        {m.role.replace("_", " ")}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.id, e.target.value)}
                        style={{
                          border: "1px solid var(--hairline)",
                          borderRadius: 6,
                          padding: "3px 6px",
                          fontSize: 12,
                          background: "var(--paper)",
                          color: "var(--ink)",
                        }}
                      >
                        <option value="owner">owner</option>
                        <option value="pricing_manager">pricing_manager</option>
                        <option value="inventory_manager">inventory_manager</option>
                        <option value="viewer">viewer</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: m.status === "active" ? "#EAF3EC" : "#FBEAE7",
                      color: m.status === "active" ? "var(--success)" : "var(--critical)",
                    }}>
                      {m.status === "invited" ? "pending" : m.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--slate)" }}>
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleDateString() : "never"}
                  </td>
                  <td>
                    {!isSelf && (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <button className="btn" style={{ fontSize: 12, marginRight: 6 }} onClick={() => resetPassword(m)}>
                          Reset password
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: 12 }}
                          onClick={() => toggleStatus(m)}
                        >
                          {m.status === "active" ? "Disable" : m.status === "invited" ? "Approve" : "Enable"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Invite form */}
      <div className="card" style={{ maxWidth: 480 }}>
        <strong style={{ display: "block", marginBottom: 4 }}>Add a team member</strong>
        <p style={{ color: "var(--slate)", fontSize: 12, marginBottom: 16 }}>
          Leave the password blank to generate one. You'll see it once; send it to them privately.
          They can change it in Settings after signing in.
        </p>
        <form onSubmit={handleInvite}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Full name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} placeholder="Alex Johnson" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email address</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="alex@company.com" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle }}>
              <option value="viewer">Viewer</option>
              <option value="inventory_manager">Inventory Manager</option>
              <option value="pricing_manager">Pricing Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Temporary password (optional)</label>
            <input
              type="text"
              autoComplete="new-password"
              minLength={8}
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              style={inputStyle}
              placeholder="Generate for me"
            />
          </div>
          <button type="submit" className="btn primary" disabled={inviting} style={{ fontSize: 13 }}>
            {inviting ? "Adding…" : "Add team member"}
          </button>
        </form>
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = { marginBottom: 14 };
const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 };
const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  background: "var(--paper)",
  color: "var(--ink)",
};
const errorStyle: CSSProperties = {
  background: "#FBEAE7", color: "var(--critical)",
  border: "1px solid var(--critical)", borderRadius: 6,
  padding: "10px 12px", fontSize: 13, marginBottom: 16,
};
const successStyle: CSSProperties = {
  background: "#EAF3EC", color: "var(--success)",
  border: "1px solid var(--success)", borderRadius: 6,
  padding: "10px 12px", fontSize: 13, marginBottom: 16,
};
