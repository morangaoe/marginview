import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { request } from "../lib/useApi";
import { decodeJwt, isExpired, JwtPayload } from "./jwt";
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
  token: string | null;
  user: JwtPayload | null;
  me: Me | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  me: null,
  login: () => {},
  logout: () => {},
});

const TOKEN_KEY = "mv_token";

function loadToken(): string | null {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    const payload = decodeJwt(stored);
    // FIX: if the stored token is already expired on page load, clear it
    // immediately instead of letting a 401 cascade through every API call.
    if (!payload || isExpired(payload)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return stored;
  } catch {
    // localStorage may be unavailable in private/sandboxed contexts
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [me, setMe] = useState<Me | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const user = token ? decodeJwt(token) : null;

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, []);

  const login = useCallback((newToken: string) => {
    // FIX: validate the incoming token before storing it to avoid persisting
    // a malformed JWT that would cause a silent redirect loop.
    const payload = decodeJwt(newToken);
    if (!payload) {
      console.error("[auth] login() received an undecodable token — ignoring");
      return;
    }
    if (isExpired(payload)) {
      console.error("[auth] login() received an already-expired token — ignoring");
      return;
    }
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
    } catch {
      /* ignore storage errors in sandboxed environments */
    }
    setToken(newToken);
  }, []);

  // The server ends sessions on disable or password reset; any 401 lands here.
  useEffect(() => {
    window.addEventListener(SESSION_ENDED_EVENT, logout);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, logout);
  }, [logout]);

  useEffect(() => {
    setMe(null);
    if (!token) return;
    let cancelled = false;
    request<Me>("/auth/me")
      .then((m) => !cancelled && setMe(m))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Auto-logout timer: fires when the token hits its expiry time.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!user?.exp) return;

    const msLeft = user.exp * 1000 - Date.now();
    if (msLeft <= 0) {
      // Already expired (race between load and effect)
      logout();
      return;
    }
    timerRef.current = setTimeout(logout, msLeft);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user?.exp, logout]);

  return (
    <AuthContext.Provider value={{ token, user, me, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
