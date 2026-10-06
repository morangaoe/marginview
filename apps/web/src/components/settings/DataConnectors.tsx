import { Link } from "react-router-dom";

const PROVIDERS = [
  { name: "Shopify", note: "Products, costs and stock levels" },
  { name: "Lightspeed", note: "Catalog and inventory counts" },
  { name: "ERP / custom API", note: "NetSuite, SAP, Odoo or your own endpoint" },
];

export default function DataConnectors({ enterprise }: { enterprise: boolean }) {
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <strong style={{ display: "block", marginBottom: 4 }}>
        {enterprise ? "Enterprise integrations" : "External data connectors"}
      </strong>
      <p style={{ color: "var(--slate)", fontSize: 13, marginTop: 0 }}>
        Connector setup is handled with our team. Connections are read-only: Marginview does not write inventory or price changes back.
      </p>
      {PROVIDERS.map((provider) => (
        <div key={provider.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{provider.name} <span className="pill info" style={{ marginLeft: 6 }}>Read-only</span></div>
            <div style={{ color: "var(--slate)", fontSize: 12 }}>{provider.note}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill warn"><span className="dot" />Not connected</span>
            <Link to={`/contact?connector=${encodeURIComponent(provider.name)}`} className="btn" style={{ fontSize: 12 }}>Request setup</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
