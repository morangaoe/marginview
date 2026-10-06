import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { usePlanAccess } from "../plan/PlanContext";
import DataConnectors from "../components/settings/DataConnectors";

interface OrgInfo {
  id: string;
  name: string;
  default_currency: string;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
}

interface Supplier {
  id: string;
  name: string;
  contact_email: string | null;
  default_lead_time_days: number;
}

interface ScrapingSource {
  id: string;
  url: string;
  compliance_status: string;
  last_status: string;
  last_checked_at: string | null;
  competitor_name: string;
  product_name: string;
  sku: string;
  latest_price_cents: number | null;
  latest_currency: string;
  latest_observed_at: string | null;
  validation_flag: string | null;
}

type Tab = "org" | "locations" | "suppliers" | "scraping" | "connectors";

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function Settings() {
  const { user } = useAuth();
  const { can, effectiveTier } = usePlanAccess();
  const [tab, setTab] = useState<Tab>("org");
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Org
  const [orgName, setOrgName] = useState("");
  const [orgCurrency, setOrgCurrency] = useState("USD");

  // Add location
  const [newLocName, setNewLocName] = useState("");
  const [newLocAddress, setNewLocAddress] = useState("");

  // Add supplier
  const [newSupName, setNewSupName] = useState("");
  const [newSupEmail, setNewSupEmail] = useState("");
  const [newSupLead, setNewSupLead] = useState("14");

  const isOwner = user?.role === "owner";
  const showConnectors = effectiveTier === "margin_intelligence" || can("integrations");

  function flash(msg: string) {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  }

  useEffect(() => {
    api.get<OrgInfo>("/admin/org").then((o) => {
      setOrg(o);
      setOrgName(o.name);
      setOrgCurrency(o.default_currency);
    }).catch(() => {});

    api.get<Location[]>("/admin/locations").then(setLocations).catch(() => {});
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    api.get<ScrapingSource[]>("/scraping/sources").then(setSources).catch(() => {});
  }, []);

  async function saveOrg(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch("/admin/org", { name: orgName, defaultCurrency: orgCurrency });
      flash("Organization updated.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addLocation(e: FormEvent) {
    e.preventDefault();
    try {
      const loc = await api.post<Location>("/admin/locations", {
        name: newLocName,
        address: newLocAddress || undefined,
      });
      setLocations((l) => [...l, loc]);
      setNewLocName("");
      setNewLocAddress("");
      flash("Location added.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addSupplier(e: FormEvent) {
    e.preventDefault();
    try {
      const sup = await api.post<Supplier>("/suppliers", {
        name: newSupName,
        contactEmail: newSupEmail || undefined,
        defaultLeadTimeDays: Number(newSupLead),
      });
      setSuppliers((s) => [...s, sup]);
      setNewSupName("");
      setNewSupEmail("");
      setNewSupLead("14");
      flash("Supplier added.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function runSource(sourceId: string) {
    try {
      const result = await api.post<any>(`/scraping/sources/${sourceId}/run`, {});
      flash(`Run complete. ${result.extracted?.priceCents ? `Price: ${money(result.extracted.priceCents)}` : "No price found."}`);
      const updated = await api.get<ScrapingSource[]>("/scraping/sources");
      setSources(updated);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "org", label: "Organization" },
    { key: "locations", label: "Locations" },
    ...(can("procurement") ? [{ key: "suppliers" as Tab, label: "Suppliers" }] : []),
    { key: "scraping", label: "Tracked competitors" },
    ...(showConnectors ? [{ key: "connectors" as Tab, label: can("integrations") ? "Integrations" : "Data connectors" }] : []),
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Settings</h1>
      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--hairline)", paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className="btn"
            style={{
              borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
              borderRadius: "6px 6px 0 0",
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              color: tab === t.key ? "var(--accent)" : "var(--slate)",
              fontWeight: tab === t.key ? 600 : 400,
              fontSize: 13,
              padding: "8px 14px",
              background: "transparent",
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Org tab */}
      {tab === "org" && (
        <div className="card" style={{ maxWidth: 480 }}>
          <strong style={{ display: "block", marginBottom: 16 }}>Organization details</strong>
          <form onSubmit={saveOrg}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Organization name</label>
              <input
                disabled={!isOwner}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Default currency</label>
              <select
                disabled={!isOwner}
                value={orgCurrency}
                onChange={(e) => setOrgCurrency(e.target.value)}
                style={{ ...inputStyle }}
              >
                <option value="USD">USD — US Dollar</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="EUR">EUR — Euro</option>
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="CAD">CAD — Canadian Dollar</option>
              </select>
            </div>
            {isOwner && (
              <button type="submit" className="btn primary" style={{ fontSize: 13 }}>
                Save changes
              </button>
            )}
            {!isOwner && (
              <p style={{ fontSize: 12, color: "var(--slate)" }}>Only the org owner can change these settings.</p>
            )}
          </form>
        </div>
      )}

      {/* Locations tab */}
      {tab === "locations" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <strong style={{ display: "block", marginBottom: 12 }}>Locations</strong>
            {locations.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No locations yet.</p>}
            {locations.map((l) => (
              <div key={l.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline)", fontSize: 14 }}>
                <strong>{l.name}</strong>
                {l.address && <span style={{ color: "var(--slate)", marginLeft: 8, fontSize: 12 }}>{l.address}</span>}
              </div>
            ))}
          </div>

          {isOwner && (
            <div className="card" style={{ maxWidth: 440 }}>
              <strong style={{ display: "block", marginBottom: 12 }}>Add a location</strong>
              <form onSubmit={addLocation}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Name</label>
                  <input required value={newLocName} onChange={(e) => setNewLocName(e.target.value)} style={inputStyle} placeholder="Warehouse A" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Address (optional)</label>
                  <input value={newLocAddress} onChange={(e) => setNewLocAddress(e.target.value)} style={inputStyle} placeholder="123 Main St, City, State" />
                </div>
                <button type="submit" className="btn primary" style={{ fontSize: 13 }}>Add location</button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Suppliers tab */}
      {tab === "suppliers" && can("procurement") && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <strong style={{ display: "block", marginBottom: 12 }}>Suppliers</strong>
            {suppliers.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No suppliers yet.</p>}
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Lead time</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td style={{ color: "var(--slate)", fontSize: 13 }}>{s.contact_email ?? "—"}</td>
                    <td>{s.default_lead_time_days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 440 }}>
            <strong style={{ display: "block", marginBottom: 12 }}>Add a supplier</strong>
            <form onSubmit={addSupplier}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Supplier name</label>
                <input required value={newSupName} onChange={(e) => setNewSupName(e.target.value)} style={inputStyle} placeholder="Acme Distributors" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Contact email (optional)</label>
                <input type="email" value={newSupEmail} onChange={(e) => setNewSupEmail(e.target.value)} style={inputStyle} placeholder="orders@acme.com" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Default lead time (days)</label>
                <input type="number" min={1} value={newSupLead} onChange={(e) => setNewSupLead(e.target.value)} style={inputStyle} />
              </div>
              <button type="submit" className="btn primary" style={{ fontSize: 13 }}>Add supplier</button>
            </form>
          </div>
        </div>
      )}

      {/* Scraping tab */}
      {tab === "scraping" && (
        <div className="card">
          <strong style={{ display: "block", marginBottom: 12 }}>Tracked competitor sources</strong>
          {sources.length === 0 && (
            <p style={{ color: "var(--slate)", fontSize: 13 }}>
              No sources tracked yet. Add competitor URLs from the Pricing intelligence page.
            </p>
          )}
          {sources.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Latest price</th>
                  <th>Last checked</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.competitor_name}</div>
                      <div style={{ fontSize: 11, color: "var(--slate)" }}>
                        {s.compliance_status === "automated_allowed" ? "🤖 Auto" : "✋ Manual"}
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>{s.product_name} <span style={{ color: "var(--slate)" }}>({s.sku})</span></td>
                    <td>
                      <span style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontWeight: 600,
                        background: s.last_status === "ok" ? "#EAF3EC" : s.last_status === "failed" ? "#FBEAE7" : "#EAEFF4",
                        color: s.last_status === "ok" ? "var(--success)" : s.last_status === "failed" ? "var(--critical)" : "var(--info)",
                      }}>
                        {s.last_status}
                      </span>
                      {s.validation_flag === "out_of_band" && (
                        <span style={{ marginLeft: 4, fontSize: 11, color: "var(--warning)" }}>⚠ spike</span>
                      )}
                    </td>
                    <td>{s.latest_price_cents ? money(s.latest_price_cents, s.latest_currency) : "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--slate)" }}>
                      {s.last_checked_at ? new Date(s.last_checked_at).toLocaleString() : "Never"}
                    </td>
                    <td>
                      {s.compliance_status === "automated_allowed" && (
                        <button
                          className="btn"
                          style={{ fontSize: 12 }}
                          onClick={() => runSource(s.id)}
                        >
                          Run now
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === "connectors" && showConnectors && <DataConnectors enterprise={can("integrations")} />}
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
