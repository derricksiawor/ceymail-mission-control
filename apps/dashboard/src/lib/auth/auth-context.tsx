"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          // Explicit auth failure — session expired or invalid
          if (!cancelled) {
            setUser(null);
            setLoading(false);
            router.replace("/login");
          }
          return;
        }
        if (!res.ok) {
          // Server error (500, 502, etc.) — don't redirect to login,
          // the session may still be valid
          if (!cancelled) {
            setUser(null);
            setLoading(false);
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setUser(data.user);
          setLoading(false);
        }
      } catch {
        // Network error — don't redirect to login. The session may still
        // be valid; the request just didn't reach the server.
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Best effort
    }
    setUser(null);
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
