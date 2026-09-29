import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { decodeJwt, isExpired, JwtPayload } from "./jwt";

interface AuthState {
  token: string | null;
  user: JwtPayload | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem("mv_token");
    if (!stored) return null;
    const payload = decodeJwt(stored);
    if (!payload || isExpired(payload)) {
      localStorage.removeItem("mv_token");
      return null;
    }
    return stored;
  });

  const user = token ? decodeJwt(token) : null;

  const login = useCallback((newToken: string) => {
    localStorage.setItem("mv_token", newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("mv_token");
    setToken(null);
  }, []);

  // Auto-logout when token expires
  useEffect(() => {
    if (!user?.exp) return;
    const msLeft = user.exp * 1000 - Date.now();
    if (msLeft <= 0) { logout(); return; }
    const timer = setTimeout(logout, msLeft);
    return () => clearTimeout(timer);
  }, [user?.exp, logout]);

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
