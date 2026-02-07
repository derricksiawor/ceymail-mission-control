"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Info,
  ChevronRight,
} from "lucide-react";

interface Props {
  onNext: () => void;
}

interface ProvisionStep {
  step: string;
  status: "done" | "failed";
  detail: string;
}

export function DatabaseSetup({ onNext }: Props) {
  // Connection form
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [rootUser, setRootUser] = useState("root");
  const [rootPassword, setRootPassword] = useState("");

  // CeyMail user
  const [ceymailUser, setCeymailUser] = useState("ceymail");
  const [ceymailPassword, setCeymailPassword] = useState(() => generatePassword());
  const [copiedPassword, setCopiedPassword] = useState(false);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    version?: string;
    error?: string;
  } | null>(null);

  // Provision state
  const [provisioning, setProvisioning] = useState(false);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStep[]>([]);
  const [provisionError, setProvisionError] = useState("");
  const [provisionDone, setProvisionDone] = useState(false);

  function generatePassword(): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => chars[b % chars.length]).join("");
  }

  const handleRegenerate = () => {
    setCeymailPassword(generatePassword());
    setCopiedPassword(false);
  };

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(ceymailPassword);
    setCopiedPassword(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedPassword(false), 2000);
  };

  const canTest = rootPassword.trim().length > 0;
  const canProvision =
    testResult?.success && !provisionDone && ceymailPassword.trim().length > 0;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/welcome/test-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          rootUser: rootUser.trim(),
          rootPassword,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionError("");
    setProvisionSteps([]);
    try {
      const res = await fetch("/api/welcome/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          rootUser: rootUser.trim(),
          rootPassword,
          ceymailUser: ceymailUser.trim(),
          ceymailPassword,
        }),
      });
      const data = await res.json();

      if (data.steps) {
        setProvisionSteps(data.steps);
      }

      if (data.success) {
        setProvisionDone(true);
      } else {
        setProvisionError(data.error || "Provisioning failed");
      }
    } catch {
      setProvisionError("Network error during provisioning");
    } finally {
      setProvisioning(false);
    }
  };

  const portNum = useMemo(() => parseInt(port, 10), [port]);
  const portValid = !isNaN(portNum) && portNum > 0 && portNum < 65536;

  return (
    <div className="glass rounded-2xl p-6 shadow-xl shadow-black/10 sm:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-mc-text">Database Setup</h1>
        <p className="mt-1 text-sm text-mc-text-muted">
          Connect to your MariaDB/MySQL server to create the CeyMail databases.
        </p>
      </div>

      {/* Connection Section */}
      <fieldset disabled={provisionDone} className="space-y-6">
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
            Connection
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-mc-text">
                Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setTestResult(null);
                }}
                placeholder="localhost"
                className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-mc-text">
                Port
              </label>
              <input
                type="text"
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setTestResult(null);
                }}
                placeholder="3306"
                className={`w-full rounded-lg border bg-mc-bg px-4 py-2.5 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:outline-none focus:ring-1 disabled:opacity-50 ${
                  port && !portValid
                    ? "border-mc-danger focus:border-mc-danger focus:ring-mc-danger/50"
                    : "border-mc-border focus:border-mc-accent focus:ring-mc-accent/50"
                }`}
              />
            </div>
          </div>
        </div>

        {/* Root Credentials */}
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
            Root / Admin Credentials
          </h2>
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-mc-info/20 bg-mc-info/5 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-mc-info" />
            <p className="text-xs text-mc-info">
              Used once to create the CeyMail database user. Never stored.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-mc-text">
                Username
              </label>
              <input
                type="text"
                value={rootUser}
                onChange={(e) => {
                  setRootUser(e.target.value);
                  setTestResult(null);
                }}
                placeholder="root"
                className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-mc-text">
                Password
              </label>
              <input
                type="password"
                value={rootPassword}
                onChange={(e) => {
                  setRootPassword(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Enter root password"
                className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestConnection}
            disabled={!canTest || testing}
            className="flex items-center gap-2 rounded-lg bg-mc-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Database className="h-4 w-4" />
                Test Connection
              </>
            )}
          </button>

          {testResult && (
            <div className="flex items-center gap-2 text-sm">
              {testResult.success ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-mc-success" />
                  <span className="text-mc-success">
                    Connected — {testResult.version}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-mc-danger" />
                  <span className="text-mc-danger">{testResult.error}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* CeyMail User Section */}
        {testResult?.success && (
          <div>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
              CeyMail Database User
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-mc-text">
                  Username
                </label>
                <input
                  type="text"
                  value={ceymailUser}
                  onChange={(e) => setCeymailUser(e.target.value)}
                  placeholder="ceymail"
                  className="w-full rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 text-sm text-mc-text placeholder:text-mc-text-muted/50 focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-mc-text">
                  Password
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ceymailPassword}
                    onChange={(e) => setCeymailPassword(e.target.value)}
                    className="flex-1 rounded-lg border border-mc-border bg-mc-bg px-4 py-2.5 font-mono text-xs text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    title="Copy password"
                    className="flex items-center justify-center rounded-lg border border-mc-border bg-mc-surface px-2.5 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text disabled:opacity-50"
                  >
                    {copiedPassword ? (
                      <Check className="h-4 w-4 text-mc-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    title="Regenerate password"
                    className="flex items-center justify-center rounded-lg border border-mc-border bg-mc-surface px-2.5 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </fieldset>

      {/* Provision Button + Progress */}
      {testResult?.success && !provisionDone && (
        <div className="mt-6">
          <button
            onClick={handleProvision}
            disabled={!canProvision || provisioning}
            className="flex items-center gap-2 rounded-lg bg-mc-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {provisioning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <Database className="h-4 w-4" />
                Set Up Database
              </>
            )}
          </button>
        </div>
      )}

      {/* Provision Progress */}
      {provisionSteps.length > 0 && (
        <div className="mt-4 space-y-2 rounded-lg border border-mc-border bg-mc-bg p-4">
          {provisionSteps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {s.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-mc-success" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-mc-danger" />
              )}
              <span
                className={
                  s.status === "done" ? "text-mc-text" : "text-mc-danger"
                }
              >
                {s.step}
              </span>
              <span className="text-mc-text-muted">— {s.detail}</span>
            </div>
          ))}
        </div>
      )}

      {provisionError && (
        <p className="mt-3 text-sm text-mc-danger">{provisionError}</p>
      )}

      {/* Next Button */}
      {provisionDone && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onNext}
            className="flex items-center gap-2 rounded-lg bg-mc-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-mc-accent-hover"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
