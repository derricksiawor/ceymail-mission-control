"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, User, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Check welcome wizard state, then auth state
  useEffect(() => {
    async function checkSetup() {
      // 1. Check if first-run wizard is needed
      try {
        const res = await fetch("/api/welcome/status");
        const data = await res.json();
        if (data.state === "UNCONFIGURED" || data.state === "NEEDS_ADMIN") {
          router.replace("/welcome");
          return;
        }
      } catch {
        // Status check failed, continue to auth checks
      }

      // 2. Check if legacy setup is needed (DB configured but no admin)
      try {
        const res = await fetch("/api/auth/setup");
        const data = await res.json();
        if (data.needsSetup) {
          router.replace("/setup");
          return;
        }
      } catch {
        // Setup check failed, show login anyway
      }

      // 3. Check if already authenticated
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          router.replace("/");
          return;
        }
      } catch {
        // Not authenticated, show login
      }

      setCheckingSetup(false);
    }

    checkSetup();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      // Cookie is set on the login response via httpOnly Set-Cookie header.
      // Use window.location (not router.replace) to ensure the browser processes
      // the Set-Cookie header before navigating.
      window.location.href = "/";
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return (
      <div className="flex items-center gap-3 text-mc-text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Initializing...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      {/* Brand */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mc-accent font-bold text-white text-2xl shadow-lg shadow-mc-accent/20">
          C
        </div>
        <h1 className="text-2xl font-bold text-mc-text">Mission Control</h1>
        <p className="mt-1 text-sm text-mc-text-muted">
          Sign in to manage your mail server
        </p>
      </div>

      {/* Login Card */}
      <div className="glass rounded-2xl p-6 shadow-xl shadow-black/10">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error Banner */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-mc-danger/30 bg-mc-danger/10 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-mc-danger" />
              <p className="text-sm text-mc-danger">{error}</p>
            </div>
          )}

          {/* Username */}
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-mc-text">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                autoFocus
                required
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-mc-text">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-10 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[44px] min-w-[44px] text-mc-text-muted hover:text-mc-text"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-mc-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-mc-text-muted/60">
        CeyMail Mission Control v{process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}
      </p>
    </div>
  );
}
