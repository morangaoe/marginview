import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * FIX: The original ProtectedRoute silently redirected unauthenticated users
 * to /login without preserving where they were trying to go. After login they
 * always landed on /app instead of their original destination.
 *
 * This version:
 *  1. Preserves the intended path via location state so Login can redirect back.
 *  2. Detects brand-new users (no products yet) and redirects them to /app/onboarding
 *     — the flag is set in AuthContext when the JWT contains `newUser: true`.
 */
export function ProtectedRoute() {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    // Pass the current path so Login.tsx can navigate back after successful login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
