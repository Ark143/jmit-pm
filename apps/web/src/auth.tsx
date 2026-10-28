import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { SessionUser, WorkspaceRef } from "./types";

const WORKSPACE_KEY = "jmit.workspace";

interface AuthContextValue {
  status: "loading" | "anon" | "ready";
  user: SessionUser | null;
  workspaces: WorkspaceRef[];
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshWorkspaces: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "anon" | "ready">("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    localStorage.getItem(WORKSPACE_KEY),
  );

  const applySession = useCallback((payload: { user: SessionUser; workspaces: WorkspaceRef[] }) => {
    setUser(payload.user);
    setWorkspaces(payload.workspaces);
    setStatus("ready");

    const remembered = localStorage.getItem(WORKSPACE_KEY);
    const valid = payload.workspaces.some((w) => w.id === remembered);
    const next = valid ? remembered : (payload.workspaces[0]?.id ?? null);

    setActiveWorkspaceId(next);
    if (next) localStorage.setItem(WORKSPACE_KEY, next);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus("anon");
      return;
    }

    api.auth
      .me()
      .then(applySession)
      .catch(() => {
        tokenStore.clear();
        setStatus("anon");
      });
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.auth.login({ email, password });
      tokenStore.set(session.token);
      applySession(session);
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await api.auth.register({ name, email, password });
      tokenStore.set(session.token);
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(WORKSPACE_KEY);
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setStatus("anon");
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const me = await api.auth.me();
    applySession(me);
  }, [applySession]);

  const setActiveWorkspace = useCallback((id: string) => {
    localStorage.setItem(WORKSPACE_KEY, id);
    setActiveWorkspaceId(id);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      workspaces,
      activeWorkspaceId,
      setActiveWorkspace,
      login,
      register,
      logout,
      refreshWorkspaces,
    }),
    [status, user, workspaces, activeWorkspaceId, setActiveWorkspace, login, register, logout, refreshWorkspaces],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
