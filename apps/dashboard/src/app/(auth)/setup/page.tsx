"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Shield, User, Mail, Lock, Eye, EyeOff, AlertCircle,
  Loader2, Check, X,
} from "lucide-react";

interface PasswordCheck {
  label: string;
  met: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch("/api/auth/setup");
        const data = await res.json();
        if (!data.needsSetup) {
          router.replace("/login");
          return;
        }
      } catch {
        // If check fails, show setup anyway
      }
      setCheckingSetup(false);
    }

    checkSetup();
  }, [router]);

  const passwordChecks: PasswordCheck[] = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
    { label: "Special character", met: /[^A-Za-z0-9]/.test(password) },
  ];

  const allChecksMet = passwordChecks.every((c) => c.met);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!allChecksMet) {
      setError("Password does not meet all requirements");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Setup failed");
        setLoading(false);
        return;
      }

      // Use window.location (not router.replace) to ensure the browser
      // processes the Set-Cookie header before navigating
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
        <span className="text-sm">Checking setup status...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      {/* Brand */}
      <div className="mb-8 text-center">
        <Image src="/icon.png" alt="CeyMail" width={56} height={56} className="mx-auto mb-4 h-14 w-14" />
        <h1 className="text-2xl font-bold text-mc-text">Welcome to Mission Control</h1>
        <p className="mt-1 text-sm text-mc-text-muted">
          Create your administrator account to get started
        </p>
      </div>

      {/* Setup Card */}
      <div className="rounded-2xl border border-mc-border bg-mc-surface p-6 shadow-xl shadow-black/20">
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-mc-accent/20 bg-mc-accent/5 px-3 py-2.5">
          <Shield className="h-4 w-4 shrink-0 text-mc-accent" />
          <p className="text-xs text-mc-accent">
            This account will have full administrator privileges.
          </p>
        </div>

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
                minLength={3}
                maxLength={50}
                pattern="[a-zA-Z0-9_.\-]+"
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
              />
            </div>
            <p className="mt-1 text-xs text-mc-text-muted">
              Letters, numbers, underscores, hyphens, dots. 3-50 characters.
            </p>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-mc-text">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@yourdomain.com"
                autoComplete="email"
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
                placeholder="Create a strong password"
                autoComplete="new-password"
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

            {/* Password Strength Checklist */}
            {password.length > 0 && (
              <div className="mt-2 space-y-1">
                {passwordChecks.map((check) => (
                  <div key={check.label} className="flex items-center gap-2">
                    {check.met ? (
                      <Check className="h-3 w-3 text-mc-success" />
                    ) : (
                      <X className="h-3 w-3 text-mc-text-muted/50" />
                    )}
                    <span
                      className={`text-xs ${
                        check.met ? "text-mc-success" : "text-mc-text-muted/60"
                      }`}
                    >
                      {check.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-mc-text">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                autoComplete="new-password"
                required
                className="w-full rounded-lg border border-mc-border bg-mc-bg py-2.5 pl-10 pr-4 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
              />
            </div>
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="mt-1 text-xs text-mc-danger">Passwords do not match</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !email || !allChecksMet || !passwordsMatch}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-mc-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4" />
                Create Admin Account
              </>
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
