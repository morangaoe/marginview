import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { request } from "../lib/useApi";
import { JwtPayload } from "./jwt";
import { SESSION_ENDED_EVENT } from "./session";

/** The signed-in user as the server sees it right now (GET /api/auth/me). */
export interface Me {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  organizationName: string;
  role: JwtPayload["role"];
  isPlatformAdmin: boolean;
}

interface AuthState {
  /** Truthy while signed in. The real credential is an httpOnly cookie the page can't read. */
  token: string | null;
  /** Same claims the UI used to read from the JWT, now taken from the server. */
  user: JwtPayload | null;
  me: Me | null;
  /** False until the first /auth/me answer, so routes don't flash the login page on reload. */
  ready: boolean;
  /** Call after the server has set the session cookie (sign-in, password change). */
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  me: null,
  ready: false,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await request<Me>("/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  // The cookie is the session: ask the server who we are on every page load.
  useEffect(() => {
    try {
      localStorage.removeItem("mv_token"); // tokens from before sessions moved to cookies
    } catch {
      /* storage unavailable */
    }
    void refresh();
  }, [refresh]);

  const clearLocal = useCallback(() => setMe(null), []);

  const logout = useCallback(() => {
    setMe(null);
    // Server removes the cookie. Failure is harmless: the session still expires on its own.
    void request("/auth/logout", { method: "POST" }).catch(() => undefined);
  }, []);

  // The server ends sessions on disable or password reset; any 401 while signed in lands here.
  useEffect(() => {
    window.addEventListener(SESSION_ENDED_EVENT, clearLocal);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, clearLocal);
  }, [clearLocal]);

  const user: JwtPayload | null = me
    ? { id: me.id, sub: me.id, organizationId: me.organizationId, role: me.role, email: me.email }
    : null;

  return (
    <AuthContext.Provider value={{ token: me ? "session" : null, user, me, ready, login: refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
