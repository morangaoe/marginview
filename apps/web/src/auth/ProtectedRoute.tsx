import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { request } from "../lib/useApi";
import { useAuth } from "./AuthContext";

/**
 * 1. Unauthenticated users go to /login and come back to where they were headed.
 * 2. Workspace owners who haven't finished (or skipped) setup are sent to
 *    /app/onboarding. The server decides via GET /api/onboarding/status, so a
 *    stale JWT can't trigger a redirect loop.
 *
 * If the status call fails we let the user through rather than locking them out.
 * The wizard fires "mv:onboarding-complete" when it finishes so we stop redirecting.
 */
export function ProtectedRoute() {
  const { token, ready } = useAuth();
  const location = useLocation();
  const [required, setRequired] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) {
      setRequired(null);
      return;
    }
    let cancelled = false;
    request<{ required: boolean }>("/onboarding/status")
      .then((r) => !cancelled && setRequired(r.required))
      .catch(() => !cancelled && setRequired(false));

    const onDone = () => setRequired(false);
    window.addEventListener("mv:onboarding-complete", onDone);
    return () => {
      cancelled = true;
      window.removeEventListener("mv:onboarding-complete", onDone);
    };
  }, [token]);

  if (!ready) {
    return (
      <div className="mv-page">
        <p className="mv-sub">Loading…</p>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (required === null) {
    return (
      <div className="mv-page">
        <p className="mv-sub">Loading…</p>
      </div>
    );
  }

  if (required && !location.pathname.startsWith("/app/onboarding")) {
    return <Navigate to="/app/onboarding" replace />;
  }

  return <Outlet />;
}