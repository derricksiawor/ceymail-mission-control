"use client";

import { useState, useMemo, useCallback, type FormEvent } from "react";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface Props {
  onNext: (sessionToken: string) => void;
}

export function AdminAccount({ onNext }: Props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => {
    return {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      digit: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
  }, [password]);

  const strength = useMemo(() => {
    const points = Object.values(checks).filter(Boolean).length;
    if (points <= 2) return { label: "Weak", color: "bg-mc-danger", bars: 1 };
    if (points <= 3) return { label: "Fair", color: "bg-mc-warning", bars: 2 };
    return { label: "Strong", color: "bg-mc-success", bars: 3 };
  }, [checks]);

  const usernameValid =
    username.length >= 3 &&
    username.length <= 50 &&
    /^[a-zA-Z0-9_.-]+$/.test(username);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const allChecks = Object.values(checks).every(Boolean);
  const canSubmit = usernameValid && emailValid && allChecks && passwordsMatch;

  const handleSubmit = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/welcome/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create admin account");
        setLoading(false);
        return;
      }

      setLoading(false);
      onNext(data.sessionToken || "");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }, [canSubmit, username, email, password, onNext]);

  return (
    <div className="glass rounded-2xl p-6 shadow-xl shadow-black/10 sm:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-mc-text">Create Admin Account</h1>
        <p className="mt-1 text-sm text-mc-text-muted">
          Set up your administrator account to manage the dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username */}
        <div>
          <label className="mb-1 block text-sm font-medium text-mc-text">
            Username
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
            />
          </div>
          {username && !usernameValid && (
            <p className="mt-1 text-xs text-mc-danger">
              3-50 characters, letters, numbers, underscores, hyphens, dots
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="mb-1 block text-sm font-medium text-mc-text">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
            />
          </div>
          {email && !emailValid && (
            <p className="mt-1 text-xs text-mc-danger">
              Enter a valid email address
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <label className="mb-1 block text-sm font-medium text-mc-text">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-10 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-mc-text-muted hover:text-mc-text"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Strength meter */}
          {password && (
            <div className="mt-2">
              <div className="mb-1 flex gap-1">
                {[1, 2, 3].map((bar) => (
                  <div
                    key={bar}
                    className={`h-1.5 flex-1 rounded-full ${
                      bar <= strength.bars ? strength.color : "bg-mc-border"
                    }`}
                  />
                ))}
              </div>
              <p
                className={`text-xs ${
                  strength.bars === 1
                    ? "text-mc-danger"
                    : strength.bars === 2
                    ? "text-mc-warning"
                    : "text-mc-success"
                }`}
              >
                {strength.label}
              </p>
            </div>
          )}

          {/* Requirements checklist */}
          {password && (
            <div className="mt-2 space-y-1">
              {[
                { key: "length", label: "At least 8 characters" },
                { key: "uppercase", label: "Uppercase letter" },
                { key: "lowercase", label: "Lowercase letter" },
                { key: "digit", label: "Number" },
                { key: "special", label: "Special character" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5 text-xs">
                  {checks[key as keyof typeof checks] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-mc-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-mc-text-muted" />
                  )}
                  <span
                    className={
                      checks[key as keyof typeof checks]
                        ? "text-mc-success"
                        : "text-mc-text-muted"
                    }
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="mb-1 block text-sm font-medium text-mc-text">
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
            />
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="mt-1 text-xs text-mc-danger">
              Passwords do not match
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-mc-danger/30 bg-mc-danger/10 px-3 py-2.5">
            <p className="text-sm text-mc-danger">{error}</p>
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="flex items-center gap-2 rounded-lg bg-mc-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Account
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
