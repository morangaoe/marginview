import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { TIER_MODULES, type ModuleKey, type Tier } from "./plans";

interface PlanState {
  tier: Tier | null;
  effectiveTier: Tier | null;
  status: string | null;
  loading: boolean;
  can: (module: ModuleKey) => boolean;
  refresh: () => void;
}

const PlanContext = createContext<PlanState>({
  tier: null,
  effectiveTier: null,
  status: null,
  loading: true,
  can: () => false,
  refresh: () => {},
});

export function PlanProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [data, setData] = useState<{ tier: Tier; effectiveTier: Tier; status: string } | null>(null);
  const [loading, setLoading] = useState(!!token);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    if (!token) {
      setData(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    api.get<{ tier: Tier; effectiveTier: Tier; status: string }>("/billing/usage")
      .then((result) => { setData(result); setFailed(false); })
      .catch((error) => { console.warn("[plan] could not load plan", error); setFailed(true); })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(refresh, [refresh]);

  const value = useMemo<PlanState>(() => ({
    tier: data?.tier ?? null,
    effectiveTier: data?.effectiveTier ?? null,
    status: data?.status ?? null,
    loading,
    can: (module) => (failed ? true : !!data && TIER_MODULES[data.effectiveTier].includes(module)),
    refresh,
  }), [data, loading, failed, refresh]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlanAccess() {
  return useContext(PlanContext);
}
