import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/*
 * Auth Context — manages user state backed by an httpOnly cookie.
 *
 * The JWT is stored in an httpOnly cookie set by the backend, so it is
 * never accessible to JavaScript. On mount we validate the session by
 * calling /api/auth/me with credentials: "include" — the browser sends
 * the cookie automatically. If the cookie is missing or expired the
 * backend returns 401 and we treat the user as logged out.
 */

interface User {
  user_id: number;
  external_id: string;
  display_name: string;
  role_name: string;
  email?: string;
  row_scope?: string;
  impersonated_by?: string;
}

interface ImpersonatableUser {
  external_id: string;
  display_name: string;
  role_name: string;
  role_description: string;
  row_scope: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  impersonating: string | null;
  impersonatableUsers: ImpersonatableUser[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setImpersonating: (externalId: string | null) => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [impersonating, setImpersonatingState] = useState<string | null>(null);
  const [impersonatableUsers, setImpersonatableUsers] = useState<
    ImpersonatableUser[]
  >([]);

  const isAdmin = user?.role_name === "admin";

  // ── Validate session cookie on mount ─────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data) => {
        setUser(data);
        if (data.role_name === "admin") {
          loadImpersonatableUsers();
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // ── Load users for admin impersonation dropdown ──────────────
  const loadImpersonatableUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/users`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setImpersonatableUsers(data.users);
      }
    } catch {
      // Non-critical — impersonation just won't be available
    }
  };

  // ── Login ────────────────────────────────────────────────────
  const login = async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || "Login failed");
    }

    const data = await res.json();
    setUser(data.user);

    if (data.user.role_name === "admin") {
      loadImpersonatableUsers();
    }
  };

  // ── Logout ───────────────────────────────────────────────────
  const logout = async () => {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    setUser(null);
    setImpersonatingState(null);
    setImpersonatableUsers([]);
  };

  // ── Set impersonation ────────────────────────────────────────
  const setImpersonating = (externalId: string | null) => {
    setImpersonatingState(externalId);
  };

  // ── Authenticated fetch wrapper ──────────────────────────────
  // Every API call from the app should use this instead of raw fetch.
  // credentials: "include" causes the browser to send the httpOnly cookie.
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (impersonating) {
      headers.set("X-Impersonate", impersonating);
    }
    return fetch(url, { ...options, headers, credentials: "include" });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAdmin,
        impersonating,
        impersonatableUsers,
        login,
        logout,
        setImpersonating,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
