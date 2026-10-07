import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

export function PublicLayout() {
  const [solid, setSolid] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const fn = () => setSolid(window.scrollY > 24);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div style={{ minHeight: "100%", background: "#080808" }}>
      <header className={`mv-nav ${solid ? "solid" : ""}`}>
        <Link to="/" className="mv-logo"><i />Marginview</Link>
        <nav className="mv-nav-links">
          <Link to="/demo" className="txt">Demo</Link>
          <Link to="/audit" className="txt">Free audit</Link>
          <Link to="/login" className="txt">Sign in</Link>
          <Link to="/signup" className="btn primary" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>Start free trial</Link>
        </nav>
      </header>
      <Outlet />
      <footer
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          justifyContent: "center",
          padding: "32px 16px",
          fontSize: 13,
          color: "#9a9a9a",
        }}
      >
        <Link to="/terms" className="txt">Terms</Link>
        <Link to="/privacy" className="txt">Privacy</Link>
        <Link to="/contact" className="txt">Contact</Link>
      </footer>
    </div>
  );
}